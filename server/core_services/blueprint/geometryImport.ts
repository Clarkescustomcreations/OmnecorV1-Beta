/**
 * Blueprint Studio — geometry import helpers (light, no heavy CAD kernel).
 *
 * STL import reuses the existing `parseStl` → mesh pipeline (so an imported STL
 * becomes a first-class part: 3D viewer, drawings, and FEA). DXF import is 2D:
 * a minimal reader for LINE + LWPOLYLINE entities (what laser/CNC/vector tools
 * export) → line segments, rendered to an outline SVG preview. STEP/IGES are
 * intentionally out of scope (they need an OpenCascade-class dependency).
 */
import type { BlueprintUnits } from "@shared/blueprint";

export interface Dxf2d {
  segments: [[number, number], [number, number]][];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

const r = (n: number) => Math.round(n * 100) / 100;

/** Minimal ASCII-DXF reader: LINE + LWPOLYLINE → 2D segments (mm). */
export function parseDxf2d(text: string): Dxf2d {
  const lines = text.split(/\r\n|\r|\n/);
  const pairs: { code: number; value: string }[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number.parseInt(lines[i].trim(), 10);
    if (Number.isNaN(code)) break; // malformed / not a DXF — stop cleanly
    pairs.push({ code, value: lines[i + 1] });
  }

  // Split into entities on group code 0.
  const entities: { type: string; codes: { code: number; value: string }[] }[] = [];
  let cur: { type: string; codes: { code: number; value: string }[] } | null = null;
  for (const p of pairs) {
    if (p.code === 0) {
      if (cur) entities.push(cur);
      cur = { type: p.value.trim().toUpperCase(), codes: [] };
    } else if (cur) {
      cur.codes.push(p);
    }
  }
  if (cur) entities.push(cur);

  const segments: [[number, number], [number, number]][] = [];
  for (const e of entities) {
    if (e.type === "LINE") {
      const get = (code: number) => {
        const c = e.codes.find((x) => x.code === code);
        return c ? Number.parseFloat(c.value) : undefined;
      };
      const x1 = get(10), y1 = get(20), x2 = get(11), y2 = get(21);
      if ([x1, y1, x2, y2].every((v) => v !== undefined && !Number.isNaN(v))) {
        segments.push([[x1!, y1!], [x2!, y2!]]);
      }
    } else if (e.type === "LWPOLYLINE" || e.type === "POLYLINE") {
      const verts: [number, number][] = [];
      let x: number | undefined;
      let closed = false;
      for (const c of e.codes) {
        if (c.code === 10) x = Number.parseFloat(c.value);
        else if (c.code === 20 && x !== undefined) {
          const y = Number.parseFloat(c.value);
          if (!Number.isNaN(x) && !Number.isNaN(y)) verts.push([x, y]);
          x = undefined;
        } else if (c.code === 70) {
          closed = (Number.parseInt(c.value, 10) & 1) === 1;
        }
      }
      for (let i = 0; i + 1 < verts.length; i++) segments.push([verts[i], verts[i + 1]]);
      if (closed && verts.length > 2) segments.push([verts[verts.length - 1], verts[0]]);
    }
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [a, b] of segments) {
    for (const [x, y] of [a, b]) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (!Number.isFinite(minX)) { minX = minY = maxX = maxY = 0; }
  return { segments, bounds: { minX, minY, maxX, maxY } };
}

const fmtDim = (mm: number, units: BlueprintUnits): string => {
  if (units === "metric") return mm >= 1000 ? `${(mm / 1000).toFixed(2)} m` : `${mm.toFixed(1)} mm`;
  const inches = mm / 25.4;
  return inches < 12 ? `${inches.toFixed(2)}"` : `${Math.floor(inches / 12)}' ${(inches % 12).toFixed(1)}"`;
};

/** Render 2D segments to an outline-preview SVG (Y flipped to screen space). */
export function outlineSvg(dxf: Dxf2d, opts: { title: string; units: BlueprintUnits }): string {
  const { minX, minY, maxX, maxY } = dxf.bounds;
  const w = maxX - minX || 1;
  const h = maxY - minY || 1;
  const pad = Math.max(w, h) * 0.12 + 8;
  const vw = w + 2 * pad;
  const vh = h + 2 * pad + 24; // extra room for the title strip
  const tx = (x: number) => x - minX + pad;
  const ty = (y: number) => maxY - y + pad; // CAD Y-up → SVG Y-down
  const stroke = Math.max(vw, vh) / 400;
  const body = dxf.segments
    .map(([a, b]) => `<line x1="${r(tx(a[0]))}" y1="${r(ty(a[1]))}" x2="${r(tx(b[0]))}" y2="${r(ty(b[1]))}" stroke="#111827" stroke-width="${r(stroke)}" stroke-linecap="round"/>`)
    .join("");
  const label = `${opts.title} — ${fmtDim(w, opts.units)} × ${fmtDim(h, opts.units)} (${dxf.segments.length} edges)`;
  const fs = Math.max(vw, vh) / 45;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r(vw)} ${r(vh)}" font-family="sans-serif">` +
    `<rect x="0" y="0" width="${r(vw)}" height="${r(vh)}" fill="#ffffff"/>` +
    body +
    `<text x="${r(pad)}" y="${r(vh - 8)}" font-size="${r(fs)}" fill="#374151">${label.replace(/[<>&]/g, "")}</text>` +
    `</svg>`
  );
}
