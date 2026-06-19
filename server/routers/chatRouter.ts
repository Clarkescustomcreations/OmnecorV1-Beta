import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc.js";
import { TRPCError } from "@trpc/server";
import { eq, and, desc, asc } from "drizzle-orm";
import { getDb } from "../db.factory.js";
import { chatSessions, chatMessages } from "../../drizzle/schema.js";
import { createLogger } from "../_core/logger.js";

const log = createLogger("chatRouter");

// ─────────────────────────────────────────────────────────────────────────────
// Input Schemas
// ─────────────────────────────────────────────────────────────────────────────

const sessionIdSchema = z.object({ id: z.string().min(1) });

const createSessionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(500),
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  projectId: z.string().default(""),
  systemPrompt: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const updateSessionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(500).optional(),
  modelId: z.string().optional(),
  systemPrompt: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const addMessageSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  role: z.enum(["system", "user", "assistant", "tool", "function"]),
  content: z.string(),
  tokenCount: z.number().int().optional(),
});

const deleteMessageSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
});

const bulkImportSessionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(500),
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  projectId: z.string().default(""),
  systemPrompt: z.string().optional(),
  messages: z.array(
    z.object({
      id: z.string().min(1),
      role: z.enum(["system", "user", "assistant", "tool", "function"]),
      content: z.string(),
      tokenCount: z.number().int().optional(),
    })
  ),
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function requireOwnedSession(db: Awaited<ReturnType<typeof getDb>>, sessionId: string, userId: number) {
  const [session] = await db
    .select()
    .from(chatSessions)
    .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.userId, userId)))
    .limit(1);
  if (!session) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Chat session not found" });
  }
  return session;
}

// ─────────────────────────────────────────────────────────────────────────────
// Router Definition
// ─────────────────────────────────────────────────────────────────────────────

export const chatRouter = router({
  /** Add a single message to an existing session. */
  addMessage: protectedProcedure
    .input(addMessageSchema)
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      await requireOwnedSession(db, input.sessionId, ctx.user.id);
      const [row] = await db
        .insert(chatMessages)
        .values({
          id: input.id,
          sessionId: input.sessionId,
          role: input.role,
          content: input.content,
          tokenCount: input.tokenCount,
        })
        .onConflictDoUpdate({
          target: chatMessages.id,
          set: { content: input.content, tokenCount: input.tokenCount },
        })
        .returning();
      if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to save message" });
      // bump session updatedAt
      await db
        .update(chatSessions)
        .set({ updatedAt: new Date() })
        .where(eq(chatSessions.id, input.sessionId));
      return row;
    }),

  /** One-time migration: import all localStorage conversations into DB, skipping existing IDs. */
  bulkImport: protectedProcedure
    .input(z.object({ sessions: z.array(bulkImportSessionSchema) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      let imported = 0;
      for (const s of input.sessions) {
        const existing = await db
          .select({ id: chatSessions.id })
          .from(chatSessions)
          .where(eq(chatSessions.id, s.id))
          .limit(1);
        if (existing.length > 0) continue;

        await db.insert(chatSessions).values({
          id: s.id,
          userId: ctx.user.id,
          projectId: s.projectId || "",
          title: s.title,
          providerId: s.providerId,
          modelId: s.modelId,
          systemPrompt: s.systemPrompt,
        });

        if (s.messages.length > 0) {
          await db.insert(chatMessages).values(
            s.messages.map((m) => ({
              id: m.id,
              sessionId: s.id,
              role: m.role,
              content: m.content,
              tokenCount: m.tokenCount,
            }))
          );
        }
        imported++;
      }
      log.info(`bulkImport: imported ${imported}/${input.sessions.length} sessions for user ${ctx.user.id}`);
      return { imported };
    }),

  /** Create a new session (upsert by id). */
  createSession: protectedProcedure
    .input(createSessionSchema)
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const [row] = await db
        .insert(chatSessions)
        .values({
          id: input.id,
          userId: ctx.user.id,
          projectId: input.projectId || "",
          title: input.title,
          providerId: input.providerId,
          modelId: input.modelId,
          systemPrompt: input.systemPrompt,
          metadata: input.metadata,
        })
        .onConflictDoUpdate({
          target: chatSessions.id,
          set: {
            title: input.title,
            providerId: input.providerId,
            modelId: input.modelId,
            systemPrompt: input.systemPrompt,
            updatedAt: new Date(),
          },
        })
        .returning();
      if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to create session" });
      return row;
    }),

  /** Delete a message (verifying session ownership). */
  deleteMessage: protectedProcedure
    .input(deleteMessageSchema)
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      await requireOwnedSession(db, input.sessionId, ctx.user.id);
      await db.delete(chatMessages).where(eq(chatMessages.id, input.id));
      return { id: input.id, success: true };
    }),

  /** Delete a session and all its messages (cascade). */
  deleteSession: protectedProcedure
    .input(sessionIdSchema)
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const [row] = await db
        .delete(chatSessions)
        .where(and(eq(chatSessions.id, input.id), eq(chatSessions.userId, ctx.user.id)))
        .returning({ id: chatSessions.id });
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Chat session not found" });
      return { id: row.id, success: true };
    }),

  /** Fetch a single session with all its messages. */
  getSession: protectedProcedure
    .input(sessionIdSchema)
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      const session = await requireOwnedSession(db, input.id, ctx.user.id);
      const messages = await db
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.sessionId, input.id))
        .orderBy(asc(chatMessages.createdAt));
      return { ...session, messages };
    }),

  /** List all sessions for the current user, newest first. */
  listSessions: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    return db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.userId, ctx.user.id))
      .orderBy(desc(chatSessions.updatedAt));
  }),

  /** Update session metadata (title, model, system prompt). */
  updateSession: protectedProcedure
    .input(updateSessionSchema)
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const { id, ...rest } = input;
      const patch: Partial<typeof chatSessions.$inferInsert> = { updatedAt: new Date() };
      if (rest.title !== undefined) patch.title = rest.title;
      if (rest.modelId !== undefined) patch.modelId = rest.modelId;
      if (rest.systemPrompt !== undefined) patch.systemPrompt = rest.systemPrompt;
      if (rest.metadata !== undefined) patch.metadata = rest.metadata;

      const [row] = await db
        .update(chatSessions)
        .set(patch)
        .where(and(eq(chatSessions.id, id), eq(chatSessions.userId, ctx.user.id)))
        .returning();
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Chat session not found" });
      return row;
    }),
});
