// ---------------------------------------------------------------------------
// Pure neural-map layout engine.
//
// This module is intentionally free of React, Zustand, the DOM and reactflow so
// it can run unchanged inside a Web Worker (see neuralLayout.worker.ts) — keeping
// the O(n) / O(n·k) layout math off the render thread. The previous in-component
// implementation ran a strict O(n²) force simulation synchronously, which froze
// the UI on large maps. Here the all-pairs repulsion and overlap passes are
// accelerated with a uniform spatial grid, and the iteration count scales down as
// the node count grows.
// ---------------------------------------------------------------------------

export type LayoutEngine = "force" | "hierarchical" | "mindmap" | "circular";

/** Slim node shape passed to the layout engine — id, current position, kind. */
export interface LayoutNode {
  id: string;
  x: number;
  y: number;
  type: string; // "project" | "folder" | "file" | "integration" | …
}

export interface LayoutEdge {
  source: string;
  target: string;
}

export interface LayoutParams {
  layout: LayoutEngine;
  autoClustering: boolean;
  nodeSize: number; // 20–70 (matches visualControlStore)
}

export interface LayoutPosition {
  id: string;
  x: number;
  y: number;
}

const NODE_W = 180;
const NODE_H = 60;

// ---------------------------------------------------------------------------
// Spatial grid — visits every pair of items closer than `cellSize` on both axes
// exactly once. Reduces the all-pairs O(n²) passes to roughly O(n) for spread
// graphs while preserving the original short-range force behaviour.
// ---------------------------------------------------------------------------
// Numeric cell hash. STRIDE bounds the y-cell range to ±(STRIDE/2); layout
// coordinates stay far inside that, so collisions can't occur in practice.
const GRID_STRIDE = 1_000_000;

function forEachNearbyPair(
  items: { x: number; y: number }[],
  cellSize: number,
  cb: (i: number, j: number) => void,
): void {
  const n = items.length;
  const size = cellSize > 0 ? cellSize : 1;
  const cellX = new Int32Array(n);
  const cellY = new Int32Array(n);
  const grid = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const cx = Math.floor(items[i].x / size);
    const cy = Math.floor(items[i].y / size);
    cellX[i] = cx;
    cellY[i] = cy;
    const key = cx * GRID_STRIDE + cy;
    let bucket = grid.get(key);
    if (!bucket) {
      bucket = [];
      grid.set(key, bucket);
    }
    bucket.push(i);
  }
  for (let i = 0; i < n; i++) {
    const cx = cellX[i];
    const cy = cellY[i];
    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      for (let gy = cy - 1; gy <= cy + 1; gy++) {
        const bucket = grid.get(gx * GRID_STRIDE + gy);
        if (!bucket) continue;
        for (const j of bucket) {
          if (j <= i) continue; // visit each unordered pair once
          cb(i, j);
        }
      }
    }
  }
}

/** Force-simulation iterations, scaled down as the graph grows so very large
 *  maps converge in bounded time. Small maps keep the original 80-pass quality. */
function iterationsFor(n: number): number {
  if (n <= 1) return 1;
  return Math.max(24, Math.min(80, Math.round(1800 / Math.sqrt(n))));
}

// ---------------------------------------------------------------------------
// Barnes-Hut quadtree repulsion — O(n log n).
//
// A plain distance cutoff degenerates to O(n²) while the graph is still
// collapsed (every node lands in one cell). A Barnes-Hut quadtree approximates
// far-away groups of nodes by their centre of mass, so the repulsion stays
// near-linear regardless of how dense the current arrangement is — this is what
// keeps a multi-thousand-node map's layout fast.
// ---------------------------------------------------------------------------
interface BHCell {
  x: number; y: number; w: number;      // square cell origin + side length
  mass: number; cx: number; cy: number; // aggregate body count + centre of mass
  body: number;                         // single-body leaf index, else -1
  extra: number[] | null;               // coincident bodies overflowing max depth
  nw: BHCell | null; ne: BHCell | null; sw: BHCell | null; se: BHCell | null;
}

const BH_MAX_DEPTH = 26;
const BH_THETA_SQ = 0.81; // θ = 0.9 — higher accepts coarser approximations (faster)

function bhCell(x: number, y: number, w: number): BHCell {
  return { x, y, w, mass: 0, cx: 0, cy: 0, body: -1, extra: null, nw: null, ne: null, sw: null, se: null };
}

function bhSubdivide(cell: BHCell): void {
  const h = cell.w / 2;
  cell.nw = bhCell(cell.x, cell.y, h);
  cell.ne = bhCell(cell.x + h, cell.y, h);
  cell.sw = bhCell(cell.x, cell.y + h, h);
  cell.se = bhCell(cell.x + h, cell.y + h, h);
}

