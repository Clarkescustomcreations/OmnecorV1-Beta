import { protectedProcedure, router } from "../_core/trpc.js";
import { z } from "zod";
import { randomUUID } from "crypto";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { TRPCError } from "@trpc/server";

const UPLOAD_DIR = join(process.cwd(), "uploads", "attachments");

/**
 * Allowlist of file extensions that may be stored with their original
 * extension. Anything not in this set (including executable, script, and
 * active-content types such as exe/dll/bat/cmd/ps1/sh/msi/scr/com/jar/apk/
 * svg/html/htm/xhtml/mht) is stored as ".bin" so it can never be served or
 * executed with a dangerous content type from the /uploads route.
 */
const ALLOWED_EXTENSIONS = new Set<string>([
  // documents
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "rtf", "csv",
  // images (note: svg deliberately excluded — it can carry scripts)
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "tiff", "tif", "ico", "heic", "heif", "avif",
  // audio
  "mp3", "wav", "ogg", "flac", "aac", "m4a", "opus", "wma",
  // video
  "mp4", "webm", "mov", "avi", "mkv", "m4v", "wmv", "flv",
  // archives
  "zip", "tar", "gz", "tgz", "bz2", "xz", "7z", "rar",
  // text / data / code (served as text, never executed)
  "txt", "md", "markdown", "log", "json", "yaml", "yml", "toml", "ini", "xml",
  "js", "ts", "jsx", "tsx", "py", "go", "rs", "java", "c", "cpp", "h", "hpp",
  "cs", "rb", "php", "swift", "kt", "sql", "css", "scss",
]);

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

      // Sanitise the extension — allow only known-safe extensions; map anything
      // else (executables, scripts, active content) to ".bin" so it can't be
      // served or executed with a dangerous content type.
      const rawExt = (input.name.split(".").pop() ?? "").toLowerCase();
      const ext = ALLOWED_EXTENSIONS.has(rawExt) ? rawExt : "bin";

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
