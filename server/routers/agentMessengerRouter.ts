/**
 * @file server/routers/agentMessengerRouter.ts
 * @description Omnecor — Agent Messenger tRPC Router.
 *
 * A WhatsApp/Discord-style messenger for agents/personas, separate from regular
 * project chats. Each persona is a thread; always-on agents (planner, assistant,
 * self-clone, neural-map retriever, …) can be messaged back and forth. Replies
 * are generated through the user's configured model backend, and every agent
 * reply also raises a "agent" notification so it surfaces in the Notifications
 * feed (and on the nav badge) even when the user isn't on the thread.
 *
 * Threads live in {@link AgentMessengerStore} (process memory), matching the
 * ephemeral, migration-free design of the rest of the Notifications system.
 */

import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc.js";
import { getDb } from "../db.factory.js";
import { personas } from "../../drizzle/schema.js";
import { eq } from "drizzle-orm";
import { AgentMessengerStore } from "../_core/AgentMessengerStore.js";
import { NotificationService } from "../_core/NotificationService.js";
import type { AgentConversation } from "../../shared/notifications.js";

type PersonaData = Record<string, unknown>;

interface ResolvedPersona {
  id: string;
  name: string;
  type: string;
  alwaysOn: boolean;
  data: PersonaData;
}

/** Load the user's personas as Agent Messenger participants. */
async function loadPersonas(userId: number | undefined): Promise<ResolvedPersona[]> {
  const db = await getDb();
  if (!db || !userId) return [];
  const rows = await db.select().from(personas).where(eq(personas.userId, userId));
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    type: r.type,
    alwaysOn: !!r.alwaysOn,
    data: (r.data ?? {}) as PersonaData,
  }));
}

/** Derive the chat provider/model/apiKey from a persona's modelConfig. */
function resolveBackend(data: PersonaData): {
  providerId: string;
  modelId: string;
  apiKey?: string;
} {
  const mc = (data.modelConfig ?? {}) as Record<string, unknown>;
  const backend = typeof mc.backend === "string" ? mc.backend : "ollama";
  switch (backend) {
    case "api":
      return {
        providerId: (mc.apiProviderId as string) || "openai",
        modelId: (mc.apiModelId as string) || "gpt-4o-mini",
        apiKey: (mc.apiKey as string) || undefined,
      };
    case "ommesh":
      return { providerId: "ommesh", modelId: "phone" };
    case "ollama":
    case "cloud_compute":
    default:
      return {
        providerId: "ollama",
        modelId: (mc.ollamaModel as string) || "llama3.2",
      };
  }
}

/** Build the system prompt that gives the agent its persona + capabilities. */
function buildSystemPrompt(p: ResolvedPersona): string {
  const custom =
    typeof p.data.agentSystemPrompt === "string" && p.data.agentSystemPrompt.trim()
      ? p.data.agentSystemPrompt.trim()
      : "";
  const base = [
    `You are "${p.name}", an always-on Omnecor agent (type: ${p.type}).`,
    "You are talking to your operator over the Agent Messenger — a direct chat",
    "separate from project chats. Be concise and conversational, like a teammate",
    "on a messaging app. You can help plan, assist, start or check on Omnecor",
    "tasks, and retrieve neural-map data when asked.",
  ].join(" ");
  return custom ? `${base}\n\n${custom}` : base;
}

export const agentMessengerRouter = router({
  /** List messenger threads (one per persona) with last message + unread count. */
  listConversations: protectedProcedure.query(async ({ ctx }) => {
    const store = AgentMessengerStore.getInstance();
    const people = await loadPersonas(ctx.user?.id);
    const conversations: AgentConversation[] = people.map(p => {
      const last = store.lastMessage(p.id);
      return {
        personaId: p.id,
        name: p.name,
        type: p.type,
        alwaysOn: p.alwaysOn,
        lastMessage: last?.content,
        lastMessageAt: last?.createdAt,
        unread: store.unreadCount(p.id),
      };
    });
    return { conversations };
  }),

  /** Full thread for a persona; marks it read. */
  getMessages: protectedProcedure
    .input(z.object({ personaId: z.string() }))
    .query(({ input }) => {
      const store = AgentMessengerStore.getInstance();
      store.markRead(input.personaId);
      return { messages: store.getMessages(input.personaId) };
    }),

  /** Mark a thread read without fetching. */
  markRead: protectedProcedure
    .input(z.object({ personaId: z.string() }))
    .mutation(({ input }) => {
      AgentMessengerStore.getInstance().markRead(input.personaId);
      return { success: true };
    }),

  /**
   * Send a message to an agent and get its reply. Stores both turns, generates
   * the reply via the persona's model backend (graceful fallback if offline),
   * and raises an "agent" notification for the reply.
   */
  send: protectedProcedure
    .input(
      z.object({
        personaId: z.string(),
        content: z.string().min(1).max(8000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const store = AgentMessengerStore.getInstance();
      const people = await loadPersonas(ctx.user?.id);
      const persona = people.find(p => p.id === input.personaId);
      if (!persona) {
        // Still record the user's message so it isn't lost.
        store.append(input.personaId, "user", input.content);
        return {
          reply: store.append(
            input.personaId,
            "agent",
            "This agent no longer exists. Create it again in Settings → Personas."
          ),
        };
      }

      store.append(persona.id, "user", input.content);

      // Build the conversation context (last ~20 turns) for the model.
      const history = store.getMessages(persona.id).slice(-20);
      const backend = resolveBackend(persona.data);
      const messages = [
        { role: "system" as const, content: buildSystemPrompt(persona) },
        ...history.map(m => ({
          role: (m.role === "agent" ? "assistant" : "user") as "assistant" | "user",
          content: m.content,
        })),
      ];

      let replyText: string;
      try {
        replyText = await ctx.services.aiProvider.chat({
          providerId: backend.providerId,
          modelId: backend.modelId,
          apiKey: backend.apiKey,
          messages,
          maxTokens: 1024,
        });
      } catch {
        replyText =
          `⚠️ ${persona.name} is offline right now (no reachable model backend). ` +
          `Your message was saved — configure this persona's model in ` +
          `Settings → Personas and try again.`;
      }

      const reply = store.append(persona.id, "agent", replyText);

      NotificationService.getInstance().notify({
        kind: "agent",
        title: persona.name,
        body: replyText.slice(0, 200),
        href: `/notifications?persona=${persona.id}`,
        data: { personaId: persona.id, messageId: reply.id },
      });

      return { reply };
    }),
});
