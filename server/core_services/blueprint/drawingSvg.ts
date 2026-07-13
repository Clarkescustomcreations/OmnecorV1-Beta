/**
 * Blueprint Studio — dimensioned 2D drawing (SVG) generation.
 *
 * Renders a three-view engineering sheet (front / top / right) from projected
 * feature edges, with overall dimension callouts per view, a border and a
 * title block. Geometry is real — every line comes from the compiled mesh —
 * and dimensions are measured from the mesh bounds, so the drawing can never
 * disagree with the model. Print-neutral styling (white sheet, dark lines).
 */
import type { MeshJson } from "@shared/blueprint";
import { extractFeatureEdges, projectEdges, type ProjectedEdge, type ViewName } from "./meshUtils.js";

const SHEET_W = 1400;
const SHEET_H = 990; // ~A3 landscape proportions
const MARGIN = 40;
const TITLE_H = 110;
const GAP = 90; // room between views for dimension lines

interface ViewLayout {
  name: ViewName;
  label: string;
  edges: ProjectedEdge[];
  wMm: number;
  hMm: number;
  /** Dimension labels for this view: [horizontalMm, verticalMm]. */
  dims: [number, number];
}

export interface DrawingOptions {
  partName: string;
  planTitle: string;
  units: "imperial" | "metric";
  author?: string;
  scaleNote?: string;
}

const fmtDim = (mm: number, units: "imperial" | "metric"): string => {
  if (units === "metric") return mm >= 1000 ? `${(mm / 1000).toFixed(2)} m` : `${mm.toFixed(1)} mm`;
  const inches = mm / 25.4;
  if (inches < 12) return `${inches.toFixed(2)}"`;
  const ft = Math.floor(inches / 12);
  const rem = inches - ft * 12;
  return rem < 0.05 ? `${ft}'` : `${ft}' ${rem.toFixed(1)}"`;
};

