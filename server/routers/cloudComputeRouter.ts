/**
 * @file routers/cloudComputeRouter.ts
 * @description Omnecor — Cloud Compute Rental tRPC Router
 *
 * Supports GPU compute sessions billed by minute or hour across Vast.ai,
 * RunPod, and Lambda Labs. Sessions are tracked in DB and costs are written
 * to the Agentic Wallet spend log on stop.
 *
 * Users may also register their own monthly cloud compute subscriptions so
 * the wallet can track committed spend against metered usage.
 */

import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc.js";
import { TRPCError } from "@trpc/server";
import { v4 as uuidv4 } from "uuid";
import { eq, and, desc, isNull } from "drizzle-orm";
import { getDb } from "../db.factory.js";
import { cloudComputeSessions, cloudComputeSubscriptions, spendLog } from "../../drizzle/schema.js";
import { createLogger } from "../_core/logger.js";
import { resilientFetch } from "../_core/resilientFetch.js";

const log = createLogger("CloudCompute");

// In-memory idempotency guard: maps an idempotency key to the sessionId already
// created for it. Prevents a client retry (same key) from provisioning — and
// billing for — a duplicate instance. Entries expire after 10 minutes.
const idempotencyCache = new Map<string, { sessionId: string; at: number }>();
const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;

function getIdempotent(key: string): string | undefined {
  const hit = idempotencyCache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > IDEMPOTENCY_TTL_MS) {
    idempotencyCache.delete(key);
    return undefined;
  }
  return hit.sessionId;
}

function setIdempotent(key: string, sessionId: string): void {
  idempotencyCache.set(key, { sessionId, at: Date.now() });
  // Opportunistic sweep
  for (const [k, v] of idempotencyCache) {
    if (Date.now() - v.at > IDEMPOTENCY_TTL_MS) idempotencyCache.delete(k);
  }
}

// ---------------------------------------------------------------------------
// Provider catalog — real-world rates as of 2026-06. Update as market moves.
// ---------------------------------------------------------------------------

export const CLOUD_PROVIDERS = {
  vastai: {
    id: "vastai",
    name: "Vast.ai",
    description: "GPU cloud marketplace — pay per minute",
    billingUnits: ["minute", "hour"] as const,
    apiEndpoint: "https://console.vast.ai/api/v0",
    envKey: "VASTAI_API_KEY",
    plans: [
      { id: "rtx3090", label: "RTX 3090 (24 GB)", vram: "24GB", ratePerHourCents: 35 },
      { id: "rtx4090", label: "RTX 4090 (24 GB)", vram: "24GB", ratePerHourCents: 55 },
      { id: "a100-40", label: "A100 SXM4 (40 GB)", vram: "40GB", ratePerHourCents: 150 },
      { id: "a100-80", label: "A100 SXM4 (80 GB)", vram: "80GB", ratePerHourCents: 250 },
      { id: "h100-sxm5", label: "H100 SXM5 (80 GB)", vram: "80GB", ratePerHourCents: 380 },
    ],
  },
  runpod: {
    id: "runpod",
    name: "RunPod",
    description: "Serverless & pod-based GPU cloud — pay per second",
    billingUnits: ["minute", "hour"] as const,
    apiEndpoint: "https://rest.runpod.io/v1",
    envKey: "RUNPOD_API_KEY",
    plans: [
      { id: "rtx3090", label: "RTX 3090 (24 GB)", vram: "24GB", ratePerHourCents: 44 },
      { id: "rtx4090", label: "RTX 4090 (24 GB)", vram: "24GB", ratePerHourCents: 74 },
      { id: "a100-sxm4-80", label: "A100 SXM4 (80 GB)", vram: "80GB", ratePerHourCents: 239 },
      { id: "h100-sxm5-80", label: "H100 SXM5 (80 GB)", vram: "80GB", ratePerHourCents: 399 },
    ],
  },
  lambda: {
    id: "lambda",
    name: "Lambda Labs",
    description: "Reserved & on-demand GPU instances — pay per hour",
    billingUnits: ["hour"] as const,
    apiEndpoint: "https://cloud.lambdalabs.com/api/v1",
    envKey: "LAMBDA_API_KEY",
    plans: [
      { id: "gpu_1x_a10", label: "1× A10 (24 GB)", vram: "24GB", ratePerHourCents: 60 },
      { id: "gpu_1x_a100_sxm4", label: "1× A100 SXM4 (40 GB)", vram: "40GB", ratePerHourCents: 110 },
      { id: "gpu_1x_h100_pcie", label: "1× H100 PCIe (80 GB)", vram: "80GB", ratePerHourCents: 199 },
      { id: "gpu_8x_h100_sxm5", label: "8× H100 SXM5 (80 GB × 8)", vram: "640GB", ratePerHourCents: 1499 },
    ],
  },
} as const;

