/**
 * @file routers/scriptsRouter.ts
 * @description Omnecor — Saved Scripts library tRPC Router
 *
 * Persists Python tools/scripts the AI generates in chat to the user's DB
 * record, so they are reusable across sessions, devices and projects. This
 * replaces the previous localStorage-only store which was trapped on a single
 * browser. All procedures are scoped to the authenticated user.
 */

import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc.js";
import { TRPCError } from "@trpc/server";
import { eq, and, desc } from "drizzle-orm";
import { getDb } from "../db.factory.js";
import { savedScripts, type InsertSavedScript } from "../../drizzle/schema.js";
import { createLogger } from "../_core/logger.js";

const log = createLogger("scriptsRouter");

// ─────────────────────────────────────────────────────────────────────────────
// Input Schemas
// ─────────────────────────────────────────────────────────────────────────────

const createScriptSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  code: z.string().min(1, "Code is required"),
  description: z.string().max(2000).default(""),
  language: z.string().min(1).max(40).default("python"),
  project: z.string().max(120).default("Default"),
  mapId: z.string().optional(),
});

const updateScriptSchema = z.object({
  id: z.number(),
  name: z.string().min(1).max(200).optional(),
  code: z.string().min(1).optional(),
  description: z.string().max(2000).optional(),
  language: z.string().min(1).max(40).optional(),
  project: z.string().max(120).optional(),
  mapId: z.string().optional(),
});

const idSchema = z.object({ id: z.number() });

// ─────────────────────────────────────────────────────────────────────────────
// Router Definition
// ─────────────────────────────────────────────────────────────────────────────

export const scriptsRouter = router({
  /** List every saved script for the current user (newest first). Scoped to mapId if provided. */
  list: protectedProcedure
    .input(z.object({ mapId: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      let condition = eq(savedScripts.userId, ctx.user.id);
      if (input?.mapId) {
        condition = and(condition, eq(savedScripts.mapId, input.mapId))!;
      }
      return db
        .select()
        .from(savedScripts)
        .where(condition)
        .orderBy(desc(savedScripts.updatedAt));
    }),

  /** Distinct project/folder names the user has scripts in (for grouping). Scoped to mapId. */
  listProjects: protectedProcedure
    .input(z.object({ mapId: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      let condition = eq(savedScripts.userId, ctx.user.id);
      if (input?.mapId) {
        condition = and(condition, eq(savedScripts.mapId, input.mapId))!;
      }
      const rows = await db
        .selectDistinct({ project: savedScripts.project })
        .from(savedScripts)
        .where(condition);
      return rows
        .map((r) => r.project)
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
    }),

  /** Save a new script to the user's library. */
  create: protectedProcedure
    .input(createScriptSchema)
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const [row] = await db
        .insert(savedScripts)
        .values({
          userId: ctx.user.id,
          name: input.name,
          code: input.code,
          description: input.description,
          language: input.language,
          project: input.project || "Default",
          mapId: input.mapId || null,
        })
        .returning();

      if (!row) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to save script",
        });
      }
      return row;
    }),

  /** Update an existing script the user owns. */
  update: protectedProcedure
    .input(updateScriptSchema)
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const { id, ...rest } = input;
      const patch: Partial<InsertSavedScript> = {};
      if (rest.name !== undefined)        patch.name = rest.name;
      if (rest.code !== undefined)        patch.code = rest.code;
      if (rest.description !== undefined) patch.description = rest.description;
      if (rest.language !== undefined)    patch.language = rest.language;
      if (rest.project !== undefined)     patch.project = rest.project;
      if (rest.mapId !== undefined)       patch.mapId = rest.mapId;

      const [row] = await db
        .update(savedScripts)
        .set(patch)
        .where(
          and(eq(savedScripts.id, id), eq(savedScripts.userId, ctx.user.id))
        )
        .returning();

      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Script not found",
        });
      }
      return row;
    }),

  /** Delete a script the user owns. */
  delete: protectedProcedure
    .input(idSchema)
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const [row] = await db
        .delete(savedScripts)
        .where(
          and(
            eq(savedScripts.id, input.id),
            eq(savedScripts.userId, ctx.user.id)
          )
        )
        .returning({ id: savedScripts.id });

      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Script not found",
        });
      }
      log.info(`Deleted saved script ${input.id} for user ${ctx.user.id}`);
      return { id: row.id, success: true };
    }),
});
