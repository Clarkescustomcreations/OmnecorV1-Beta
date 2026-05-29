/**
 * @file server/routers/projectRouter.ts
 * @description Omnecor — Project Management tRPC Router
 *
 * PATCH NOTES (Neural Brain Map integration):
 *   - Added `registerProject` as the canonical alias for `registerWatcher`.
 *     NeuralBrainMap.tsx calls trpc.project.registerProject.useMutation().
 *   - Replaced `getFileTree` with a version that accepts `{ projectId, rootDir }`
 *     and returns a nested FileTreeNode[] tree instead of a flat string[].
 *     NeuralBrainMap.tsx calls trpc.project.getFileTree.useQuery({ projectId, rootDir })
 *     and pipes the result straight into fileTreeToNetwork().
 *   - All existing procedures (registerWatcher, unregisterWatcher, getWatcherStatus,
 *     checkAgentLoop, resetLoopDetector, getLoopDetectorState) are preserved unchanged.
 *
 * DROP-IN: replace server/routers/projectRouter.ts with this file.
 * No changes required to server/routers.ts — the export name is unchanged.
 */

import { z } from "zod";
import { router, publicProcedure } from "../_core/trpc.js";
import { TRPCError } from "@trpc/server";
import path from "path";
import fs from "fs/promises";

// ---------------------------------------------------------------------------
// FileTreeNode — matches fileTreeToNetwork.ts on the frontend exactly
// ---------------------------------------------------------------------------

export interface FileTreeNode {
  name: string;
  path: string;
  relativePath: string;
  type: "file" | "directory";
  size?: number;
  extension?: string;
  children?: FileTreeNode[];
  modifiedAt?: string;
}

// ---------------------------------------------------------------------------
// Ignored patterns (mirrors WATCHER_CONFIG.ignored)
// ---------------------------------------------------------------------------

const IGNORED_PATTERNS = [
  /node_modules/,
  /\.git/,
  /__pycache__/,
  /\.pyc$/,
  /^dist\//,
  /\.next\//,
  /\.cache\//,
  /coverage\//,
  /\.turbo\//,
];

function shouldIgnoreName(name: string): boolean {
  // Ignore hidden files/dirs (dot-prefixed)
  if (name.startsWith(".")) return true;
  return IGNORED_PATTERNS.some(r => r.test(name));
}

// ---------------------------------------------------------------------------
// Recursive tree builder — used by getFileTree
// ---------------------------------------------------------------------------

async function buildTree(
  absolutePath: string,
  rootDir: string,
  depth: number,
  maxDepth: number
): Promise<FileTreeNode | null> {
  let stat;
  try {
    stat = await fs.stat(absolutePath);
  } catch {
    return null; // deleted between readdir and stat — skip silently
  }

  const name = path.basename(absolutePath);
  const relativePath = path.relative(rootDir, absolutePath) || ".";
  const ext = path.extname(name) || undefined;

  const base: FileTreeNode = {
    name,
    path: absolutePath,
    relativePath,
    type: stat.isDirectory() ? "directory" : "file",
    size: stat.isFile() ? stat.size : undefined,
    extension: stat.isFile() ? ext : undefined,
    modifiedAt: stat.mtime.toISOString(),
  };

  if (!stat.isDirectory() || depth >= maxDepth) {
    return base;
  }

  let entries: string[];
  try {
    entries = await fs.readdir(absolutePath);
  } catch {
    return { ...base, children: [] };
  }

  // directories first, then files, both alphabetical — stable sort for UI
  const filtered = entries.filter(e => !shouldIgnoreName(e)).sort((a, b) => {
    return a.localeCompare(b);
  });

  const children = (
    await Promise.all(
      filtered.map(entry =>
        buildTree(path.join(absolutePath, entry), rootDir, depth + 1, maxDepth)
      )
    )
  ).filter((c): c is FileTreeNode => c !== null);

  return { ...base, children };
}

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const registerProjectSchema = z.object({
  projectId: z.string().min(1),
  rootDir: z.string().min(1),
  debounceMs: z.number().int().min(50).max(5000).optional(),
});

