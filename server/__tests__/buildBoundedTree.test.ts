import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { buildBoundedTree, type FileTreeNode } from "../routers/projectRouter.js";

// Flatten the bounded tree into a list for easy assertions.
function flatten(nodes: FileTreeNode[]): FileTreeNode[] {
  return nodes.flatMap(n => [n, ...(n.children ? flatten(n.children) : [])]);
}

let root: string;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "omnecor-tree-"));
  // small/      a.ts, b.ts
  // wide/       d0..d199 (each with one file) — 200 dirs + 200 files = 400 entries
  // deep/l1/l2/l3/l4  (nested chain)
  await fs.mkdir(path.join(root, "small"));
  await fs.writeFile(path.join(root, "small", "a.ts"), "a");
  await fs.writeFile(path.join(root, "small", "b.ts"), "b");

  await fs.mkdir(path.join(root, "wide"));
  for (let i = 0; i < 200; i++) {
    const d = path.join(root, "wide", `d${i}`);
    await fs.mkdir(d);
    await fs.writeFile(path.join(d, "f.ts"), "f");
  }

  let chain = path.join(root, "deep");
  for (const seg of ["l1", "l2", "l3", "l4"]) {
    chain = path.join(chain, seg);
    await fs.mkdir(chain, { recursive: true });
  }

  // flat/ — 50 flat files, for the root-slice overflow-marker case
  await fs.mkdir(path.join(root, "flat"));
  for (let i = 0; i < 50; i++) {
    await fs.writeFile(path.join(root, "flat", `f${i}.ts`), "x");
  }
});

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("buildBoundedTree", () => {
  it("fully expands a tree under budget (no truncation)", async () => {
    const node = await buildBoundedTree(path.join(root, "small"), path.join(root, "small"), 8, 1500);
    const all = flatten(node?.children ?? []);
    expect(all.map(n => n.name).sort()).toEqual(["a.ts", "b.ts"]);
    expect(all.some(n => n.truncated)).toBe(false);
  });

  it("truncates folders breadth-first once the node budget is exceeded", async () => {
    // 'wide' has 200 dirs + 200 files. With a small budget, the wide dir's
    // children are listed but their sub-dirs can't all expand → truncation.
    const node = await buildBoundedTree(root, root, 8, 120);
    const all = flatten(node?.children ?? []);
    const truncated = all.filter(n => n.truncated);
    expect(truncated.length).toBeGreaterThan(0);
    // A truncated directory reports how many entries it holds.
    for (const t of truncated) {
      expect(t.type).toBe("directory");
      expect(t.childCount).toBeGreaterThan(0);
      expect(t.children).toBeUndefined();
    }
    // The total returned node count stays bounded by the budget.
    expect(all.length).toBeLessThanOrEqual(120 + 5);
  });

  it("truncates at the max-depth limit with a child count", async () => {
    // Depths from root: deep=1, l1=2, l2=3. With maxDepth 2, l1 (depth 2) is the
    // deepest node processed and is truncated because l2 sits beyond the limit.
    const node = await buildBoundedTree(root, root, 2, 1500);
    const all = flatten(node?.children ?? []);
    const l1 = all.find(n => n.name === "l1");
    expect(l1?.truncated).toBe(true);
    expect(l1?.childCount).toBe(1); // contains l2
    expect(all.find(n => n.name === "l2")).toBeUndefined();
  });

  it("appends a visible overflow marker when the root slice drops entries", async () => {
    // 'flat' has 50 files; with budget 10 the root is sliced and the omission is
    // surfaced as a synthetic marker node rather than silently dropped.
    const node = await buildBoundedTree(path.join(root, "flat"), path.join(root, "flat"), 8, 10);
    const children = node?.children ?? [];
    const marker = children.find(c => c.overflow);
    expect(marker).toBeDefined();
    expect(marker?.name).toContain("more item");
    expect(marker?.name).toContain("40"); // 50 - 10 shown
    // Real files are still present alongside the marker.
    expect(children.filter(c => !c.overflow).length).toBe(10);
  });

  it("ignores node_modules and dotfiles", async () => {
    const nm = path.join(root, "small", "node_modules");
    await fs.mkdir(nm, { recursive: true });
    await fs.writeFile(path.join(nm, "junk.js"), "x");
    await fs.writeFile(path.join(root, "small", ".secret"), "x");
    const node = await buildBoundedTree(path.join(root, "small"), path.join(root, "small"), 8, 1500);
    const names = flatten(node?.children ?? []).map(n => n.name);
    expect(names).not.toContain("node_modules");
    expect(names).not.toContain(".secret");
  });
});
