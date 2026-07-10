import { protectedProcedure, router } from "../_core/trpc.js";
import { z } from "zod";
import { getDb } from "../db.factory.js";
import {
  neuralMaps,
  savedScripts,
  designProjects,
  designSaves,
  curatedPosts,
  scheduledPosts,
  discoveredArticles,
  discoveredDatasetItems,
  curatedTrainingExamples,
  virtualCards,
} from "../../drizzle/schema.js";
import { eq, and } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { MemoryArchitectService } from "../core_services/services/MemoryArchitectService.js";
import { homedir } from "os";
import { join } from "path";
import fsPromises from "fs/promises";
import { SettingsService, getSettingsPath } from "../core_services/services/SettingsService.js";
import { createLogger } from "../_core/logger.js";

const log = createLogger("neural-maps");

async function readSettingsFileAsync(): Promise<Record<string, unknown>> {
  try {
    const path = getSettingsPath();
    const text = await fsPromises.readFile(path, "utf-8");
    return JSON.parse(text) as Record<string, unknown>;
  } catch (error: any) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return {};
    }
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Failed to read or parse settings file: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

async function writeSettingsFileAsync(settings: Record<string, unknown>): Promise<void> {
  const path = getSettingsPath();
  const dir = path.substring(0, path.lastIndexOf("/"));
  await fsPromises.mkdir(dir, { recursive: true });
  await fsPromises.writeFile(path, JSON.stringify(settings, null, 2), "utf-8");
}

const isRemoteRoot = (r: string) => r.startsWith("github://") || r.startsWith("integration://");

const settingsSchema = z.object({
  autoWatch: z.boolean().default(true),
  realtimeSync: z.boolean().default(true),
  indexingEnabled: z.boolean().default(true),
  graphPhysics: z.boolean().default(true),
  maxDepth: z.number().default(6),
  isolateMemory: z.boolean().default(false),
  enableAIContext: z.boolean().default(true),
  enableSemanticLinks: z.boolean().default(true),
  collapsedFolderIds: z.array(z.string()).optional().default([]),
});

const projectContextSchema = z.object({
  description: z.string().optional(),
  techStack: z.array(z.string()).optional(),
  goals: z.array(z.string()).optional(),
  team: z.array(z.string()).optional(),
  notes: z.string().optional(),
}).optional();

