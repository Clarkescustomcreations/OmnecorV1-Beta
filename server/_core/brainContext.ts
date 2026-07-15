/**
 * @file server/_core/brainContext.ts
 * @description Brain Pack read path — augment a chat with attached "brains".
 *
 * Given a set of attached Brain Pack ids, this injects two things into a chat
 * request (Brains-Upgrade Phase 3):
 *   1. Every attached brain's **charter** — the small always-on skill/rules text
 *      — prepended verbatim (that IS its purpose: author-intended guidance).
 *   2. A merged **top-k corpus** retrieved across all *compatible* brains for the
 *      user's latest message, deduped and ranked by cosine distance (all ready
 *      brains share the running embedder, so distances are directly comparable),
 *      injected with per-source citations.
 *
 * Retrieval is entirely LOCAL (the embedded vector store), so it runs in
 * Sovereign mode — only the downstream LLM is execution-mode-gated, by the
 * calling router. Injection is best-effort: any failure returns the inputs
 * unchanged so chat never breaks because a brain is unavailable.
 *
 * Security posture: a charter is trusted (the user opted into this brain's
 * guidance), but corpus chunks are *reference knowledge*, not instructions, and
 * a pack may be third-party — so retrieved corpus text is run through
 * {@link PromptSanitizer} before injection to blunt prompt-injection payloads.
 * Incompatible brains (embedder mismatch) contribute their charter but no corpus
 * (their vectors are never indexed, so they'd be mis-queried).
 */

import { getDb } from "../db.factory.js";
import { brains, personas } from "../../drizzle/schema.js";
import { and, eq, inArray } from "drizzle-orm";
import { getVectorStore } from "../core_services/services/VectorStore.js";
import { PromptSanitizer } from "../core_services/services/PromptSanitizer.js";
import { createLogger } from "./logger.js";

const log = createLogger("brain-context");

interface ChatMsg {
  role: string;
  content: string;
}

export interface BrainContextResult<M extends ChatMsg> {
  /** Messages with the brain block merged into the system message. */
  messages: M[];
  /** systemPrompt with the brain block appended (for providers that read it). */
  systemPrompt?: string;
  /** Whether any content was actually injected. */
  injected: boolean;
  /** Ids of the brains whose content contributed (charter and/or corpus). */
  usedBrainIds: string[];
}

/** Approx chars-per-token used to turn a token budget into a char budget. */
const CHARS_PER_TOKEN = 4;
/** Total charter budget (chars) across all attached brains. */
const MAX_CHARTER_CHARS = 8_000;
/** Hard cap on how many brains can be attached to a single chat (matches the
 *  `brainIds` chat-schema limit) — bounds retrieval fan-out. */
const MAX_ATTACHED_BRAINS = 16;

/**
 * Resolve the effective set of attached brain ids for a chat turn (Phase 4).
 *
 * Two attachment layers are unioned:
 *   1. **Durable** — the brains a persona carries in its `data.brains` array
 *      (owner-scoped; the persona's "always-on" brains).
 *   2. **Per-chat** — the `brainIds` the request carries for this turn only.
 *
 * The union (deduped, non-empty, capped) is what actually gets injected, so a
 * user's persona brings its brains automatically while a chat can attach extras
 * on the fly. Best-effort: a missing/foreign persona simply contributes nothing.
 */
