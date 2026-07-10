import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────
// getDb is consulted for the Agentic Wallet budget pre-flight. We supply a
// minimal fluent stub so the budget query path runs without a real DB.
const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));
vi.mock("../../../db.factory.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return { ...actual, getDb: getDbMock };
});

// Valet pre-routing is advisory; keep it instant + offline-safe. Hoisted so
// individual tests can override its resolved/rejected value (Model-Fabric
// Phase 6: Valet is routing/selection-only — its decision must never drive
// actual provider/model dispatch).
const { valetRouteMock } = vi.hoisted(() => ({ valetRouteMock: vi.fn() }));
vi.mock("../ValetRouterService.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    ValetRouterService: {
      getInstance: () => ({ route: valetRouteMock }),
    },
  };
});

// Omnecor-owned local LLM runtime (Model-Fabric Phase 1) — the llamacpp
// provider now streams from a managed llama-server subprocess instead of the
// old one-shot python bridge. Default to "ready with a model loaded"; tests
// that exercise the unavailable/mismatch paths override individual fields.
const { localLlmMock } = vi.hoisted(() => ({
  localLlmMock: {
    ensureReady: vi.fn().mockResolvedValue(true),
    // Phase 8: chatLocalLlm now hot-swaps via ensureModelLoaded(target).
    ensureModelLoaded: vi.fn().mockResolvedValue(true),
    getBaseUrl: vi.fn().mockReturnValue("http://127.0.0.1:8014"),
    getModelPath: vi.fn().mockReturnValue("/tmp/local-model.gguf"),
    getLoadedModelId: vi.fn().mockReturnValue("local-model.gguf"),
    isReady: vi.fn().mockReturnValue(true),
  },
}));
vi.mock("../LocalLlmRuntimeService.js", () => ({
  LocalLlmRuntimeService: { getInstance: () => localLlmMock },
}));

import { AiProviderService, type ChatInput, type ChatChunk } from "../AiProviderService.js";
import { toOpenAiToolSchemas, openAiToolsToAnthropic, TOOL_CALL_TAG } from "../toolSchemas.js";

// A permissive fluent DB stub — every chain resolves to an empty result.
function chain(result: unknown[] = []): any {
  const c: any = {
    from: () => c,
    where: () => c,
    limit: () => Promise.resolve(result),
    values: () => c,
    set: () => c,
    onConflictDoNothing: () => Promise.resolve(result),
    onConflictDoUpdate: () => Promise.resolve(result),
    returning: () => Promise.resolve(result),
    then: (onF: any, onR: any) => Promise.resolve(result).then(onF, onR),
  };
  return c;
}
const permissiveDb = {
  select: () => chain(),
  insert: () => chain(),
  update: () => chain(),
  delete: () => chain(),
};

async function collect(gen: AsyncGenerator<ChatChunk>): Promise<ChatChunk[]> {
  const out: ChatChunk[] = [];
  for await (const c of gen) out.push(c);
  return out;
}

// Builds a fake llama-server /completion SSE stream: `data: {...}\n\n` per
// event, matching the raw (non-OAI) response shape — {content, stop}.
function sseCompletionStream(events: Array<{ content: string; stop: boolean }>): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const e of events) controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      controller.close();
    },
  });
  return { ok: true, body } as unknown as Response;
}

function mockLlamaServerFetch(events: Array<{ content: string; stop: boolean }>) {
  return vi.fn(async (url: string) => {
    const u = String(url);
    // renderLocalLlmPrompt() tries /apply-template first; let it 404 so the
    // ChatML fallback formatter runs (irrelevant to what these tests assert).
    if (u.includes("/apply-template")) return { ok: false, status: 404 } as Response;
    if (u.includes("/completion")) return sseCompletionStream(events);
    throw new Error(`unexpected fetch: ${url}`);
  });
}

function baseInput(overrides: Partial<ChatInput>): ChatInput {
  return {
    providerId: "openai",
    modelId: "gpt-4",
    messages: [{ role: "user", content: "hi" }],
    ...overrides,
  };
}