const loopCheckSchema = z.object({
  sessionId: z.string().min(1),
  toolName: z.string().min(1),
  args: z.record(z.string(), z.any()),
  state: z.record(z.string(), z.any()),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const projectRouter = router({
  // =========================================================================
  // File Watching
  // =========================================================================

  /**
   * ALIAS — canonical name used by NeuralBrainMap.tsx.
   * Identical behaviour to registerWatcher below.
   */
  registerProject: publicProcedure
    .input(registerProjectSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const resolved = path.resolve(input.rootDir);

        // Validate the path exists and is a directory before handing to chokidar
        const stat = await fs.stat(resolved).catch(() => null);
        if (!stat || !stat.isDirectory()) {
          throw new Error(`Path is not a directory: ${resolved}`);
        }

        await ctx.services.fileWatcher.registerProject({
          projectId: input.projectId,
          rootDir: resolved,
          debounceMs: input.debounceMs,
        });

        return {
          success: true,
          projectId: input.projectId,
          rootDir: resolved,
          message: `Project "${input.projectId}" registered and watching "${resolved}"`,
        };
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: (error as Error).message,
        });
      }
    }),

  /**
   * ORIGINAL — kept for backwards compatibility with any existing callers.
   */
  registerWatcher: publicProcedure
    .input(registerProjectSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        await ctx.services.fileWatcher.registerProject({
          projectId: input.projectId,
          rootDir: input.rootDir,
          debounceMs: input.debounceMs,
        });

        return {
          success: true,
          message: `Watcher registered for project "${input.projectId}" at "${input.rootDir}"`,
        };
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: (error as Error).message,
        });
      }
    }),

  unregisterWatcher: publicProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.services.fileWatcher.unregisterProject(input.projectId);
      return { success: true };
    }),

  getWatcherStatus: publicProcedure.query(async ({ ctx }) => {
    return ctx.services.fileWatcher.getStatus();
  }),

  /**
   * REPLACED — now accepts { projectId, rootDir } and returns FileTreeNode[]
   * (nested recursive tree) instead of a flat string[].
   *
   * NeuralBrainMap.tsx passes result directly to fileTreeToNetwork().
   * The old flat-string version is preserved as getFileTreeFlat below.
   */
  getFileTree: publicProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        rootDir: z.string().min(1),
      })
    )
    .query(async ({ input }) => {
      try {
        const resolved = path.resolve(input.rootDir);

        // Validate path
        const stat = await fs.stat(resolved).catch(() => null);
        if (!stat || !stat.isDirectory()) {
          throw new Error(`Not a directory: ${resolved}`);
        }

        // Build the tree starting from rootDir's immediate children
        // (so fileTreeToNetwork receives children[], not the root node itself)
        const rootNode = await buildTree(resolved, resolved, 0, 8);
        return (rootNode?.children ?? []) as FileTreeNode[];
      } catch (error) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Failed to build file tree for "${input.rootDir}": ${(error as Error).message}`,
        });
      }
    }),

  /**
   * PRESERVED — original flat string[] version for any existing internal callers.
   */
  getFileTreeFlat: publicProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      try {
        const files = await ctx.services.fileWatcher.getFileTree(input.projectId);
        return { projectId: input.projectId, files, count: files.length };
      } catch (error) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: (error as Error).message,
        });
      }
    }),

  // =========================================================================
  // Loop Detector (AI Agent Safety) — unchanged
  // =========================================================================

  checkAgentLoop: publicProcedure
    .input(loopCheckSchema)
    .mutation(async ({ ctx, input }) => {
      const hash = ctx.services.hashTracker.hashAction(
        input.toolName,
        input.args,
        input.state
      );
      return ctx.services.hashTracker.checkAndRecord(input.sessionId, hash);
    }),

  resetLoopDetector: publicProcedure
    .input(z.object({ sessionId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      ctx.services.hashTracker.resetSession(input.sessionId);
      return { success: true };
    }),

  getLoopDetectorState: publicProcedure
    .input(z.object({ sessionId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const snapshot = ctx.services.hashTracker.getSessionSnapshot(input.sessionId);
      if (!snapshot) {
        return { exists: false, snapshot: null };
      }
      return { exists: true, snapshot };
    }),
});
