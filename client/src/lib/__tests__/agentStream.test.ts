import { describe, it, expect } from "vitest";
import { applyAgentEvent, applyJobCompletion, isTerminalEvent } from "../agentStream";
import type { AssistantBlock } from "@shared/chatBlocks";
import type { AgentStreamEvent } from "@shared/chatAgentEvents";

/** Fold a list of events from an empty stream. */
function fold(events: AgentStreamEvent[]): AssistantBlock[] {
  return events.reduce<AssistantBlock[]>(applyAgentEvent, []);
}

describe("applyAgentEvent — text folding", () => {
  it("lazily creates a text block and appends successive deltas", () => {
    const blocks = fold([
      { type: "text_delta", id: "t1", delta: "Hel" },
      { type: "text_delta", id: "t1", delta: "lo " },
      { type: "text_delta", id: "t1", delta: "world" },
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({ id: "t1", type: "text", text: "Hello world" });
  });

  it("returns a new array + new block object each event (immutable)", () => {
    const a = fold([{ type: "text_delta", id: "t1", delta: "a" }]);
    const b = applyAgentEvent(a, { type: "text_delta", id: "t1", delta: "b" });
    expect(b).not.toBe(a);
    expect(b[0]).not.toBe(a[0]);
    expect((a[0] as { text: string }).text).toBe("a"); // original untouched
  });
});

describe("applyAgentEvent — thinking folding", () => {
  it("accumulates reasoning and latches done", () => {
    const blocks = fold([
      { type: "thinking_delta", id: "r1", delta: "step 1 " },
      { type: "thinking_delta", id: "r1", delta: "step 2", done: true },
    ]);
    expect(blocks[0]).toEqual({ id: "r1", type: "thinking", text: "step 1 step 2", done: true });
  });
});

describe("applyAgentEvent — tool block upsert by id", () => {
  it("start then update then end replace the same block in place", () => {
    const start: AgentStreamEvent = {
      type: "block_start",
      block: { id: "c1", type: "command", command: "ls", status: "pending" },
    };
    const running: AgentStreamEvent = {
      type: "block_update",
      block: { id: "c1", type: "command", command: "ls", status: "running" },
    };
    const done: AgentStreamEvent = {
      type: "block_end",
      block: { id: "c1", type: "command", command: "ls", status: "success", exitCode: 0 },
    };
    const blocks = fold([start, running, done]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ id: "c1", status: "success", exitCode: 0 });
  });

  it("keeps prose and tool boxes in emission order", () => {
    const blocks = fold([
      { type: "text_delta", id: "t1", delta: "Running it." },
      { type: "block_start", block: { id: "c1", type: "command", command: "ls", status: "pending" } },
      { type: "block_end", block: { id: "c1", type: "command", command: "ls", status: "success" } },
      { type: "text_delta", id: "t2", delta: "Done." },
    ]);
    expect(blocks.map((b) => b.type)).toEqual(["text", "command", "text"]);
  });
});

describe("applyAgentEvent — done adopts canonical ordering", () => {
  it("replaces the working array with the server's final blocks", () => {
    const finalBlocks: AssistantBlock[] = [
      { id: "t1", type: "text", text: "answer" },
      { id: "j1", type: "job", jobId: "job-1", label: "build", status: "running" },
    ];
    const blocks = fold([
      { type: "text_delta", id: "t1", delta: "answer" },
      { type: "done", blocks: finalBlocks, content: "answer" },
    ]);
    expect(blocks).toEqual(finalBlocks);
  });
});

describe("applyJobCompletion", () => {
  it("drives the matching running job block to completed with output", () => {
    const blocks: AssistantBlock[] = [
      { id: "j1", type: "job", jobId: "job-9", label: "build", status: "running" },
    ];
    const next = applyJobCompletion(blocks, "job-9", "completed", "build ok");
    expect(next[0]).toMatchObject({ status: "completed", output: "build ok" });
    expect(next).not.toBe(blocks);
  });

  it("no-ops when no job block matches the id", () => {
    const blocks: AssistantBlock[] = [{ id: "t1", type: "text", text: "hi" }];
    expect(applyJobCompletion(blocks, "nope", "failed")).toBe(blocks);
  });
});

describe("applyAgentEvent — HITL approval lifecycle", () => {
  it("surfaces a pending_approval box then resolves it to running on approval", () => {
    // The box appears, awaits approval (UI renders approve/deny), then the
    // server's post-approval update flips it to running in place.
    const afterPending = fold([
      { type: "block_start", block: { id: "c1", type: "command", command: "rm", status: "pending" } },
      { type: "block_update", block: { id: "c1", type: "command", command: "rm", status: "pending_approval" } },
    ]);
    expect(afterPending[0]).toMatchObject({ id: "c1", status: "pending_approval" });

    const afterApprove = applyAgentEvent(afterPending, {
      type: "block_update",
      block: { id: "c1", type: "command", command: "rm", status: "running" },
    });
    expect(afterApprove).toHaveLength(1);
    expect(afterApprove[0]).toMatchObject({ id: "c1", status: "running" });
  });

  it("resolves a denied box to denied without adding a block", () => {
    const denied = fold([
      { type: "block_start", block: { id: "e1", type: "edit", path: "a.ts", status: "pending" } },
      { type: "block_update", block: { id: "e1", type: "edit", path: "a.ts", status: "pending_approval" } },
      { type: "block_end", block: { id: "e1", type: "edit", path: "a.ts", status: "denied" } },
    ]);
    expect(denied).toHaveLength(1);
    expect(denied[0]).toMatchObject({ id: "e1", status: "denied" });
  });

  it("carries a job box through pending_approval → running with an adopted jobId", () => {
    const blocks = fold([
      { type: "block_start", block: { id: "j1", type: "job", jobId: "", label: "build", status: "pending" } },
      { type: "block_update", block: { id: "j1", type: "job", jobId: "", label: "build", status: "pending_approval" } },
      { type: "block_update", block: { id: "j1", type: "job", jobId: "job-7", label: "build", status: "running" } },
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ id: "j1", jobId: "job-7", status: "running" });
  });
});

describe("isTerminalEvent", () => {
  it("flags done and error only", () => {
    expect(isTerminalEvent({ type: "done", blocks: [], content: "" })).toBe(true);
    expect(isTerminalEvent({ type: "error", message: "x" })).toBe(true);
    expect(isTerminalEvent({ type: "text_delta", id: "t", delta: "a" })).toBe(false);
  });
});
