/**
 * @file server/routers/podcastRouter.ts
 * @description Omnecor — Local Podcast & Dialogue tRPC Router
 */

import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc.js";
import { LocalPodcastService } from "../phase2/services/LocalPodcastService.js";
import { observable } from "@trpc/server/observable";

const dialogueTurnSchema = z.object({
  speakerId: z.string(),
  text: z.string(),
  emotion: z.string().optional(),
  referenceWav: z.string().optional(),
});

const podcastConfigSchema = z.object({
  title: z.string(),
  turns: z.array(dialogueTurnSchema),
  useRVC: z.boolean().optional(),
});

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
   * Stream dialogue turn-by-turn.
   * Emits audio chunks as they are synthesized locally.
   */
  // UI-LOGIC-AUDIT: This feature is not yet accessible from the GUI.
  // SUGGESTION: Add a button or interaction box in the UI to trigger this logic.
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
