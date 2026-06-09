import { protectedProcedure, router } from "../_core/trpc.js";
import { z } from "zod";
import { randomUUID } from "crypto";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { TRPCError } from "@trpc/server";

const UPLOAD_DIR = join(process.cwd(), "uploads", "attachments");

export const attachmentsRouter = router({
  uploadFile: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(255),
        mimeType: z.string().max(127),
        dataUrl: z.string().max(10 * 1024 * 1024), // 10 MB base64 limit
      })
    )
    .mutation(async ({ input }) => {
      try {
        await mkdir(UPLOAD_DIR, { recursive: true });
      } catch {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create upload directory",
        });
      }

      // Sanitise the extension — allow only simple alphanumeric extensions
      const rawExt = input.name.split(".").pop() ?? "bin";
      const ext = /^[a-zA-Z0-9]{1,10}$/.test(rawExt) ? rawExt : "bin";

      const fileId = randomUUID();
      const filename = `${fileId}.${ext}`;
      const filePath = join(UPLOAD_DIR, filename);

      // Strip data URL prefix if present (e.g. "data:image/png;base64,…")
      const base64 = input.dataUrl.includes(",")
        ? input.dataUrl.split(",")[1]
        : input.dataUrl;

      try {
        await writeFile(filePath, Buffer.from(base64, "base64"));
      } catch {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to write uploaded file",
        });
      }

      return {
        fileId,
        filename: input.name,
        mimeType: input.mimeType,
        url: `/uploads/attachments/${filename}`,
      };
    }),
});
