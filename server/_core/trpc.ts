import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from "@shared/const";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { AuditLogService } from "../phase2/services/AuditLogService.js";
import { hasPermission, type Role } from "../phase2/config/rbac.js";
import { getSetting } from "../phase2/services/SettingsService.js";
import { createLogger } from "./logger.js";

const log = createLogger("trpc-audit");

// `cloud` marks a procedure as making an external call subject to Sovereign mode.
// `cloudKind` splits those calls into:
//   "ai"      → cloud AI/model inference (OpenAI, Anthropic, Gemini, Fal, voice,
//               training). ALWAYS blocked in Sovereign — this is the data that
//               must never reach a cloud AI model.
//   "service" → non-AI external services (GitHub/Notion/Drive sync, etc.). Blocked
//               in Sovereign too, UNLESS the operator enables "block AI providers
//               only" (the `sovereignBlockAiOnly` setting), so research workflows
//               like repo pulls, email and web search keep working air-gapped from
//               cloud AI. Defaults to "ai" when unset.
const t = initTRPC.context<TrpcContext>().meta<{ cloud?: boolean; cloudKind?: "ai" | "service" }>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

function redactSensitiveData(obj: unknown): unknown {
  if (!obj || typeof obj !== "object") return obj;
  const redacted = { ...(obj as Record<string, unknown>) };
  const sensitiveKeys = ["password", "token", "secret", "key", "apiKey", "accessToken", "refreshToken"];
  for (const k of Object.keys(redacted)) {
    if (sensitiveKeys.some(s => k.toLowerCase().includes(s))) {
      redacted[k] = "[REDACTED]";
    } else if (typeof redacted[k] === "object") {
      redacted[k] = redactSensitiveData(redacted[k]);
    }
  }
  return redacted;
}

const auditMiddleware = t.middleware(async (opts) => {
  const { ctx, next, path } = opts;
  const result = await next();
  if (ctx.user) {
    // Fire-and-forget — never awaited so it can't block the response, but a
    // failure to persist a security audit event must NOT be silently dropped.
    AuditLogService.getInstance().log({
      eventType: "trpc_call",
      actorId: ctx.user.id,
      actorType: "user",
      procedure: path,
      args: redactSensitiveData((opts as { rawInput?: unknown }).rawInput) as Record<string, unknown> | null,
      result: result.ok ? null : { error: true },
      ipAddress: ctx.req.ip ?? ctx.req.socket?.remoteAddress ?? null,
      sessionId: null,
    }).catch((err: unknown) => {
      log.error(`Failed to persist audit log for procedure "${path}"`, err);
    });
  }
  return result;
});

export const protectedProcedure = t.procedure.use(requireUser).use(auditMiddleware);

// Rejects paired-device sessions (role === "device"). Use for sensitive
// account/device-management mutations that a phone must never perform — e.g.
// minting new pairing codes or revoking devices — even though they aren't
// admin-only for a desktop operator.
const rejectDevice = t.middleware(async opts => {
  const { ctx, next } = opts;
  if (ctx.user?.role === "device") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This action isn't available from a paired device.",
    });
  }
  return next();
});

export const nonDeviceProcedure = protectedProcedure.use(rejectDevice);

const sovereignCheck = t.middleware(async (opts) => {
  const { ctx, meta, next, path } = opts;
  if (ctx.user?.executionMode === "sovereign" && meta?.cloud === true) {
    const kind = meta.cloudKind ?? "ai";
    // When the operator opts into "block AI providers only", non-AI external
    // services (GitHub/Notion/Drive sync, etc.) are allowed through in Sovereign
    // so research can continue — only cloud AI inference stays blocked.
    if (kind === "service" && getSetting("sovereignBlockAiOnly", false)) {
      AuditLogService.getInstance().log({
        eventType: "sovereign_allow",
        actorId: ctx.user.id,
        actorType: "user",
        procedure: path,
        args: null,
        result: { allowed: true, reason: "sovereign_block_ai_only", cloudKind: kind },
        ipAddress: ctx.req.ip ?? ctx.req.socket?.remoteAddress ?? null,
        sessionId: null,
      }).catch((err: unknown) => {
        log.error(`Failed to persist sovereign-allow audit log for procedure "${path}"`, err);
      });
      return next();
    }
    AuditLogService.getInstance().log({
      eventType: "sovereign_block",
      actorId: ctx.user.id,
      actorType: "user",
      procedure: path,
      args: null,
      result: { blocked: true, reason: "sovereign_mode", cloudKind: kind },
      ipAddress: ctx.req.ip ?? ctx.req.socket?.remoteAddress ?? null,
      sessionId: null,
    }).catch((err: unknown) => {
      log.error(`Failed to persist sovereign-block audit log for procedure "${path}"`, err);
    });
    const message =
      kind === "service"
        ? "Sovereign mode: external service calls are disabled. Enable 'block AI providers only' in Settings to allow non-AI services."
        : "Sovereign mode: cloud AI calls are disabled.";
    throw new TRPCError({ code: "FORBIDDEN", message });
  }
  return next();
});

// Cloud AI inference — always blocked in Sovereign mode.
export const cloudProcedure = protectedProcedure.meta({ cloud: true, cloudKind: "ai" }).use(sovereignCheck);

// Non-AI external service call (GitHub/Notion/Drive sync, etc.). Blocked in
// Sovereign mode unless `sovereignBlockAiOnly` is enabled. Use this — not
// cloudProcedure — for procedures that talk to external services but never send
// data to a cloud AI model.
export const externalServiceProcedure = protectedProcedure.meta({ cloud: true, cloudKind: "service" }).use(sovereignCheck);

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || (ctx.user.role !== "admin" && ctx.user.role !== "owner")) {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  })
);

export const ownerProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;
    if (!ctx.user || ctx.user.role !== "owner") {
      throw new TRPCError({ code: "FORBIDDEN", message: "Owner-only operation." });
    }
    return next({ ctx: { ...ctx, user: ctx.user } });
  })
);

export function requirePermission(resource: string, action: string) {
  return t.middleware(async opts => {
    const { ctx, next } = opts;
    if (!ctx.user) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Not authenticated." });
    }
    const role = (ctx.user.role ?? "user") as Role;
    if (!hasPermission(role, resource, action)) {
      throw new TRPCError({ code: "FORBIDDEN", message: `Insufficient permissions: ${resource}:${action}` });
    }
    return next({ ctx: { ...ctx, user: ctx.user } });
  });
}
