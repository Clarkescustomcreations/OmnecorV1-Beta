/**
 * Batch C — Item 2: MoeChainService
 *
 * Covers cloud chain execution:
 *   - all enabled steps run in sorted order
 *   - disabled steps are skipped
 *   - steps filtered by taskCategory
 *   - rolling context accumulates all prior step outputs
 *   - onChunk receives status headers + final content
 *   - throws when no active steps match
 *   - sovereign mode blocks cloud steps
 *
 * Local steps (LlamaCppService) require a loaded GGUF; they are tested via
 * mocked LlamaCppService to verify the call contract.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MoeChainStep } from "../../drizzle/schema.js";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../_core/sovereign.js", () => ({
  isSovereignMode: vi.fn().mockReturnValue(false),
}));

const mockGenerate = vi.fn();
const mockUnload = vi.fn().mockResolvedValue(undefined);
const mockPreWarm = vi.fn().mockResolvedValue(undefined);

vi.mock("../phase2/services/LlamaCppService.js", () => ({
  LlamaCppService: {
    getInstance: () => ({
      generate: mockGenerate,
      unload: mockUnload,
      preWarm: mockPreWarm,
    }),
  },
}));

const mockChat = vi.fn();
vi.mock("../phase2/services/AiProviderService.js", () => ({
  AiProviderService: {
    getInstance: () => ({ chat: mockChat }),
  },
}));

import { MoeChainService } from "../phase2/services/MoeChainService.js";
import { isSovereignMode } from "../_core/sovereign.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeStep(overrides: Partial<MoeChainStep> = {}): MoeChainStep {
  return {
    order: 1,
    label: "Test Step",
    taskCategories: [],
    enabled: true,
    providerId: "openai",
    modelId: "gpt-4o",
    ...overrides,
  };
}

function makeCtx(overrides: Partial<{
  taskCategory: string;
  executionMode: string;
}> = {}) {
  return {
    messages: [{ role: "user" as const, content: "Hello" }],
    ...overrides,
  };
}

type Chunk = { content: string; done: boolean };

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.mocked(isSovereignMode).mockReturnValue(false);
  mockChat.mockReset();
  mockGenerate.mockReset();
  mockUnload.mockReset().mockResolvedValue(undefined);
  mockPreWarm.mockReset().mockResolvedValue(undefined);
  (MoeChainService as any).instance = null;
});

// ── Cloud chain ───────────────────────────────────────────────────────────────

describe("MoeChainService.execute — cloud chain", () => {
  it("runs all enabled steps in sorted order and returns last output", async () => {
    mockChat
      .mockResolvedValueOnce("Step 1 output")
      .mockResolvedValueOnce("Step 2 output");

    const steps: MoeChainStep[] = [
      makeStep({ order: 2, label: "Step B" }),
      makeStep({ order: 1, label: "Step A" }),
    ];
    const result = await MoeChainService.getInstance().execute(
      steps, "cloud", makeCtx(), () => {}
    );

    expect(result.output).toBe("Step 2 output");
    expect(result.stepsRan).toBe(2);
    expect(result.stepsSkipped).toBe(0);
    // Step A (order 1) must run before Step B (order 2)
    expect(mockChat.mock.calls[0]![0].messages[0]!.content).toBe("Hello");
  });

  it("skips disabled steps and counts them correctly", async () => {
    mockChat.mockResolvedValueOnce("active output");

    const steps: MoeChainStep[] = [
      makeStep({ order: 1, label: "Active", enabled: true }),
      makeStep({ order: 2, label: "Disabled", enabled: false }),
    ];
    const result = await MoeChainService.getInstance().execute(
      steps, "cloud", makeCtx(), () => {}
    );

    expect(result.stepsRan).toBe(1);
    expect(mockChat).toHaveBeenCalledTimes(1);
  });

  it("filters steps by taskCategory — only matching steps run", async () => {
    mockChat.mockResolvedValueOnce("code output");

    const steps: MoeChainStep[] = [
      makeStep({ order: 1, label: "Code", taskCategories: ["code_generation"] }),
      makeStep({ order: 2, label: "Research", taskCategories: ["research"] }),
    ];
    const result = await MoeChainService.getInstance().execute(
      steps, "cloud", makeCtx({ taskCategory: "code_generation" }), () => {}
    );

    expect(result.stepsRan).toBe(1);
    expect(result.stepsSkipped).toBe(1);
    expect(mockChat).toHaveBeenCalledTimes(1);
  });

  it("runs all steps when taskCategory is not set (empty categories always run)", async () => {
    mockChat
      .mockResolvedValueOnce("out1")
      .mockResolvedValueOnce("out2");

    const steps: MoeChainStep[] = [
      makeStep({ order: 1, taskCategories: ["code_generation"] }),
      makeStep({ order: 2, taskCategories: ["research"] }),
    ];
    const result = await MoeChainService.getInstance().execute(
      steps, "cloud", makeCtx(), // no taskCategory
      () => {}
    );

    expect(result.stepsRan).toBe(2);
  });

  it("accumulates rolling context — second step receives first step's assistant output", async () => {
    mockChat
      .mockResolvedValueOnce("first output")
      .mockResolvedValueOnce("second output");

    const steps: MoeChainStep[] = [
      makeStep({ order: 1, label: "Step A" }),
      makeStep({ order: 2, label: "Step B" }),
    ];
    await MoeChainService.getInstance().execute(steps, "cloud", makeCtx(), () => {});

    const secondCallMessages = (mockChat.mock.calls[1]![0] as { messages: Array<{ role: string; content: string }> }).messages;
    const hasFirstOutput = secondCallMessages.some(
      m => m.role === "assistant" && m.content === "first output"
    );
    expect(hasFirstOutput).toBe(true);
  });

  it("onChunk receives status headers and final content", async () => {
    mockChat
      .mockResolvedValueOnce("step A result")
      .mockResolvedValueOnce("step B result");

    const steps: MoeChainStep[] = [
      makeStep({ order: 1, label: "Alpha" }),
      makeStep({ order: 2, label: "Beta" }),
    ];
    const chunks: Chunk[] = [];
    await MoeChainService.getInstance().execute(
      steps, "cloud", makeCtx(),
      (chunk) => chunks.push(chunk)
    );

    // Status chunks (one per step)
    const statusChunks = chunks.filter(c => c.content.includes("MoE Chain"));
    expect(statusChunks.length).toBe(2);
    expect(statusChunks[0]!.content).toContain("Alpha");
    expect(statusChunks[1]!.content).toContain("Beta");

    // Final content chunk (last step output)
    const contentChunks = chunks.filter(c => c.content === "step B result");
    expect(contentChunks.length).toBe(1);

    // done:true terminal chunk
    const doneChunk = chunks.find(c => c.done);
    expect(doneChunk).toBeDefined();
  });

  it("throws when all steps are filtered by taskCategory — no active steps", async () => {
    const steps: MoeChainStep[] = [
      makeStep({ order: 1, taskCategories: ["research"] }),
    ];
    await expect(
      MoeChainService.getInstance().execute(
        steps, "cloud", makeCtx({ taskCategory: "code_generation" }), () => {}
      )
    ).rejects.toThrow("no active steps");
  });

  it("throws when all steps are disabled", async () => {
    const steps: MoeChainStep[] = [
      makeStep({ order: 1, enabled: false }),
    ];
    await expect(
      MoeChainService.getInstance().execute(steps, "cloud", makeCtx(), () => {})
    ).rejects.toThrow("no active steps");
  });

  it("blocks cloud chain steps when sovereign mode is active", async () => {
    vi.mocked(isSovereignMode).mockReturnValue(true);

    const steps: MoeChainStep[] = [makeStep({ order: 1 })];
    await expect(
      MoeChainService.getInstance().execute(
        steps, "cloud", makeCtx({ executionMode: "sovereign" }), () => {}
      )
    ).rejects.toThrow(/sovereign/i);
  });
});

// ── Local chain ───────────────────────────────────────────────────────────────

describe("MoeChainService.execute — local chain", () => {
  it("calls LlamaCppService.generate with the model path and prompt", async () => {
    mockGenerate.mockResolvedValueOnce("llama output");

    const steps: MoeChainStep[] = [
      makeStep({ order: 1, label: "Local", modelPath: "/models/expert.gguf" }),
    ];
    const result = await MoeChainService.getInstance().execute(
      steps, "local", makeCtx(), () => {}
    );

    expect(result.output).toBe("llama output");
    expect(mockGenerate).toHaveBeenCalledOnce();
    const [prompt, modelPath] = mockGenerate.mock.calls[0]!;
    expect(modelPath).toBe("/models/expert.gguf");
    expect(typeof prompt).toBe("string");
    expect(prompt).toContain("Hello"); // user message in prompt
  });

  it("unloads model between steps to free RAM", async () => {
    mockGenerate
      .mockResolvedValueOnce("out1")
      .mockResolvedValueOnce("out2");

    const steps: MoeChainStep[] = [
      makeStep({ order: 1, modelPath: "/models/a.gguf" }),
      makeStep({ order: 2, modelPath: "/models/b.gguf" }),
    ];
    await MoeChainService.getInstance().execute(steps, "local", makeCtx(), () => {});

    expect(mockUnload).toHaveBeenCalledOnce(); // called after first step, not last
    expect(mockUnload).toHaveBeenCalledWith("/models/a.gguf");
  });

  it("throws when a local step has no modelPath configured", async () => {
    const steps: MoeChainStep[] = [
      makeStep({ order: 1, modelPath: undefined }),
    ];
    await expect(
      MoeChainService.getInstance().execute(steps, "local", makeCtx(), () => {})
    ).rejects.toThrow("no modelPath");
  });
});
