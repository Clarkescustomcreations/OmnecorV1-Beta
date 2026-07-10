import { protectedProcedure, router } from "../_core/trpc.js";
import { z } from "zod";
import { PenpotService } from "../core_services/services/PenpotService.js";

export const penpotRouter = router({
  configure: protectedProcedure
    .input(z.object({
      url: z.string().url(),
      token: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      await PenpotService.getInstance().configure(input.url, input.token);
      return { success: true };
    }),

  generateComponent: protectedProcedure
    .input(z.object({
      fileId: z.string().min(1).max(256),
      nodeId: z.string().min(1).max(256),
      // Must be a valid identifier — this is also used as the output filename,
      // so the constraint blocks path traversal via the component name.
      componentName: z.string().regex(
        /^[A-Za-z][A-Za-z0-9_]*$/,
        "componentName must be a valid identifier (letters, digits, underscore; starting with a letter)",
      ).max(100),
      outputDir: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const filePath = await PenpotService.getInstance().generateComponent(
        input.fileId,
        input.nodeId,
        input.componentName,
        input.outputDir
      );
      
      return {
        success: true,
        filePath,
      };
    }),
});
