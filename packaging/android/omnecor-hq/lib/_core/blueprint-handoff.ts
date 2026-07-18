/**
 * @file lib/_core/blueprint-handoff.ts
 *
 * Pure parser for the chat → Blueprint Studio handoff. When the Fabrication
 * toolset finishes a `create_blueprint` tool box, its `result` is a JSON string
 * describing the new Build Plan (and any auto-created Project). The chat screen
 * uses this to offer "Open in Blueprint Studio". Kept dependency-free (type-only
 * import) so it unit-tests without React Native / Expo mocks — mirrors the web
 * `Chat.tsx` handler.
 */
import type { AssistantBlock } from "./agent-blocks";

export interface BlueprintCreatedInfo {
  planId: string;
  mapId: string;
  title?: string;
  mapCreated?: boolean;
  mapName?: string;
}

/**
 * Returns the created-plan info if `block` is a successful `create_blueprint`
 * tool result, else null (wrong block, tool error / non-JSON, or missing ids).
 */
export function parseCreateBlueprint(block: AssistantBlock): BlueprintCreatedInfo | null {
  if (block.type !== "mcp" || block.server !== "feature" || block.tool !== "create_blueprint" || !block.result) {
    return null;
  }
  let info: { planId?: string; title?: string; mapId?: string; mapCreated?: boolean; mapName?: string };
  try {
    info = JSON.parse(block.result);
  } catch {
    return null; // tool errored (non-JSON message) — nothing to adopt
  }
  if (!info.planId || !info.mapId) return null;
  return { planId: info.planId, mapId: info.mapId, title: info.title, mapCreated: info.mapCreated, mapName: info.mapName };
}
