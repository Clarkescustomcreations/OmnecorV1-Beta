/**
 * @file server/routers/brainmapRouter.ts
 * @description Brain Map layout preference persistence.
 *
 * The Zustand store (client/src/lib/stores/brainMapStore.ts) is the primary
 * source of truth for layout settings. This router accepts and acknowledges
 * saves so the frontend can round-trip preferences; actual DB persistence can
 * be wired in later.
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc.js";

export const brainmapRouter = router({
  saveLayoutPreferences: protectedProcedure
    .input(
      z.object({
        layout: z.string(),
        nodeSize: z.number(),
        simSpeed: z.number(),
        gpuEnabled: z.boolean(),
        autoClustering: z.boolean(),
      }),
    )
    .mutation(async ({ input: _input }) => {
      return { success: true } as const;
    }),
});
