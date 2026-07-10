/**
 * Batch C — Item 3: ValetRouterService
 *
 * Tests the rule-based static fallback path that activates whenever the Python
 * Valet Router inference server is offline (fetch throws / returns non-ok).
 * The model-based routing path requires a running GGUF server and is
 * 🌐 MANUAL REQUIRED.
 *
 * Covers:
 *   route(): offline fallback respects preferredMode, uses first availableProvider,
 *     confidence=0.5, category="local_task", requiresTodoMd/requiresStatusMd=false
 *   getModes(): returns static list when server is offline
 *   isAvailable(): returns false when server unreachable
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ValetRouterService } from "../core_services/services/ValetRouterService.js";

function makeOfflineFetch() {
  return vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
}

beforeEach(() => {
  // Force a fresh singleton so the `available` cache does not bleed between tests
  (ValetRouterService as any).instance = null;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── isAvailable ───────────────────────────────────────────────────────────────

describe("ValetRouterService.isAvailable", () => {
  it("returns false when server is unreachable", async () => {
    vi.stubGlobal("fetch", makeOfflineFetch());
    const svc = ValetRouterService.getInstance();
    expect(await svc.isAvailable()).toBe(false);
  });

  it("returns false when server returns non-ok status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    const svc = ValetRouterService.getInstance();
    expect(await svc.isAvailable()).toBe(false);
  });
});

// ── route() — offline fallback ────────────────────────────────────────────────

describe("ValetRouterService.route — offline fallback", () => {
  it("returns a valid RouteDecision when server is offline", async () => {
    vi.stubGlobal("fetch", makeOfflineFetch());
    const svc = ValetRouterService.getInstance();
    const result = await svc.route({ task: "write some code" });

    expect(result).toMatchObject({
      category: "local_task",
      confidence: 0.5,
      localCapable: true,
      costTier: "free",
      requiresTodoMd: false,
      requiresStatusMd: false,
    });
    expect(result.reasoning).toMatch(/offline|fallback/i);
  });

  it("respects preferredMode in fallback", async () => {
    vi.stubGlobal("fetch", makeOfflineFetch());
    const svc = ValetRouterService.getInstance();
    const result = await svc.route({ task: "test", preferredMode: "moe_chain" });
    expect(result.mode).toBe("moe_chain");
  });

  it("defaults to main_api mode when no preferredMode supplied", async () => {
    vi.stubGlobal("fetch", makeOfflineFetch());
    const svc = ValetRouterService.getInstance();
    const result = await svc.route({ task: "test" });
    expect(result.mode).toBe("main_api");
  });

  it("uses the first available provider as primaryProvider", async () => {
    vi.stubGlobal("fetch", makeOfflineFetch());
    const svc = ValetRouterService.getInstance();
    const result = await svc.route({
      task: "test",
      availableProviders: ["claude", "gpt-4", "gemini"],
    });
    expect(result.primaryProvider).toBe("claude");
    expect(result.secondaryProviders).toEqual(["gpt-4", "gemini"]);
  });

  it("defaults primaryProvider to 'ollama' when no providers are given", async () => {
    vi.stubGlobal("fetch", makeOfflineFetch());
    const svc = ValetRouterService.getInstance();
    const result = await svc.route({ task: "test" });
    expect(result.primaryProvider).toBe("ollama");
    expect(result.secondaryProviders).toEqual([]);
  });

  it("falls back gracefully when server returns HTTP error", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503 }) // isAvailable → false
    );
    const svc = ValetRouterService.getInstance();
    const result = await svc.route({ task: "test" });
    expect(result.confidence).toBe(0.5);
  });
});

// ── getModes() — static list ──────────────────────────────────────────────────

describe("ValetRouterService.getModes — offline", () => {
  it("returns a non-empty static list when server is offline", async () => {
    vi.stubGlobal("fetch", makeOfflineFetch());
    const svc = ValetRouterService.getInstance();
    const modes = await svc.getModes();
    expect(modes.length).toBeGreaterThan(0);
    expect(modes.every(m => m.id && m.label && m.description)).toBe(true);
  });

  it("includes expected routing modes in the static list", async () => {
    vi.stubGlobal("fetch", makeOfflineFetch());
    const svc = ValetRouterService.getInstance();
    const modes = await svc.getModes();
    const ids = modes.map(m => m.id);
    expect(ids).toContain("api_direct");
    expect(ids).toContain("main_api");
    expect(ids).toContain("moe_chain");
    expect(ids).toContain("sub_agent_harness");
  });
});
