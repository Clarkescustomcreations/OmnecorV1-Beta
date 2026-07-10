import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";
import {
  SubAgentHostService,
  SubAgentHostError,
  type SubAgentHostDeps,
} from "../SubAgentHostService.js";
import type { AgentStreamEvent } from "@shared/chatAgentEvents";
import type { SubAgentEventEnvelope, SubAgentTurnRequest } from "@shared/subagent";
import {
  SUBAGENT_ENABLED_SETTING,
  SUBAGENT_MAX_CONCURRENT_SETTING,
} from "@shared/subagent";

/** A scripted runner: yields the given events (in order) then a `done`. */
function scriptedRunner(events: AgentStreamEvent[], content = "done") {
  return {
    async *run(): AsyncGenerator<AgentStreamEvent> {
      for (const ev of events) yield ev;
      yield { type: "done", blocks: [], content, totalTokens: 1 };
    },
  };
}

/** A runner that never completes until aborted (for cancel/grace tests). */
function hangingRunner(signalHolder: { signal?: AbortSignal }) {
  return {
    async *run(params: { signal?: AbortSignal }): AsyncGenerator<AgentStreamEvent> {
      signalHolder.signal = params.signal;
      yield { type: "block_start", block: { id: "b1", type: "command", command: "sleep", status: "running" } };
      // Wait until aborted.
      await new Promise<void>((resolve) => {
        params.signal?.addEventListener("abort", () => resolve(), { once: true });
      });
      yield { type: "error", message: "aborted" };
    },
  };
}

const uuid = "11111111-2222-3333-4444-555555555555";

function baseReq(over: Partial<SubAgentTurnRequest> = {}): SubAgentTurnRequest {
  return {
    taskId: uuid,
    label: "test task",
    messages: [{ role: "user", content: "do a thing" }],
    originNodeId: "origin-node",
    providerId: "ollama",
    modelId: "llama3.2",
    ...over,
  };
}

function makeHost(over: Partial<SubAgentHostDeps> = {}, settings: Record<string, unknown> = {}) {
  const deps: SubAgentHostDeps = {
    aiProvider: { getLocalFallbackProvider: async () => ({ providerId: "llamacpp", modelId: "local.gguf" }) },
    asyncJob: new EventEmitter() as unknown as SubAgentHostDeps["asyncJob"],
    settings: { get: <T>(key: string, fallback: T): T => (key in settings ? (settings[key] as T) : fallback) },
    validatePath: async (p: string) => p,
    mkdir: async () => {},
    createRunner: () => scriptedRunner([]),
    ...over,
  };
  return new SubAgentHostService(deps);
}

