/**
 * Mobile Sync Router
 *
 * Receives chat conversations synced from the Omnecor HQ mobile app and surfaces
 * them in the desktop Notifications tab. If a mobile chat was started without a
 * project / neural map, the desktop offers an "Add to project" action which
 * materializes the conversation as a real chat session under a chosen project.
 *
 * Storage is an in-memory ring buffer (mirrors NotificationService / HITL) so it
 * works identically on MySQL and SQLite without a schema migration. The
 * materialized session created by addToProject IS persisted via the normal chat
 * session tables.
 */
import { z } from "zod";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc.js";
import { NotificationService } from "../_core/NotificationService.js";
import { createChatSession, addChatMessage, getDb } from "../db.factory.js";
import { neuralMaps } from "../../drizzle/schema.js";

/**
 * Best-effort auto-link: when a mobile chat arrived with no project / neural
 * map, try to detect one by matching the conversation text against the user's
 * project names and neural-map names. Returns the first confident match.
 */
async function detectLink(
  ctx: { services: { fileWatcher: { getStatus: () => { projectId: string; rootDir: string }[] } }; user?: { id: number } },
  text: string,
): Promise<{ projectId?: string; neuralMapId?: string; label?: string }> {
  const hay = text.toLowerCase();
  try {
    for (const s of ctx.services.fileWatcher.getStatus()) {
      const name = (path.basename(s.rootDir) || "").toLowerCase();
      if (name.length >= 3 && hay.includes(name)) return { projectId: s.projectId, label: name };
    }
  } catch { /* fileWatcher unavailable */ }
  try {
    const db = await getDb();
    if (db && ctx.user?.id) {
      const maps = await db.select().from(neuralMaps).where(eq(neuralMaps.userId, ctx.user.id));
      for (const m of maps as { id: string; name?: string | null }[]) {
        const name = String(m.name ?? "").toLowerCase();
        if (name.length >= 3 && hay.includes(name)) return { neuralMapId: m.id, label: name };
      }
    }
  } catch { /* neural maps unavailable (e.g. null db) */ }
  return {};
}

interface SyncedChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp?: string;
}

interface SyncedChat {
  syncId: string;
  deviceName: string;
  mobileSessionId: string;
  title: string;
  messages: SyncedChatMessage[];
  neuralMapId: string | null;
  projectId: string | null;
  addedToProjectId: string | null;
  syncedAt: string;
}

const MAX_SYNCED = 250;
const store: SyncedChat[] = [];

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  timestamp: z.string().optional(),
});

export const mobileSyncRouter = router({
  /**
   * Push a mobile conversation to the desktop. Idempotent per mobileSessionId
   * (re-pushing updates the existing record). Emits a 'mobile-chat'
   * notification into the Notifications feed.
   */
  push: protectedProcedure
    .input(
      z.object({
        deviceName: z.string().max(120).default("Phone"),
        mobileSessionId: z.string().min(1).max(120),
        title: z.string().max(200).default("Mobile chat"),
        messages: z.array(messageSchema).max(2000),
        neuralMapId: z.string().nullish(),
        projectId: z.string().nullish(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      let projectId = input.projectId ?? null;
      let neuralMapId = input.neuralMapId ?? null;

      // Auto-link: if the chat arrived unassigned, try to detect a project /
      // neural map from the conversation content.
      let detected: { projectId?: string; neuralMapId?: string; label?: string } = {};
      if (!projectId && !neuralMapId) {
        const text = input.messages.map((m) => m.content).join(" ");
        detected = await detectLink(ctx as Parameters<typeof detectLink>[0], text);
        if (detected.projectId) projectId = detected.projectId;
        if (detected.neuralMapId) neuralMapId = detected.neuralMapId;
      }

      const existing = store.find((c) => c.mobileSessionId === input.mobileSessionId);
      const record: SyncedChat = {
        syncId: existing?.syncId ?? randomUUID(),
        deviceName: input.deviceName,
        mobileSessionId: input.mobileSessionId,
        title: input.title,
        messages: input.messages,
        neuralMapId,
        projectId,
        addedToProjectId: existing?.addedToProjectId ?? null,
        syncedAt: new Date().toISOString(),
      };
      if (existing) Object.assign(existing, record);
      else {
        store.unshift(record);
        if (store.length > MAX_SYNCED) store.length = MAX_SYNCED;
      }

      const last = input.messages[input.messages.length - 1];
      const unassigned = !record.projectId && !record.neuralMapId && !record.addedToProjectId;
      const autoLinked = !!(detected.projectId || detected.neuralMapId);
      NotificationService.getInstance().notify({
        kind: "mobile-chat",
        title: `📱 ${input.deviceName}: ${input.title}`,
        body: autoLinked
          ? `Auto-linked to ${detected.label}. ${last ? last.content : ""}`.slice(0, 200)
          : last ? `${last.role === "user" ? "You" : "AI"}: ${last.content}` : "Synced from mobile",
        href: "/notifications",
        data: {
          syncId: record.syncId,
          mobileSessionId: record.mobileSessionId,
          messageCount: input.messages.length,
          needsProject: unassigned,
          autoLinked,
          detectedLabel: detected.label ?? null,
          neuralMapId: record.neuralMapId,
          projectId: record.projectId,
        },
      });

      return {
        ok: true,
        syncId: record.syncId,
        needsProject: unassigned,
        autoLinked,
        projectId: record.projectId,
        neuralMapId: record.neuralMapId,
      };
    }),

  /** List synced mobile chats, newest-first. */
  list: protectedProcedure.query(() => store),

  /**
   * Materialize a synced mobile conversation as a real chat session under the
   * given project (the desktop "Add to project" action).
   */
  addToProject: protectedProcedure
    .input(
      z.object({
        syncId: z.string().min(1),
        projectId: z.string().min(1),
        providerId: z.string().default("ollama"),
        modelId: z.string().default("llama3.2:latest"),
      })
    )
    .mutation(async ({ input }) => {
      const chat = store.find((c) => c.syncId === input.syncId);
      if (!chat) throw new TRPCError({ code: "NOT_FOUND", message: "Synced chat not found" });

      const sessionId = randomUUID();
      await createChatSession({
        id: sessionId,
        projectId: input.projectId,
        title: chat.title || "Mobile chat",
        providerId: input.providerId,
        modelId: input.modelId,
        systemPrompt: null,
      });

      for (const m of chat.messages) {
        await addChatMessage({
          id: randomUUID(),
          sessionId,
          role: m.role,
          content: m.content,
          tokenCount: null,
        });
      }

      chat.addedToProjectId = input.projectId;
      return { ok: true, sessionId, projectId: input.projectId };
    }),
});

export type MobileSyncRouter = typeof mobileSyncRouter;
