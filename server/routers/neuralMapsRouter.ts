import { protectedProcedure, router } from "../_core/trpc.js";
import { z } from "zod";
import { getDb } from "../db.factory.js";
import { neuralMaps } from "../../drizzle/schema.js";
import { eq, and } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { MemoryArchitectService } from "../phase2/services/MemoryArchitectService.js";

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
          removedRemoteRoots.map(uri => memory.deleteRemoteSource(input.id, uri).catch(() => {})),
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

      await db
        .delete(neuralMaps)
        .where(and(eq(neuralMaps.id, input.id), eq(neuralMaps.userId, userId)));

      // Drop the map's entire vector collection so its indexed content (local
      // + remote) doesn't linger after the map is gone.
      await MemoryArchitectService.getInstance().deleteCollection(input.id).catch(() => {});

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
});
