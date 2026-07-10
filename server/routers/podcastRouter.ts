/**
 * @file server/routers/podcastRouter.ts
 * @description Omnecor — Local Podcast & Dialogue tRPC Router
 */

import { z } from "zod";
import { randomUUID } from "crypto";
import { and, desc, eq } from "drizzle-orm";
import { router, protectedProcedure } from "../_core/trpc.js";
import { LocalPodcastService } from "../core_services/services/LocalPodcastService.js";
import { observable } from "@trpc/server/observable";
import { TRPCError } from "@trpc/server";
import { assertProviderAllowedInMode } from "../_core/sovereign.js";
import { getDb } from "../db.factory.js";
import { podcastEpisodes } from "../../drizzle/schema.js";
import { createLogger } from "../_core/logger.js";

const log = createLogger("podcastRouter");

const dialogueTurnSchema = z.object({
  speakerId: z.string(),
  text: z.string(),
  emotion: z.string().optional(),
  referenceWav: z.string().optional(),
  engine: z.string().optional(),
});

const podcastConfigSchema = z.object({
  // Must be a UUID — jobId is used to build the on-disk output dir
  // (path.join(~/.omnecor/podcasts, jobId)); a non-UUID value would allow
  // path traversal / arbitrary directory creation.
  jobId: z.string().uuid().optional(),
  title: z.string(),
  description: z.string().optional(),
  durationMinutes: z.number().optional(),
  quality: z.enum(["draft", "standard", "high"]).optional(),
  turns: z.array(dialogueTurnSchema),
  useRVC: z.boolean().optional(),
});

const generateScriptSchema = z.object({
  providerId: z.string().optional(),
  modelId: z.string().optional(),
  topic: z.string(),
  description: z.string().optional(),
  durationMinutes: z.number().optional(),
  quality: z.enum(["draft", "standard", "high"]).optional(),
  turnsCount: z.number().optional(),
  format: z.enum(["json", "text"]).default("json"),
  sources: z.array(z.object({
    label: z.string(),
    content: z.string(),
  })).optional(),
});


export const podcastRouter = router({
  /**
   * Generate a full multi-speaker podcast.
   * This is a long-running operation that returns once all segments are synthesized.
   */
  generate: protectedProcedure
    .input(podcastConfigSchema)
    .mutation(async ({ input, ctx }) => {
      const service = LocalPodcastService.getInstance();
      const result = await service.generatePodcast(input);

      // Server-backed episode history (TD-026): persist on a successful master
      // mix so History survives a cache clear and follows the user across
      // browsers/devices. Keyed by jobId → idempotent upsert (re-generating the
      // same job updates rather than duplicates). A persistence failure must not
      // fail generation — log and return the result regardless.
      if (result?.audioUrl) {
        try {
          const db = await getDb();
          const episodeId = result.jobId || input.jobId || randomUUID();
          const title = (input.title?.trim() || "Podcast Episode").slice(0, 200);
          const segmentCount = Array.isArray(result.segments) ? result.segments.length : 0;
          const durationSeconds = Math.max(0, Math.round(result.duration ?? 0));
          await db
            .insert(podcastEpisodes)
            .values({ id: episodeId, userId: ctx.user!.id, title, audioUrl: result.audioUrl, segmentCount, durationSeconds })
            .onConflictDoUpdate({
              target: podcastEpisodes.id,
              set: { title, audioUrl: result.audioUrl, segmentCount, durationSeconds },
            });
        } catch (err) {
          log.warn("[podcast] failed to persist episode history", err);
        }
      }

      return result;
    }),

  /** Server-backed episode history for the current user (newest first, capped at 100). */
  listEpisodes: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    return db
      .select()
      .from(podcastEpisodes)
      .where(eq(podcastEpisodes.userId, ctx.user!.id))
      .orderBy(desc(podcastEpisodes.createdAt))
      .limit(100);
  }),

  /** Remove one episode from the current user's history. Scoped by userId (IDOR-safe). */
  deleteEpisode: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const deleted = await db
        .delete(podcastEpisodes)
        .where(and(eq(podcastEpisodes.id, input.id), eq(podcastEpisodes.userId, ctx.user!.id)))
        .returning({ id: podcastEpisodes.id });
      if (deleted.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Episode not found." });
      }
      return { id: deleted[0].id };
    }),

  /**
   * Generate a podcast script using an LLM.
   */
  generateScript: protectedProcedure
    .input(generateScriptSchema)
    .mutation(async ({ input, ctx }) => {
      const providerId = input.providerId ?? "openai";
      const modelId = input.modelId ?? "gpt-4o";

      assertProviderAllowedInMode(providerId, ctx.user?.executionMode);

      const duration = input.durationMinutes ?? 15;
      const turnCount = input.turnsCount ?? Math.max(2, Math.round(duration * 0.8));

      const promptDesc = input.description?.trim()
        ? `\nInstructions/Context: ${input.description.trim()}`
        : "";

      const sourceContext = input.sources && input.sources.length > 0
        ? `\n\nUse these sources as context:\n${input.sources.map((s, i) => `[${i + 1}] ${s.label}:\n${s.content}`).join("\n\n")}`
        : "";

      let systemPrompt = "You are a podcast scriptwriter. Return ONLY a JSON array of dialogue turns.";
      let prompt = `Generate a ${turnCount}-turn podcast script between two hosts (Alex and Sam) about: "${input.topic}".${promptDesc}${sourceContext}
      Return ONLY a JSON array of objects with keys: speakerId (Alex or Sam), text, emotion (excited, thoughtful, neutral, whispering).
      Example: [{"speakerId": "Alex", "text": "Hello!", "emotion": "excited"}]`;

      if (input.format === "text") {
        systemPrompt = "You are a podcast scriptwriter. Output only the dialogue lines.";
        prompt = `Generate a ${turnCount}-turn podcast script between two hosts named Host and Guest about: "${input.topic}".${promptDesc}${sourceContext} Put each turn on its own line, alternating Host: and Guest:, no extra commentary.`;
      }

      try {
        const response = await ctx.services.aiProvider.chat({
          providerId,
          modelId,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: prompt }
          ],
        });
        return { content: response };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error("[podcast:generateScript]", error);
        throw new TRPCError({
          cause: error,
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to generate script",
        });
      }
    }),

  /**
   * Stream dialogue turn-by-turn.
   * Emits audio chunks as they are synthesized locally.
   */
  streamTurn: protectedProcedure
    .input(dialogueTurnSchema)
    .subscription(({ input }) => {
      return observable((emit) => {
        const service = LocalPodcastService.getInstance();
        (async () => {
          try {
            for await (const chunk of service.streamDialogue(input)) {
              emit.next({
                audioBase64: chunk.toString("base64"),
                contentType: "audio/wav",
              });
            }
            emit.complete();
          } catch (err) {
            emit.error(err);
          }
        })();
      });
    }),
});
