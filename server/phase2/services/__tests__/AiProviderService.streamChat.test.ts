import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────
// getDb is consulted for the Agentic Wallet budget pre-flight. We supply a
// minimal fluent stub so the budget query path runs without a real DB.
const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));
vi.mock("../../../db.factory.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return { ...actual, getDb: getDbMock };
});

// Valet pre-routing is advisory; keep it instant + offline-safe.
vi.mock("../ValetRouterService.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    ValetRouterService: {
      getInstance: () => ({
        route: vi.fn().mockResolvedValue({
          mode: "main_api",
          primaryProvider: "llamacpp",
          confidence: 1,
          category: "chat",
        }),
      }),
    },
  };
});

// llama.cpp returns the full completion in one shot.
const generateMock = vi.fn();
vi.mock("../LlamaCppService.js", () => ({
  LlamaCppService: { getInstance: () => ({ generate: generateMock }) },
}));

import { AiProviderService, type ChatInput, type ChatChunk } from "../AiProviderService.js";

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
    service = AiProviderService.getInstance();
    // Never offload to OMMESH peers in unit tests.
    vi.spyOn(service as any, "shouldOffload").mockResolvedValue(false);
  });

  it("emits a terminal done:true chunk for the llamacpp provider", async () => {
    // Regression: the llamacpp branch used to emit only { done:false }, so the
    // consumer never observed completion and the client stream hung forever.
    generateMock.mockResolvedValue("hello world");
    const chunks = await collect(
      service.streamChat(
        baseInput({
          providerId: "llamacpp",
          modelId: "local",
          modelPath: "/tmp/model.gguf",
          // Avoid the local sub-agent harness wrap (api_direct/sub_agent_harness).
          routingMode: "sub_agent_internal",
        }),
      ),
    );

    const last = chunks.at(-1)!;
    expect(last.done).toBe(true);
    expect(last.content).toBe("hello world");
    expect(chunks.some((c) => c.done)).toBe(true);
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
});
