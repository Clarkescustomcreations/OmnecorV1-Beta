/**
 * Blueprint Studio router — AI-assisted fabrication planning.
 *
 * Surfaces: plan CRUD (attached to the active Neural Map), the agentic
 * planning stream (ChatAgentRunner with the Blueprint domain toolset and
 * built-in file/command tools disabled), conversation persistence, manual
 * BOM/cut-list editing, generated-file access, the materials catalog,
 * concept renders, engine/FEA status, and full plan PDF export.
 *
 * Sovereign gating follows the agentChatStream pattern: the stream itself is
 * mixed local+cloud, so the provider is gated per-call via
 * `assertProviderAllowedInMode`; cloud-only extras (web search, cloud image
 * providers) are gated inside the toolset / by `assertImageProviderAllowedInMode`.
 */
import { z } from "zod";
import { and, asc, desc, eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { TRPCError } from "@trpc/server";
import { observable } from "@trpc/server/observable";
import { router, protectedProcedure, requirePermission } from "../_core/trpc.js";
import { getDb } from "../db.factory.js";
import {
  blueprintBomItems,
  blueprintCutItems,
  blueprintFiles,
  blueprintMessages,
  blueprintPlans,
  blueprintSimResults,
  neuralMaps,
} from "../../drizzle/schema.js";
import { ChatAgentRunner } from "../core_services/services/ChatAgentRunner.js";
import { assertImageProviderAllowedInMode, assertProviderAllowedInMode, isSovereignMode } from "../_core/sovereign.js";
import { guardedEmit } from "../_core/streamEmit.js";
import { BlueprintCadService } from "../core_services/blueprint/BlueprintCadService.js";
import { BlueprintFeaService } from "../core_services/blueprint/BlueprintFeaService.js";
import {
  buildBlueprintSystemPrompt,
  buildBlueprintTools,
  loadPlanSnapshot,
} from "../core_services/blueprint/blueprintAgentTools.js";
import { resolveProjectMap } from "../core_services/blueprint/chatBlueprintTools.js";
import { MATERIALS_CATALOG, listCategories, searchMaterials } from "../core_services/blueprint/materialsCatalog.js";
import { generateConceptImage } from "../core_services/blueprint/conceptRender.js";
import { buildPlanPdf } from "../core_services/blueprint/planPdf.js";
import { buildBomExport } from "../core_services/blueprint/bomExport.js";
import { persistPlanFile } from "../core_services/blueprint/fileStore.js";
import { extractFeatureEdges, parseStl, projectEdges, toMeshJson } from "../core_services/blueprint/meshUtils.js";
import { buildDrawingSvg, buildDxf } from "../core_services/blueprint/drawingSvg.js";
import { parseDxf2d, outlineSvg } from "../core_services/blueprint/geometryImport.js";
import type { AgentStreamEvent } from "@shared/chatAgentEvents";
import { BLUEPRINT_CATEGORIES } from "@shared/blueprint";

const agentsRunProcedure = protectedProcedure.use(requirePermission("agents", "run"));

const planIdSchema = z.object({ planId: z.string().min(1) });

/**
 * Build a `<project_context>` block from the plan's parent Neural Map / Project
 * (name + projectContext: description/goals/techStack/notes), gated by the map's
 * `enableAIContext`. Returns null when there's no map, the gate is off, or there's
 * nothing worth injecting — so the Blueprint agent sees the project's intent but
 * only when the user has opted into map AI context.
 */
async function buildProjectContextBlock(mapId: string | null, userId: number): Promise<string | null> {
  if (!mapId) return null;
  const db = await getDb();
  const [map] = await db
    .select({ name: neuralMaps.name, projectContext: neuralMaps.projectContext, settings: neuralMaps.settings })
    .from(neuralMaps)
    .where(and(eq(neuralMaps.id, mapId), eq(neuralMaps.userId, userId)))
    .limit(1);
  if (!map) return null;
  if ((map.settings as Record<string, unknown> | null)?.enableAIContext === false) return null;
  const pc = (map.projectContext ?? {}) as {
    description?: string;
    techStack?: string[];
    goals?: string[];
    notes?: string;
  };
  const lines: string[] = [];
  if (pc.description) lines.push(pc.description.slice(0, 800));
  if (pc.goals?.length) lines.push(`Goals: ${pc.goals.join("; ").slice(0, 400)}`);
  if (pc.techStack?.length) lines.push(`Stack/materials focus: ${pc.techStack.join(", ").slice(0, 300)}`);
  if (pc.notes) lines.push(`Notes: ${pc.notes.slice(0, 400)}`);
  if (lines.length === 0) return null;
  return `PARENT PROJECT (Neural Map "${map.name}") — this plan belongs to this project; keep the design consistent with it:\n${lines.join("\n")}`;
}

async function requireOwnedPlan(planId: string, userId: number) {
  const db = await getDb();
  const [plan] = await db
    .select()
    .from(blueprintPlans)
    .where(and(eq(blueprintPlans.id, planId), eq(blueprintPlans.userId, userId)))
    .limit(1);
  if (!plan) throw new TRPCError({ code: "NOT_FOUND", message: "Blueprint plan not found." });
  return plan;
}

export const blueprintRouter = router({
  // ── Plans ──────────────────────────────────────────────────────────────
  list: protectedProcedure
    .input(z.object({ mapId: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      const rows = await db
        .select()
        .from(blueprintPlans)
        .where(
          input?.mapId
            ? and(eq(blueprintPlans.userId, ctx.user.id), eq(blueprintPlans.mapId, input.mapId))
            : eq(blueprintPlans.userId, ctx.user.id),
        )
        .orderBy(desc(blueprintPlans.updatedAt));
      return rows;
    }),

  create: protectedProcedure
    .input(
      z.object({
        title: z.string().min(1).max(200),
        brief: z.string().max(8000).default(""),
        category: z.enum(BLUEPRINT_CATEGORIES).default("other"),
        units: z.enum(["imperial", "metric"]).default("imperial"),
        cadEngine: z.enum(["jscad", "openscad"]).default("jscad"),
        mapId: z.string().optional(),
        /** "＋ New project": create a fresh Project and attach this plan to it.
         *  Server-side creation keeps the plan's mapId FK valid (no client race). */
        newMapName: z.string().max(120).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      // Attach to the given map, or bootstrap a new Project (server-side so the
      // FK is satisfied before the plan insert). mapId undefined + no newMapName
      // → an unattached plan (allowed; mapId is nullable).
      let mapId = input.mapId;
      let mapCreated = false;
      let mapName = "";
      if (input.newMapName !== undefined) {
        const resolved = await resolveProjectMap(db, ctx.user.id, {
          mapId: input.mapId,
          newMapName: input.newMapName,
          brief: input.brief,
          fallbackName: input.title,
        });
        mapId = resolved.mapId;
        mapCreated = resolved.mapCreated;
        mapName = resolved.mapName;
      }
      const id = uuidv4();
      await db.insert(blueprintPlans).values({
        id,
        userId: ctx.user.id,
        mapId,
        title: input.title,
        brief: input.brief,
        category: input.category,
        units: input.units,
        cadEngine: input.cadEngine,
        status: "draft",
      });
      return { id, mapId, mapCreated, mapName };
    }),

  get: protectedProcedure.input(planIdSchema).query(async ({ ctx, input }) => {
    await requireOwnedPlan(input.planId, ctx.user.id);
    const snapshot = await loadPlanSnapshot(input.planId, ctx.user.id);
    // Strip absolute paths from the client payload — files are fetched by id.
    return {
      plan: snapshot.plan,
      bomItems: snapshot.bomItems,
      cutItems: snapshot.cutItems,
      simResults: snapshot.simResults,
      files: snapshot.files.map(({ path: _path, ...rest }) => rest),
    };
  }),

  update: protectedProcedure
    .input(
      z.object({
        planId: z.string().min(1),
        title: z.string().min(1).max(200).optional(),
        brief: z.string().max(8000).optional(),
        category: z.enum(BLUEPRINT_CATEGORIES).optional(),
        status: z.enum(["draft", "planning", "ready", "building", "complete"]).optional(),
        units: z.enum(["imperial", "metric"]).optional(),
        cadEngine: z.enum(["jscad", "openscad"]).optional(),
        overview: z.string().max(60000).optional(),
        safetyNotes: z.string().max(30000).optional(),
        mapId: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireOwnedPlan(input.planId, ctx.user.id);
      const db = await getDb();
      const { planId, ...patch } = input;
      await db.update(blueprintPlans).set(patch).where(eq(blueprintPlans.id, planId));
      return { success: true } as const;
    }),

  delete: protectedProcedure.input(planIdSchema).mutation(async ({ ctx, input }) => {
    await requireOwnedPlan(input.planId, ctx.user.id);
    const db = await getDb();
    await db.delete(blueprintPlans).where(eq(blueprintPlans.id, input.planId));
    return { success: true } as const;
  }),

  // ── Conversation ───────────────────────────────────────────────────────
  listMessages: protectedProcedure.input(planIdSchema).query(async ({ ctx, input }) => {
    await requireOwnedPlan(input.planId, ctx.user.id);
    const db = await getDb();
    return db
      .select()
      .from(blueprintMessages)
      .where(eq(blueprintMessages.planId, input.planId))
      .orderBy(asc(blueprintMessages.createdAt));
  }),

  appendMessage: protectedProcedure
    .input(
      z.object({
        planId: z.string().min(1),
        role: z.enum(["user", "assistant"]),
        content: z.string().max(200000),
        blocks: z.array(z.unknown()).optional(),
        tokenCount: z.number().int().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireOwnedPlan(input.planId, ctx.user.id);
      const db = await getDb();
      const id = uuidv4();
      await db.insert(blueprintMessages).values({
        id,
        planId: input.planId,
        role: input.role,
        content: input.content,
        blocks: input.blocks,
        tokenCount: input.tokenCount,
      });
      return { id };
    }),

  /**
   * The Blueprint planning stream. Same event contract as
   * `aiProvider.agentChatStream` (the client reuses AssistantStream), but the
   * run gets the Blueprint domain toolset and NO built-in file/command tools —
   * this agent designs, calculates and records; it does not touch the host.
   */
  agentStream: agentsRunProcedure
    .input(
      z.object({
        planId: z.string().min(1),
        providerId: z.string().min(1),
        modelId: z.string().min(1),
        message: z.string().min(1).max(32000),
        maxTokens: z.number().int().optional(),
        supportsNativeTools: z.boolean().optional(),
        targetNodeId: z.string().optional(),
      }),
    )
    .subscription(({ ctx, input }) => {
      assertProviderAllowedInMode(input.providerId, ctx.user?.executionMode);
      return observable<AgentStreamEvent>((emit) => {
        const g = guardedEmit(emit);
        const controller = new AbortController();
        (async () => {
          await requireOwnedPlan(input.planId, ctx.user.id);
          const db = await getDb();
          // Persist the user turn first so history survives a mid-stream drop.
          await db.insert(blueprintMessages).values({
            id: uuidv4(),
            planId: input.planId,
            role: "user",
            content: input.message,
          });

          const snapshot = await loadPlanSnapshot(input.planId, ctx.user.id);
          const [engineStatus, feaStatus] = await Promise.all([
            BlueprintCadService.getInstance().getEngineStatus(),
            BlueprintFeaService.getInstance().checkAvailability(),
          ]);
          const sovereign = isSovereignMode(ctx.user?.executionMode);
          let systemPrompt = buildBlueprintSystemPrompt(snapshot, {
            sovereign,
            feaAvailable: feaStatus.available,
            openscadAvailable: engineStatus.openscad.available,
          });
          // Bidirectional sharing: fold the parent Project (Neural Map) context in
          // so the Blueprint agent designs with the project's goals/notes in mind.
          const projectBlock = await buildProjectContextBlock(snapshot.plan.mapId, ctx.user.id);
          if (projectBlock) systemPrompt = `${systemPrompt}\n\n${projectBlock}`;

          // Conversation history from persistence (assistant turns flattened).
          // Empty-content rows are dropped: providers reject empty parts
          // (Gemini 400s), and a failed earlier turn must not poison the next.
          const history = await db
            .select()
            .from(blueprintMessages)
            .where(eq(blueprintMessages.planId, input.planId))
            .orderBy(asc(blueprintMessages.createdAt));
          const messages = history
            .filter((m) => m.content.trim().length > 0)
            .map((m) => ({ role: m.role, content: m.content }));

          const runner = new ChatAgentRunner();
          const events = runner.run({
            input: {
              providerId: input.providerId,
              modelId: input.modelId,
              messages,
              systemPrompt,
              maxTokens: input.maxTokens,
              supportsNativeTools: input.supportsNativeTools,
              targetNodeId: input.targetNodeId,
            },
            userId: ctx.user.id,
            executionMode: ctx.user?.executionMode,
            conversationId: input.planId,
            includeBuiltInTools: false,
            extraTools: buildBlueprintTools({
              planId: input.planId,
              userId: ctx.user.id,
              executionMode: ctx.user?.executionMode,
              signal: controller.signal,
            }),
            signal: controller.signal,
          });

          for await (const event of events) {
            if (g.closed) break;
            g.next(event);
            if (event.type === "done") {
              // Persist the assistant turn (blocks are the render truth). A
              // turn that produced nothing (provider yielded zero chunks) is
              // not persisted — an empty assistant row only poisons history.
              if (event.content.trim().length > 0 || event.blocks.length > 0) {
                await db.insert(blueprintMessages).values({
                  id: uuidv4(),
                  planId: input.planId,
                  role: "assistant",
                  content: event.content,
                  blocks: event.blocks as unknown[],
                  tokenCount: event.totalTokens,
                });
              }
              g.complete();
              break;
            }
            if (event.type === "error") {
              g.complete();
              break;
            }
          }
        })().catch((err) => g.error(err));
        return () => {
          controller.abort();
          g.close();
        };
      });
    }),

  // ── Manual BOM / cut-list editing (the user can hand-tune rows) ────────
  upsertBomItem: protectedProcedure
    .input(
      z.object({
        planId: z.string().min(1),
        id: z.string().optional(),
        name: z.string().min(1).max(300),
        kind: z.enum(["material", "hardware", "tool", "consumable"]).default("material"),
        materialKey: z.string().optional(),
        spec: z.string().max(500).default(""),
        quantity: z.number().min(0),
        unit: z.string().max(20).default("pcs"),
        unitCost: z.number().min(0).nullable().optional(),
        supplier: z.string().max(200).optional(),
        url: z.string().max(2000).optional(),
        notes: z.string().max(2000).optional(),
        sortOrder: z.number().int().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireOwnedPlan(input.planId, ctx.user.id);
      const db = await getDb();
      const { id, planId, ...fields } = input;
      if (id) {
        await db
          .update(blueprintBomItems)
          .set(fields)
          .where(and(eq(blueprintBomItems.id, id), eq(blueprintBomItems.planId, planId)));
        return { id };
      }
      const newId = uuidv4();
      await db.insert(blueprintBomItems).values({ id: newId, planId, ...fields });
      return { id: newId };
    }),

  deleteBomItem: protectedProcedure
    .input(z.object({ planId: z.string().min(1), id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await requireOwnedPlan(input.planId, ctx.user.id);
      const db = await getDb();
      await db
        .delete(blueprintBomItems)
        .where(and(eq(blueprintBomItems.id, input.id), eq(blueprintBomItems.planId, input.planId)));
      return { success: true } as const;
    }),

  upsertCutItem: protectedProcedure
    .input(
      z.object({
        planId: z.string().min(1),
        id: z.string().optional(),
        partLabel: z.string().min(1).max(300),
        stockName: z.string().max(300).default(""),
        materialKey: z.string().optional(),
        quantity: z.number().int().min(1).default(1),
        lengthMm: z.number().min(0).nullable().optional(),
        widthMm: z.number().min(0).nullable().optional(),
        thicknessMm: z.number().min(0).nullable().optional(),
        miter1Deg: z.number().min(-90).max(90).nullable().optional(),
        bevel1Deg: z.number().min(-90).max(90).nullable().optional(),
        miter2Deg: z.number().min(-90).max(90).nullable().optional(),
        bevel2Deg: z.number().min(-90).max(90).nullable().optional(),
        notes: z.string().max(2000).optional(),
        sortOrder: z.number().int().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireOwnedPlan(input.planId, ctx.user.id);
      const db = await getDb();
      const { id, planId, ...fields } = input;
      if (id) {
        await db
          .update(blueprintCutItems)
          .set(fields)
          .where(and(eq(blueprintCutItems.id, id), eq(blueprintCutItems.planId, planId)));
        return { id };
      }
      const newId = uuidv4();
      await db.insert(blueprintCutItems).values({ id: newId, planId, ...fields });
      return { id: newId };
    }),

  deleteCutItem: protectedProcedure
    .input(z.object({ planId: z.string().min(1), id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await requireOwnedPlan(input.planId, ctx.user.id);
      const db = await getDb();
      await db
        .delete(blueprintCutItems)
        .where(and(eq(blueprintCutItems.id, input.id), eq(blueprintCutItems.planId, input.planId)));
      return { success: true } as const;
    }),

  // ── Generated files ─────────────────────────────────────────────────────
  getFile: protectedProcedure
    .input(z.object({ planId: z.string().min(1), fileId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await requireOwnedPlan(input.planId, ctx.user.id);
      const db = await getDb();
      const [file] = await db
        .select()
        .from(blueprintFiles)
        .where(and(eq(blueprintFiles.id, input.fileId), eq(blueprintFiles.planId, input.planId)))
        .limit(1);
      if (!file) throw new TRPCError({ code: "NOT_FOUND", message: "File not found." });
      const data = await BlueprintCadService.getInstance().readArtifact(file.path);
      return {
        id: file.id,
        name: file.name,
        kind: file.kind,
        mimeType: file.mimeType,
        meta: file.meta,
        contentBase64: data.toString("base64"),
      };
    }),

  deleteFile: protectedProcedure
    .input(z.object({ planId: z.string().min(1), fileId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await requireOwnedPlan(input.planId, ctx.user.id);
      const db = await getDb();
      await db
        .delete(blueprintFiles)
        .where(and(eq(blueprintFiles.id, input.fileId), eq(blueprintFiles.planId, input.planId)));
      return { success: true } as const;
    }),

  // ── Geometry import (STL / DXF → a plan part) ────────────────────────────
  importGeometry: protectedProcedure
    .input(
      z.object({
        planId: z.string().min(1),
        name: z.string().min(1).max(200),
        format: z.enum(["stl", "dxf"]),
        contentBase64: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const plan = await requireOwnedPlan(input.planId, ctx.user.id);
      const buf = Buffer.from(input.contentBase64, "base64");
      if (buf.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Empty file." });
      if (buf.length > 30 * 1024 * 1024) throw new TRPCError({ code: "BAD_REQUEST", message: "File too large (30 MB max)." });
      const partName = (input.name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9 _-]/g, "").trim() || "imported").slice(0, 80);
      const cad = BlueprintCadService.getInstance();
      const files: { id: string; name: string }[] = [];

      if (input.format === "stl") {
        let mesh;
        try {
          const { positions, indices } = parseStl(buf);
          if (indices.length < 3) throw new Error("no triangles found");
          mesh = toMeshJson(positions, indices);
        } catch (e) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Could not parse STL: ${(e as Error).message}` });
        }
        if (mesh.triangleCount > 400_000) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `STL has ${mesh.triangleCount.toLocaleString()} triangles (limit 400,000) — decimate it first.` });
        }
        const meta = { partLabel: partName, imported: true, boundsMm: mesh.boundsMm, volumeMm3: mesh.volumeMm3, triangles: mesh.triangleCount };
        files.push(await persistPlanFile(input.planId, "mesh_json", `${partName}.mesh.json`, JSON.stringify(mesh), "application/json", meta));
        files.push(await persistPlanFile(input.planId, "stl", `${partName}.stl`, cad.buildStl(mesh, partName), "model/stl", meta));
        files.push(await persistPlanFile(input.planId, "drawing_svg", `${partName}.drawing.svg`, buildDrawingSvg(mesh, { partName, planTitle: plan.title, units: plan.units }), "image/svg+xml", meta));
        const edges = extractFeatureEdges(mesh.positions, mesh.indices);
        files.push(await persistPlanFile(input.planId, "drawing_dxf", `${partName}.front.dxf`, buildDxf(projectEdges(mesh.positions, edges, "front")), "application/dxf", meta));
        const { min, max } = mesh.boundsMm;
        return {
          format: "stl" as const,
          part: {
            name: partName,
            sizeMm: [max[0] - min[0], max[1] - min[1], max[2] - min[2]].map((v) => Math.round(v * 100) / 100),
            triangles: mesh.triangleCount,
            volumeMm3: Math.round(mesh.volumeMm3 ?? 0),
          },
          files: files.map((f) => f.name),
        };
      }

      // DXF — 2D outline
      const text = buf.toString("utf-8");
      const dxf = parseDxf2d(text);
      if (dxf.segments.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No LINE/LWPOLYLINE geometry found in the DXF." });
      }
      const meta = { partLabel: partName, imported: true, edges: dxf.segments.length, boundsMm: dxf.bounds };
      files.push(await persistPlanFile(input.planId, "drawing_svg", `${partName}.drawing.svg`, outlineSvg(dxf, { title: partName, units: plan.units }), "image/svg+xml", meta));
      files.push(await persistPlanFile(input.planId, "drawing_dxf", `${partName}.dxf`, text, "application/dxf", meta));
      return {
        format: "dxf" as const,
        part: { name: partName, edges: dxf.segments.length, boundsMm: dxf.bounds },
        files: files.map((f) => f.name),
      };
    }),

  // ── Materials catalog ───────────────────────────────────────────────────
  materials: router({
    categories: protectedProcedure.query(() => listCategories()),
    search: protectedProcedure
      .input(z.object({ query: z.string().max(200).default(""), category: z.string().optional(), limit: z.number().int().min(1).max(50).default(20) }))
      .query(({ input }) =>
        input.query || input.category
          ? searchMaterials(input.query, input.category as never, input.limit)
          : MATERIALS_CATALOG.slice(0, input.limit),
      ),
  }),

  // ── Concept renders (manual button — the agent has its own tool) ───────
  generateConcept: protectedProcedure
    .input(
      z.object({
        planId: z.string().min(1),
        prompt: z.string().min(1).max(2000),
        provider: z.enum(["local", "fal", "openart"]).default("local"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const plan = await requireOwnedPlan(input.planId, ctx.user.id);
      assertImageProviderAllowedInMode(input.provider, ctx.user?.executionMode);
      const result = await generateConceptImage(input.prompt, input.provider);
      const ext = result.mimeType === "image/jpeg" ? "jpg" : result.mimeType === "image/webp" ? "webp" : "png";
      const cad = BlueprintCadService.getInstance();
      const { filePath, sizeBytes } = await cad.saveArtifact(plan.id, `concept-${Date.now()}.${ext}`, result.data);
      const db = await getDb();
      const id = uuidv4();
      await db.insert(blueprintFiles).values({
        id,
        planId: plan.id,
        kind: "concept_image",
        name: `concept-${Date.now()}.${ext}`,
        path: filePath,
        mimeType: result.mimeType,
        sizeBytes,
        meta: { prompt: input.prompt, provider: input.provider },
      });
      return { fileId: id };
    }),

  // ── Status + export ────────────────────────────────────────────────────
  engineStatus: protectedProcedure.query(async () => {
    const [cad, fea] = await Promise.all([
      BlueprintCadService.getInstance().getEngineStatus(),
      BlueprintFeaService.getInstance().checkAvailability(),
    ]);
    return { ...cad, fea };
  }),

  /** Shopping export — CSV + supplier-grouped printable buy-list from the BOM. */
  exportBom: protectedProcedure.input(planIdSchema).query(async ({ ctx, input }) => {
    const plan = await requireOwnedPlan(input.planId, ctx.user.id);
    const db = await getDb();
    const items = await db
      .select()
      .from(blueprintBomItems)
      .where(eq(blueprintBomItems.planId, input.planId))
      .orderBy(asc(blueprintBomItems.sortOrder));
    return buildBomExport(items, plan.title);
  }),

  exportPdf: protectedProcedure.input(planIdSchema).mutation(async ({ ctx, input }) => {
    await requireOwnedPlan(input.planId, ctx.user.id);
    const snapshot = await loadPlanSnapshot(input.planId, ctx.user.id);
    const cad = BlueprintCadService.getInstance();

    // Embed the newest drawing per part name + up to two concept renders.
    const drawingRows = snapshot.files.filter((f) => f.kind === "drawing_svg");
    const seen = new Set<string>();
    const drawings: { name: string; svg: string }[] = [];
    for (const row of drawingRows) {
      if (seen.has(row.name)) continue;
      seen.add(row.name);
      try {
        drawings.push({ name: row.name, svg: (await cad.readArtifact(row.path)).toString("utf-8") });
      } catch {
        /* missing on disk — skip */
      }
      if (drawings.length >= 8) break;
    }
    const conceptImages: { name: string; data: Buffer }[] = [];
    for (const row of snapshot.files.filter((f) => f.kind === "concept_image").slice(0, 2)) {
      try {
        conceptImages.push({ name: row.name, data: await cad.readArtifact(row.path) });
      } catch {
        /* skip */
      }
    }

    const pdf = await buildPlanPdf({
      plan: snapshot.plan,
      bomItems: snapshot.bomItems,
      cutItems: snapshot.cutItems,
      simResults: snapshot.simResults,
      drawings,
      conceptImages,
    });
    const safeTitle = snapshot.plan.title.replace(/[^a-zA-Z0-9 _-]/g, "").slice(0, 60) || "build-plan";
    const { filePath, sizeBytes } = await cad.saveArtifact(input.planId, `${safeTitle}.plan.pdf`, pdf);
    const db = await getDb();
    const id = uuidv4();
    await db.insert(blueprintFiles).values({
      id,
      planId: input.planId,
      kind: "plan_pdf",
      name: `${safeTitle}.plan.pdf`,
      path: filePath,
      mimeType: "application/pdf",
      sizeBytes,
    });
    return { fileId: id, name: `${safeTitle}.plan.pdf`, contentBase64: pdf.toString("base64") };
  }),
});
