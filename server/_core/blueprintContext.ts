/**
 * @file server/_core/blueprintContext.ts
 * @description Blueprint → chat read path — de-isolate Blueprint Studio by making
 * a Project's (Neural Map's) attached Build Plans part of what the main chat sees.
 *
 * When a chat is anchored to a map whose `enableAIContext` setting is on, this
 * injects a COMPACT block: an index of every Build Plan attached to that map plus
 * a fuller (still bounded) summary of the most-recently-updated one — status,
 * overview excerpt, BOM headline, and any failed verification. This is the READ
 * half of blueprint sharing; the reverse direction (project brief → the Blueprint
 * agent) lives in `blueprintRouter.agentStream`.
 *
 * Entirely LOCAL (SQLite), so it functions in Sovereign mode. Injection is
 * best-effort: any failure returns the inputs unchanged so chat never breaks.
 */

import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../db.factory.js";
import { blueprintBomItems, blueprintPlans, blueprintSimResults, neuralMaps } from "../../drizzle/schema.js";
import { createLogger } from "./logger.js";

const log = createLogger("blueprint-context");

interface ChatMsg {
  role: string;
  content: string;
}

export interface BlueprintContextResult<M extends ChatMsg> {
  messages: M[];
  systemPrompt?: string;
  injected: boolean;
}

/**
 * Inject the active map's attached Build Plans into a chat request. Added to BOTH
 * carriers (the system message inside `messages` AND `systemPrompt`) for the same
 * cross-provider reason as {@link injectMapRagContext}.
 */
export async function injectBlueprintContext<M extends ChatMsg>(args: {
  mapId?: string | null;
  userId?: number | null;
  messages: M[];
  systemPrompt?: string;
}): Promise<BlueprintContextResult<M>> {
  const { mapId, userId, messages, systemPrompt } = args;
  const passthrough: BlueprintContextResult<M> = { messages, systemPrompt, injected: false };
  if (!mapId || !userId) return passthrough;

  try {
    const db = await getDb();
    const [map] = await db
      .select({ settings: neuralMaps.settings })
      .from(neuralMaps)
      .where(and(eq(neuralMaps.id, mapId), eq(neuralMaps.userId, userId)))
      .limit(1);
    if (!map) return passthrough; // not this user's map (or gone) — never leak
    const settings = (map.settings ?? {}) as Record<string, unknown>;
    if (settings.enableAIContext === false) return passthrough; // read-gate off

    const plans = await db
      .select({
        id: blueprintPlans.id,
        title: blueprintPlans.title,
        category: blueprintPlans.category,
        status: blueprintPlans.status,
        units: blueprintPlans.units,
        overview: blueprintPlans.overview,
        brief: blueprintPlans.brief,
      })
      .from(blueprintPlans)
      .where(and(eq(blueprintPlans.mapId, mapId), eq(blueprintPlans.userId, userId)))
      .orderBy(desc(blueprintPlans.updatedAt))
      .limit(8);
    if (plans.length === 0) return passthrough;

    const index = plans
      .map((p) => `- ${p.title} — ${p.category.replace("_", " ")}, status: ${p.status} (id: ${p.id})`)
      .join("\n");

    // Fuller summary of the most-recently-updated plan (bounded).
    const top = plans[0];
    const [bom, sims] = await Promise.all([
      db.select().from(blueprintBomItems).where(eq(blueprintBomItems.planId, top.id)).limit(12),
      db
        .select()
        .from(blueprintSimResults)
        .where(eq(blueprintSimResults.planId, top.id))
        .orderBy(desc(blueprintSimResults.createdAt))
        .limit(6),
    ]);
    const overview = (top.overview || top.brief || "").trim();
    const bomLine = bom.length
      ? bom.map((b) => `${b.name} ×${b.quantity} ${b.unit}`).join("; ")
      : "(none yet)";
    const failed = sims.filter((s) => (s.results as Record<string, unknown> | null)?.pass === false);
    const simLine = sims.length
      ? `${sims.length} verification run(s)` + (failed.length ? `, ⚠ ${failed.length} FAILED CHECK — flag this to the user` : "")
      : "(none yet)";

    const block =
      `# Attached Build Plans (Blueprint Studio)\n` +
      `This Project has the following fabrication Build Plans. Treat them as shared context: reference and build on them, and if the user asks to continue a design, do so.\n\n` +
      `${index}\n\n` +
      `## Active plan: ${top.title} (${top.units})\n` +
      (overview ? `${overview.slice(0, 700)}${overview.length > 700 ? "…" : ""}\n` : "") +
      `BOM: ${bomLine.slice(0, 600)}\n` +
      `Verification: ${simLine}\n\n` +
      `To create or edit a plan yourself, turn on the chat's Fabrication tools; otherwise point the user to Blueprint Studio.`;

    const augmentedSystemPrompt = systemPrompt ? `${systemPrompt}\n\n${block}` : block;

    const sysIdx = messages.findIndex((m) => m.role === "system");
    const augmentedMessages: M[] =
      sysIdx >= 0
        ? messages.map((m, i) => (i === sysIdx ? { ...m, content: `${m.content}\n\n${block}` } : m))
        : [{ role: "system", content: block } as M, ...messages];

    return { messages: augmentedMessages, systemPrompt: augmentedSystemPrompt, injected: true };
  } catch (err) {
    log.warn("Blueprint context injection failed (continuing without it)", {
      mapId,
      error: err instanceof Error ? err.message : String(err),
    });
    return passthrough;
  }
}
