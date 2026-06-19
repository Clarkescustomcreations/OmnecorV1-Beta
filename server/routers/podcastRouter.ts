/**
 * @file server/routers/podcastRouter.ts
 * @description Omnecor — Local Podcast & Dialogue tRPC Router
 */

import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc.js";
import { LocalPodcastService } from "../phase2/services/LocalPodcastService.js";
import { observable } from "@trpc/server/observable";
import { TRPCError } from "@trpc/server";

const dialogueTurnSchema = z.object({
  speakerId: z.string(),
  text: z.string(),
  emotion: z.string().optional(),
  referenceWav: z.string().optional(),
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

const CLOUD_PROVIDER_IDS = new Set([
  "openai",
  "anthropic",
  "gemini",
  "grok",
  "huggingface",
]);

export const podcastRouter = router({
  /**
   * Generate a full multi-speaker podcast.
   * This is a long-running operation that returns once all segments are synthesized.
   */
  generate: protectedProcedure
    .input(podcastConfigSchema)
    .mutation(async ({ input }) => {
      const service = LocalPodcastService.getInstance();
      return await service.generatePodcast(input);
    }),

  /**
   * Generate a podcast script using an LLM.
   */
  generateScript: protectedProcedure
    .input(generateScriptSchema)
    .mutation(async ({ input, ctx }) => {
      const providerId = input.providerId ?? "openai";
      const modelId = input.modelId ?? "gpt-4o";

      if (ctx.user?.executionMode === "sovereign" && CLOUD_PROVIDER_IDS.has(providerId)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `Sovereign mode: cloud provider "${providerId}" is disabled. Use a local provider (ollama, llamacpp, ommesh).`,
        });
      }

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
