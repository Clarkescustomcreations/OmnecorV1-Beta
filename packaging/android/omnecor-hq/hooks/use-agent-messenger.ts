/**
 * useAgentMessenger — WhatsApp/Discord-style threads with agents/personas.
 *
 * Separate from regular project chats. Lists conversations (one per persona),
 * loads a thread on demand, and sends a message which the PC answers via the
 * persona's model backend. Mirrors agentMessengerRouter on the desktop server.
 */
import { useState, useEffect, useCallback } from "react";
import { trpcQuery, trpcMutate } from "@/lib/_core/trpc-fetch";
import { isServerConfigured } from "@/lib/_core/server-config";

export interface AgentConversation {
  personaId: string;
  name: string;
  type: string;
  alwaysOn: boolean;
  lastMessage?: string;
  lastMessageAt?: string;
  unread: number;
}

export interface AgentMessage {
  id: string;
  personaId: string;
  role: "user" | "agent";
  content: string;
  createdAt: string;
}

export function useAgentConversations() {
  const [conversations, setConversations] = useState<AgentConversation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isServerConfigured()) {
      setError("No server configured");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await trpcQuery<{ conversations: AgentConversation[] }>(
        "agentMessenger.listConversations"
      );
      setConversations(res?.conversations ?? []);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { conversations, loading, error, refresh };
}

export function useAgentThread(personaId: string | null) {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!personaId || !isServerConfigured()) return;
    try {
      const res = await trpcQuery<{ messages: AgentMessage[] }>(
        "agentMessenger.getMessages",
        { personaId }
      );
      setMessages(res?.messages ?? []);
    } catch (e) {
      setError(String(e));
    }
  }, [personaId]);

  useEffect(() => {
    setMessages([]);
    refresh();
  }, [refresh]);

  const send = useCallback(async (content: string) => {
    if (!personaId || !content.trim()) return;
    const optimistic: AgentMessage = {
      id: `local-${Date.now()}`,
      personaId,
      role: "user",
      content,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    setSending(true);
    setError(null);
    try {
      const res = await trpcMutate<{ reply: AgentMessage }>("agentMessenger.send", {
        personaId,
        content,
      });
      // Re-pull the authoritative thread (includes both turns server-side).
      await refresh();
      return res?.reply;
    } catch (e) {
      setError(String(e));
      refresh();
    } finally {
      setSending(false);
    }
  }, [personaId, refresh]);

  return { messages, sending, error, refresh, send };
}