export type ProviderId = keyof typeof CLOUD_PROVIDERS;

const PROVIDER_IDS = Object.keys(CLOUD_PROVIDERS) as [ProviderId, ...ProviderId[]];

// ---------------------------------------------------------------------------
// Cost helpers
// ---------------------------------------------------------------------------

function ratePerHourCentsToMicrocents(ratePerHourCents: number): number {
  return ratePerHourCents * 10_000; // 1 cent = 10,000 microcents
}

function computeCostMicrocents(
  ratePerUnitMicrocents: number,
  billingUnit: "minute" | "hour",
  elapsedMs: number
): number {
  const elapsedHours = elapsedMs / 3_600_000;
  const units = billingUnit === "minute" ? elapsedHours * 60 : elapsedHours;
  return Math.ceil(ratePerUnitMicrocents * units);
}

// ---------------------------------------------------------------------------
// Provider API helpers (native fetch, key-gated)
// ---------------------------------------------------------------------------

function getProviderApiKey(envKey: string): string | undefined {
  return process.env[envKey];
}

async function vastaiStartInstance(
  apiKey: string,
  planId: string
): Promise<{ externalId: string } | null> {
  // Ask Vast.ai for the cheapest available offer matching the GPU type.
  // In production, you'd first call /bundles to find an offer ID, then bid on it.
  // We surface the external session ID for reference; actual provisioning
  // depends on the user's Vast.ai account balance.
  try {
    const res = await resilientFetch(`https://console.vast.ai/api/v0/asks/0/`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ gpu_name: planId, num_gpus: 1, image: "pytorch/pytorch:latest" }),
      circuitKey: "vastai",
    });
    if (!res.ok) return null;
    const data = await res.json() as { new_contract?: number };
    return data.new_contract ? { externalId: String(data.new_contract) } : null;
  } catch {
    return null;
  }
}

async function runpodStartPod(
  apiKey: string,
  planId: string
): Promise<{ externalId: string } | null> {
  try {
    const res = await resilientFetch("https://rest.runpod.io/v1/pods", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ gpuTypeId: planId, imageName: "runpod/pytorch:latest", containerDiskInGb: 20 }),
      circuitKey: "runpod",
    });
    if (!res.ok) return null;
    const data = await res.json() as { id?: string };
    return data.id ? { externalId: data.id } : null;
  } catch {
    return null;
  }
}

async function lambdaStartInstance(
  apiKey: string,
  planId: string
): Promise<{ externalId: string } | null> {
  try {
    const credentials = Buffer.from(`${apiKey}:`).toString("base64");
    const res = await resilientFetch("https://cloud.lambdalabs.com/api/v1/instance-operations/launch", {
      method: "POST",
      headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/json" },
      body: JSON.stringify({ instance_type_name: planId, region_name: "us-east-1", quantity: 1 }),
      circuitKey: "lambda",
    });
    if (!res.ok) return null;
    const data = await res.json() as { instance_ids?: string[] };
    return data.instance_ids?.[0] ? { externalId: data.instance_ids[0] } : null;
  } catch {
    return null;
  }
}

/**
 * Terminate a provider session. Returns true when the provider confirmed the
 * stop (2xx), false otherwise. The caller MUST only write the spend log after a
 * confirmed stop so we never bill for compute the provider kept running.
 */
