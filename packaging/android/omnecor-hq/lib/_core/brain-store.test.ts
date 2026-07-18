/**
 * Unit tests for the active-brains persistence helper (brain-store).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// In-memory AsyncStorage mock — the module under test only needs get/set.
const store = new Map<string, string>();
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (k: string) => (store.has(k) ? store.get(k)! : null)),
    setItem: vi.fn(async (k: string, v: string) => { store.set(k, v); }),
    removeItem: vi.fn(async (k: string) => { store.delete(k); }),
  },
}));

import { loadActiveBrains, saveActiveBrains } from "./brain-store";

describe("brain-store", () => {
  beforeEach(() => { store.clear(); vi.clearAllMocks(); });

  it("returns [] when nothing is persisted", async () => {
    expect(await loadActiveBrains()).toEqual([]);
  });

  it("round-trips the attached brain ids", async () => {
    await saveActiveBrains(["coding", "pcb"]);
    expect(await loadActiveBrains()).toEqual(["coding", "pcb"]);
  });

  it("dedupes and caps at 16 on save", async () => {
    await saveActiveBrains(["a", "a", "b"]);
    expect(await loadActiveBrains()).toEqual(["a", "b"]);
    const many = Array.from({ length: 20 }, (_, i) => `b${i}`);
    await saveActiveBrains(many);
    expect((await loadActiveBrains()).length).toBe(16);
  });

  it("tolerates a corrupt / non-array payload", async () => {
    store.set("omnecor_active_brains", "{not json");
    expect(await loadActiveBrains()).toEqual([]);
    store.set("omnecor_active_brains", JSON.stringify({ nope: true }));
    expect(await loadActiveBrains()).toEqual([]);
  });

  it("filters non-string entries and caps to 16 on load", async () => {
    store.set("omnecor_active_brains", JSON.stringify(["ok", 5, null, "two"]));
    expect(await loadActiveBrains()).toEqual(["ok", "two"]);
  });
});
