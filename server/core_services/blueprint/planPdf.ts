/**
 * Blueprint Studio — full Build Plan PDF export.
 *
 * Assembles the persistent plan document into a printable booklet: cover +
 * overview, bill of materials with cost rollup, cut list with angles,
 * embedded blueprint drawings (vector — via svg-to-pdfkit), assembly steps,
 * simulation summary, and safety notes.
 */
import PDFDocument from "pdfkit";
import SVGtoPDF from "svg-to-pdfkit";
import type {
  BlueprintBomItem,
  BlueprintCutItem,
  BlueprintPlan,
  BlueprintSimResult,
} from "../../../drizzle/schema.js";

const PAGE_W = 612; // Letter, pt
const MARGIN = 46;
const CONTENT_W = PAGE_W - 2 * MARGIN;

const fmtLen = (mm: number | null, units: string): string => {
  if (mm === null || mm === undefined) return "—";
  if (units === "metric") return mm >= 1000 ? `${(mm / 1000).toFixed(2)} m` : `${mm.toFixed(1)} mm`;
  const inches = mm / 25.4;
  if (inches < 12) return `${inches.toFixed(2)}"`;
  const ft = Math.floor(inches / 12);
  const rem = inches - ft * 12;
  return rem < 0.05 ? `${ft}'` : `${ft}' ${rem.toFixed(1)}"`;
};

const fmtAngle = (d: number | null): string => (d === null || d === undefined || d === 0 ? "square" : `${d.toFixed(1)}°`);

/**
 * PDFKit's built-in Helvetica is WinAnsi-encoded — Greek letters, math
 * symbols and superscript 4 (all used in calc `workings`) fall outside it and
 * render as mojibake. Transliterate to ASCII-safe equivalents for PDF body
 * text (the web UI renders the originals fine).
 */
const WINANSI_MAP: [RegExp, string][] = [
  [/σ/g, "sigma"],
  [/τ/g, "tau"],
  [/δ/g, "delta"],
  [/π/g, "pi"],
  [/⁴/g, "^4"],
  [/√/g, "sqrt"],
  [/≤/g, "<="],
  [/≥/g, ">="],
  [/→/g, "->"],
  [/·/g, "*"],
  [/✓/g, ""],
  [/✗/g, ""],
  [/Ø/g, "dia "],
  [/⚠/g, "!"],
  // Typographic punctuation above U+00FF — swap to ASCII so the catch-all
  // below never mangles it.
  [/[—–]/g, "-"],
  [/[“”]/g, '"'],
  [/[‘’]/g, "'"],
  [/…/g, "..."],
];

function winAnsi(s: string): string {
  let out = s;
  for (const [re, repl] of WINANSI_MAP) out = out.replace(re, repl);
  // Anything else outside Latin-1 becomes "?" rather than mojibake.
  // eslint-disable-next-line no-control-regex
  return out.replace(/[^\x00-\xFF]/g, "?");
}

export interface PlanPdfInput {
  plan: BlueprintPlan;
  bomItems: BlueprintBomItem[];
  cutItems: BlueprintCutItem[];
  simResults: BlueprintSimResult[];
  /** Drawing SVG strings to embed (name + svg markup). */
  drawings: { name: string; svg: string }[];
  /** Concept render images (PNG/JPEG bytes). */
  conceptImages?: { name: string; data: Buffer }[];
}

