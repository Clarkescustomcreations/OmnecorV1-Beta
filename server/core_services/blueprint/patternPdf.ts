/**
 * Blueprint Studio — true-scale printable sewing/foam pattern PDFs.
 *
 * Takes 2D pattern pieces (mm outlines), applies seam-allowance offsets,
 * nests them onto a virtual sheet, and tiles that sheet across US-Letter
 * pages at exactly 1:1 scale — with registration crosses, a page-join grid
 * (A1/B2…), glue-overlap margins, a 100 mm calibration square, piece labels
 * and grainline arrows. Print at "100% / actual size", verify the calibration
 * square, tape pages by matching grid letters, cut on solid lines, sew on
 * dashed lines.
 */
import PDFDocument from "pdfkit";
import type { PatternPieceSpec } from "@shared/blueprint";

const MM_TO_PT = 72 / 25.4;

// US Letter, 0.5 in margins, 10 mm glue overlap between tiles.
const PAGE_W_MM = 215.9;
const PAGE_H_MM = 279.4;
const MARGIN_MM = 12.7;
const OVERLAP_MM = 10;
const TILE_W_MM = PAGE_W_MM - 2 * MARGIN_MM - OVERLAP_MM; // drawable step per column
const TILE_H_MM = PAGE_H_MM - 2 * MARGIN_MM - OVERLAP_MM;

interface PlacedPiece {
  spec: PatternPieceSpec;
  /** Outline translated into virtual-sheet coordinates (cut line, mm). */
  cut: [number, number][];
  /** Stitch line (original outline) translated, when seam allowance > 0. */
  stitch?: [number, number][];
  labelAt: [number, number];
}

/**
 * Offset a simple polygon outward by `d` mm (miter joins, clamped). Adequate
 * for seam allowances (small offsets on garment/armor outlines); extreme
 * concave geometry may need the allowance drawn manually.
 */
export function offsetPolygon(points: [number, number][], d: number): [number, number][] {
  const n = points.length;
  if (n < 3 || d === 0) return points.slice();
  // Ensure counter-clockwise winding so "outward" is consistent.
  let area = 0;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % n];
    area += x1 * y2 - x2 * y1;
  }
  const pts = area < 0 ? [...points].reverse() : points;

  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n];
    const cur = pts[i];
    const next = pts[(i + 1) % n];
    // Edge normals (outward for CCW = right-hand normal of direction).
    const d1 = norm([cur[0] - prev[0], cur[1] - prev[1]]);
    const d2 = norm([next[0] - cur[0], next[1] - cur[1]]);
    const n1: [number, number] = [d1[1], -d1[0]];
    const n2: [number, number] = [d2[1], -d2[0]];
    // Miter direction = normalized sum of normals.
    let mx = n1[0] + n2[0];
    let my = n1[1] + n2[1];
    const mlen = Math.hypot(mx, my);
    if (mlen < 1e-9) {
      // 180° spike — fall back to a single normal.
      mx = n1[0];
      my = n1[1];
    } else {
      mx /= mlen;
      my /= mlen;
    }
    // Miter length so the offset edge stays d away: d / cos(θ/2), clamped ×4.
    const cosHalf = Math.max(0.25, mx * n1[0] + my * n1[1]);
    const ml = Math.min(d / cosHalf, d * 4);
    out.push([cur[0] + mx * ml, cur[1] + my * ml]);
  }
  return out;
}

function norm(v: [number, number]): [number, number] {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
}