describe("AiProviderService.streamChat", () => {
  let service: AiProviderService;

  beforeEach(() => {
    vi.clearAllMocks();
    getDbMock.mockResolvedValue(permissiveDb);
    localLlmMock.ensureReady.mockResolvedValue(true);
    localLlmMock.ensureModelLoaded.mockResolvedValue(true);
    localLlmMock.getBaseUrl.mockReturnValue("http://127.0.0.1:8014");
    localLlmMock.getModelPath.mockReturnValue("/tmp/local-model.gguf");
    localLlmMock.getLoadedModelId.mockReturnValue("local-model.gguf");
    localLlmMock.isReady.mockReturnValue(true);
    valetRouteMock.mockResolvedValue({
      mode: "main_api",
      primaryProvider: "llamacpp",
      confidence: 1,
      category: "chat",
    });
    service = AiProviderService.getInstance();
    // Never offload to OMMESH peers in unit tests.
    vi.spyOn(service as any, "selectPeerNode").mockResolvedValue(null);
  });

  it("streams real deltas and emits a terminal done:true chunk for the llamacpp provider", async () => {
    // Regression: the old one-shot llamacpp branch emitted the whole answer in
    // a single { done:true } chunk (or, before that fix, only { done:false }
    // with no terminal chunk at all, hanging the client stream forever). The
    // Model-Fabric Phase 1 runtime must stream incremental deltas AND still
    // guarantee a terminal chunk.
    vi.stubGlobal("fetch", mockLlamaServerFetch([
      { content: "hello ", stop: false },
      { content: "world", stop: false },
      { content: "", stop: true },
    ]));

    const chunks = await collect(
      service.streamChat(
        baseInput({
          providerId: "llamacpp",
          modelId: "local",
          // Avoid the local sub-agent harness wrap (api_direct/sub_agent_harness).
          routingMode: "sub_agent_internal",
        }),
      ),
    );

    expect(chunks.map((c) => c.delta).join("")).toBe("hello world");
    const last = chunks.at(-1)!;
    expect(last.done).toBe(true);
    expect(chunks.some((c) => c.done)).toBe(true);
    vi.unstubAllGlobals();
  });

  // ── /apply-template — renders with the loaded model's OWN chat template ──
  it("renders the prompt via /apply-template and posts the model-templated result to /completion, with no stop string", async () => {
    const completionCalls: any[] = [];
    const fetchMock = vi.fn(async (url: string, opts?: any) => {
      const u = String(url);
      if (u.includes("/apply-template")) {
        const body = JSON.parse(opts.body);
        // System prompt + non-system messages forwarded as an OAI-style array.
        expect(body.messages).toEqual([
          { role: "system", content: "You are Omnecor." },
          { role: "user", content: "hi" },
        ]);
        return { ok: true, json: async () => ({ prompt: "<|start_header_id|>rendered by the model's real template" }) } as any;
      }
      if (u.includes("/completion")) {
        completionCalls.push(JSON.parse(opts.body));
        return sseCompletionStream([{ content: "hi back", stop: true }]);
      }
      throw new Error(`unexpected fetch: ${u}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const chunks = await collect(
      service.streamChat(
        baseInput({
          providerId: "llamacpp",
          modelId: "local",
          systemPrompt: "You are Omnecor.",
          routingMode: "sub_agent_internal",
        }),
      ),
    );

    expect(chunks.map((c) => c.delta).join("")).toBe("hi back");
    expect(completionCalls).toHaveLength(1);
    // The model-templated prompt from /apply-template was used verbatim...
    expect(completionCalls[0].prompt).toBe("<|start_header_id|>rendered by the model's real template");
    // ...and no stop string is forced — the model's own EOS/EOT bounds it.
    expect(completionCalls[0].stop).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it("falls back to a ChatML prompt AND forces a <|im_end|> stop string when /apply-template is unavailable", async () => {
    // Regression: the ChatML fallback used to lose its stop-sequence safety
    // net entirely when /apply-template became the primary path — a model
    // that doesn't recognize ChatML tags as real turn boundaries could then
    // run unbounded (n_predict defaults to -1) past where it should stop.
    const completionCalls: any[] = [];
    const fetchMock = vi.fn(async (url: string, opts?: any) => {
      const u = String(url);
      if (u.includes("/apply-template")) return { ok: false, status: 404 } as any;
      if (u.includes("/completion")) {
        completionCalls.push(JSON.parse(opts.body));
        return sseCompletionStream([{ content: "hi back", stop: true }]);
      }
      throw new Error(`unexpected fetch: ${u}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const chunks = await collect(
      service.streamChat(
        baseInput({
          providerId: "llamacpp",
          modelId: "local",
          systemPrompt: "You are Omnecor.",
          routingMode: "sub_agent_internal",
        }),
      ),
    );

    expect(chunks.map((c) => c.delta).join("")).toBe("hi back");
    expect(completionCalls).toHaveLength(1);
    expect(completionCalls[0].prompt).toContain("<|im_start|>system\nYou are Omnecor.<|im_end|>");
    expect(completionCalls[0].prompt).toContain("<|im_start|>user\nhi<|im_end|>");
    expect(completionCalls[0].stop).toEqual(["<|im_end|>"]);
    vi.unstubAllGlobals();
  });

  it("throws a clear in-band error when the local runtime has no binary/model available", async () => {
    localLlmMock.ensureModelLoaded.mockResolvedValue(false);

    const chunks = await collect(
      service.streamChat(
        baseInput({
          providerId: "llamacpp",
          modelId: "local",
          routingMode: "sub_agent_internal",
        }),
      ),
    );

    const last = chunks.at(-1)!;
    expect(last.done).toBe(true);
    expect(last.content).toMatch(/^Error:/);
    expect(last.content).toMatch(/Local LLM runtime not available/i);
  });

  it("delivers a provider error in-band as a terminal chunk and still completes", async () => {
    // Regression: the producer used to rethrow on error (and the llamacpp path
    // never completed), so the stream surfaced only via onError / hung. The
    // error must now arrive as a normal terminal chunk so the generator ends.
    const chunks = await collect(
      service.streamChat(
        baseInput({ providerId: "totally-unsupported", routingMode: "api_direct" }),
      ),
    );

    const last = chunks.at(-1)!;
    expect(last.done).toBe(true);
    expect(last.content).toMatch(/^Error:/);
    expect(last.content).toMatch(/Unsupported provider/i);
  });

  // Model-Fabric Phase 6: Valet is routing/selection-only. It must never own
  // the "cubicle" — a routing decision that disagrees with the caller's
  // explicit provider/model must not redirect the actual dispatch.
  it("never lets Valet's routing decision override the caller's explicit provider/model", async () => {
    valetRouteMock.mockResolvedValue({
      mode: "main_api",
      primaryProvider: "anthropic", // deliberately disagrees with providerId below
      primaryModel: "claude-3-opus",
      confidence: 0.99,
      category: "chat",
    });
    const chatOpenAI = vi
      .spyOn(service as any, "chatOpenAI")
      .mockImplementation(async (input: any, onChunk: any) => {
        onChunk({ content: "hi", done: true });
        return "hi";
      });

    await collect(
      service.streamChat(
        baseInput({ providerId: "openai", modelId: "gpt-4", routingMode: "main_api" }),
      ),
    );

    expect(chatOpenAI).toHaveBeenCalledTimes(1);
    const dispatchedInput = chatOpenAI.mock.calls[0][0];
    expect(dispatchedInput.providerId).toBe("openai");
    expect(dispatchedInput.modelId).toBe("gpt-4");
    chatOpenAI.mockRestore();
  });

  it("never blocks a chat turn when Valet's routing call fails or is offline", async () => {
    valetRouteMock.mockRejectedValue(new Error("Valet Router offline"));
    const chatOpenAI = vi
      .spyOn(service as any, "chatOpenAI")
      .mockImplementation(async (_input: any, onChunk: any) => {
        onChunk({ content: "hi", done: true });
        return "hi";
      });

    const chunks = await collect(
      service.streamChat(
        baseInput({ providerId: "openai", modelId: "gpt-4", routingMode: "main_api" }),
      ),
    );

    expect(chatOpenAI).toHaveBeenCalledTimes(1);
    expect(chunks.some((c) => c.done)).toBe(true);
    expect(chunks.map((c) => c.content).join("")).not.toMatch(/^Error:/);
    chatOpenAI.mockRestore();
  });

  it("blocks (never reaches the cloud provider) when a hard budget cap is exhausted and history overflows the local model", async () => {
    // Regression: the ContextOverflowError used to be thrown inside the
    // swallow-all budget catch, which logged a warning AND skipped the
    // downgrade — so the request proceeded on the paid cloud provider past a
    // hard cap. It must now block with a user-facing terminal chunk.
    getDbMock.mockResolvedValue({
      // No-arg select → budget row; arg select({total}) → spend row.
      select: (arg?: unknown) =>
        arg
          ? chain([{ total: 200_000_000 }]) // 200 cents spent
          : chain([{ limitCents: 100, mode: "hard", alertThreshold: 80 }]),
      insert: () => chain(),
      update: () => chain(),
      delete: () => chain(),
    });
    // The cloud provider dispatch must never run.
    const chatOpenAI = vi.spyOn(service as any, "chatOpenAI");
    // Silence the over-budget wallet alert (notification side-effects).
    vi.spyOn(service as any, "raiseWalletAlert").mockResolvedValue(undefined);

    const chunks = await collect(
      service.streamChat(
        baseInput({
          providerId: "openai",
          projectId: "proj-1",
          routingMode: "api_direct",
          // ~10k estimated tokens (len/4) — over the 8k local-context budget.
          messages: [{ role: "user", content: "x".repeat(40_000) }],
        }),
      ),
    );

    expect(chatOpenAI).not.toHaveBeenCalled();
    expect(chunks).toHaveLength(1);
    expect(chunks[0].done).toBe(true);
    expect(chunks[0].content).toMatch(/^Error:/);
    expect(chunks[0].content).toMatch(/budget exhausted/i);
  });

  it("never re-offloads a mesh-origin request to another peer", async () => {
    // Regression: an inbound mesh job used to re-run the federated routing
    // check on the executing node, forwarding it onward (A→B→C…) whenever a
    // peer's telemetry out-scored the executor — live-hit 2026-07-02 when
    // warming qwen2.5:3b on the 4060 Ti made StudioOne win the re-decision.
    vi.stubGlobal("fetch", mockLlamaServerFetch([{ content: "local result", stop: true }]));
    const selectPeerNode = service["selectPeerNode"] as ReturnType<typeof vi.fn>;

    const chunks = await collect(
      service.streamChat(
        baseInput({
          providerId: "llamacpp",
          modelId: "local",
          routingMode: "sub_agent_internal",
          meshOrigin: true,
        }),
      ),
    );

    expect(selectPeerNode).not.toHaveBeenCalled();
    expect(chunks.map((c) => c.delta).join("")).toBe("local result");
    vi.unstubAllGlobals();
  });

  it("consults federated routing for local providers but never for cloud providers", async () => {
    vi.stubGlobal("fetch", mockLlamaServerFetch([{ content: "ok", stop: true }]));
    const selectPeerNode = service["selectPeerNode"] as ReturnType<typeof vi.fn>;

    await collect(
      service.streamChat(
        baseInput({
          providerId: "llamacpp",
          modelId: "local",
          routingMode: "sub_agent_internal",
        }),
      ),
    );
    expect(selectPeerNode).toHaveBeenCalledTimes(1);

    // Cloud provider → the mesh must not even be consulted.
    selectPeerNode.mockClear();
    await collect(
      service.streamChat(baseInput({ providerId: "totally-unsupported", routingMode: "api_direct" })),
    );
    expect(selectPeerNode).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  // ── Ollama native reasoning + real token accounting ──────────────────────
  // Build a fake newline-delimited Ollama /api/chat stream and a /api/show
  // capability probe, then assert streamChat surfaces `thinking` deltas and a
  // real `totalTokens` from eval_count (previously both were silently dropped).
  function ndjsonStream(lines: string[]): Response {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const l of lines) controller.enqueue(encoder.encode(l + "\n"));
        controller.close();
      },
    });
    return { ok: true, body } as unknown as Response;
  }

  it("routes Ollama native reasoning to `thinking` chunks, reports eval_count tokens, and requests think:true for a thinking-capable model", async () => {
    const fetchMock = vi.fn(async (url: string, opts?: any) => {
      const u = String(url);
      if (u.includes("/api/show")) {
        return { ok: true, json: async () => ({ capabilities: ["completion", "thinking", "tools"] }) } as any;
      }
      if (u.includes("/api/chat")) {
        (fetchMock as any)._chatBody = JSON.parse(opts.body);
        return ndjsonStream([
          JSON.stringify({ message: { thinking: "Let me think. " }, done: false }),
          JSON.stringify({ message: { thinking: "42 it is." }, done: false }),
          JSON.stringify({ message: { content: "The answer " }, done: false }),
          JSON.stringify({ message: { content: "is 42." }, done: false }),
          JSON.stringify({ message: { content: "" }, done: true, eval_count: 12, prompt_eval_count: 30 }),
        ]);
      }
      throw new Error(`unexpected fetch: ${u}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const chunks = await collect(
      service.streamChat(
        baseInput({
          providerId: "ollama",
          modelId: "deepseek-r1:14b",
          baseUrl: "http://test-ollama:11434",
          // sub_agent_internal skips the local sub-agent harness wrap → chatOllama.
          routingMode: "sub_agent_internal",
        }),
      ),
    );

    // Reasoning arrived on the side channel, never mixed into content.
    const thinking = chunks.map((c) => c.thinking ?? "").join("");
    expect(thinking).toBe("Let me think. 42 it is.");
    const content = chunks.map((c) => c.delta).join("");
    expect(content).toBe("The answer is 42.");

    // Terminal chunk carries the real generated-token count (eval_count).
    const last = chunks.at(-1)!;
    expect(last.done).toBe(true);
    expect(last.totalTokens).toBe(12);

    // A thinking-capable model must be asked to emit its reasoning.
    expect((fetchMock as any)._chatBody.think).toBe(true);
    vi.unstubAllGlobals();
  });

  it("omits think for a non-thinking Ollama model and yields no reasoning", async () => {
    const fetchMock = vi.fn(async (url: string, opts?: any) => {
      const u = String(url);
      if (u.includes("/api/show")) {
        return { ok: true, json: async () => ({ capabilities: ["completion", "tools"] }) } as any;
      }
      if (u.includes("/api/chat")) {
        (fetchMock as any)._chatBody = JSON.parse(opts.body);
        return ndjsonStream([
          JSON.stringify({ message: { content: "hi there" }, done: false }),
          JSON.stringify({ message: { content: "" }, done: true, eval_count: 3, prompt_eval_count: 10 }),
        ]);
      }
      throw new Error(`unexpected fetch: ${u}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const chunks = await collect(
      service.streamChat(
        baseInput({
          providerId: "ollama",
          modelId: "qwen2.5:7b",
          baseUrl: "http://test-ollama:11434",
          routingMode: "sub_agent_internal",
        }),
      ),
    );

    expect(chunks.every((c) => !c.thinking)).toBe(true);
    expect(chunks.map((c) => c.delta).join("")).toBe("hi there");
    expect(chunks.at(-1)!.totalTokens).toBe(3);
    expect((fetchMock as any)._chatBody.think).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it("falls back to local execution when the mesh offload attempt fails", async () => {
    // A flaky peer must never lose the request — the offload error is logged
    // and the local provider dispatch proceeds.
    vi.stubGlobal("fetch", mockLlamaServerFetch([{ content: "local fallback", stop: true }]));
    (service["selectPeerNode"] as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("peer telemetry unavailable"),
    );

    const chunks = await collect(
      service.streamChat(
        baseInput({
          providerId: "llamacpp",
          modelId: "local",
          routingMode: "sub_agent_internal",
        }),
      ),
    );

    const last = chunks.at(-1)!;
    expect(last.done).toBe(true);
    expect(chunks.map((c) => c.delta).join("")).toBe("local fallback");
    vi.unstubAllGlobals();
  });

  // /review 2026-07-08 (Model-Fabric Phase 5/6): a *pinned* mesh-peer failure
  // must never take the silent-fallback path above — the user explicitly
  // chose that peer's model, so running elsewhere with the same providerId/
  // modelId (which may not even exist locally) must surface as a clear
  // in-band error instead of a confusing unrelated one.
  it("surfaces a clear in-band error (never falls back locally) when a pinned mesh peer is unreachable", async () => {
    const chatOllama = vi.spyOn(service as any, "chatOllama");
    (service["selectPeerNode"] as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Mesh peer "DadsPC" is not currently discoverable — is it online?'),
    );

    const chunks = await collect(
      service.streamChat(
        baseInput({
          providerId: "ollama",
          modelId: "qwen2.5:7b",
          routingMode: "main_api",
          targetNodeId: "DadsPC",
        }),
      ),
    );

    expect(chatOllama).not.toHaveBeenCalled();
    const last = chunks.at(-1)!;
    expect(last.done).toBe(true);
    expect(last.content).toMatch(/^Error:/);
    expect(last.content).toMatch(/DadsPC/);
    chatOllama.mockRestore();
  });

  it("surfaces a clear in-band error (never falls back locally) when a pinned peer fails mid-turn for moe_chain_omesh", async () => {
    (service["selectPeerNode"] as ReturnType<typeof vi.fn>).mockResolvedValue({ name: "DadsPC" });
    vi.spyOn(service as any, "routeToPeer").mockRejectedValue(
      new Error("peer DadsPC returned 503: model loading"),
    );

    const chunks = await collect(
      service.streamChat(
        baseInput({
          providerId: "ollama",
          modelId: "qwen2.5:7b",
          routingMode: "moe_chain_omesh",
          targetNodeId: "DadsPC",
          userId: 1,
        }),
      ),
    );

    const last = chunks.at(-1)!;
    expect(last.done).toBe(true);
    expect(last.content).toMatch(/^Error:/);
    expect(last.content).toMatch(/DadsPC/);
  });

  // ── Budget hard-cap downgrade prefers the Omnecor-owned local runtime ────
  it("downgrades to the local llama-server runtime (not Ollama) when a hard budget cap is hit", async () => {
    getDbMock.mockResolvedValue({
      select: (arg?: unknown) =>
        arg ? chain([{ total: 200_000_000 }]) : chain([{ limitCents: 100, mode: "hard", alertThreshold: 80 }]),
      insert: () => chain(),
      update: () => chain(),
      delete: () => chain(),
    });
    vi.spyOn(service as any, "raiseWalletAlert").mockResolvedValue(undefined);
    const chatOpenAI = vi.spyOn(service as any, "chatOpenAI");
    vi.stubGlobal("fetch", mockLlamaServerFetch([{ content: "downgraded answer", stop: true }]));

    const chunks = await collect(
      service.streamChat(
        baseInput({
          providerId: "openai",
          projectId: "proj-1",
          routingMode: "api_direct",
          messages: [{ role: "user", content: "small message" }],
        }),
      ),
    );

    expect(chatOpenAI).not.toHaveBeenCalled();
    expect(chunks.map((c) => c.delta).join("")).toBe("downgraded answer");
    expect(chunks.at(-1)!.done).toBe(true);
    vi.unstubAllGlobals();
  });

  it("blocks with a clear message when a hard budget cap is hit and neither the local runtime nor Ollama has a model available", async () => {
    getDbMock.mockResolvedValue({
      select: (arg?: unknown) =>
        arg ? chain([{ total: 200_000_000 }]) : chain([{ limitCents: 100, mode: "hard", alertThreshold: 80 }]),
      insert: () => chain(),
      update: () => chain(),
      delete: () => chain(),
    });
    vi.spyOn(service as any, "raiseWalletAlert").mockResolvedValue(undefined);
    const chatOpenAI = vi.spyOn(service as any, "chatOpenAI");
    localLlmMock.isReady.mockReturnValue(false);
    localLlmMock.getModelPath.mockReturnValue(null);
    // discoverOllamaModels() hits /api/tags — return no pulled models.
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ models: [] }) } as any)));

    const chunks = await collect(
      service.streamChat(
        baseInput({
          providerId: "openai",
          projectId: "proj-1",
          routingMode: "api_direct",
          messages: [{ role: "user", content: "small message" }],
        }),
      ),
    );

    expect(chatOpenAI).not.toHaveBeenCalled();
    expect(chunks).toHaveLength(1);
    expect(chunks[0].done).toBe(true);
    expect(chunks[0].content).toMatch(/^Error:/);
    expect(chunks[0].content).toMatch(/no local model is available/i);
    vi.unstubAllGlobals();
  });

  // ── Model-Fabric Phase 2 — native (structured) tool-calling ─────────────
  describe("native tool-calling", () => {
    function sseLines(lines: string[]): Response {
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const l of lines) controller.enqueue(encoder.encode(`data: ${l}\n\n`));
          controller.close();
        },
      });
      return { ok: true, body } as unknown as Response;
    }

    it("assembles fragmented OpenAI tool_calls deltas into a single ChatChunk.toolCalls on [DONE]", async () => {
      const tools = toOpenAiToolSchemas();
      const fetchMock = vi.fn(async (_url: string, opts?: any) => {
        (fetchMock as any)._body = JSON.parse(opts.body);
        const events = [
          { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "run_command", arguments: "" } }] } }] },
          { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"command":' } }] } }] },
          { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"echo"}' } }] } }] },
        ];
        return sseLines([...events.map((e) => JSON.stringify(e)), "[DONE]"]);
      });
      vi.stubGlobal("fetch", fetchMock);

      const chunks = await collect(
        service.streamChat(baseInput({ providerId: "openai", apiKey: "sk-test", tools, routingMode: "api_direct" })),
      );

      expect((fetchMock as any)._body.tools).toEqual(tools);
      expect((fetchMock as any)._body.tool_choice).toBe("auto");
      const last = chunks.at(-1)!;
      expect(last.done).toBe(true);
      expect(last.toolCalls).toEqual([{ id: "call_1", name: "run_command", arguments: '{"command":"echo"}' }]);
      vi.unstubAllGlobals();
    });

    it("assembles streamed Anthropic tool_use content blocks into ChatChunk.toolCalls", async () => {
      const tools = toOpenAiToolSchemas();
      const fetchMock = vi.fn(async (_url: string, opts?: any) => {
        (fetchMock as any)._body = JSON.parse(opts.body);
        const events = [
          { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
          { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Sure, " } },
          { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_1", name: "run_command" } },
          { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"command":' } },
          { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '"echo"}' } },
          { type: "content_block_stop", index: 1 },
          { type: "message_stop" },
        ];
        return sseLines(events.map((e) => JSON.stringify(e)));
      });
      vi.stubGlobal("fetch", fetchMock);

      const chunks = await collect(
        service.streamChat(baseInput({ providerId: "anthropic", apiKey: "sk-ant-test", tools, routingMode: "api_direct" })),
      );

      expect((fetchMock as any)._body.tools).toEqual(openAiToolsToAnthropic(tools));
      expect(chunks.map((c) => c.delta).join("")).toBe("Sure, ");
      const last = chunks.at(-1)!;
      expect(last.done).toBe(true);
      expect(last.toolCalls).toEqual([{ id: "toolu_1", name: "run_command", arguments: '{"command":"echo"}' }]);
      vi.unstubAllGlobals();
    });

    // Regression: a non-compliant OpenAI-compatible proxy (or an abrupt
    // connection drop) can close the stream WITHOUT ever sending "[DONE]".
    // The already-assembled tool call must still surface via handleStream's
    // post-loop fallback chunk, not be silently discarded.
    it("still surfaces an assembled OpenAI tool call even if the stream ends without a [DONE] sentinel", async () => {
      const tools = toOpenAiToolSchemas();
      const fetchMock = vi.fn(async () => {
        const events = [
          { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "run_command", arguments: "" } }] } }] },
          { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"command":"echo"}' } }] } }] },
        ];
        // No trailing "[DONE]" — the stream just closes.
        return sseLines(events.map((e) => JSON.stringify(e)));
      });
      vi.stubGlobal("fetch", fetchMock);

      const chunks = await collect(
        service.streamChat(baseInput({ providerId: "openai", apiKey: "sk-test", tools, routingMode: "api_direct" })),
      );

      const last = chunks.at(-1)!;
      expect(last.done).toBe(true);
      expect(last.toolCalls).toEqual([{ id: "call_1", name: "run_command", arguments: '{"command":"echo"}' }]);
      vi.unstubAllGlobals();
    });

    // Same regression, Anthropic side: no `message_stop` before the stream closes.
    it("still surfaces an assembled Anthropic tool call even if the stream ends without a message_stop event", async () => {
      const tools = toOpenAiToolSchemas();
      const fetchMock = vi.fn(async () => {
        const events = [
          { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_1", name: "run_command" } },
          { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"command":"echo"}' } },
          { type: "content_block_stop", index: 0 },
          // No trailing "message_stop" — the stream just closes.
        ];
        return sseLines(events.map((e) => JSON.stringify(e)));
      });
      vi.stubGlobal("fetch", fetchMock);

      const chunks = await collect(
        service.streamChat(baseInput({ providerId: "anthropic", apiKey: "sk-ant-test", tools, routingMode: "api_direct" })),
      );

      const last = chunks.at(-1)!;
      expect(last.done).toBe(true);
      expect(last.toolCalls).toEqual([{ id: "toolu_1", name: "run_command", arguments: '{"command":"echo"}' }]);
      vi.unstubAllGlobals();
    });

    // The non-streaming branch is currently unreachable from streamChat()'s
    // public path (onChunk is always supplied there), but is exercised
    // directly here to lock in the fix: Anthropic can interleave more than
    // one text block around a tool_use block, and only returning the first
    // (`.find()`) would silently drop the rest.
    it("chatAnthropic (non-streaming) concatenates every text block instead of only the first", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({
          ok: true,
          json: async () => ({
            content: [
              { type: "text", text: "Before. " },
              { type: "tool_use", id: "toolu_1", name: "run_command", input: { command: "echo" } },
              { type: "text", text: "After." },
            ],
          }),
        })),
      );

      const result = await (service as any).chatAnthropic(
        baseInput({ providerId: "anthropic", apiKey: "sk-ant-test" }),
      );

      expect(result).toContain("Before. ");
      expect(result).toContain("After.");
      expect(result).toContain(TOOL_CALL_TAG);
      vi.unstubAllGlobals();
    });

    it("parses native tool_calls from a streamed Ollama message onto the terminal ChatChunk", async () => {
      const tools = toOpenAiToolSchemas();
      const fetchMock = vi.fn(async (url: string, opts?: any) => {
        const u = String(url);
        if (u.includes("/api/show")) return { ok: true, json: async () => ({ capabilities: [] }) } as any;
        if (u.includes("/api/chat")) {
          (fetchMock as any)._chatBody = JSON.parse(opts.body);
          return ndjsonStream([
            JSON.stringify({ message: { content: "" }, done: false }),
            JSON.stringify({
              message: {
                content: "",
                tool_calls: [{ id: "call_9", function: { name: "run_command", arguments: { command: "echo", args: ["hi"] } } }],
              },
              done: true,
              eval_count: 5,
            }),
          ]);
        }
        throw new Error(`unexpected fetch: ${u}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      const chunks = await collect(
        service.streamChat(
          baseInput({ providerId: "ollama", modelId: "qwen2.5:7b", baseUrl: "http://test-ollama:11434", tools, routingMode: "sub_agent_internal" }),
        ),
      );

      expect((fetchMock as any)._chatBody.tools).toEqual(tools);
      const last = chunks.at(-1)!;
      expect(last.done).toBe(true);
      expect(last.toolCalls).toEqual([{ id: "call_9", name: "run_command", arguments: JSON.stringify({ command: "echo", args: ["hi"] }) }]);
      vi.unstubAllGlobals();
    });

    it("requests grammar-constrained tool-call generation for llamacpp when supportsNativeTools is set", async () => {
      const tools = toOpenAiToolSchemas();
      const fetchMock = vi.fn(async (url: string, opts?: any) => {
        const u = String(url);
        if (u.includes("/apply-template")) return { ok: false, status: 404 } as Response;
        if (u.includes("/completion")) {
          (fetchMock as any)._body = JSON.parse(opts.body);
          return sseCompletionStream([{ content: "ok", stop: true }]);
        }
        throw new Error(`unexpected fetch: ${u}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      await collect(
        service.streamChat(baseInput({ providerId: "llamacpp", tools, supportsNativeTools: true, routingMode: "sub_agent_internal" })),
      );

      const body = (fetchMock as any)._body;
      expect(body.grammar_lazy).toBe(true);
      expect(body.grammar_triggers).toEqual([{ type: 1, value: "<tool_call>" }]);
      expect(body.json_schema).toMatchObject({ type: "object", required: ["action"] });
      expect(body.json_schema.properties.action.enum).toEqual(tools.map((t) => t.function.name));
      vi.unstubAllGlobals();
    });

    it("falls back to a plain (ungrammared) request when llama-server rejects the native-tool request", async () => {
      const tools = toOpenAiToolSchemas();
      let completionCalls = 0;
      const fetchMock = vi.fn(async (url: string, opts?: any) => {
        const u = String(url);
        if (u.includes("/apply-template")) return { ok: false, status: 404 } as Response;
        if (u.includes("/completion")) {
          completionCalls++;
          const body = JSON.parse(opts.body);
          if (body.json_schema) return { ok: false, status: 400 } as Response;
          (fetchMock as any)._fallbackBody = body;
          return sseCompletionStream([{ content: "fallback answer", stop: true }]);
        }
        throw new Error(`unexpected fetch: ${u}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      const chunks = await collect(
        service.streamChat(baseInput({ providerId: "llamacpp", tools, supportsNativeTools: true, routingMode: "sub_agent_internal" })),
      );

      expect(completionCalls).toBe(2);
      expect((fetchMock as any)._fallbackBody.json_schema).toBeUndefined();
      expect((fetchMock as any)._fallbackBody.grammar_triggers).toBeUndefined();
      expect(chunks.map((c) => c.delta).join("")).toBe("fallback answer");
      expect(chunks.at(-1)!.done).toBe(true);
      vi.unstubAllGlobals();
    });
  });
});
