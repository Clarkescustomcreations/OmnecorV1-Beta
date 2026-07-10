/**
 * kicadBoardSpecs — extract fabrication parameters from a `.kicad_pcb` file.
 *
 * PCBWay's quotation API is *parametric* (it prices a board from its
 * dimensions, layer count, material, etc. — the Gerbers are only attached when
 * an order is actually placed). To request a real quote we therefore derive the
 * board outline size and copper-layer count directly from the KiCad board file
 * (s-expression, millimetres in KiCad 6+):
 *
 *   - Length × Width: bounding box of all graphics on the `Edge.Cuts` layer.
 *   - Layers: number of `*.Cu` entries in the board's `(layers …)` stackup,
 *     snapped to a PCBWay-supported count (1, 2, 4, 6, 8, 10, 12, 14).
 *
 * Parsing is tolerant: unknown/missing geometry falls back to sensible
 * prototype defaults rather than throwing, so a quote can always be attempted.
 */
import { promises as fs } from "fs";

export interface BoardSpecs {
  /** Board outline length (longer side) in mm, rounded to 0.1 mm. */
  lengthMm: number;
  /** Board outline width (shorter side) in mm, rounded to 0.1 mm. */
  widthMm: number;
  /** Copper layer count, snapped to a PCBWay-supported value. */
  layers: number;
  /** True when the Edge.Cuts outline was found (vs. falling back to defaults). */
  outlineFound: boolean;
}

const PCBWAY_LAYER_COUNTS = [1, 2, 4, 6, 8, 10, 12, 14] as const;
const DEFAULT_SIZE_MM = 50; // 50 × 50 mm prototype fallback
const DEFAULT_LAYERS = 2;

/** Snap an arbitrary copper-layer count up to the nearest PCBWay-supported value. */
export function snapToSupportedLayers(count: number): number {
  for (const supported of PCBWAY_LAYER_COUNTS) {
    if (count <= supported) return supported;
  }
  return PCBWAY_LAYER_COUNTS[PCBWAY_LAYER_COUNTS.length - 1];
}

/** Return the substring of the balanced s-expression beginning at `openIdx` (a '('). */
function readBalanced(text: string, openIdx: number): string {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return text.slice(openIdx, i + 1);
    }
  }
  return text.slice(openIdx); // unbalanced — return the rest defensively
}

/**
 * Count copper layers from the board's `(layers …)` stackup block. Each copper
 * layer is declared with a quoted name ending in `.Cu` (e.g. `"F.Cu"`,
 * `"In1.Cu"`, `"B.Cu"`).
 */
export function countCopperLayers(text: string): number {
  const idx = text.indexOf("(layers");
  if (idx === -1) return DEFAULT_LAYERS;
  const block = readBalanced(text, idx);
  const matches = block.match(/"[^"]*\.Cu"/g);
  const count = matches ? matches.length : 0;
  return count > 0 ? count : DEFAULT_LAYERS;
}

/**
 * Bounding box of all graphics on the `Edge.Cuts` layer. Scans the common board
 * outline primitives (`gr_line`, `gr_arc`, `gr_rect`, `gr_circle`, `gr_poly`,
 * `gr_curve`) and collects every coordinate from their `(start …)`, `(end …)`,
 * `(center …)`, `(mid …)` and `(xy …)` points.
 */
export function edgeCutsBoundingBox(
  text: string,
): { lengthMm: number; widthMm: number } | null {
  const primitive = /\((gr_line|gr_arc|gr_rect|gr_circle|gr_poly|gr_curve)\b/g;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let found = false;

  let m: RegExpExecArray | null;
  while ((m = primitive.exec(text)) !== null) {
    const block = readBalanced(text, m.index);
    if (!/Edge\.Cuts/.test(block)) continue;

    const coord = /\((?:start|end|center|mid|xy)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\)/g;
    let c: RegExpExecArray | null;
    while ((c = coord.exec(block)) !== null) {
      const x = parseFloat(c[1]);
      const y = parseFloat(c[2]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      found = true;
    }
  }

  if (!found || maxX <= minX || maxY <= minY) return null;
  return {
    lengthMm: Math.round((maxX - minX) * 10) / 10,
    widthMm: Math.round((maxY - minY) * 10) / 10,
  };
}

/** Parse board specs from `.kicad_pcb` text (already loaded). */
export function parseBoardSpecs(text: string): BoardSpecs {
  const bbox = edgeCutsBoundingBox(text);
  const layers = snapToSupportedLayers(countCopperLayers(text));
  if (!bbox) {
    return { lengthMm: DEFAULT_SIZE_MM, widthMm: DEFAULT_SIZE_MM, layers, outlineFound: false };
  }
  // Longer side = Length, shorter side = Width (PCBWay convention).
  const lengthMm = Math.max(bbox.lengthMm, bbox.widthMm);
  const widthMm = Math.min(bbox.lengthMm, bbox.widthMm);
  return { lengthMm, widthMm, layers, outlineFound: true };
}

/** Read a `.kicad_pcb` file from disk and extract its fabrication specs. */
export async function extractBoardSpecs(pcbPath: string): Promise<BoardSpecs> {
  const text = await fs.readFile(pcbPath, "utf-8");
  return parseBoardSpecs(text);
}