export async function resolveAttachedBrainIds(args: {
  userId?: number | null;
  personaId?: string | null;
  brainIds?: string[] | null;
}): Promise<string[]> {
  const { userId, personaId } = args;
  const merged = new Set<string>((args.brainIds ?? []).filter(Boolean));

  if (userId && personaId) {
    try {
      const db = await getDb();
      const [persona] = await db
        .select({ data: personas.data })
        .from(personas)
        .where(and(eq(personas.id, personaId), eq(personas.userId, userId)))
        .limit(1);
      const raw = (persona?.data as Record<string, unknown> | undefined)?.brains;
      if (Array.isArray(raw)) {
        for (const id of raw) {
          if (typeof id === "string" && id) merged.add(id);
        }
      }
    } catch (err) {
      log.warn("Persona brain resolution failed (using per-chat brains only)", {
        personaId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return Array.from(merged).slice(0, MAX_ATTACHED_BRAINS);
}

interface RankedChunk {
  brainId: string;
  brainName: string;
  text: string;
  source: string;
  distance: number;
}

/**
 * Retrieve + inject attached brains' charters and corpus into a chat request.
 *
 * Mirrors {@link injectMapRagContext}'s dual-carrier contract: the block is added
 * to BOTH the system message inside `messages` AND the `systemPrompt` field,
 * because providers disagree on which they read. Each provider consumes exactly
 * one carrier, so there is no duplication within a single call.
 */
export async function injectBrainContext<M extends ChatMsg>(args: {
  brainIds?: string[] | null;
  /** Durable attachment source: resolve this persona's `data.brains` and union
   *  them with `brainIds` (Phase 4). Owner-scoped. */
  personaId?: string | null;
  userId?: number | null;
  messages: M[];
  systemPrompt?: string;
  /** Approx token budget for the retrieved corpus (charter is separate). */
  corpusMaxTokens?: number;
  /** Top-k retrieved per compatible brain before the cross-brain merge. */
  topKPerBrain?: number;
}): Promise<BrainContextResult<M>> {
  const { brainIds, personaId, userId, messages, systemPrompt } = args;
  const passthrough: BrainContextResult<M> = {
    messages,
    systemPrompt,
    injected: false,
    usedBrainIds: [],
  };

  if (!userId) return passthrough;
  // Union per-chat brains with the persona's durable brains.
  const ids = await resolveAttachedBrainIds({ userId, personaId, brainIds });
  if (ids.length === 0) return passthrough;

  try {
    const db = await getDb();
    // Ownership-scoped fetch — never resolve another user's brains.
    const rows = await db
      .select()
      .from(brains)
      .where(and(eq(brains.userId, userId), inArray(brains.id, ids)));
    if (rows.length === 0) return passthrough;

    // Preserve the caller's requested order for stable charter concatenation.
    const byId = new Map(rows.map(r => [r.id, r]));
    const ordered = ids.map(id => byId.get(id)).filter((r): r is (typeof rows)[number] => !!r);

    // ── 1. Charters (always-on, every attached brain, embedder-independent) ──
    const charterParts: string[] = [];
    const usedBrainIds = new Set<string>();
    let charterBudget = MAX_CHARTER_CHARS;
    for (const brain of ordered) {
      const charter = (brain.charter ?? "").trim();
      if (!charter) continue;
      const clipped = charter.length > charterBudget ? charter.slice(0, charterBudget) : charter;
      if (!clipped) break;
      charterParts.push(`## ${brain.name} (${brain.domain})\n${clipped}`);
      charterBudget -= clipped.length;
      usedBrainIds.add(brain.id);
      if (charterBudget <= 0) break;
    }

    // ── 2. Corpus (retrieved, compatible brains only, merged + ranked) ──
    const lastUser = [...messages].reverse().find(m => m.role === "user")?.content;
    const ready = ordered.filter(b => b.embedderMatch === 1 && b.status === "ready");
    let ranked: RankedChunk[] = [];
    if (lastUser && ready.length > 0) {
      const store = getVectorStore();
      await store.init().catch(() => {}); // best-effort; degrades to no corpus
      const topK = Math.max(1, Math.min(20, args.topKPerBrain ?? 6));
      const perBrain = await Promise.all(
        ready.map(async brain => {
          try {
            const results = await store.semanticSearch(brain.collectionName, lastUser, topK);
            return results
              .filter(r => r.text && r.distance !== null)
              .map<RankedChunk>(r => ({
                brainId: brain.id,
                brainName: brain.name,
                text: r.text as string,
                source: String((r.metadata?.sourcePath ?? r.metadata?.source ?? r.id) ?? "corpus"),
                distance: r.distance as number,
              }));
          } catch (err) {
            log.warn("Brain corpus retrieval failed", {
              brainId: brain.id,
              error: err instanceof Error ? err.message : String(err),
            });
            return [];
          }
        })
      );
      // Merge across brains: dedupe identical text (keep the closest), sort by
      // distance ascending (closest first — same embedder ⇒ comparable scores).
      const seen = new Map<string, RankedChunk>();
      for (const chunk of perBrain.flat()) {
        const key = chunk.text.trim();
        const prev = seen.get(key);
        if (!prev || chunk.distance < prev.distance) seen.set(key, chunk);
      }
      ranked = Array.from(seen.values()).sort((a, b) => a.distance - b.distance);
    }

    if (charterParts.length === 0 && ranked.length === 0) return passthrough;

    // ── 3. Assemble the injected block ──
    const sections: string[] = ["# Attached Brains"];
    if (charterParts.length > 0) {
      sections.push(
        `## Skills & Rules (always apply)\n${charterParts.join("\n\n")}`
      );
    }

    if (ranked.length > 0) {
      const sanitizer = PromptSanitizer.getInstance();
      const corpusBudget = (args.corpusMaxTokens ?? 1500) * CHARS_PER_TOKEN;
      const entries: string[] = [];
      let used = 0;
      for (const chunk of ranked) {
        const safe = sanitizer.sanitize(chunk.text).clean.trim();
        if (!safe) continue;
        const entry = `[Brain: ${chunk.brainName} · ${chunk.source}]\n${safe}`;
        if (used + entry.length > corpusBudget && entries.length > 0) break;
        entries.push(entry);
        used += entry.length;
        usedBrainIds.add(chunk.brainId);
        if (used >= corpusBudget) break;
      }
      if (entries.length > 0) {
        sections.push(
          `## Reference Knowledge\n` +
            `Relevant excerpts retrieved from the attached brains. Ground your ` +
            `answer in them when applicable and cite the brain + source.\n\n` +
            entries.join("\n\n")
        );
      }
    }

    if (usedBrainIds.size === 0) return passthrough;
    const block = sections.join("\n\n");

    const augmentedSystemPrompt = systemPrompt ? `${systemPrompt}\n\n${block}` : block;
    const sysIdx = messages.findIndex(m => m.role === "system");
    const augmentedMessages: M[] =
      sysIdx >= 0
        ? messages.map((m, i) => (i === sysIdx ? { ...m, content: `${m.content}\n\n${block}` } : m))
        : [{ role: "system", content: block } as M, ...messages];

    return {
      messages: augmentedMessages,
      systemPrompt: augmentedSystemPrompt,
      injected: true,
      usedBrainIds: Array.from(usedBrainIds),
    };
  } catch (err) {
    log.warn("Brain injection failed (continuing without brains)", {
      brainIds: ids,
      error: err instanceof Error ? err.message : String(err),
    });
    return passthrough;
  }
}
