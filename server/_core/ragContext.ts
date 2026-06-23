/**
 * @file server/_core/ragContext.ts
 * @description Neural-map RAG read path — augment a chat with the active map's
 * indexed knowledge.
 *
 * When a chat is anchored to a neural map (`ragMapId`) whose `enableAIContext`
 * setting is on, this retrieves the most relevant excerpts from that map's
 * vector collection (local files + indexed remote sources) and injects them as
 * system context. This is the READ half of map RAG; the WRITE half (feeding
 * remote sources into the collection) lives in integrationsRouter.indexMapSources.
 *
 * Retrieval is entirely LOCAL (ChromaDB), so it functions in Sovereign mode —
 * only the downstream LLM provider is execution-mode-gated, and that gate is
 * enforced by the calling router. Injection is best-effort: any failure returns
 * the inputs unchanged so chat never breaks because RAG is unavailable.
 */

import { getDb } from "../db.factory.js";
import { neuralMaps } from "../../drizzle/schema.js";
import { and, eq } from "drizzle-orm";
import { MemoryArchitectService } from "../phase2/services/MemoryArchitectService.js";
import { createLogger } from "./logger.js";

const log = createLogger("rag-context");

interface ChatMsg {
  role: string;
  content: string;
}

export interface MapRagResult<M extends ChatMsg> {
  /** Messages with the knowledge block merged into the system message. */
  messages: M[];
  /** systemPrompt with the knowledge block appended (for providers that read it). */
  systemPrompt?: string;
  /** Whether any context was actually injected. */
  injected: boolean;
}

/**
 * Retrieve and inject a map's indexed knowledge into a chat request.
 *
 * The knowledge block is added to BOTH carriers — the system message inside the
 * `messages` array AND the `systemPrompt` field — because providers disagree on
 * which they read (OpenAI/Ollama use the messages array; Anthropic/Gemini prefer
 * `systemPrompt`, falling back to the system message). Each provider consumes
 * exactly one carrier, so there is no duplication within a single call.
 */
export async function injectMapRagContext<M extends ChatMsg>(args: {
  mapId?: string | null;
  userId?: number | null;
  messages: M[];
  systemPrompt?: string;
  maxTokens?: number;
}): Promise<MapRagResult<M>> {
  const { mapId, userId, messages, systemPrompt } = args;
  const passthrough: MapRagResult<M> = { messages, systemPrompt, injected: false };
  if (!mapId || !userId) return passthrough;

  try {
    const db = await getDb();
    const rows = await db
      .select({ settings: neuralMaps.settings })
      .from(neuralMaps)
      .where(and(eq(neuralMaps.id, mapId), eq(neuralMaps.userId, userId)))
      .limit(1);
    const map = rows[0];
    if (!map) return passthrough; // not this user's map (or gone) — never leak

    const settings = (map.settings ?? {}) as Record<string, unknown>;
    if (settings.enableAIContext === false) return passthrough; // read-gate off

    const memory = MemoryArchitectService.getInstance();
    if (!memory.isOnline()) {
      await memory.init().catch(() => {});
      if (!memory.isOnline()) return passthrough; // ChromaDB offline → degrade
    }

    const lastUser = [...messages].reverse().find(m => m.role === "user")?.content;
    if (!lastUser) return passthrough;

    const context = await memory.retrieveContext(mapId, lastUser, args.maxTokens ?? 1500);
    if (!context.trim()) return passthrough;

    const block =
      `# Map Knowledge Base\n` +
      `Relevant excerpts retrieved from this map's indexed sources (local files + ` +
      `connected remote sources). Ground your answer in them when applicable and ` +
      `cite the source path.\n\n${context}`;

    const augmentedSystemPrompt = systemPrompt ? `${systemPrompt}\n\n${block}` : block;

    const sysIdx = messages.findIndex(m => m.role === "system");
    const augmentedMessages: M[] =
      sysIdx >= 0
        ? messages.map((m, i) => (i === sysIdx ? { ...m, content: `${m.content}\n\n${block}` } : m))
        : [{ role: "system", content: block } as M, ...messages];

    return { messages: augmentedMessages, systemPrompt: augmentedSystemPrompt, injected: true };
  } catch (err) {
    log.warn("Map RAG injection failed (continuing without context)", {
      mapId,
      error: err instanceof Error ? err.message : String(err),
    });
    return passthrough;
  }
}