function bounds(points: [number, number][]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

/** Shelf-nest pieces onto a virtual sheet `sheetWmm` wide. Returns placements. */
function layoutPieces(pieces: PatternPieceSpec[], sheetWmm: number, gapMm = 15): { placed: PlacedPiece[]; sheetHmm: number } {
  interface Prepared {
    spec: PatternPieceSpec;
    cutLocal: [number, number][];
    stitchLocal?: [number, number][];
    w: number;
    h: number;
  }
  const prepared: Prepared[] = pieces.map((spec) => {
    const raw = spec.outline.points;
    const sa = spec.seamAllowanceMm ?? 0;
    const cut = sa > 0 ? offsetPolygon(raw, sa) : raw;
    const b = bounds(cut);
    const shift = (pts: [number, number][]): [number, number][] => pts.map(([x, y]) => [x - b.minX, y - b.minY]);
    return {
      spec,
      cutLocal: shift(cut),
      stitchLocal: sa > 0 ? shift(raw) : undefined,
      w: b.w,
      h: b.h,
    };
  });
  prepared.sort((a, b) => b.h - a.h);

  const placed: PlacedPiece[] = [];
  let shelfY = 0, shelfH = 0, cursorX = 0;
  for (const p of prepared) {
    if (cursorX > 0 && cursorX + p.w > sheetWmm) {
      shelfY += shelfH + gapMm;
      shelfH = 0;
      cursorX = 0;
    }
    const ox = cursorX, oy = shelfY;
    const move = (pts: [number, number][]): [number, number][] => pts.map(([x, y]) => [x + ox, y + oy]);
    const cut = move(p.cutLocal);
    placed.push({
      spec: p.spec,
      cut,
      stitch: p.stitchLocal ? move(p.stitchLocal) : undefined,
      labelAt: [ox + p.w / 2, oy + p.h / 2],
    });
    cursorX += p.w + gapMm;
    shelfH = Math.max(shelfH, p.h);
  }
  return { placed, sheetHmm: shelfY + shelfH };
}

/** Render the tiled 1:1 pattern PDF. Resolves to the PDF bytes. */
export async function buildPatternPdf(
  pieces: PatternPieceSpec[],
  opts: { planTitle: string; setName: string },
): Promise<Buffer> {
  if (pieces.length === 0) throw new Error("No pattern pieces supplied.");
  const widest = Math.max(...pieces.map((p) => bounds(p.outline.points).w + 2 * (p.seamAllowanceMm ?? 0)));
  const cols0 = Math.max(1, Math.ceil(widest / TILE_W_MM));
  // Prefer a 2-column virtual sheet unless a single piece needs more.
  const sheetWmm = Math.max(cols0, 2) * TILE_W_MM;
  const { placed, sheetHmm } = layoutPieces(pieces, sheetWmm);
  const cols = Math.max(1, Math.ceil(sheetWmm / TILE_W_MM));
  const rows = Math.max(1, Math.ceil(sheetHmm / TILE_H_MM));

  const doc = new PDFDocument({ size: "LETTER", margin: 0, autoFirstPage: false });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const mm = (v: number) => v * MM_TO_PT;

  // ── Cover / calibration page ────────────────────────────────────────────
  doc.addPage();
  doc.font("Helvetica-Bold").fontSize(20).text(`${opts.planTitle} — ${opts.setName}`, mm(15), mm(18));
  doc.font("Helvetica").fontSize(11).text(
    [
      `Pattern pieces: ${pieces.length}   ·   Tiled pages: ${cols * rows} (${cols} across × ${rows} down)`,
      "",
      "1. Print ALL pages at 100% / Actual Size — never 'fit to page'.",
      "2. Check the calibration square below measures exactly 100 mm before cutting anything.",
      "3. Tape pages edge-to-edge matching the grid labels (A1, B1, …), aligning the cross marks.",
      "4. CUT on solid lines. SEW on dashed lines. Arrows show the grainline / EVA-stretch direction.",
    ].join("\n"),
    mm(15),
    mm(32),
    { width: mm(180) },
  );
  // 100 mm calibration square
  doc.save().lineWidth(1.2).rect(mm(15), mm(95), mm(100), mm(100)).stroke("#111827").restore();
  doc.fontSize(10).text("Calibration square — must measure exactly 100 × 100 mm (4 in ≈ 101.6 mm is WRONG)", mm(15), mm(198));
  // Piece list
  doc.font("Helvetica-Bold").fontSize(12).text("Pieces:", mm(15), mm(212));
  doc.font("Helvetica").fontSize(10);
  placed.forEach((p, i) => {
    const sa = p.spec.seamAllowanceMm ?? 0;
    doc.text(
      `${i + 1}. ${p.spec.name}${sa > 0 ? ` (+${sa} mm seam allowance)` : ""}${p.spec.cutNote ? ` — ${p.spec.cutNote}` : ""}`,
      mm(18),
      mm(220 + i * 6),
    );
  });

  // ── Tile pages ──────────────────────────────────────────────────────────
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      doc.addPage();
      const gridLabel = `${String.fromCharCode(65 + col)}${row + 1}`;
      // Window of the virtual sheet shown on this page (with glue overlap).
      const winX = col * TILE_W_MM;
      const winY = row * TILE_H_MM;

      // Clip to the printable area.
      doc.save();
      doc.rect(mm(MARGIN_MM), mm(MARGIN_MM), mm(TILE_W_MM + OVERLAP_MM), mm(TILE_H_MM + OVERLAP_MM)).clip();
      // Transform: virtual-sheet mm → page pt.
      const tx = (x: number) => mm(MARGIN_MM + (x - winX));
      const ty = (y: number) => mm(MARGIN_MM + (y - winY));

      for (const piece of placed) {
        drawPolyline(doc, piece.cut, tx, ty, { dashed: false });
        if (piece.stitch) drawPolyline(doc, piece.stitch, tx, ty, { dashed: true });
        // Label + grainline at the centroid (drawn on every page whose window
        // contains it; the clip handles partial visibility).
        const [lx, ly] = piece.labelAt;
        doc.font("Helvetica-Bold").fontSize(12).fillColor("#111827")
          .text(piece.spec.name, tx(lx) - 60, ty(ly) - 14, { width: 120, align: "center" });
        if (piece.spec.cutNote)
          doc.font("Helvetica").fontSize(8).text(piece.spec.cutNote, tx(lx) - 60, ty(ly), { width: 120, align: "center" });
        const ang = ((piece.spec.grainlineDeg ?? 90) * Math.PI) / 180;
        const gx = Math.cos(ang) * mm(20), gy = -Math.sin(ang) * mm(20);
        const cx0 = tx(lx) - gx / 2, cy0 = ty(ly) + mm(8) - gy / 2;
        doc.save().lineWidth(1).strokeColor("#374151")
          .moveTo(cx0, cy0).lineTo(cx0 + gx, cy0 + gy).stroke().restore();
      }
      doc.restore();

      // Registration crosses at the tile corners + grid label.
      const crosses: [number, number][] = [
        [MARGIN_MM, MARGIN_MM],
        [MARGIN_MM + TILE_W_MM, MARGIN_MM],
        [MARGIN_MM, MARGIN_MM + TILE_H_MM],
        [MARGIN_MM + TILE_W_MM, MARGIN_MM + TILE_H_MM],
      ];
      doc.save().lineWidth(0.6).strokeColor("#6b7280");
      for (const [cxMm, cyMm] of crosses) {
        doc.moveTo(mm(cxMm) - 8, mm(cyMm)).lineTo(mm(cxMm) + 8, mm(cyMm)).stroke();
        doc.moveTo(mm(cxMm), mm(cyMm) - 8).lineTo(mm(cxMm), mm(cyMm) + 8).stroke();
      }
      doc.restore();
      doc.font("Helvetica-Bold").fontSize(14).fillColor("#6b7280")
        .text(gridLabel, mm(PAGE_W_MM) - mm(22), mm(PAGE_H_MM) - mm(10), { lineBreak: false });
      doc.font("Helvetica").fontSize(8)
        .text(`${opts.planTitle} — ${opts.setName} — 100% scale`, mm(MARGIN_MM), mm(PAGE_H_MM) - mm(10), { lineBreak: false });
    }
  }

  doc.end();
  return done;
}

function drawPolyline(
  doc: PDFKit.PDFDocument,
  pts: [number, number][],
  tx: (x: number) => number,
  ty: (y: number) => number,
  opts: { dashed: boolean },
) {
  if (pts.length < 2) return;
  doc.save().lineWidth(opts.dashed ? 0.8 : 1.4).strokeColor(opts.dashed ? "#374151" : "#111827");
  if (opts.dashed) doc.dash(6, { space: 4 });
  doc.moveTo(tx(pts[0][0]), ty(pts[0][1]));
  for (let i = 1; i < pts.length; i++) doc.lineTo(tx(pts[i][0]), ty(pts[i][1]));
  doc.closePath().stroke();
  if (opts.dashed) doc.undash();
  doc.restore();
}
