import { protectedProcedure, router } from "../_core/trpc.js";
import { z } from "zod";
import { getDb } from "../db.factory.js";
import { personas, brains } from "../../drizzle/schema.js";
import { eq, and, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

const personaDataSchema = z.record(z.string(), z.unknown());

/** Max brains a single persona may durably carry (matches the chat-schema cap). */
const MAX_PERSONA_BRAINS = 16;

/** Read a persona's durable brain ids out of its free-form `data` blob. */
function personaBrainIds(data: Record<string, unknown> | undefined): string[] {
  const raw = data?.brains;
  return Array.isArray(raw) ? raw.filter((b): b is string => typeof b === "string" && !!b) : [];
}

export const personaRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
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

  /**
   * Durably attach a Brain Pack to a persona (Brains-Upgrade Phase 4). The
   * persona then carries the brain into every chat that resolves it (unioned
   * with any per-chat `brainIds`). Both the persona and the brain must be owned
   * by the caller. Idempotent — attaching an already-attached brain is a no-op.
   */
  attachBrain: protectedProcedure
    .input(z.object({ personaId: z.string().uuid(), brainId: z.string().min(1).max(128) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const userId = ctx.user?.id;
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });

      const [persona] = await db.select().from(personas)
        .where(and(eq(personas.id, input.personaId), eq(personas.userId, userId))).limit(1);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND", message: "Persona not found" });

      // Ownership-gate the brain so a persona can't reference a foreign/missing pack.
      const [brain] = await db.select({ id: brains.id }).from(brains)
        .where(and(eq(brains.id, input.brainId), eq(brains.userId, userId))).limit(1);
      if (!brain) throw new TRPCError({ code: "NOT_FOUND", message: "Brain not found" });

      const data = (persona.data as Record<string, unknown>) ?? {};
      const current = personaBrainIds(data);
      if (current.includes(input.brainId)) return { brains: current };
      const next = [...current, input.brainId].slice(0, MAX_PERSONA_BRAINS);
      await db.update(personas).set({ data: { ...data, brains: next } })
        .where(and(eq(personas.id, input.personaId), eq(personas.userId, userId)));
      return { brains: next };
    }),

  /** Detach a Brain Pack from a persona (idempotent). */
  detachBrain: protectedProcedure
    .input(z.object({ personaId: z.string().uuid(), brainId: z.string().min(1).max(128) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const userId = ctx.user?.id;
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });

      const [persona] = await db.select().from(personas)
        .where(and(eq(personas.id, input.personaId), eq(personas.userId, userId))).limit(1);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND", message: "Persona not found" });

      const data = (persona.data as Record<string, unknown>) ?? {};
      const next = personaBrainIds(data).filter(b => b !== input.brainId);
      await db.update(personas).set({ data: { ...data, brains: next } })
        .where(and(eq(personas.id, input.personaId), eq(personas.userId, userId)));
      return { brains: next };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
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
      const userId = ctx.user?.id;
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      let migrated = 0;
      if (input.length === 0) return { migrated };
      const inputIds = input.map(p => p.id);
      const existingRows = await db.select({ id: personas.id }).from(personas)
        .where(and(inArray(personas.id, inputIds), eq(personas.userId, userId)));
      const existingSet = new Set(existingRows.map(r => r.id));
      const toInsert = input.filter(p => !existingSet.has(p.id));
      for (const p of toInsert) {
        await db.insert(personas).values({
          id: p.id, userId, name: p.name, type: p.type,
          alwaysOn: p.alwaysOn ? 1 : 0, data: p.data,
        });
        migrated++;
      }
      return { migrated };
    }),
});