/** Build the three-view blueprint sheet for a compiled part. */
export function buildDrawingSvg(mesh: MeshJson, opts: DrawingOptions): string {
  const edges3d = extractFeatureEdges(mesh.positions, mesh.indices);
  const { min, max } = mesh.boundsMm;
  const sizeX = max[0] - min[0];
  const sizeY = max[1] - min[1];
  const sizeZ = max[2] - min[2];

  const views: ViewLayout[] = [
    { name: "front", label: "FRONT", edges: projectEdges(mesh.positions, edges3d, "front"), wMm: sizeX, hMm: sizeZ, dims: [sizeX, sizeZ] },
    { name: "top", label: "TOP", edges: projectEdges(mesh.positions, edges3d, "top"), wMm: sizeX, hMm: sizeY, dims: [sizeX, sizeY] },
    { name: "right", label: "RIGHT", edges: projectEdges(mesh.positions, edges3d, "right"), wMm: sizeY, hMm: sizeZ, dims: [sizeY, sizeZ] },
  ];

  // Uniform scale so all three views + gaps fit the sheet body.
  const bodyW = SHEET_W - 2 * MARGIN;
  const bodyH = SHEET_H - 2 * MARGIN - TITLE_H;
  // Layout: front + right side by side (sharing height sizeZ), top below front.
  const rowW = views[0].wMm + views[2].wMm;
  const colH = views[0].hMm + views[1].hMm;
  const scale = Math.min(
    (bodyW - 3 * GAP) / Math.max(rowW, 1e-6),
    (bodyH - 3 * GAP) / Math.max(colH, 1e-6),
  );

  const parts: string[] = [];
  const line = (x1: number, y1: number, x2: number, y2: number, cls = "e") =>
    parts.push(`<line class="${cls}" x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}"/>`);
  const text = (x: number, y: number, s: string, cls = "t", anchor = "middle") =>
    parts.push(`<text class="${cls}" x="${x.toFixed(2)}" y="${y.toFixed(2)}" text-anchor="${anchor}">${escapeXml(s)}</text>`);

  /** Render one view at sheet position (ox, oy = top-left of the view box). */
  const renderView = (v: ViewLayout, ox: number, oy: number, minU: number, minV: number) => {
    const h = v.hMm * scale;
    for (const e of v.edges) {
      // Flip vertical: mesh "up" should be up on the sheet.
      line(
        ox + (e.x1 - minU) * scale,
        oy + h - (e.y1 - minV) * scale,
        ox + (e.x2 - minU) * scale,
        oy + h - (e.y2 - minV) * scale,
      );
    }
    const w = v.wMm * scale;
    text(ox + w / 2, oy + h + 58, v.label, "vl");
    // Horizontal dimension (below the view)
    const dy = oy + h + 22;
    line(ox, oy + h + 6, ox, dy + 6, "d");
    line(ox + w, oy + h + 6, ox + w, dy + 6, "d");
    line(ox, dy, ox + w, dy, "d");
    arrow(parts, ox, dy, 1);
    arrow(parts, ox + w, dy, -1);
    text(ox + w / 2, dy - 5, fmtDim(v.dims[0], opts.units), "dt");
    // Vertical dimension (right of the view)
    const dx = ox + w + 22;
    line(ox + w + 6, oy, dx + 6, oy, "d");
    line(ox + w + 6, oy + h, dx + 6, oy + h, "d");
    line(dx, oy, dx, oy + h, "d");
    arrowV(parts, dx, oy, 1);
    arrowV(parts, dx, oy + h, -1);
    parts.push(
      `<text class="dt" x="${(dx + 12).toFixed(2)}" y="${(oy + h / 2).toFixed(2)}" text-anchor="middle" transform="rotate(90 ${(dx + 12).toFixed(2)} ${(oy + h / 2).toFixed(2)})">${escapeXml(fmtDim(v.dims[1], opts.units))}</text>`,
    );
  };

  // View extents in projected coordinates.
  const ext = (edges: ProjectedEdge[]) => {
    let minU = Infinity, minV = Infinity;
    for (const e of edges) {
      minU = Math.min(minU, e.x1, e.x2);
      minV = Math.min(minV, e.y1, e.y2);
    }
    return { minU: Number.isFinite(minU) ? minU : 0, minV: Number.isFinite(minV) ? minV : 0 };
  };

  const fx = MARGIN + GAP / 2;
  const fy = MARGIN + GAP / 2;
  const frontExt = ext(views[0].edges);
  const topExt = ext(views[1].edges);
  const rightExt = ext(views[2].edges);
  renderView(views[0], fx, fy, frontExt.minU, frontExt.minV);
  renderView(views[2], fx + views[0].wMm * scale + GAP * 1.5, fy, rightExt.minU, rightExt.minV);
  renderView(views[1], fx, fy + views[0].hMm * scale + GAP * 1.4, topExt.minU, topExt.minV);

  // Border + title block
  const tbY = SHEET_H - MARGIN - TITLE_H;
  const scaleDenom = scale > 0 ? (1 / scale).toFixed(1) : "?";
  const titleBlock = `
  <rect class="frame" x="${MARGIN}" y="${MARGIN}" width="${SHEET_W - 2 * MARGIN}" height="${SHEET_H - 2 * MARGIN}"/>
  <rect class="frame" x="${MARGIN}" y="${tbY}" width="${SHEET_W - 2 * MARGIN}" height="${TITLE_H}"/>
  <line class="frame" x1="${SHEET_W * 0.45}" y1="${tbY}" x2="${SHEET_W * 0.45}" y2="${tbY + TITLE_H}"/>
  <line class="frame" x1="${SHEET_W * 0.72}" y1="${tbY}" x2="${SHEET_W * 0.72}" y2="${tbY + TITLE_H}"/>
  <text class="tb1" x="${MARGIN + 16}" y="${tbY + 44}" text-anchor="start">${escapeXml(opts.partName)}</text>
  <text class="tb2" x="${MARGIN + 16}" y="${tbY + 78}" text-anchor="start">${escapeXml(opts.planTitle)}</text>
  <text class="tb2" x="${SHEET_W * 0.45 + 16}" y="${tbY + 34}" text-anchor="start">UNITS: ${opts.units === "metric" ? "METRIC (mm)" : "IMPERIAL (in)"}</text>
  <text class="tb2" x="${SHEET_W * 0.45 + 16}" y="${tbY + 62}" text-anchor="start">SCALE 1:${scaleDenom} ${escapeXml(opts.scaleNote ?? "")}</text>
  <text class="tb2" x="${SHEET_W * 0.45 + 16}" y="${tbY + 90}" text-anchor="start">OVERALL: ${escapeXml(`${fmtDim(sizeX, opts.units)} × ${fmtDim(sizeY, opts.units)} × ${fmtDim(sizeZ, opts.units)}`)}</text>
  <text class="tb2" x="${SHEET_W * 0.72 + 16}" y="${tbY + 34}" text-anchor="start">OMNECOR BLUEPRINT STUDIO</text>
  <text class="tb2" x="${SHEET_W * 0.72 + 16}" y="${tbY + 62}" text-anchor="start">${escapeXml(opts.author ?? "")}</text>
  <text class="tb2" x="${SHEET_W * 0.72 + 16}" y="${tbY + 90}" text-anchor="start">${new Date().toISOString().slice(0, 10)}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SHEET_W} ${SHEET_H}" font-family="ui-monospace, Menlo, monospace">
  <style>
    .bg { fill: #ffffff; }
    .e { stroke: #1a2433; stroke-width: 1.6; stroke-linecap: round; }
    .d { stroke: #5b7fa6; stroke-width: 1; }
    .dt { fill: #23405e; font-size: 15px; }
    .vl { fill: #1a2433; font-size: 16px; font-weight: 600; letter-spacing: 2px; }
    .frame { fill: none; stroke: #1a2433; stroke-width: 2; }
    .tb1 { fill: #1a2433; font-size: 26px; font-weight: 700; }
    .tb2 { fill: #3a4a5e; font-size: 14px; }
    .arr { fill: #5b7fa6; }
  </style>
  <rect class="bg" x="0" y="0" width="${SHEET_W}" height="${SHEET_H}"/>
  ${parts.join("\n  ")}
  ${titleBlock}
</svg>`;
}

function arrow(parts: string[], x: number, y: number, dir: 1 | -1) {
  parts.push(`<path class="arr" d="M ${x} ${y} l ${10 * dir} -4 l 0 8 z"/>`);
}
function arrowV(parts: string[], x: number, y: number, dir: 1 | -1) {
  parts.push(`<path class="arr" d="M ${x} ${y} l -4 ${10 * dir} l 8 0 z"/>`);
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);
}

// ---------------------------------------------------------------------------
// Minimal DXF (R12 ASCII, LINE entities) for CAM/CNC handoff
// ---------------------------------------------------------------------------

/** Serialize projected edges of a view to a minimal R12 DXF (mm units). */
export function buildDxf(edges: ProjectedEdge[]): string {
  const lines: string[] = ["0", "SECTION", "2", "ENTITIES"];
  for (const e of edges) {
    lines.push(
      "0", "LINE", "8", "0",
      "10", e.x1.toFixed(4), "20", e.y1.toFixed(4), "30", "0",
      "11", e.x2.toFixed(4), "21", e.y2.toFixed(4), "31", "0",
    );
  }
  lines.push("0", "ENDSEC", "0", "EOF");
  return lines.join("\n");
}
