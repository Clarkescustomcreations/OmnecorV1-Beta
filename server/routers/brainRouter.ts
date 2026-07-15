/**
 * @file server/routers/brainRouter.ts
 * @description Omnecor — Brain Packs tRPC router (Brains-Upgrade Phase 3).
 *
 * The management surface for portable `.obp` Brain Packs: list / get / stats /
 * import / export / delete / rebuild-index / import-built-ins. All operations are
 * local (no cloud AI or external service), so every procedure is a
 * `protectedProcedure` and works air-gapped in Sovereign mode. Retrieval +
 * prompt injection at chat time lives in {@link injectBrainContext}; persona-
 * durable attachment + Valet auto-suggest are Phase 4.
 *
 * Packs cross the wire base64-encoded (a `.obp` is a binary gzip blob). The
 * byte-size cap and all validation/embedder-match gating are enforced in
 * {@link BrainPackService}; this router is a thin, ownership-scoped façade.
 */

import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc.js";
import { TRPCError } from "@trpc/server";
import { BrainPackService } from "../core_services/services/BrainPackService.js";
import { BrainAuthoringService } from "../core_services/services/BrainAuthoringService.js";
import { meshNode } from "../ommesh/core/MeshNode.js";

const svc = () => BrainPackService.getInstance();

/** Serialize a brain row for the client (dates → ISO, int flags → boolean). */
function serializeBrain(b: Awaited<ReturnType<BrainPackService["get"]>>) {
  if (!b) return null;
  return {
    id: b.id,
    name: b.name,
    version: b.version,
    domain: b.domain,
    description: b.description,
    status: b.status,
    embedderId: b.embedderId,
    embedderDim: b.embedderDim,
    embedderMatch: b.embedderMatch === 1,
    chunkCount: b.chunkCount,
    provenance: b.provenance ?? null,
    builtin: b.builtin === 1,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  };
}

const brainIdInput = z.object({ brainId: z.string().min(1).max(128) });

