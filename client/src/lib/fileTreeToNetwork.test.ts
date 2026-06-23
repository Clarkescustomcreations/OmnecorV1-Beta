import { describe, it, expect } from "vitest";
import { fileTreeToNetwork, subtreeToNodes } from "./fileTreeToNetwork";

// Minimal FileTreeNode-shaped fixtures (the network builder only reads a subset).
const tree = [
  {
    name: "src",
    path: "/proj/src",
    type: "directory" as const,
    children: [
      { name: "index.ts", path: "/proj/src/index.ts", type: "file" as const },
    ],
  },
  {
    name: "huge",
    path: "/proj/huge",
    type: "directory" as const,
    truncated: true,
    childCount: 4200,
  },
];

describe("fileTreeToNetwork", () => {
  it("propagates truncated + childCount onto folder nodes", () => {
    const net = fileTreeToNetwork(tree, { projectId: "p", projectName: "Proj" });
    const huge = net.nodes.find(n => n.id === "node-/proj/huge");
    expect(huge?.type).toBe("folder");
    expect(huge?.data.truncated).toBe(true);
    expect(huge?.data.fileCount).toBe(4200);
  });

  it("marks fully-listed folders as not truncated and counts children", () => {
    const net = fileTreeToNetwork(tree, { projectId: "p", projectName: "Proj" });
    const src = net.nodes.find(n => n.id === "node-/proj/src");
    expect(src?.data.truncated).toBe(false);
    expect(src?.data.fileCount).toBe(1);
    // The file child exists and is linked under src.
    expect(net.nodes.some(n => n.id === "node-/proj/src/index.ts")).toBe(true);
    expect(net.edges.some(e => e.source === "node-/proj/src" && e.target === "node-/proj/src/index.ts")).toBe(true);
  });
});

describe("subtreeToNodes", () => {
  it("links a fetched subtree under an existing parent node id", () => {
    const children = [
      { name: "a.ts", path: "/proj/huge/a.ts", type: "file" as const },
      {
        name: "sub",
        path: "/proj/huge/sub",
        type: "directory" as const,
        truncated: true,
        childCount: 99,
      },
    ];
    const { nodes, edges } = subtreeToNodes(children, "node-/proj/huge", 1);
    expect(nodes.map(n => n.id).sort()).toEqual(["node-/proj/huge/a.ts", "node-/proj/huge/sub"]);
    // Every top-level child is linked to the parent.
    expect(edges.every(e => e.source === "node-/proj/huge" || nodes.some(n => n.id === e.source))).toBe(true);
    expect(edges.some(e => e.source === "node-/proj/huge" && e.target === "node-/proj/huge/a.ts")).toBe(true);
    // A nested truncated folder keeps its flag for further drill-in.
    const sub = nodes.find(n => n.id === "node-/proj/huge/sub");
    expect(sub?.data.truncated).toBe(true);
    expect(sub?.data.fileCount).toBe(99);
  });
});
