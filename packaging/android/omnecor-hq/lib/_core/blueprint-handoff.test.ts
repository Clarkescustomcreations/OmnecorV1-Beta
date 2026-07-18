/**
 * Unit tests for the pure chat → Blueprint Studio handoff parser.
 */
import { describe, it, expect } from "vitest";
import { parseCreateBlueprint } from "./blueprint-handoff";
import type { AssistantBlock } from "./agent-blocks";

/** Build a minimal `mcp` AssistantBlock for the create_blueprint tool. */
function mcpBlock(over: Partial<Extract<AssistantBlock, { type: "mcp" }>> = {}): AssistantBlock {
  return {
    id: "b1",
    type: "mcp",
    server: "feature",
    tool: "create_blueprint",
    status: "done",
    ...over,
  } as AssistantBlock;
}

describe("parseCreateBlueprint", () => {
  it("parses a successful create_blueprint result (new project)", () => {
    const info = parseCreateBlueprint(mcpBlock({
      result: JSON.stringify({ planId: "p1", mapId: "m1", title: "Welding table", mapCreated: true, mapName: "Shop" }),
    }));
    expect(info).toEqual({ planId: "p1", mapId: "m1", title: "Welding table", mapCreated: true, mapName: "Shop" });
  });

  it("parses a result attached to an existing project", () => {
    const info = parseCreateBlueprint(mcpBlock({ result: JSON.stringify({ planId: "p2", mapId: "m2", title: "Cart" }) }));
    expect(info?.planId).toBe("p2");
    expect(info?.mapCreated).toBeUndefined();
  });

  it("returns null for the wrong tool / server", () => {
    expect(parseCreateBlueprint(mcpBlock({ tool: "something_else", result: JSON.stringify({ planId: "p", mapId: "m" }) }))).toBeNull();
    expect(parseCreateBlueprint(mcpBlock({ server: "other", result: JSON.stringify({ planId: "p", mapId: "m" }) }))).toBeNull();
  });

  it("returns null for a non-mcp block", () => {
    expect(parseCreateBlueprint({ id: "t", type: "text", text: "hi" } as AssistantBlock)).toBeNull();
  });

  it("returns null on a tool error (non-JSON result)", () => {
    expect(parseCreateBlueprint(mcpBlock({ result: "Error: could not create plan" }))).toBeNull();
  });

  it("returns null when planId or mapId is missing", () => {
    expect(parseCreateBlueprint(mcpBlock({ result: JSON.stringify({ planId: "p" }) }))).toBeNull();
    expect(parseCreateBlueprint(mcpBlock({ result: JSON.stringify({ mapId: "m" }) }))).toBeNull();
    expect(parseCreateBlueprint(mcpBlock({ result: undefined }))).toBeNull();
  });
});