describe("SubAgentHostService — policy gates", () => {
  it("refuses when the kill switch disables inbound sub-agents", async () => {
    const host = makeHost({}, { [SUBAGENT_ENABLED_SETTING]: false });
    await expect(host.runTurn(baseReq())).rejects.toMatchObject({ code: "subagents_disabled" });
  });

  it("rejects a non-uuid taskId (path-traversal guard)", async () => {
    const host = makeHost();
    await expect(host.runTurn(baseReq({ taskId: "../etc" }))).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("rejects an empty message list", async () => {
    const host = makeHost();
    await expect(host.runTurn(baseReq({ messages: [] }))).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("enforces the origin's execution mode (sovereign origin cannot reach cloud)", async () => {
    const host = makeHost();
    await expect(
      host.runTurn(baseReq({ providerId: "openai", executionMode: "sovereign" })),
    ).rejects.toMatchObject({ code: "provider_forbidden" });
  });

  it("resolves the peer's local default model when the request names none", async () => {
    const seen: string[] = [];
    const host = makeHost({
      aiProvider: { getLocalFallbackProvider: async () => ({ providerId: "llamacpp", modelId: "peer-default.gguf" }) },
      createRunner: () => ({
        async *run(params: { input: { modelId: string } }): AsyncGenerator<AgentStreamEvent> {
          seen.push(params.input.modelId);
          yield { type: "done", blocks: [], content: "ok" };
        },
      }),
    });
    await host.runTurn(baseReq({ providerId: undefined, modelId: undefined }));
    expect(seen).toEqual(["peer-default.gguf"]);
  });

  it("reports model_unavailable when nothing is runnable", async () => {
    const host = makeHost({
      aiProvider: { getLocalFallbackProvider: async () => null },
    });
    await expect(host.runTurn(baseReq({ providerId: undefined, modelId: undefined }))).rejects.toMatchObject({
      code: "model_unavailable",
    });
  });
});

describe("SubAgentHostService — streaming + concurrency", () => {
  it("streams sequenced envelopes to the subscriber and ends with done", async () => {
    const host = makeHost({
      createRunner: () => scriptedRunner([
        { type: "text_delta", id: "t", delta: "hi" },
        { type: "block_start", block: { id: "b", type: "command", command: "ls", status: "running" } },
      ]),
    });
    const seen: SubAgentEventEnvelope[] = [];
    const info = await host.runTurn(baseReq(), (env) => seen.push(env));

    // Monotonic seq starting at 1, all tagged with the taskId + turn 1.
    expect(seen.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(seen.every((e) => e.taskId === uuid && e.turn === 1)).toBe(true);
    expect(seen.at(-1)?.event.type).toBe("done");
    expect(info.status).toBe("idle");
    expect(info.lastSeq).toBe(3);
  });

  it("enforces the concurrent-run cap", async () => {
    const holder: { signal?: AbortSignal } = {};
    const host = makeHost(
      { createRunner: () => hangingRunner(holder) },
      { [SUBAGENT_MAX_CONCURRENT_SETTING]: 1 },
    );
    // First run hangs (never awaited).
    void host.runTurn(baseReq({ taskId: "aaaaaaaa-1111-2222-3333-444444444444" }), () => {});
    // Give the first run a tick to flip to "running".
    await new Promise((r) => setTimeout(r, 5));
    await expect(
      host.runTurn(baseReq({ taskId: "bbbbbbbb-1111-2222-3333-444444444444" }), () => {}),
    ).rejects.toMatchObject({ code: "concurrency_limit" });
  });

  it("rejects a second concurrent turn for the same task", async () => {
    const holder: { signal?: AbortSignal } = {};
    const host = makeHost({ createRunner: () => hangingRunner(holder) });
    void host.runTurn(baseReq(), () => {});
    await new Promise((r) => setTimeout(r, 5));
    await expect(host.runTurn(baseReq(), () => {})).rejects.toMatchObject({ code: "task_busy" });
  });
});

describe("SubAgentHostService — attach / approval / cancel", () => {
  it("replays buffered envelopes on cursor re-attach without a gap", async () => {
    const host = makeHost({
      createRunner: () => scriptedRunner([
        { type: "text_delta", id: "t", delta: "one" },
        { type: "text_delta", id: "t", delta: "two" },
      ]),
    });
    await host.runTurn(baseReq(), () => {});
    // Re-attach from seq 1 → should replay seq 2 and 3 (not 1).
    const replayed: SubAgentEventEnvelope[] = [];
    const { replay, gap } = host.attach(uuid, 1, (env) => replayed.push(env));
    expect(gap).toBe(false);
    expect(replay.map((e) => e.seq)).toEqual([2, 3]);
  });

  it("throws unknown_task for attach/approval/cancel on an unknown task", () => {
    const host = makeHost();
    expect(() => host.attach("no-such", 0, () => {})).toThrow(SubAgentHostError);
    expect(() => host.getInfo("no-such")).toThrow(SubAgentHostError);
  });

  it("cancel aborts a running turn and marks it cancelled", async () => {
    const holder: { signal?: AbortSignal } = {};
    const host = makeHost({ createRunner: () => hangingRunner(holder) });
    const run = host.runTurn(baseReq(), () => {});
    await new Promise((r) => setTimeout(r, 5));
    const info = host.cancel(uuid, "test cancel");
    expect(info.status).toBe("cancelled");
    expect(holder.signal?.aborted).toBe(true);
    await run; // the aborted runner unwinds cleanly
  });

  it("forwards an approval decision into the isolated approval broker", async () => {
    // The host uses its OWN ToolApprovalRegistry (not the process singleton), so
    // resolveApproval returns false for an unknown id but never touches local chat.
    const host = makeHost({
      createRunner: () => scriptedRunner([{ type: "text_delta", id: "t", delta: "x" }]),
    });
    await host.runTurn(baseReq(), () => {});
    // No pending approval was created by this scripted runner → resolve is a no-op.
    expect(host.resolveApproval(uuid, { id: "nope", decision: "approve" })).toBe(false);
  });
});
