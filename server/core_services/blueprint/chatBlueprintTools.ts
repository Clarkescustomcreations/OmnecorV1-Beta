/**
 * Blueprint tools for the MAIN chat (de-isolation — see the architect blueprint).
 *
 * The Blueprint Studio agent (`blueprintRouter.agentStream`) runs a pure domain
 * toolset bound to a fixed `planId`. The main chat is different: there is no plan
 * yet when the user says "design me a welding table". This wrapper adds two entry
 * tools — `create_blueprint` (which also BOOTSTRAPS a new Neural Map / Project
 * when no map is active) and `open_blueprint` — in front of the exact same domain
 * toolset (`buildBlueprintTools`), whose executors resolve their plan through a
 * lazy holder so their signatures stay identical to Studio.
 *
 * Exposed in `agentChatStream` only when the user turns on the chat's
 * "Fabrication" toggle, so the default chat prompt carries no extra tools.
 */
import { and, eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "../../db.factory.js";
import { blueprintPlans, neuralMaps } from "../../../drizzle/schema.js";
import type { ExtraAgentTool } from "../services/ChatAgentRunner.js";
import { BLUEPRINT_CATEGORIES } from "@shared/blueprint";
import { buildBlueprintTools, type BlueprintToolContext } from "./blueprintAgentTools.js";

export interface ChatBlueprintToolContext {
  userId: number;
  executionMode?: string;
  /** The chat's active Neural Map / Project (undefined = none selected yet). */
  activeMapId?: string;
  /** Aborts long-running tools (FEA) when the client disconnects. */
  signal?: AbortSignal;
}

/** Result payload of `create_blueprint`, echoed to the client (parses the box). */
export interface CreateBlueprintResult {
  planId: string;
  title: string;
  mapId: string;
  /** True when this call bootstrapped a brand-new Project (no map was active). */
  mapCreated: boolean;
  mapName: string;
}

/** Default map settings for an auto-bootstrapped Project — mirrors the client
 *  NeuralMapContext DEFAULT_SETTINGS + the router's settingsSchema defaults. */
const NEW_MAP_SETTINGS = {
  autoWatch: true,
  realtimeSync: true,
  indexingEnabled: true,
  graphPhysics: true,
  maxDepth: 6,
  isolateMemory: false,
  enableAIContext: true,
  enableSemanticLinks: true,
  collapsedFolderIds: [] as string[],
};

const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);

/**
 * Resolve the Project (Neural Map) a Build Plan attaches to — returning an
 * existing owned map, or creating a fresh one when none/an unusable id is given.
 * Creating the map here (same connection, before the plan insert) is what keeps
 * the plan's `mapId` FK valid; a client that fires two independent mutations
 * would race the constraint. Shared by the chat `create_blueprint` tool and the
 * Studio `blueprint.create` "＋ New project" path so map bootstrap lives in ONE
 * place. `brief` seeds a new map's projectContext; an existing map is untouched.
 */
export async function resolveProjectMap(
  db: Awaited<ReturnType<typeof getDb>>,
  userId: number,
  opts: { mapId?: string; newMapName?: string; brief?: string; fallbackName: string },
): Promise<{ mapId: string; mapCreated: boolean; mapName: string }> {
  if (opts.mapId) {
    const [existing] = await db
      .select({ id: neuralMaps.id, name: neuralMaps.name })
      .from(neuralMaps)
      .where(and(eq(neuralMaps.id, opts.mapId), eq(neuralMaps.userId, userId)))
      .limit(1);
    if (existing) return { mapId: existing.id, mapCreated: false, mapName: existing.name };
    // Unknown / not-ours id — don't attach to a phantom; bootstrap instead.
  }
  const mapId = uuidv4();
  const brief = opts.brief?.trim();
  const mapName = (opts.newMapName?.trim() || opts.fallbackName || "New Project").slice(0, 120);
  await db.insert(neuralMaps).values({
    id: mapId,
    userId,
    name: mapName,
    mode: "standard",
    rootDirectories: [],
    projectContext: brief ? { description: brief } : null,
    settings: NEW_MAP_SETTINGS,
  });
  return { mapId, mapCreated: true, mapName };
}

/**
 * Build the main-chat Blueprint toolset. Returns `[create_blueprint,
 * open_blueprint, ...domain tools]`. The domain tools share a single mutable
 * plan holder that the two entry tools set; until one runs, they error with a
 * clear "call create_blueprint first" message rather than touching a random plan.
 */
