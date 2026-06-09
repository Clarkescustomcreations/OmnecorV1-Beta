import { protectedProcedure, router } from "../_core/trpc.js";
import { z } from "zod";
import { getDb } from "../db.factory.js";
import { personas } from "../../drizzle/schema.js";
import { eq, and } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

const personaDataSchema = z.record(z.string(), z.unknown());

export const personaRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return [];
    const userId = ctx.user?.id;
    if (!userId) return [];
    const rows = await db.select().from(personas).where(eq(personas.userId, userId));
    return rows.map((r): Record<string, unknown> => ({
      ...(r.data as Record<string, unknown>),
      id: r.id,
      name: r.name,
      type: r.type,
      alwaysOn: !!r.alwaysOn,
      createdAt: r.createdAt.toISOString(),
    }));
  }),

  upsert: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      name: z.string().min(1),
      type: z.string().default("self_clone"),
      alwaysOn: z.boolean().default(false),
      data: personaDataSchema,
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Database unavailable" });
      const userId = ctx.user?.id;
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      const existing = await db.select({ id: personas.id }).from(personas)
        .where(and(eq(personas.id, input.id), eq(personas.userId, userId)));
      if (existing.length > 0) {
        await db.update(personas).set({
          name: input.name,
          type: input.type,
          alwaysOn: input.alwaysOn ? 1 : 0,
          data: input.data,
        }).where(and(eq(personas.id, input.id), eq(personas.userId, userId)));
      } else {
        await db.insert(personas).values({
          id: input.id,
          userId,
          name: input.name,
          type: input.type,
          alwaysOn: input.alwaysOn ? 1 : 0,
          data: input.data,
        });
      }
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Database unavailable" });
      const userId = ctx.user?.id;
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      await db.delete(personas).where(
        and(eq(personas.id, input.id), eq(personas.userId, userId))
      );
      return { success: true };
    }),

  migrate: protectedProcedure
    .input(z.array(z.object({
      id: z.string(),
      name: z.string(),
      type: z.string().default("self_clone"),
      alwaysOn: z.boolean().default(false),
      data: personaDataSchema,
    })))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { migrated: 0 };
      const userId = ctx.user?.id;
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      let migrated = 0;
      for (const p of input) {
        const existing = await db.select({ id: personas.id }).from(personas)
          .where(and(eq(personas.id, p.id), eq(personas.userId, userId)));
        if (existing.length === 0) {
          await db.insert(personas).values({
            id: p.id, userId, name: p.name, type: p.type,
            alwaysOn: p.alwaysOn ? 1 : 0, data: p.data,
          });
          migrated++;
        }
      }
      return { migrated };
    }),
});
