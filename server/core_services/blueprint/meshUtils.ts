/**
 * Blueprint Studio — mesh utilities.
 *
 * Converts JSCAD geometry / STL bytes into the `MeshJson` contract the client
 * ThreeViewer renders, computes physical properties (bounds, volume, surface
 * area via the divergence theorem), serializes/parses binary STL, and extracts
 * projected feature edges for the 2D blueprint drawings.
 */
import type { MeshJson } from "@shared/blueprint";

export interface TriMesh {
  positions: Float64Array | number[]; // flat xyz
  indices: number[];
}

// ---------------------------------------------------------------------------
// Mesh math
// ---------------------------------------------------------------------------

export function computeBounds(positions: ArrayLike<number>): MeshJson["boundsMm"] {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = positions[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  if (!Number.isFinite(min[0])) return { min: [0, 0, 0], max: [0, 0, 0] };
  return { min, max };
}

/** Signed volume via the divergence theorem (positive for outward-wound meshes). */
export function computeVolumeMm3(positions: ArrayLike<number>, indices: number[]): number {
  let vol = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t] * 3, indices[t + 1] * 3, indices[t + 2] * 3];
    const ax = positions[a], ay = positions[a + 1], az = positions[a + 2];
    const bx = positions[b], by = positions[b + 1], bz = positions[b + 2];
    const cx = positions[c], cy = positions[c + 1], cz = positions[c + 2];
    vol += (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6;
  }
  return Math.abs(vol);
}

export function computeSurfaceAreaMm2(positions: ArrayLike<number>, indices: number[]): number {
  let area = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t] * 3, indices[t + 1] * 3, indices[t + 2] * 3];
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    area += Math.sqrt(cx * cx + cy * cy + cz * cz) / 2;
  }
  return area;
}

export function computeNormals(positions: ArrayLike<number>, indices: number[]): number[] {
  const normals = new Array(positions.length).fill(0);
  for (let t = 0; t < indices.length; t += 3) {
    const [ia, ib, ic] = [indices[t], indices[t + 1], indices[t + 2]];
    const [a, b, c] = [ia * 3, ib * 3, ic * 3];
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const i of [ia, ib, ic]) {
      normals[i * 3] += nx;
      normals[i * 3 + 1] += ny;
      normals[i * 3 + 2] += nz;
    }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const len = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    normals[i] /= len;
    normals[i + 1] /= len;
    normals[i + 2] /= len;
  }
  return normals;
}

export function toMeshJson(positions: number[], indices: number[]): MeshJson {
  return {
    positions,
    indices,
    normals: computeNormals(positions, indices),
    boundsMm: computeBounds(positions),
    triangleCount: indices.length / 3,
    volumeMm3: computeVolumeMm3(positions, indices),
    surfaceAreaMm2: computeSurfaceAreaMm2(positions, indices),
  };
}

// ---------------------------------------------------------------------------
// JSCAD geometry → mesh
// ---------------------------------------------------------------------------

interface JscadPolygon {
  vertices: ArrayLike<number>[];
}

/**
 * Triangulate JSCAD geom3 polygons (convex, planar — the kernel guarantees
 * this) into an indexed mesh with vertex dedup.
 */
export function jscadGeom3ToMesh(polygons: JscadPolygon[]): { positions: number[]; indices: number[] } {
  const positions: number[] = [];
  const indices: number[] = [];
  const vertKey = new Map<string, number>();

  const addVertex = (v: ArrayLike<number>): number => {
    const key = `${v[0].toFixed(5)},${v[1].toFixed(5)},${v[2].toFixed(5)}`;
    const existing = vertKey.get(key);
    if (existing !== undefined) return existing;
    const idx = positions.length / 3;
    positions.push(v[0], v[1], v[2]);
    vertKey.set(key, idx);
    return idx;
  };

  for (const poly of polygons) {
    const verts = poly.vertices;
    if (verts.length < 3) continue;
    const i0 = addVertex(verts[0]);
    for (let i = 1; i + 1 < verts.length; i++) {
      indices.push(i0, addVertex(verts[i]), addVertex(verts[i + 1]));
    }
  }
  return { positions, indices };
}

// ---------------------------------------------------------------------------
// Binary STL
// ---------------------------------------------------------------------------

export function meshToStlBinary(positions: ArrayLike<number>, indices: number[], name = "omnecor"): Buffer {
  const triCount = indices.length / 3;
  const buf = Buffer.alloc(84 + triCount * 50);
  buf.write(`Omnecor Blueprint ${name}`.slice(0, 79), 0, "ascii");
  buf.writeUInt32LE(triCount, 80);
  let off = 84;
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t] * 3, indices[t + 1] * 3, indices[t + 2] * 3];
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    buf.writeFloatLE(nx, off); buf.writeFloatLE(ny, off + 4); buf.writeFloatLE(nz, off + 8);
    off += 12;
    for (const vi of [a, b, c]) {
      buf.writeFloatLE(positions[vi], off);
      buf.writeFloatLE(positions[vi + 1], off + 4);
      buf.writeFloatLE(positions[vi + 2], off + 8);
      off += 12;
    }
    buf.writeUInt16LE(0, off);
    off += 2;
  }
  return buf;
}