function bhInsertChild(cell: BHCell, pts: { x: number; y: number }[], i: number, depth: number): void {
  const mid = cell.x + cell.w / 2;
  const midY = cell.y + cell.w / 2;
  const east = pts[i].x >= mid;
  const south = pts[i].y >= midY;
  const child = east ? (south ? cell.se! : cell.ne!) : (south ? cell.sw! : cell.nw!);
  bhInsert(child, pts, i, depth + 1);
}

function bhInsert(cell: BHCell, pts: { x: number; y: number }[], i: number, depth: number): void {
  if (cell.body === -1 && !cell.nw) { cell.body = i; return; } // empty leaf
  if (depth >= BH_MAX_DEPTH) { (cell.extra ??= []).push(i); return; } // coincident cluster
  if (!cell.nw) {
    bhSubdivide(cell);
    const existing = cell.body;
    cell.body = -1;
    if (existing !== -1) bhInsertChild(cell, pts, existing, depth);
  }
  bhInsertChild(cell, pts, i, depth);
}

/** Bottom-up pass computing each cell's mass and centre of mass. */
function bhComputeMass(cell: BHCell, pts: { x: number; y: number }[]): void {
  if (cell.nw) {
    let m = 0, cx = 0, cy = 0;
    for (const c of [cell.nw, cell.ne!, cell.sw!, cell.se!]) {
      bhComputeMass(c, pts);
      if (c.mass > 0) { m += c.mass; cx += c.cx * c.mass; cy += c.cy * c.mass; }
    }
    cell.mass = m; cell.cx = m ? cx / m : 0; cell.cy = m ? cy / m : 0;
  } else {
    let m = 0, cx = 0, cy = 0;
    if (cell.body !== -1) { m++; cx += pts[cell.body].x; cy += pts[cell.body].y; }
    if (cell.extra) for (const b of cell.extra) { m++; cx += pts[b].x; cy += pts[b].y; }
    cell.mass = m; cell.cx = m ? cx / m : 0; cell.cy = m ? cy / m : 0;
  }
}

function bhAccumulate(
  cell: BHCell,
  idx: number,
  pts: { x: number; y: number }[],
  repelForce: number,
  fx: Float64Array,
  fy: Float64Array,
): void {
  if (cell.mass === 0) return;

  if (cell.nw) {
    let dx = pts[idx].x - cell.cx;
    let dy = pts[idx].y - cell.cy;
    let distSq = dx * dx + dy * dy;
    // θ criterion: if the cell is far enough, treat its bodies as one at the COM.
    if (cell.w * cell.w < BH_THETA_SQ * distSq) {
      if (distSq === 0) { dx = Math.random() * 2 - 1; dy = Math.random() * 2 - 1; distSq = dx * dx + dy * dy; }
      const dist = Math.sqrt(distSq);
      const f = (repelForce * cell.mass) / (distSq + 100);
      fx[idx] += (dx / dist) * f;
      fy[idx] += (dy / dist) * f;
      return;
    }
    bhAccumulate(cell.nw, idx, pts, repelForce, fx, fy);
    bhAccumulate(cell.ne!, idx, pts, repelForce, fx, fy);
    bhAccumulate(cell.sw!, idx, pts, repelForce, fx, fy);
    bhAccumulate(cell.se!, idx, pts, repelForce, fx, fy);
    return;
  }

  // Leaf — apply each body directly (skipping self).
  const apply = (b: number) => {
    if (b === idx) return;
    let dx = pts[idx].x - pts[b].x;
    let dy = pts[idx].y - pts[b].y;
    let distSq = dx * dx + dy * dy;
    if (distSq === 0) { dx = Math.random() * 2 - 1; dy = Math.random() * 2 - 1; distSq = dx * dx + dy * dy; }
    const dist = Math.sqrt(distSq);
    const f = repelForce / (distSq + 100);
    fx[idx] += (dx / dist) * f;
    fy[idx] += (dy / dist) * f;
  };
  if (cell.body !== -1) apply(cell.body);
  if (cell.extra) for (const b of cell.extra) apply(b);
}

/** Accumulate repulsive forces for every node into fx/fy using Barnes-Hut. */
function computeRepulsion(
  pts: { x: number; y: number }[],
  repelForce: number,
  fx: Float64Array,
  fy: Float64Array,
): void {
  const n = pts.length;
  if (n < 2) return;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const size = Math.max(maxX - minX, maxY - minY, 1) * 1.01;

  const root = bhCell(minX, minY, size);
  for (let i = 0; i < n; i++) bhInsert(root, pts, i, 0);
  bhComputeMass(root, pts);
  for (let i = 0; i < n; i++) bhAccumulate(root, i, pts, repelForce, fx, fy);
}

