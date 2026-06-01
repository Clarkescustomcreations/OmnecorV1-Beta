import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc.js";
import { OpenArtService } from "../phase2/services/OpenArtService.js";
import { ENV } from "../_core/env.js";

export const imageGenRouter = router({
  providers: protectedProcedure.query(() => ({
    local: true,
    fal: !!process.env.FAL_KEY,
    openart: OpenArtService.getInstance().isConfigured(),
  })),

  generate: protectedProcedure
    .input(z.object({
      prompt: z.string().min(1).max(500),
      provider: z.enum(["local", "fal", "openart"]),
      model: z.string().optional(),
      width: z.number().min(64).max(2048).default(512),
      height: z.number().min(64).max(2048).default(512),
    }))
    .mutation(async ({ ctx, input }) => {
      if (input.provider === "openart") {
        return OpenArtService.getInstance().generate(
          input.prompt,
          input.model ?? "default",
          input.width,
          input.height,
        );
      }
      if (input.provider === "fal") {
        const url = await ctx.services.fal.generateCharacter(input.prompt);
        return { imageUrl: url, prompt: input.prompt, model: "fal", width: input.width, height: input.height };
      }
      // local — ComfyUI
      const result = await ctx.services.comfy.queuePrompt({
        prompt: input.prompt,
        width: input.width,
        height: input.height,
      });
      return { imageUrl: "", prompt: input.prompt, model: "comfyui", width: input.width, height: input.height, comfyResult: result };
    }),
});
