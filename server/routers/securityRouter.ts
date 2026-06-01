/**
 * @file routers/securityRouter.ts
 * @description Omnecor — Security Services tRPC Router
 *
 * Exposes tRPC endpoints for:
 *  - File security scanning
 *  - Encryption key management
 *  - Backup creation and restoration
 *
 * Architecture Notes:
 *  - Security scanning uses YARA rules and magic-byte detection
 *  - Encryption uses AES-256-GCM with PBKDF2 key derivation
 *  - Backups are encrypted ZIP archives
 *
 * UNIFIED: This router now imports from the main _core/trpc.ts stack.
 */

import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc.js";
import { TRPCError } from "@trpc/server";
import { TokenRefreshService } from "../phase2/services/TokenRefreshService.js";
import { validatePath } from "../_core/security.js";

// ---------------------------------------------------------------------------
// Input Schemas
// ---------------------------------------------------------------------------

const pathSchema = z.string().min(1);

const scanFileSchema = z.object({
  filePath: pathSchema,
});

const scanDirectorySchema = z.object({
  dirPath: pathSchema,
});

const encryptFileSchema = z.object({
  filePath: pathSchema,
  passphrase: z.string().min(8, "Passphrase must be at least 8 characters"),
});

const decryptFileSchema = z.object({
  encryptedPath: pathSchema,
  passphrase: z.string().min(1),
});

const generateKeySchema = z.object({
  projectId: z.string().min(1),
  passphrase: z.string().min(8, "Passphrase must be at least 8 characters"),
});

const createBackupSchema = z.object({
  projectId: z.string().min(1),
  sourceDir: pathSchema,
  passphrase: z.string().optional(),
});

const restoreBackupSchema = z.object({
  archivePath: pathSchema,
  targetDir: pathSchema,
  passphrase: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Router Definition
// ---------------------------------------------------------------------------

export const securityRouter = router({
  // =========================================================================
  // File Scanning
  // =========================================================================

  /** Scan a single file for security threats */
  scanFile: protectedProcedure
    .input(scanFileSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const resolvedPath = await validatePath(input.filePath);
        return await ctx.services.security.scanFile(resolvedPath);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: (error as Error).message,
        });
      }
    }),

  /** Scan an entire directory recursively */
  scanDirectory: protectedProcedure
    .input(scanDirectorySchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const resolvedPath = await validatePath(input.dirPath);
        const results = await ctx.services.security.scanDirectory(resolvedPath);
        const threats = results.filter(r => !r.isSafe);
        return {
          totalFiles: results.length,
          safeFiles: results.length - threats.length,
          threatsFound: threats.length,
          results,
        };
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: (error as Error).message,
        });
      }
    }),

  // =========================================================================
  // Encryption
  // =========================================================================

  /** Encrypt a file with a passphrase */
  encryptFile: protectedProcedure
    .input(encryptFileSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const resolvedPath = await validatePath(input.filePath);
        const outputPath = await ctx.services.security.encryptFile(
          resolvedPath,
          input.passphrase
        );
        return { success: true, outputPath };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Encryption failed: ${(error as Error).message}`,
        });
      }
    }),

  /** Decrypt a file with a passphrase */
  decryptFile: protectedProcedure
    .input(decryptFileSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const resolvedPath = await validatePath(input.encryptedPath);
        const outputPath = await ctx.services.security.decryptFile(
          resolvedPath,
          input.passphrase
        );
        return { success: true, outputPath };
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Decryption failed: ${(error as Error).message}`,
        });
      }
    }),

  /** Generate and store an encryption key for a project */
  generateProjectKey: protectedProcedure
    .input(generateKeySchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const metadata = await ctx.services.security.generateProjectKey(
          input.projectId,
          input.passphrase
        );
        return {
          success: true,
          keyId: metadata.keyId,
          projectId: metadata.projectId,
          createdAt: metadata.createdAt,
        };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: (error as Error).message,
        });
      }
    }),

  // =========================================================================
  // Backup & Restore
  // =========================================================================

  /** Create a backup of a project directory */
  createBackup: protectedProcedure
    .input(createBackupSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const resolvedPath = await validatePath(input.sourceDir);
        return await ctx.services.security.createBackup(
          input.projectId,
          resolvedPath,
          input.passphrase
        );
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Backup failed: ${(error as Error).message}`,
        });
      }
    }),

  /** Restore a project from a backup archive */
  restoreBackup: protectedProcedure
    .input(restoreBackupSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const resolvedArchive = await validatePath(input.archivePath);
        const resolvedTarget = await validatePath(input.targetDir);
        return await ctx.services.security.restoreBackup(
          resolvedArchive,
          resolvedTarget,
          input.passphrase
        );
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Restore failed: ${(error as Error).message}`,
        });
      }
    }),

  /** List all backups for a project */
  listBackups: protectedProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      return ctx.services.security.listBackups(input.projectId);
    }),

  forceRefresh: protectedProcedure
    .input(z.object({ provider: z.string() }))
    .mutation(async ({ input }) => {
      await TokenRefreshService.getInstance().forceRefresh(input.provider);
      return { ok: true };
    }),

  runVulnerabilityScan: protectedProcedure
    .input(z.object({ targetPath: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const safePath = await validatePath(input.targetPath);
      return ctx.services.security.runVulnerabilityScan(safePath);
    }),

  getIoCFeed: protectedProcedure
    .query(async () => {
      const { ThreatIntelService } = await import("../phase2/services/ThreatIntelService.js");
      return ThreatIntelService.getInstance().getIoCFeed();
    }),
});