export const neuralMapsRouter = router({
  /** List all maps for the current user */
  list: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();

    const userId = ctx.user?.id;
    if (!userId) return [];

    return db
      .select()
      .from(neuralMaps)
      .where(eq(neuralMaps.userId, userId))
      .orderBy(neuralMaps.createdAt);
  }),

  /** Create a new map. Client provides the UUID so it can use it immediately. */
  create: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      name: z.string().min(1).max(255),
      mode: z.enum(["standard", "fiction", "research", "coding", "roleplay"]).default("standard"),
      rootDirectories: z.array(z.string()).default([]),
      projectContext: projectContextSchema,
      labelOverrides: z.record(z.string(), z.string()).optional(),
      settings: settingsSchema,
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();

      const userId = ctx.user?.id;
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });

      await db.insert(neuralMaps).values({
        id: input.id,
        userId,
        name: input.name,
        mode: input.mode,
        rootDirectories: input.rootDirectories,
        projectContext: input.projectContext ?? null,
        labelOverrides: input.labelOverrides ?? null,
        settings: input.settings,
      }).onConflictDoUpdate({
        target: neuralMaps.id,
        set: { name: input.name, updatedAt: new Date() },
      });

      return { success: true, id: input.id };
    }),

  /** Partial update — only provided fields are changed */
  update: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      name: z.string().min(1).max(255).optional(),
      mode: z.enum(["standard", "fiction", "research", "coding", "roleplay"]).optional(),
      rootDirectories: z.array(z.string()).optional(),
      projectContext: projectContextSchema,
      labelOverrides: z.record(z.string(), z.string()).optional().nullable(),
      settings: settingsSchema.optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();

      const userId = ctx.user?.id;
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });

      // When the root list changes, reconcile the vector store: any remote
      // source dropped from the map has its indexed chunks removed so RAG never
      // returns content from a source the user disconnected.
      let removedRemoteRoots: string[] = [];
      if (input.rootDirectories !== undefined) {
        const existing = await db
          .select({ rootDirectories: neuralMaps.rootDirectories })
          .from(neuralMaps)
          .where(and(eq(neuralMaps.id, input.id), eq(neuralMaps.userId, userId)))
          .limit(1);
        const before = new Set(existing[0]?.rootDirectories ?? []);
        const after = new Set(input.rootDirectories);
        removedRemoteRoots = [...before].filter(r => isRemoteRoot(r) && !after.has(r));
      }

      const patch: Partial<typeof neuralMaps.$inferInsert> = { updatedAt: new Date() };
      if (input.name !== undefined) patch.name = input.name;
      if (input.mode !== undefined) patch.mode = input.mode;
      if (input.rootDirectories !== undefined) patch.rootDirectories = input.rootDirectories;
      if (input.projectContext !== undefined) patch.projectContext = input.projectContext ?? null;
      if (input.labelOverrides !== undefined) patch.labelOverrides = input.labelOverrides ?? null;
      if (input.settings !== undefined) patch.settings = input.settings;

      await db
        .update(neuralMaps)
        .set(patch)
        .where(and(eq(neuralMaps.id, input.id), eq(neuralMaps.userId, userId)));

      if (removedRemoteRoots.length > 0) {
        const memory = MemoryArchitectService.getInstance();
        await Promise.all(
          removedRemoteRoots.map(uri =>
            memory.deleteRemoteSource(input.id, uri).catch(error => {
              log.warn(`Failed to delete remote source ${uri} for map ${input.id}:`, error instanceof Error ? error.message : String(error));
            })
          ),
        );
      }

      return { success: true };
    }),

  /** Delete a map */
  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();

      const userId = ctx.user?.id;
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });

      // Verify ownership up front so a non-owner can neither delete rows nor
      // (previously a small IDOR) trigger the vector-collection wipe by guessing
      // a map id. Stay idempotent for an unowned/missing id: no-op success.
      const owned = await db
        .select({ id: neuralMaps.id })
        .from(neuralMaps)
        .where(and(eq(neuralMaps.id, input.id), eq(neuralMaps.userId, userId)))
        .limit(1);
      if (!owned[0]) return { success: true };

      // Belt + suspenders. Migration 0014 makes every neural_maps child FK
      // ON DELETE CASCADE at the DB layer (the inline-FK tables already had it),
      // so deleting the map row alone cleans up. We ALSO delete the children
      // explicitly — atomically, via a libsql batch (single BEGIN/COMMIT) —
      // so cleanup is correct even on a DB whose FK actions drifted (the bug this
      // fixed). Children are deleted before the map so the batch succeeds with or
      // without the DB-level cascade. `db.batch` (not `db.transaction`) is used
      // deliberately: it runs on one connection, so it also works under the
      // in-memory libsql test harness. This list mirrors the FK children of
      // neural_maps; dbSchema.test.ts guards the DB-cascade side, so a newly
      // added child table missed here is still cleaned by the cascade and the
      // schema test flags the divergence.
      await db.batch([
        db.delete(savedScripts).where(eq(savedScripts.mapId, input.id)),
        db.delete(designSaves).where(eq(designSaves.mapId, input.id)),
        db.delete(designProjects).where(eq(designProjects.mapId, input.id)),
        db.delete(curatedPosts).where(eq(curatedPosts.projectId, input.id)),
        db.delete(scheduledPosts).where(eq(scheduledPosts.projectId, input.id)),
        db.delete(discoveredArticles).where(eq(discoveredArticles.projectId, input.id)),
        db.delete(discoveredDatasetItems).where(eq(discoveredDatasetItems.projectId, input.id)),
        db.delete(curatedTrainingExamples).where(eq(curatedTrainingExamples.projectId, input.id)),
        db.delete(virtualCards).where(eq(virtualCards.projectId, input.id)),
        db.delete(neuralMaps).where(and(eq(neuralMaps.id, input.id), eq(neuralMaps.userId, userId))),
      ]);

      // Drop the map's entire vector collection so its indexed content (local
      // + remote) doesn't linger after the map is gone.
      await MemoryArchitectService.getInstance().deleteCollection(input.id).catch(error => {
        log.warn(`Failed to delete vector collection for map ${input.id}:`, error instanceof Error ? error.message : String(error));
      });

      return { success: true };
    }),

  /**
   * Upsert a batch of maps — used for one-time migration of localStorage maps to DB.
   * Skips maps whose IDs already exist in the DB.
   */
  migrate: protectedProcedure
    .input(z.array(z.object({
      id: z.string(),
      name: z.string().min(1).max(255),
      mode: z.string().default("standard"),
      rootDirectories: z.array(z.string()).default([]),
      projectContext: z.record(z.string(), z.unknown()).optional().nullable(),
      labelOverrides: z.record(z.string(), z.string()).optional().nullable(),
      settings: z.record(z.string(), z.unknown()),
      createdAt: z.string().optional(),
    })))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();

      const userId = ctx.user?.id;
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });

      let migrated = 0;
      for (const map of input) {
        try {
          await db.insert(neuralMaps).values({
            id: map.id,
            userId,
            name: map.name,
            mode: map.mode,
            rootDirectories: map.rootDirectories,
            projectContext: map.projectContext ?? null,
            labelOverrides: map.labelOverrides ?? null,
            settings: map.settings,
            createdAt: map.createdAt ? new Date(map.createdAt) : new Date(),
          }).onConflictDoUpdate({ target: neuralMaps.id, set: { updatedAt: new Date() } });
          migrated++;
        } catch {
          // Skip maps that fail to insert (e.g. invalid UUID format)
        }
      }

      return { success: true, migrated };
    }),

  /** Get the currently active map ID from settings */
  getActiveMapId: protectedProcedure.query(async () => {
    const activeMapId = SettingsService.getInstance().get("activeMapId", null as string | null);
    return { activeMapId };
  }),

  /** Set the currently active map ID in settings */
  setActiveMapId: protectedProcedure
    .input(z.object({ activeMapId: z.string().uuid().nullable() }))
    .mutation(async ({ input }) => {
      const current = await readSettingsFileAsync();
      const updated = { ...current, activeMapId: input.activeMapId };
      await writeSettingsFileAsync(updated);
      return { success: true };
    }),
});
