/**
 * Blueprint Studio — shopping export.
 *
 * Turns the plan's bill of materials into a downloadable CSV (spreadsheet /
 * import into a cart) and a supplier-grouped printable buy-list, with a
 * known-price rollup. Pure + Sovereign-safe — no network, no live pricing.
 */
import type { BlueprintBomItem } from "../../../drizzle/schema.js";

/**
 * RFC-4180 cell escaping with formula-injection (CWE-1236) neutralization.
 *
 * Quotes when the value has a comma/quote/newline. Additionally, when a cell
 * begins with a formula-trigger character (`=`, `+`, `-`, `@`, tab, or CR),
 * prefixes a single quote so spreadsheet apps (Excel/LibreOffice/Sheets) treat
 * it as literal text rather than executing it as a formula. BOM fields
 * (name/spec/supplier/url/notes) are free-text and can be populated by an AI
 * agent from externally-sourced material, so they must not be trusted here.
 */
const csvCell = (v: string | number | null | undefined): string => {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export interface BomExport {
  csv: string;
  /** Human-readable buy-list grouped by supplier, with subtotals + a total. */
  buyList: string;
  /** Rollup of (unitCost × quantity) across lines that have a price. */
  totalUsd: number;
  itemCount: number;
}

export function buildBomExport(items: BlueprintBomItem[], planTitle: string): BomExport {
  const header = ["Name", "Kind", "Spec", "Quantity", "Unit", "Unit Cost (USD)", "Line Cost (USD)", "Supplier", "URL", "Notes"];
  const rows: string[] = [header.map(csvCell).join(",")];
  let total = 0;
  for (const it of items) {
    const priced = it.unitCost != null;
    const line = (it.unitCost ?? 0) * it.quantity;
    if (priced) total += line;
    rows.push(
      [
        it.name,
        it.kind,
        it.spec,
        it.quantity,
        it.unit,
        it.unitCost ?? "",
        priced ? line.toFixed(2) : "",
        it.supplier ?? "",
        it.url ?? "",
        it.notes ?? "",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  const csv = rows.join("\r\n") + "\r\n";

  // Printable buy-list grouped by supplier (insertion order preserved).
  const groups = new Map<string, BlueprintBomItem[]>();
  for (const it of items) {
    const key = it.supplier?.trim() || "Unspecified supplier";
    const arr = groups.get(key);
    if (arr) arr.push(it);
    else groups.set(key, [it]);
  }
  const lines: string[] = [`Shopping list — ${planTitle}`, ""];
  for (const [supplier, list] of groups) {
    lines.push(`${supplier}:`);
    let sub = 0;
    for (const it of list) {
      const priced = it.unitCost != null;
      const lineCost = (it.unitCost ?? 0) * it.quantity;
      if (priced) sub += lineCost;
      const spec = it.spec ? ` (${it.spec})` : "";
      const cost = priced ? ` @ $${it.unitCost} = $${lineCost.toFixed(2)}` : "";
      const url = it.url ? `  ${it.url}` : "";
      lines.push(`  - ${it.quantity} ${it.unit} — ${it.name}${spec}${cost}${url}`);
    }
    lines.push(`  Subtotal: $${sub.toFixed(2)}`, "");
  }
  lines.push(`TOTAL (lines with a known price): $${total.toFixed(2)}`);

  return { csv, buyList: lines.join("\n"), totalUsd: Math.round(total * 100) / 100, itemCount: items.length };
}