export async function buildPlanPdf(input: PlanPdfInput): Promise<Buffer> {
  const { plan } = input;
  const doc = new PDFDocument({ size: "LETTER", margin: MARGIN, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const h1 = (s: string) => doc.font("Helvetica-Bold").fontSize(22).fillColor("#111827").text(winAnsi(s));
  const h2 = (s: string) => {
    if (doc.y > doc.page.height - 140) doc.addPage();
    doc.moveDown(0.8);
    doc.font("Helvetica-Bold").fontSize(15).fillColor("#111827").text(s);
    doc.moveTo(MARGIN, doc.y + 2).lineTo(MARGIN + CONTENT_W, doc.y + 2).lineWidth(1).strokeColor("#9ca3af").stroke();
    doc.moveDown(0.5);
  };
  const body = (s: string) => doc.font("Helvetica").fontSize(10.5).fillColor("#1f2937").text(winAnsi(s), { width: CONTENT_W });

  // ── Cover ──────────────────────────────────────────────────────────────
  h1(plan.title);
  doc.moveDown(0.2);
  doc.font("Helvetica").fontSize(11).fillColor("#4b5563").text(
    `Build Plan · ${plan.category.replace("_", " ")} · ${plan.units} units · generated ${new Date().toISOString().slice(0, 10)} by Omnecor Blueprint Studio`,
  );
  if (plan.brief) {
    doc.moveDown(0.6);
    doc.font("Helvetica-Oblique").fontSize(10.5).fillColor("#374151").text(winAnsi(`Brief: ${plan.brief}`), { width: CONTENT_W });
  }
  if (input.conceptImages?.length) {
    for (const img of input.conceptImages.slice(0, 2)) {
      try {
        doc.moveDown(0.6);
        doc.image(img.data, { fit: [CONTENT_W, 260], align: "center" });
      } catch {
        /* unsupported image format — skip, the plan text is the deliverable */
      }
    }
  }

  // ── Overview ───────────────────────────────────────────────────────────
  if (plan.overview) {
    h2("Overview");
    body(stripMarkdown(plan.overview));
  }

  // ── Bill of Materials ──────────────────────────────────────────────────
  if (input.bomItems.length > 0) {
    h2("Bill of Materials");
    const cols = [0.3, 0.24, 0.1, 0.08, 0.13, 0.15]; // name, spec, qty, unit, unit cost, line total
    tableHeader(doc, ["Item", "Spec", "Qty", "Unit", "Unit cost", "Line total"], cols);
    let total = 0;
    for (const item of [...input.bomItems].sort((a, b) => a.sortOrder - b.sortOrder)) {
      const line = item.unitCost !== null && item.unitCost !== undefined ? item.unitCost * item.quantity : null;
      if (line !== null) total += line;
      tableRow(
        doc,
        [
          `${item.name}${item.kind !== "material" ? `  (${item.kind})` : ""}`,
          item.spec || "—",
          String(item.quantity),
          item.unit,
          item.unitCost !== null && item.unitCost !== undefined ? `$${item.unitCost.toFixed(2)}` : "—",
          line !== null ? `$${line.toFixed(2)}` : "—",
        ],
        cols,
      );
    }
    doc.moveDown(0.3);
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#111827")
      .text(`Estimated material cost: $${total.toFixed(2)} (planning estimate — verify live prices)`, { align: "right", width: CONTENT_W });
  }

  // ── Cut List ───────────────────────────────────────────────────────────
  if (input.cutItems.length > 0) {
    h2("Cut List");
    const cols = [0.26, 0.2, 0.07, 0.15, 0.16, 0.16];
    tableHeader(doc, ["Part", "From stock", "Qty", "Length", "End 1", "End 2"], cols);
    for (const item of [...input.cutItems].sort((a, b) => a.sortOrder - b.sortOrder)) {
      tableRow(
        doc,
        [
          item.partLabel,
          item.stockName || "—",
          String(item.quantity),
          fmtLen(item.lengthMm, plan.units),
          `${fmtAngle(item.miter1Deg)}${item.bevel1Deg ? ` / ${fmtAngle(item.bevel1Deg)}` : ""}`,
          `${fmtAngle(item.miter2Deg)}${item.bevel2Deg ? ` / ${fmtAngle(item.bevel2Deg)}` : ""}`,
        ],
        cols,
      );
      if (item.notes) {
        // Explicit x: after tableRow the cursor sits at the last column.
        doc.font("Helvetica-Oblique").fontSize(8.5).fillColor("#6b7280").text(winAnsi(item.notes), MARGIN + 14, doc.y, { width: CONTENT_W - 14 });
      }
    }
  }

  // ── Drawings ───────────────────────────────────────────────────────────
  for (const drawing of input.drawings) {
    doc.addPage({ layout: "landscape", margin: 24 });
    try {
      SVGtoPDF(doc, drawing.svg, 24, 24, { width: doc.page.width - 48, height: doc.page.height - 48, preserveAspectRatio: "xMidYMid meet" });
    } catch {
      doc.font("Helvetica").fontSize(11).text(`(Drawing "${drawing.name}" could not be embedded — open the SVG file directly.)`, 24, 40);
    }
  }
  if (input.drawings.length > 0) doc.addPage({ layout: "portrait", margin: MARGIN });

  // ── Assembly steps ─────────────────────────────────────────────────────
  const steps = plan.assemblySteps ?? [];
  if (steps.length > 0) {
    h2("Assembly Instructions");
    steps.forEach((step, i) => {
      if (doc.y > doc.page.height - 120) doc.addPage();
      doc.font("Helvetica-Bold").fontSize(11.5).fillColor("#111827").text(winAnsi(`${i + 1}. ${step.title}`));
      doc.font("Helvetica").fontSize(10).fillColor("#1f2937").text(winAnsi(step.detail), { width: CONTENT_W, indent: 14 });
      if (step.parts?.length)
        doc.font("Helvetica-Oblique").fontSize(9).fillColor("#4b5563").text(winAnsi(`Parts: ${step.parts.join(", ")}`), { indent: 14 });
      if (step.tools?.length)
        doc.font("Helvetica-Oblique").fontSize(9).fillColor("#4b5563").text(winAnsi(`Tools: ${step.tools.join(", ")}`), { indent: 14 });
      doc.moveDown(0.4);
    });
  }

  // ── Simulation summary ─────────────────────────────────────────────────
  const completedSims = input.simResults.filter((s) => s.status === "completed");
  if (completedSims.length > 0) {
    h2("Structural Verification");
    for (const sim of completedSims) {
      const res = (sim.results ?? {}) as Record<string, unknown>;
      const sf = typeof res.safetyFactor === "number" ? ` — safety factor ${(res.safetyFactor as number).toFixed(2)}` : "";
      const pass = res.pass === true ? " — PASS" : res.pass === false ? " — REVIEW" : "";
      doc.font("Helvetica-Bold").fontSize(10.5).fillColor(res.pass === false ? "#b91c1c" : "#111827").text(winAnsi(`${sim.kind.toUpperCase()}: ${sim.name}${sf}${pass}`));
      const workings = Array.isArray(res.workings) ? (res.workings as string[]) : [];
      for (const line of workings)
        doc.font("Helvetica").fontSize(8.5).fillColor("#4b5563").text(winAnsi(line), { indent: 14, width: CONTENT_W });
      doc.moveDown(0.3);
    }
  }

  // ── Safety notes ───────────────────────────────────────────────────────
  h2("Safety Notes & Disclaimer");
  if (plan.safetyNotes) body(stripMarkdown(plan.safetyNotes));
  doc.moveDown(0.4);
  doc.font("Helvetica-Oblique").fontSize(9).fillColor("#6b7280").text(
    "This plan was produced with AI assistance and deterministic engineering calculations for personal fabrication. " +
      "It is not a substitute for a licensed engineer or local building/vehicle codes. Verify all dimensions before cutting; " +
      "wear appropriate PPE; check structural elements against your jurisdiction's requirements.",
    { width: CONTENT_W },
  );

  // Page numbers
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.font("Helvetica").fontSize(8).fillColor("#9ca3af")
      .text(`${plan.title} — page ${i + 1} of ${range.count}`, MARGIN, doc.page.height - 30, { lineBreak: false });
  }

  doc.end();
  return done;
}

function tableHeader(doc: PDFKit.PDFDocument, labels: string[], colFracs: number[]) {
  if (doc.y > doc.page.height - 120) doc.addPage();
  const y = doc.y;
  let x = MARGIN;
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#374151");
  let maxH = 12;
  labels.forEach((label, i) => {
    const w = CONTENT_W * colFracs[i] - 6;
    maxH = Math.max(maxH, doc.heightOfString(label, { width: w }));
    doc.text(winAnsi(label), x, y, { width: w });
    x += CONTENT_W * colFracs[i];
  });
  doc.moveTo(MARGIN, y + maxH + 2).lineTo(MARGIN + CONTENT_W, y + maxH + 2).lineWidth(0.7).strokeColor("#9ca3af").stroke();
  doc.y = y + maxH + 6;
}

function tableRow(doc: PDFKit.PDFDocument, cells: string[], colFracs: number[]) {
  if (doc.y > doc.page.height - 80) doc.addPage();
  const y = doc.y;
  let x = MARGIN;
  doc.font("Helvetica").fontSize(9).fillColor("#1f2937");
  let maxH = 0;
  cells.forEach((cell, i) => {
    const w = CONTENT_W * colFracs[i] - 6;
    const text = winAnsi(cell);
    const h = doc.heightOfString(text, { width: w });
    doc.text(text, x, y, { width: w });
    maxH = Math.max(maxH, h);
    x += CONTENT_W * colFracs[i];
  });
  doc.y = y + maxH + 4;
}

/** Light markdown → plain text for PDF body copy. */
function stripMarkdown(md: string): string {
  return md
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
}