export const brainRouter = router({
  /** List the caller's brains (metadata only). */
  list: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.user?.id;
    if (!userId) return [];
    const rows = await svc().list(userId);
    return rows.map(serializeBrain);
  }),

  /** Get one brain the caller owns. */
  get: protectedProcedure.input(brainIdInput).query(async ({ ctx, input }) => {
    const userId = ctx.user?.id;
    if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
    const brain = await svc().get(userId, input.brainId);
    if (!brain) throw new TRPCError({ code: "NOT_FOUND", message: "Brain not found" });
    return serializeBrain(brain);
  }),

  /** Health + indexed-count stats for a brain (drives the UI match indicator). */
  stats: protectedProcedure.input(brainIdInput).query(async ({ ctx, input }) => {
    const userId = ctx.user?.id;
    if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
    const stats = await svc().stats(userId, input.brainId);
    if (!stats) throw new TRPCError({ code: "NOT_FOUND", message: "Brain not found" });
    return stats;
  }),

  /**
   * Import a `.obp` from a base64 payload. Validates, gates on embedder match,
   * persists, and (when compatible) loads the corpus into the vector index.
   */
  import: protectedProcedure
    .input(
      z.object({
        /** base64-encoded `.obp` (gzip) blob. */
        data: z.string().min(1),
        /** Optional client filename, for error messages only. */
        filename: z.string().max(256).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user?.id;
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      let buf: Buffer;
      try {
        buf = Buffer.from(input.data, "base64");
      } catch {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid base64 payload" });
      }
      try {
        const res = await svc().importFromBuffer(userId, buf);
        return {
          brain: serializeBrain(res.brain),
          embedderMatch: res.embedderMatch,
          chunksStored: res.chunksStored,
          vectorsLoaded: res.vectorsLoaded,
        };
      } catch (err) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Brain import failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }),

  /**
   * Author a brain end-to-end (Brains-Upgrade Phase 5): ingest sources (pasted
   * text + scraped URLs) → optional model-distilled synthetic Q&A → on-device
   * embed → assemble charter + corpus → write a `.obp` and import it live.
   *
   * `protectedProcedure` (not a blanket `cloudProcedure`) so raw/local authoring
   * works air-gapped; the distillation model is gated per-provider inside the
   * service, so a Sovereign user is only blocked when they request a *cloud*
   * distiller. The produced pack is 100% local at query time.
   */
  build: protectedProcedure
    .input(
      z.object({
        id: z.string().min(1).max(128),
        name: z.string().min(1).max(200),
        version: z.string().max(64).optional(),
        domain: z.string().min(1).max(64),
        description: z.string().max(2000).optional(),
        charter: z.string().max(200_000).default(""),
        sources: z
          .array(
            z.object({
              text: z.string().max(2_000_000).optional(),
              url: z.string().url().max(2048).optional(),
              name: z.string().max(256).optional(),
            })
          )
          .max(50)
          .default([]),
        distill: z
          .object({
            providerId: z.string().min(1).max(64),
            modelId: z.string().min(1).max(256),
            apiKey: z.string().max(512).optional(),
            baseUrl: z.string().url().max(256).optional(),
            maxExamplesPerChunk: z.number().int().min(1).max(5).optional(),
            maxChunks: z.number().int().min(1).max(500).optional(),
            temperature: z.number().min(0).max(2).optional(),
          })
          .optional(),
        includeRawChunks: z.boolean().optional(),
        license: z.string().max(256).optional(),
        notes: z.string().max(4000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user?.id;
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      try {
        const res = await BrainAuthoringService.getInstance().build(
          userId,
          input,
          ctx.user?.executionMode
        );
        return {
          brainId: res.brainId,
          filePath: res.filePath,
          bytes: res.bytes,
          rawChunks: res.rawChunks,
          distilledChunks: res.distilledChunks,
          totalChunks: res.totalChunks,
          embedderMatch: res.embedderMatch,
          distillProvider: res.distillProvider ?? null,
          scrapeFailures: res.scrapeFailures,
          brain: serializeBrain(res.import.brain),
        };
      } catch (err) {
        if (err instanceof TRPCError) throw err; // preserve the Sovereign FORBIDDEN
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Brain build failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }),

  /** Import every built-in `.obp` shipped in the repo (idempotent). */
  importBuiltins: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.user?.id;
    if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
    const imported = await svc().importBuiltins(userId);
    return { imported };
  }),

  /** Export a stored brain back to a `.obp`, base64-encoded for download. */
  export: protectedProcedure.input(brainIdInput).mutation(async ({ ctx, input }) => {
    const userId = ctx.user?.id;
    if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
    try {
      const buf = await svc().export(userId, input.brainId);
      return {
        filename: `${input.brainId}.obp`,
        data: buf.toString("base64"),
        bytes: buf.byteLength,
      };
    } catch (err) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }),

  /** Delete a brain: drop its vector collection and cascade-remove its rows. */
  delete: protectedProcedure.input(brainIdInput).mutation(async ({ ctx, input }) => {
    const userId = ctx.user?.id;
    if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
    const ok = await svc().delete(userId, input.brainId);
    if (!ok) throw new TRPCError({ code: "NOT_FOUND", message: "Brain not found" });
    return { deleted: true };
  }),

  /**
   * Valet auto-suggest (Phase 4): classify a task and rank the caller's brains
   * by how well they fit it (corpus relevance + category alignment). Returns a
   * *confirmable* suggestion set — the client attaches on the user's nod, never
   * automatically. Fully local (Valet is a local inference server + on-device
   * retrieval), so it stays a `protectedProcedure` and works air-gapped.
   */
  suggest: protectedProcedure
    .input(
      z.object({
        task: z.string().min(1).max(8000),
        limit: z.number().int().min(1).max(10).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.user?.id;
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      return svc().suggest(userId, input.task, {
        limit: input.limit,
        executionMode: ctx.user?.executionMode,
      });
    }),

  /**
   * Sync a brain to a mesh peer (Brains-Upgrade Phase 7). The caller's brain is
   * losslessly re-serialized from its durable chunk store, then pushed to the
   * named peer over the pinned-mTLS mesh channel (HMAC-signed, replay-guarded).
   * The receiver imports it and verifies embedder compatibility; we relay that
   * outcome so the UI can show whether it landed queryable or charter-only.
   *
   * `protectedProcedure` — the transfer is peer-to-peer local compute (no cloud
   * API), so it works in Sovereign mode. The receiving node enforces its own
   * pinned-peer trust gate; an untrusted or offline peer surfaces as an error.
   */
  syncToPeer: protectedProcedure
    .input(
      z.object({
        brainId: z.string().min(1).max(128),
        peerId: z.string().min(1).max(128),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user?.id;
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });

      // Export (ownership-checked) → a self-contained `.obp` buffer.
      let buf: Buffer;
      try {
        buf = await svc().export(userId, input.brainId);
      } catch (err) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: err instanceof Error ? err.message : String(err),
        });
      }

      let result;
      try {
        result = await meshNode.sendBrainToPeerByName(input.peerId, buf);
      } catch (err) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Brain sync to peer failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      if (!result.ok) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Peer rejected the brain: ${result.error ?? "unknown error"}`,
        });
      }
      return { peerId: input.peerId, brainId: input.brainId, ...result };
    }),

  /**
   * Rebuild a brain's vector index from its durable chunk store, re-evaluating
   * embedder compatibility (e.g. after a vector-backend switch or once the
   * embedder becomes available).
   */
  rebuildIndex: protectedProcedure.input(brainIdInput).mutation(async ({ ctx, input }) => {
    const userId = ctx.user?.id;
    if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
    try {
      return await svc().rebuildIndex(userId, input.brainId);
    } catch (err) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }),
});
