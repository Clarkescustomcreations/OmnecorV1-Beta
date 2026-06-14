import { safeStorage } from "@/lib/safeStorage";

const STORAGE_KEY = "omnecor_font_size";
export const DEFAULT_FONT_SIZE = 14;
const MIN_FONT_SIZE = 12;
const MAX_FONT_SIZE = 18;

function clamp(size: number): number {
  if (!Number.isFinite(size)) return DEFAULT_FONT_SIZE;
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(size)));
}

/** Read the persisted base font size, falling back to the default. */
export function getStoredFontSize(): number {
  const raw = safeStorage.getItem(STORAGE_KEY);
  return raw ? clamp(Number(raw)) : DEFAULT_FONT_SIZE;
}

/**
 * Apply a base font size to the document root. Tailwind's rem-based sizing
 * scales the whole UI relative to this value. Optionally persist it so the
 * preference survives a reload.
 */
export function applyFontSize(size: number, persist = true): void {
  const clamped = clamp(size);
  if (typeof document !== "undefined") {
    document.documentElement.style.fontSize = `${clamped}px`;
  }
  if (persist) {
    safeStorage.setItem(STORAGE_KEY, String(clamped));
  }
}