export function buildChatBlueprintTools(ctx: ChatBlueprintToolContext): ExtraAgentTool[] {
  const holder: { planId: string | null } = { planId: null };

  // Domain-tool context: `planId` is a getter so every existing executor keeps
  // reading `ctx.planId` unchanged but resolves the conversation's active plan
  // at call time (throwing a helpful error before one is opened).
  const domainCtx: BlueprintToolContext = {
    get planId(): string {
      if (!holder.planId) {
        throw new Error(
          "No active blueprint yet — call create_blueprint first (or open_blueprint with a planId) before using the other build tools.",
        );
      }
      return holder.planId;
    },
    userId: ctx.userId,
    executionMode: ctx.executionMode,
    signal: ctx.signal,
  };

  const createTool: ExtraAgentTool = {
    title: "Create build plan",
    definition: {
      name: "create_blueprint",
      description:
        "Start a new persistent Build Plan (Blueprint) for a physical fabrication project and make it the active plan for this chat. Call this FIRST when the user asks you to design/plan/build something physical (furniture, frames, structures, vehicles, 3D-printed parts, costumes). The plan is attached to the chat's active Neural Map / Project; if none is selected, a new Project is created for it automatically. After this, use the other build tools (list_materials, engineering_calc, set_bom, set_cut_list, compile_cad, run_fea, update_plan …) to fill it in — the user watches the Build Plan update live and can open it in Blueprint Studio.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short project name, e.g. \"Heavy welding table\"." },
          brief: { type: "string", description: "The user's plain-language project description (dimensions, purpose, loads, style)." },
          category: { type: "string", enum: [...BLUEPRINT_CATEGORIES] },
          units: { type: "string", enum: ["imperial", "metric"] },
          cadEngine: { type: "string", enum: ["jscad", "openscad"], description: "Parametric CAD engine (default jscad — built-in)." },
        },
        required: ["title"],
        additionalProperties: false,
      },
    },
    execute: async (args) => {
      const title = str(args.title);
      if (!title) throw new Error("create_blueprint requires a title.");
      const brief = str(args.brief) ?? "";
      const category = (BLUEPRINT_CATEGORIES as readonly string[]).includes(String(args.category))
        ? (String(args.category) as (typeof BLUEPRINT_CATEGORIES)[number])
        : "other";
      const units = args.units === "metric" ? "metric" : "imperial";
      const cadEngine = args.cadEngine === "openscad" ? "openscad" : "jscad";

      const db = await getDb();

      // Resolve the target Project: the active map, or bootstrap a new one.
      const { mapId, mapCreated, mapName } = await resolveProjectMap(db, ctx.userId, {
        mapId: ctx.activeMapId,
        newMapName: title,
        brief,
        fallbackName: title,
      });

      const planId = uuidv4();
      await db.insert(blueprintPlans).values({
        id: planId,
        userId: ctx.userId,
        mapId,
        title,
        brief,
        category,
        units,
        cadEngine,
        status: "planning",
      });
      holder.planId = planId;

      const result: CreateBlueprintResult = { planId, title, mapId, mapCreated, mapName };
      return JSON.stringify(result);
    },
  };

  const openTool: ExtraAgentTool = {
    title: "Open build plan",
    definition: {
      name: "open_blueprint",
      description:
        "Make an EXISTING Build Plan the active plan for this chat so you can continue editing it with the other build tools. Only needed to resume a plan you did not just create in this chat — use the planId from the user or a previous create_blueprint.",
      parameters: {
        type: "object",
        properties: { planId: { type: "string", description: "The plan's id." } },
        required: ["planId"],
        additionalProperties: false,
      },
    },
    execute: async (args) => {
      const planId = str(args.planId);
      if (!planId) throw new Error("open_blueprint requires a planId.");
      const db = await getDb();
      const [plan] = await db
        .select({ id: blueprintPlans.id, title: blueprintPlans.title, mapId: blueprintPlans.mapId, status: blueprintPlans.status })
        .from(blueprintPlans)
        .where(and(eq(blueprintPlans.id, planId), eq(blueprintPlans.userId, ctx.userId)))
        .limit(1);
      if (!plan) throw new Error(`No Build Plan "${planId}" found (or it isn't yours).`);
      holder.planId = plan.id;
      return JSON.stringify({ planId: plan.id, title: plan.title, mapId: plan.mapId, status: plan.status, opened: true });
    },
  };

  return [createTool, openTool, ...buildBlueprintTools(domainCtx)];
}
