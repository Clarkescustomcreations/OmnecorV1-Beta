import { describe, it, expect } from "vitest";
import {
  computeLayoutPositions,
  type LayoutEngine,
  type LayoutNode,
  type LayoutEdge,
} from "./neuralLayout";

/** Build a ternary tree of `n` nodes with a project root and folder/file kinds. */
function buildTree(n: number): { nodes: LayoutNode[]; edges: LayoutEdge[] } {
  const nodes: LayoutNode[] = [];
  const edges: LayoutEdge[] = [];
  for (let i = 0; i < n; i++) {
    nodes.push({
      id: `node-${i}`,
      // Distinct seed positions (radial) so the force sim doesn't start coincident.
      x: Math.cos(i) * (100 + i),
      y: Math.sin(i) * (100 + i),
      type: i === 0 ? "project" : i % 2 === 0 ? "folder" : "file",
    });
    if (i > 0) {
      const parent = Math.floor((i - 1) / 3);
      edges.push({ source: `node-${parent}`, target: `node-${i}` });
    }
  }
  return { nodes, edges };
}

const LAYOUTS: LayoutEngine[] = ["force", "hierarchical", "mindmap", "circular"];

describe("computeLayoutPositions", () => {
  it("returns an empty array for empty input", () => {
    for (const layout of LAYOUTS) {
      expect(computeLayoutPositions({ layout, autoClustering: false, nodeSize: 40 }, [], [])).toEqual([]);
    }
  });

  it("returns a finite position for every node id, in every layout", () => {
    const { nodes, edges } = buildTree(60);
    const ids = new Set(nodes.map(n => n.id));
    for (const layout of LAYOUTS) {
      const positions = computeLayoutPositions({ layout, autoClustering: false, nodeSize: 40 }, nodes, edges);
      expect(positions).toHaveLength(nodes.length);
      const returnedIds = new Set(positions.map(p => p.id));
      expect(returnedIds).toEqual(ids);
      for (const p of positions) {
        expect(Number.isFinite(p.x)).toBe(true);
        expect(Number.isFinite(p.y)).toBe(true);
      }
    }
  });

  it("force layout separates nodes (no two share a coordinate)", () => {
    const { nodes, edges } = buildTree(80);
    const positions = computeLayoutPositions({ layout: "force", autoClustering: false, nodeSize: 40 }, nodes, edges);
    const seen = new Set<string>();
    for (const p of positions) {
      const key = `${p.x},${p.y}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("respects autoClustering without dropping nodes", () => {
    const { nodes, edges } = buildTree(40);
    const positions = computeLayoutPositions({ layout: "force", autoClustering: true, nodeSize: 40 }, nodes, edges);
    expect(positions).toHaveLength(nodes.length);
  });

  it("handles a large graph without blowing up (Barnes-Hut, O(n log n))", () => {
    // The explicit 15s test timeout below is the regression guard: the previous
    // strict-O(n²) force simulation on 2000 nodes took tens of seconds and would
    // blow it, whereas the Barnes-Hut version completes in a few. We avoid a
    // brittle wall-clock assertion here since this runs under a parallel runner.
    const { nodes, edges } = buildTree(2000);
    const positions = computeLayoutPositions({ layout: "force", autoClustering: false, nodeSize: 40 }, nodes, edges);
    expect(positions).toHaveLength(nodes.length);
    expect(positions.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
  }, 15000);
});