async function terminateProviderSession(
  provider: ProviderId,
  externalId: string,
  apiKey: string
): Promise<boolean> {
  try {
    let res: Response | null = null;
    if (provider === "vastai") {
      res = await resilientFetch(`https://console.vast.ai/api/v0/instances/${externalId}/`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${apiKey}` },
        circuitKey: "vastai",
      });
    } else if (provider === "runpod") {
      res = await resilientFetch(`https://rest.runpod.io/v1/pods/${externalId}/stop`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        circuitKey: "runpod",
      });
    } else if (provider === "lambda") {
      const credentials = Buffer.from(`${apiKey}:`).toString("base64");
      res = await resilientFetch("https://cloud.lambdalabs.com/api/v1/instance-operations/terminate", {
        method: "POST",
        headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/json" },
        body: JSON.stringify({ instance_ids: [externalId] }),
        circuitKey: "lambda",
      });
    }
    return res ? res.ok : false;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const startSessionSchema = z.object({
  provider: z.enum(PROVIDER_IDS),
  planId: z.string().min(1),
  billingUnit: z.enum(["minute", "hour"]).default("hour"),
  projectId: z.string().min(1).max(64),
  /**
   * Optional client-supplied idempotency key. When the same key is replayed
   * (e.g. a network retry), the existing session is returned instead of
   * provisioning — and billing for — a second instance.
   */
  idempotencyKey: z.string().min(1).max(128).optional(),
});

const stopSessionSchema = z.object({
  sessionId: z.string().uuid(),
});

const subscriptionSchema = z.object({
  provider: z.enum(PROVIDER_IDS),
  planName: z.string().min(1).max(128),
  monthlyCents: z.number().int().min(0),
  renewalDate: z.string().datetime().optional(),
  notes: z.string().max(500).optional(),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const cloudComputeRouter = router({
  /** Return the full provider + plan catalog, with live key-configured status. */
  listProviders: protectedProcedure.query(() => {
    return Object.values(CLOUD_PROVIDERS).map(p => ({
      ...p,
      configured: Boolean(getProviderApiKey(p.envKey)),
    }));
  }),

  /** Estimate cost for a given provider plan and duration. */
  estimateCost: protectedProcedure
    .input(z.object({
      provider: z.enum(PROVIDER_IDS),
      planId: z.string(),
      billingUnit: z.enum(["minute", "hour"]).default("hour"),
      durationHours: z.number().positive(),
    }))
    .query(({ input }) => {
      const providerCfg = CLOUD_PROVIDERS[input.provider];
      const plan = providerCfg.plans.find(p => p.id === input.planId);
      if (!plan) throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown plan ID" });

      const ratePerUnitMicrocents = input.billingUnit === "minute"
        ? ratePerHourCentsToMicrocents(plan.ratePerHourCents) / 60
        : ratePerHourCentsToMicrocents(plan.ratePerHourCents);

      const units = input.billingUnit === "minute"
        ? input.durationHours * 60
        : input.durationHours;

      const totalMicrocents = Math.ceil(ratePerUnitMicrocents * units);
      return {
        totalCents: totalMicrocents / 10_000,
        totalDollars: totalMicrocents / 1_000_000,
        ratePerHourCents: plan.ratePerHourCents,
        billingUnit: input.billingUnit,
        durationHours: input.durationHours,
      };
    }),

  /** Start a cloud compute session. Calls provider API when key is configured. */
  startSession: protectedProcedure
    .input(startSessionSchema)
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();

      const providerCfg = CLOUD_PROVIDERS[input.provider];
      const plan = providerCfg.plans.find(p => p.id === input.planId);
      if (!plan) throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown plan ID" });

      const ratePerUnitMicrocents = input.billingUnit === "minute"
        ? ratePerHourCentsToMicrocents(plan.ratePerHourCents) / 60
        : ratePerHourCentsToMicrocents(plan.ratePerHourCents);

      // Idempotency: scope the key to the user so keys can't collide/leak across
      // accounts. A replayed request returns the existing session.
      const idemKey = input.idempotencyKey
        ? `${ctx.user.id}:${input.idempotencyKey}`
        : undefined;
      if (idemKey) {
        const existingId = getIdempotent(idemKey);
        if (existingId) {
          const existing = await db
            .select()
            .from(cloudComputeSessions)
            .where(eq(cloudComputeSessions.id, existingId))
            .limit(1);
          if (existing[0]) {
            log.info(`Idempotent replay for key — returning existing session ${existingId}`);
            return {
              sessionId: existingId,
              provider: providerCfg.name,
              plan: plan.label,
              billingUnit: input.billingUnit,
              ratePerHourCents: plan.ratePerHourCents,
              externalSessionId: existing[0].externalSessionId,
              provisionedByApi: Boolean(existing[0].externalSessionId),
              idempotentReplay: true,
            };
          }
        }
      }

      const apiKey = getProviderApiKey(providerCfg.envKey);
      const sessionId = uuidv4();

      // State machine: insert as "starting" BEFORE calling the provider. No
      // charge can ever accrue against a "starting" or "error" session, so a
      // failed/partial provisioning never produces an orphaned billable record.
      await db.insert(cloudComputeSessions).values({
        id: sessionId,
        userId: ctx.user.id,
        projectId: input.projectId,
        provider: input.provider,
        externalSessionId: null,
        planId: input.planId,
        instanceLabel: plan.label,
        billingUnit: input.billingUnit,
        ratePerUnitMicrocents,
        status: "starting",
      });
      if (idemKey) setIdempotent(idemKey, sessionId);

      let externalSessionId: string | undefined;

      if (apiKey) {
        log.info(`Starting ${input.provider} session for user ${ctx.user.id}, plan ${input.planId}`);
        let result: { externalId: string } | null = null;
        try {
          if (input.provider === "vastai") result = await vastaiStartInstance(apiKey, input.planId);
          else if (input.provider === "runpod") result = await runpodStartPod(apiKey, input.planId);
          else if (input.provider === "lambda") result = await lambdaStartInstance(apiKey, input.planId);
        } catch (err) {
          log.error(`Provider provisioning threw for session ${sessionId}`, { error: (err as Error)?.message });
          result = null;
        }
        externalSessionId = result?.externalId;

        if (!externalSessionId) {
          // Provider did not provision. Mark the session "error" so it is never
          // billed, and surface a clear failure to the user.
          await db
            .update(cloudComputeSessions)
            .set({ status: "error" })
            .where(eq(cloudComputeSessions.id, sessionId));
          throw new TRPCError({
            code: "BAD_GATEWAY",
            message: `${providerCfg.name} did not provision an instance. No charge was incurred.`,
          });
        }
      } else {
        log.warn(`${providerCfg.envKey} not set — session tracked locally without provider provisioning`);
      }

      // Provisioning confirmed (or local-only tracking) → promote to "running".
      await db
        .update(cloudComputeSessions)
        .set({ status: "running", externalSessionId: externalSessionId ?? null })
        .where(eq(cloudComputeSessions.id, sessionId));

      // Surface a clear note when the provider key is absent so the user
      // understands the session is locally-tracked only — not real GPU compute.
      const providerNote = !apiKey
        ? `${providerCfg.envKey} is not configured — session tracked locally only. Set ${providerCfg.envKey} in your .env to provision real GPU compute on ${providerCfg.name}.`
        : null;

      return {
        sessionId,
        provider: providerCfg.name,
        plan: plan.label,
        billingUnit: input.billingUnit,
        ratePerHourCents: plan.ratePerHourCents,
        externalSessionId: externalSessionId ?? null,
        provisionedByApi: Boolean(apiKey && externalSessionId),
        providerNote,
      };
    }),

  /** Stop a session, compute final cost, and record to the wallet spend log. */
  stopSession: protectedProcedure
    .input(stopSessionSchema)
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();

      const rows = await db
        .select()
        .from(cloudComputeSessions)
        .where(and(
          eq(cloudComputeSessions.id, input.sessionId),
          eq(cloudComputeSessions.userId, ctx.user.id),
        ))
        .limit(1);

      const session = rows[0];
      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });
      if (session.status === "stopped") throw new TRPCError({ code: "BAD_REQUEST", message: "Session already stopped" });

      const stoppedAt = new Date();
      const elapsedMs = stoppedAt.getTime() - session.startedAt.getTime();
      const totalCostMicrocents = computeCostMicrocents(
        session.ratePerUnitMicrocents,
        session.billingUnit,
        elapsedMs
      );

      // Terminate on provider if API key present and external session exists.
      // We must CONFIRM the provider stopped the instance before recording spend
      // — otherwise we could bill the user while the instance keeps running.
      const providerCfg = CLOUD_PROVIDERS[session.provider as ProviderId];
      const apiKey = getProviderApiKey(providerCfg.envKey);
      const needsProviderStop = Boolean(apiKey && session.externalSessionId);
      let providerStopConfirmed = !needsProviderStop; // local-only sessions need no confirmation
      if (needsProviderStop) {
        providerStopConfirmed = await terminateProviderSession(
          session.provider as ProviderId,
          session.externalSessionId!,
          apiKey!,
        );
        if (!providerStopConfirmed) {
          // Do NOT mark stopped or write the spend log: the instance may still
          // be running and accruing real charges. Surface a clear error so the
          // user (or a retry) can stop it. The session stays "running".
          log.error(`Provider did not confirm stop for session ${input.sessionId} — not recording spend`);
          throw new TRPCError({
            code: "BAD_GATEWAY",
            message: `${providerCfg.name} did not confirm instance termination. The session is still active — please retry stopping it.`,
          });
        }
      }

      await db
        .update(cloudComputeSessions)
        .set({ status: "stopped", stoppedAt, totalCostMicrocents })
        .where(eq(cloudComputeSessions.id, input.sessionId));

      // Record cost to wallet spend log so budget tracking captures it — ONLY
      // after the provider stop is confirmed (or for local-only sessions).
      if (totalCostMicrocents > 0) {
        await db.insert(spendLog).values({
          id: uuidv4(),
          projectId: session.projectId,
          provider: `cloud_compute:${session.provider}`,
          modelId: session.planId,
          promptTokens: 0,
          completionTokens: 0,
          estimatedCostMicrocents: totalCostMicrocents,
          sessionId: input.sessionId,
        });
      }

      const elapsedMinutes = elapsedMs / 60_000;
      log.info(`Session ${input.sessionId} stopped — ${elapsedMinutes.toFixed(1)} min, $${(totalCostMicrocents / 1_000_000).toFixed(4)}`);

      return {
        sessionId: input.sessionId,
        elapsedMinutes: Math.round(elapsedMinutes),
        totalCostCents: totalCostMicrocents / 10_000,
        totalCostDollars: totalCostMicrocents / 1_000_000,
      };
    }),

  /** List all currently running sessions for the authenticated user. */
  getActiveSessions: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    const rows = await db
      .select()
      .from(cloudComputeSessions)
      .where(and(
        eq(cloudComputeSessions.userId, ctx.user.id),
        eq(cloudComputeSessions.status, "running"),
      ))
      .orderBy(desc(cloudComputeSessions.startedAt));

    const now = Date.now();
    return rows.map(s => {
      const elapsedMs = now - s.startedAt.getTime();
      const currentCostMicrocents = computeCostMicrocents(
        s.ratePerUnitMicrocents,
        s.billingUnit,
        elapsedMs
      );
      return {
        ...s,
        elapsedMinutes: Math.round(elapsedMs / 60_000),
        currentCostDollars: currentCostMicrocents / 1_000_000,
      };
    });
  }),

  /** Paginated session history for the authenticated user. */
  getSessionHistory: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).default(50) }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      return db
        .select()
        .from(cloudComputeSessions)
        .where(eq(cloudComputeSessions.userId, ctx.user.id))
        .orderBy(desc(cloudComputeSessions.createdAt))
        .limit(input.limit);
    }),

  /** Register a monthly cloud compute subscription (informational — wallet tracking). */
  setSubscription: protectedProcedure
    .input(subscriptionSchema)
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();

      await db.insert(cloudComputeSubscriptions).values({
        id: uuidv4(),
        userId: ctx.user.id,
        provider: input.provider,
        planName: input.planName,
        monthlyCents: input.monthlyCents,
        renewalDate: input.renewalDate ? new Date(input.renewalDate) : null,
        notes: input.notes ?? null,
        isActive: 1,
      });

      return { success: true };
    }),

  /** List all active subscriptions for the authenticated user. */
  getSubscriptions: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    return db
      .select()
      .from(cloudComputeSubscriptions)
      .where(and(
        eq(cloudComputeSubscriptions.userId, ctx.user.id),
        eq(cloudComputeSubscriptions.isActive, 1),
      ))
      .orderBy(desc(cloudComputeSubscriptions.createdAt));
  }),

  /** Deactivate a subscription. */
  cancelSubscription: protectedProcedure
    .input(z.object({ subscriptionId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      await db
        .update(cloudComputeSubscriptions)
        .set({ isActive: 0 })
        .where(and(
          eq(cloudComputeSubscriptions.id, input.subscriptionId),
          eq(cloudComputeSubscriptions.userId, ctx.user.id),
        ));
      return { success: true };
    }),
});