/** Parse binary or ASCII STL into an indexed mesh (vertices deduped). */
export function parseStl(data: Buffer): { positions: number[]; indices: number[] } {
  const isAscii = data.length > 5 && data.subarray(0, 5).toString("ascii").toLowerCase() === "solid" && !looksBinary(data);
  return isAscii ? parseStlAscii(data.toString("ascii")) : parseStlBinary(data);
}

function looksBinary(data: Buffer): boolean {
  if (data.length < 84) return false;
  const triCount = data.readUInt32LE(80);
  return data.length === 84 + triCount * 50;
}

function parseStlBinary(data: Buffer): { positions: number[]; indices: number[] } {
  const triCount = data.readUInt32LE(80);
  const positions: number[] = [];
  const indices: number[] = [];
  const vertKey = new Map<string, number>();
  let off = 84;
  for (let t = 0; t < triCount; t++) {
    off += 12; // skip normal
    for (let v = 0; v < 3; v++) {
      const x = data.readFloatLE(off), y = data.readFloatLE(off + 4), z = data.readFloatLE(off + 8);
      off += 12;
      const key = `${x.toFixed(5)},${y.toFixed(5)},${z.toFixed(5)}`;
      let idx = vertKey.get(key);
      if (idx === undefined) {
        idx = positions.length / 3;
        positions.push(x, y, z);
        vertKey.set(key, idx);
      }
      indices.push(idx);
    }
    off += 2; // attribute byte count
  }
  return { positions, indices };
}

function parseStlAscii(text: string): { positions: number[]; indices: number[] } {
  const positions: number[] = [];
  const indices: number[] = [];
  const vertKey = new Map<string, number>();
  const re = /vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/g;
  let m: RegExpExecArray | null;
  const verts: number[] = [];
  while ((m = re.exec(text))) {
    const [x, y, z] = [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])];
    const key = `${x.toFixed(5)},${y.toFixed(5)},${z.toFixed(5)}`;
    let idx = vertKey.get(key);
    if (idx === undefined) {
      idx = positions.length / 3;
      positions.push(x, y, z);
      vertKey.set(key, idx);
    }
    verts.push(idx);
  }
  for (let i = 0; i + 2 < verts.length; i += 3) indices.push(verts[i], verts[i + 1], verts[i + 2]);
  return { positions, indices };
}

// ---------------------------------------------------------------------------
// Feature-edge extraction + orthographic projection (blueprint views)
// ---------------------------------------------------------------------------

export type ViewName = "front" | "top" | "right";

export interface ProjectedEdge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Extract drawing-worthy edges: boundary edges (used by one triangle) and
 * feature edges where adjacent face normals differ by more than `angleDeg`.
 * This gives clean outlines for prismatic/CSG parts without a full
 * hidden-line-removal pass.
 */
export function extractFeatureEdges(
  positions: ArrayLike<number>,
  indices: number[],
  angleDeg = 20,
): [number, number][] {
  const cosLimit = Math.cos((angleDeg * Math.PI) / 180);
  interface EdgeInfo {
    a: number;
    b: number;
    normals: [number, number, number][];
  }
  const edges = new Map<string, EdgeInfo>();

  for (let t = 0; t < indices.length; t += 3) {
    const tri = [indices[t], indices[t + 1], indices[t + 2]];
    const [a, b, c] = tri.map((i) => i * 3);
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    for (let e = 0; e < 3; e++) {
      const i1 = tri[e], i2 = tri[(e + 1) % 3];
      const key = i1 < i2 ? `${i1}_${i2}` : `${i2}_${i1}`;
      let info = edges.get(key);
      if (!info) {
        info = { a: Math.min(i1, i2), b: Math.max(i1, i2), normals: [] };
        edges.set(key, info);
      }
      info.normals.push([nx, ny, nz]);
    }
  }

  const result: [number, number][] = [];
  for (const info of edges.values()) {
    if (info.normals.length === 1) {
      result.push([info.a, info.b]); // boundary edge
      continue;
    }
    const [n1, n2] = info.normals;
    const dot = n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2];
    if (dot < cosLimit) result.push([info.a, info.b]);
  }
  return result;
}

/**
 * Project feature edges into a named orthographic view (Z-up convention:
 * front = X/Z looking down −Y, top = X/Y looking down −Z, right = Y/Z looking
 * down +X). Drawing Y grows up — the SVG layer flips it.
 */
export function projectEdges(
  positions: ArrayLike<number>,
  edges: [number, number][],
  view: ViewName,
): ProjectedEdge[] {
  const pick = (i: number): [number, number] => {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    switch (view) {
      case "front":
        return [x, z];
      case "top":
        return [x, y];
      case "right":
        return [y, z];
    }
  };
  const out: ProjectedEdge[] = [];
  const seen = new Set<string>();
  for (const [a, b] of edges) {
    const [x1, y1] = pick(a);
    const [x2, y2] = pick(b);
    // Drop degenerate (projected to a point) and duplicate segments.
    if (Math.hypot(x2 - x1, y2 - y1) < 1e-6) continue;
    const key =
      x1 < x2 || (x1 === x2 && y1 <= y2)
        ? `${x1.toFixed(3)},${y1.toFixed(3)}_${x2.toFixed(3)},${y2.toFixed(3)}`
        : `${x2.toFixed(3)},${y2.toFixed(3)}_${x1.toFixed(3)},${y1.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ x1, y1, x2, y2 });
  }
  return out;
}