// ---------------------------------------------------------------------------
// Hierarchical (layered) layout — O(n + e)
// ---------------------------------------------------------------------------
function hierarchical(nodes: LayoutNode[], edges: LayoutEdge[], p: LayoutParams): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  if (!nodes.length) return out;

  const scale = p.nodeSize / 10;
  const scaledW = NODE_W * scale;
  const scaledH = NODE_H * scale;
  const H_GAP = p.autoClustering ? 120 * scale : 800;
  const V_GAP = p.autoClustering ? 180 * scale : 1200;

  const children = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  nodes.forEach(n => { children.set(n.id, []); inDegree.set(n.id, 0); });
  edges.forEach(e => {
    children.get(e.source)?.push(e.target);
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
  });

  const roots = nodes.filter(n => (inDegree.get(n.id) ?? 0) === 0).map(n => n.id);
  if (!roots.length) roots.push(nodes[0].id);

  const depthMap = new Map<string, number>();
  const queue = [...roots];
  roots.forEach(r => depthMap.set(r, 0));
  while (queue.length) {
    const id = queue.shift()!;
    const d = depthMap.get(id)!;
    for (const c of children.get(id) ?? []) {
      if (!depthMap.has(c)) { depthMap.set(c, d + 1); queue.push(c); }
    }
  }
  nodes.forEach(n => { if (!depthMap.has(n.id)) depthMap.set(n.id, 0); });

  const byDepth = new Map<number, string[]>();
  depthMap.forEach((d, id) => {
    if (!byDepth.has(d)) byDepth.set(d, []);
    byDepth.get(d)!.push(id);
  });

  byDepth.forEach((ids, depth) => {
    const totalW = ids.length * (scaledW + H_GAP) - H_GAP;
    ids.forEach((id, i) => {
      out.set(id, { x: i * (scaledW + H_GAP) - totalW / 2, y: depth * (scaledH + V_GAP) });
    });
  });

  return out;
}

// ---------------------------------------------------------------------------
// Circular layout — O(n)
// ---------------------------------------------------------------------------
function circular(nodes: LayoutNode[], p: LayoutParams): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  if (!nodes.length) return out;

  const scale = p.nodeSize / 10;
  const S_x = p.autoClustering ? (NODE_W * scale + 24 * scale) : (NODE_W * scale * 2.8);
  const minR = (nodes.length * S_x) / (2 * Math.PI);
  const factor = p.autoClustering ? 80 : 350;
  const baseR = Math.max(p.autoClustering ? 300 : 800, nodes.length * factor);
  const R = Math.max(baseR, minR);

  nodes.forEach((n, i) => {
    out.set(n.id, {
      x: R * Math.cos((i * 2 * Math.PI) / nodes.length),
      y: R * Math.sin((i * 2 * Math.PI) / nodes.length),
    });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Mind-map (radial BFS) layout — O(n + e)
// ---------------------------------------------------------------------------
function mindmap(nodes: LayoutNode[], edges: LayoutEdge[], p: LayoutParams): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  if (!nodes.length) return out;

  const STEP = p.autoClustering ? 380 : 1200;
  const scale = p.nodeSize / 10;
  const S_y = p.autoClustering ? (NODE_H * scale + 36 * scale) : (NODE_H * scale * 3.5);

  const degree = new Map<string, number>();
  nodes.forEach(n => degree.set(n.id, 0));
  edges.forEach(e => {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  });
  const center = nodes.reduce((best, n) => {
    if (n.type === "project") return n;
    return (degree.get(n.id) ?? 0) > (degree.get(best.id) ?? 0) ? n : best;
  }, nodes[0]);

  const adj = new Map<string, string[]>();
  nodes.forEach(n => adj.set(n.id, []));
  edges.forEach(e => {
    adj.get(e.source)?.push(e.target);
    adj.get(e.target)?.push(e.source);
  });

  out.set(center.id, { x: 0, y: 0 });
  const visited = new Set<string>([center.id]);

  type BfsItem = { id: string; depth: number; aStart: number; aEnd: number };
  const bfsQ: BfsItem[] = [{ id: center.id, depth: 0, aStart: 0, aEnd: 2 * Math.PI }];

  while (bfsQ.length) {
    const { id, depth, aStart, aEnd } = bfsQ.shift()!;
    const unvisited = (adj.get(id) ?? []).filter(c => !visited.has(c));
    if (!unvisited.length) continue;

    const minR = (unvisited.length * S_y) / (aEnd - aStart);
    const r = Math.max((depth + 1) * STEP, minR);
    const aStep = (aEnd - aStart) / unvisited.length;
    unvisited.forEach((cid, i) => {
      visited.add(cid);
      const angle = aStart + (i + 0.5) * aStep;
      out.set(cid, { x: r * Math.cos(angle), y: r * Math.sin(angle) });
      bfsQ.push({ id: cid, depth: depth + 1, aStart: aStart + i * aStep, aEnd: aStart + (i + 1) * aStep });
    });
  }

  const orphans = nodes.filter(n => !out.has(n.id));
  const R2 = (Math.max(...Array.from(out.values()).map(pt => Math.hypot(pt.x, pt.y)), 0) || STEP) + STEP;
  const minOrphanR = (orphans.length * S_y) / (2 * Math.PI);
  const finalR2 = Math.max(R2, minOrphanR);
  orphans.forEach((n, i) => {
    out.set(n.id, {
      x: finalR2 * Math.cos((i * 2 * Math.PI) / Math.max(orphans.length, 1)),
      y: finalR2 * Math.sin((i * 2 * Math.PI) / Math.max(orphans.length, 1)),
    });
  });

  return out;
}

// ---------------------------------------------------------------------------
// Force-directed layout — grid-accelerated, bounded iterations
// ---------------------------------------------------------------------------
function force(nodes: LayoutNode[], edges: LayoutEdge[], p: LayoutParams): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  if (!nodes.length) return out;

  const pts = nodes.map(n => ({
    id: n.id,
    x: typeof n.x === "number" && Number.isFinite(n.x) ? n.x : (Math.random() * 100 - 50),
    y: typeof n.y === "number" && Number.isFinite(n.y) ? n.y : (Math.random() * 100 - 50),
    type: n.type || "file",
  }));
  const idToIndex = new Map(pts.map((n, i) => [n.id, i]));

  const idealLength = p.autoClustering ? 220 : 700;
  const repelForce = p.autoClustering ? 350000 : 2500000;
  const springCoeff = 0.04;
  const gravity = 0.05;
  const iterations = iterationsFor(pts.length);

  const scale = p.nodeSize / 10;
  const nodeWidth = NODE_W * scale;
  const nodeHeight = NODE_H * scale;
  const S_x = p.autoClustering ? (nodeWidth + 24 * scale) : (nodeWidth * 2.8);
  const S_y = p.autoClustering ? (nodeHeight + 36 * scale) : (nodeHeight * 3.5);

  const collideCell = Math.max(S_x, S_y);
  // Short-range separation only kicks in once the graph is roughly arranged — it
  // is unnecessary (and expensive) while everything is still collapsed at the
  // start, and the final resolveOverlaps pass guarantees no overlaps regardless.
  const separationStart = Math.floor(iterations * 0.5);

  const fx = new Float64Array(pts.length);
  const fy = new Float64Array(pts.length);

  for (let iter = 0; iter < iterations; iter++) {
    fx.fill(0);
    fy.fill(0);

    // Repulsion (Barnes-Hut quadtree, O(n log n))
    computeRepulsion(pts, repelForce, fx, fy);

    // Spring (edges)
    for (const e of edges) {
      const i = idToIndex.get(e.source);
      const j = idToIndex.get(e.target);
      if (i === undefined || j === undefined) continue;
      const n1 = pts[i];
      const n2 = pts[j];
      const dx = n1.x - n2.x;
      const dy = n1.y - n2.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.1;
      const f = springCoeff * (dist - idealLength);
      const ux = (dx / dist) * f;
      const uy = (dy / dist) * f;
      fx[i] -= ux; fy[i] -= uy;
      fx[j] += ux; fy[j] += uy;
    }

    // Gravity toward per-type cluster anchor (or origin when clustering is off)
    for (let i = 0; i < pts.length; i++) {
      const n = pts[i];
      let targetX = 0;
      let targetY = 0;
      if (p.autoClustering) {
        if (n.type === "project") { targetX = -300; targetY = -300; }
        else if (n.type === "folder") { targetX = 300; targetY = -300; }
        else if (n.type === "file") { targetX = -300; targetY = 300; }
        else { targetX = 300; targetY = 300; }
      }
      fx[i] -= (n.x - targetX) * gravity;
      fy[i] -= (n.y - targetY) * gravity;
    }

    // Integrate with cooling temperature
    const temp = Math.max(1, 20 * (1 - iter / iterations));
    for (let i = 0; i < pts.length; i++) {
      let dx = fx[i];
      let dy = fy[i];
      const forceDist = Math.sqrt(dx * dx + dy * dy);
      if (forceDist > temp) {
        dx = (dx / forceDist) * temp;
        dy = (dy / forceDist) * temp;
      }
      pts[i].x += dx;
      pts[i].y += dy;
    }

    // Local separation passes to guide convergence (grid-accelerated). Skipped
    // early — see separationStart above.
    for (let cIter = 0; iter >= separationStart && cIter < 3; cIter++) {
      forEachNearbyPair(pts, collideCell, (i, j) => {
        const n1 = pts[i];
        const n2 = pts[j];
        let dx = n2.x - n1.x;
        let dy = n2.y - n1.y;
        if (dx === 0 && dy === 0) { dx = Math.random() * 2 - 1; dy = Math.random() * 2 - 1; }
        const absDx = Math.abs(dx);
        const absDy = Math.abs(dy);
        if (absDx < S_x && absDy < S_y) {
          const overlapX = S_x - absDx;
          const overlapY = S_y - absDy;
          if (overlapX < overlapY) {
            const pushX = (overlapX / 2) * 1.02;
            const sign = dx >= 0 ? 1 : -1;
            n1.x -= sign * pushX;
            n2.x += sign * pushX;
          } else {
            const pushY = (overlapY / 2) * 1.02;
            const sign = dy >= 0 ? 1 : -1;
            n1.y -= sign * pushY;
            n2.y += sign * pushY;
          }
        }
      });
    }
  }

  pts.forEach(n => out.set(n.id, { x: Math.round(n.x), y: Math.round(n.y) }));
  return out;
}

// ---------------------------------------------------------------------------
// Final overlap-resolution pass — grid-accelerated, early-out when clean
// ---------------------------------------------------------------------------
function resolveOverlaps(
  positions: Map<string, { x: number; y: number }>,
  nodes: LayoutNode[],
  p: LayoutParams,
): void {
  if (!nodes.length) return;

  const scale = p.nodeSize / 10;
  const nodeWidth = NODE_W * scale;
  const nodeHeight = NODE_H * scale;
  const S_x = p.autoClustering ? (nodeWidth + 24 * scale) : (nodeWidth * 2.8);
  const S_y = p.autoClustering ? (nodeHeight + 36 * scale) : (nodeHeight * 3.5);
  const cell = Math.max(S_x, S_y);

  const pts = nodes.map(n => {
    const pos = positions.get(n.id);
    return { id: n.id, x: pos?.x ?? n.x, y: pos?.y ?? n.y };
  });

  const iterations = 80;
  for (let iter = 0; iter < iterations; iter++) {
    let hasOverlap = false;
    forEachNearbyPair(pts, cell, (i, j) => {
      const n1 = pts[i];
      const n2 = pts[j];
      let dx = n2.x - n1.x;
      let dy = n2.y - n1.y;
      if (dx === 0 && dy === 0) { dx = Math.random() * 2 - 1; dy = Math.random() * 2 - 1; }
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);
      if (absDx < S_x && absDy < S_y) {
        hasOverlap = true;
        const overlapX = S_x - absDx;
        const overlapY = S_y - absDy;
        if (overlapX < overlapY) {
          const pushX = (overlapX / 2) * 1.05;
          const sign = dx >= 0 ? 1 : -1;
          n1.x -= sign * pushX;
          n2.x += sign * pushX;
        } else {
          const pushY = (overlapY / 2) * 1.05;
          const sign = dy >= 0 ? 1 : -1;
          n1.y -= sign * pushY;
          n2.y += sign * pushY;
        }
      }
    });
    if (!hasOverlap) break;
  }

  pts.forEach(n => positions.set(n.id, { x: Math.round(n.x), y: Math.round(n.y) }));
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------
export function computeLayoutPositions(
  params: LayoutParams,
  nodes: LayoutNode[],
  edges: LayoutEdge[],
): LayoutPosition[] {
  if (!nodes.length) return [];

  let positions: Map<string, { x: number; y: number }>;
  if (params.layout === "hierarchical") {
    positions = hierarchical(nodes, edges, params);
  } else if (params.layout === "circular") {
    positions = circular(nodes, params);
  } else if (params.layout === "mindmap") {
    positions = mindmap(nodes, edges, params);
  } else {
    positions = force(nodes, edges, params);
    resolveOverlaps(positions, nodes, params);
  }

  return nodes.map(n => {
    const pos = positions.get(n.id) ?? { x: n.x, y: n.y };
    return { id: n.id, x: pos.x, y: pos.y };
  });
}
