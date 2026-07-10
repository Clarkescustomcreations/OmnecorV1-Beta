import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "events";
import {
  ChatAgentRunner,
  countLineChanges,
  buildFileDiff,
  extractFirstJsonObject,
  parseToolCallText,
  type AgentRunParams,
} from "../ChatAgentRunner.js";
import { ToolApprovalRegistry } from "../ToolApprovalRegistry.js";
import type { ChatChunk, ChatInput, NativeToolCall } from "../AiProviderService.js";
import type { AgentStreamEvent } from "@shared/chatAgentEvents";
import type { AssistantBlock } from "@shared/chatBlocks";

/**
 * A scripted fake AiProvider. Each element of `turns` is the sequence of raw
 * text deltas the model emits for that model↔tool round-trip. The runner drives
 * one turn per `streamChat` call, so the Nth call replays `turns[N-1]`.
 */
function fakeAiProvider(turns: string[][]) {
  let call = 0;
  return {
    async *streamChat(): AsyncGenerator<ChatChunk> {
      const deltas = turns[call++] ?? [""];
      let content = "";
      for (let i = 0; i < deltas.length; i++) {
        content += deltas[i];
        const done = i === deltas.length - 1;
        yield { content, delta: deltas[i], done, totalTokens: content.length };
      }
    },
  };
}

/**
 * A scripted fake AiProvider for the NATIVE tool protocol. Each element of
 * `turns` is one model↔tool round-trip: `deltas` stream as prose exactly like
 * `fakeAiProvider`, and an optional `toolCalls` array rides on the terminal
 * chunk (mirroring what AiProviderService assembles for OpenAI/Anthropic/
 * Ollama once a native tool-call finishes streaming). `onCall` — when given —
 * receives the exact `ChatInput` the runner built for that turn, so a test can
 * assert the native protocol's encode() output (system prompt, `tools`).
 */
function fakeNativeAiProvider(
  turns: Array<{ deltas: string[]; toolCalls?: NativeToolCall[] }>,
  onCall?: (chatInput: ChatInput) => void,
) {
  let call = 0;
  return {
    async *streamChat(chatInput: ChatInput): AsyncGenerator<ChatChunk> {
      onCall?.(chatInput);
      const turn = turns[call++] ?? { deltas: [""] };
      let content = "";
      for (let i = 0; i < turn.deltas.length; i++) {
        content += turn.deltas[i];
        const done = i === turn.deltas.length - 1;
        const chunk: ChatChunk = { content, delta: turn.deltas[i], done, totalTokens: content.length };
        if (done && turn.toolCalls) chunk.toolCalls = turn.toolCalls;
        yield chunk;
      }
    },
  };
}

/** Minimal ProcessManager fake: an EventEmitter that completes jobs on demand. */
class FakeProcessManager extends EventEmitter {
  public spawned: Array<{ command: string; args: string[]; cwd?: string; label?: string }> = [];
  private captured = new Map<string, { stdoutTail: string[]; stderr: string }>();
  private states = new Map<string, string>();
  constructor(private readonly onSpawn?: (jobId: string) => void) {
    super();
  }
  async spawn(cfg: { command: string; args: string[]; cwd?: string; label?: string }): Promise<string> {
    const jobId = `job-${this.spawned.length + 1}`;
    this.spawned.push({ command: cfg.command, args: cfg.args, cwd: cfg.cwd, label: cfg.label });
    this.states.set(jobId, "running");
    this.captured.set(jobId, { stdoutTail: ["line-1", "line-2"], stderr: "" });
    // Complete on a later tick so waitForLifecycle attaches its listener first.
    setTimeout(() => {
      this.states.set(jobId, "completed");
      this.emit("lifecycle", {
        jobId,
        type: "custom",
        label: cfg.label ?? "",
        state: "completed",
        exitCode: 0,
        error: null,
        timestamp: new Date().toISOString(),
        durationMs: 5,
      });
    }, 0);
    this.onSpawn?.(jobId);
    return jobId;
  }
  getJobStatus(jobId: string) {
    const state = this.states.get(jobId);
    if (!state) return null;
    return { jobId, type: "custom", label: "", state, pid: 1, startedAt: null, completedAt: null, lastProgress: null, stderrBuffer: "" };
  }
  getCapturedOutput(jobId: string) {
    return this.captured.get(jobId) ?? null;
  }
  async cancelJob() {
    return true;
  }
}

/** Drain a runner generator, resolving any HITL approval via `decide`. */
async function drain(
  runner: ChatAgentRunner,
  params: AgentRunParams,
  approvals?: ToolApprovalRegistry,
  decide?: (block: AssistantBlock) => { decision: "approve" | "deny"; denyReason?: string },
): Promise<AgentStreamEvent[]> {
  const events: AgentStreamEvent[] = [];
  for await (const ev of runner.run(params)) {
    events.push(ev);
    if (ev.type === "block_update" && "status" in ev.block && ev.block.status === "pending_approval" && approvals && decide) {
      const { decision, denyReason } = decide(ev.block);
      const id = ev.block.id;
      const uid = params.userId;
      // Resolve once the runner has registered its wait (just after the next()
      // that follows this yield). Poll briefly until it lands.
      const tick = () => {
        if (!approvals.resolve(id, uid, decision, denyReason)) setTimeout(tick, 2);
      };
      setTimeout(tick, 2);
    }
  }
  return events;
}

const baseInput = {
  providerId: "ollama",
  modelId: "llama3.2:latest",
  messages: [{ role: "user" as const, content: "hi" }],
};

describe("ChatAgentRunner — prose streaming", () => {
  it("streams a plain answer as text deltas and a flattened done payload", async () => {
    const runner = new ChatAgentRunner({ aiProvider: fakeAiProvider([["Hello ", "world", "!"]]) });
    const events = await drain(runner, { input: baseInput });

    const text = events.filter((e) => e.type === "text_delta").map((e) => (e as { delta: string }).delta).join("");
    expect(text).toBe("Hello world!");

    const done = events.at(-1);
    expect(done?.type).toBe("done");
    if (done?.type === "done") {
      expect(done.content).toBe("Hello world!");
      expect(done.blocks).toHaveLength(1);
      expect(done.blocks[0].type).toBe("text");
      expect(done.totalTokens).toBeGreaterThan(0);
    }
  });

  it("never leaks a <tool_call> tag into prose even when split across deltas", async () => {
    // The opening tag is fragmented across three deltas.
    const runner = new ChatAgentRunner({
      aiProvider: fakeAiProvider([
        ["Working. ", "<tool", "_call>", '{"action":"noop_final"}', "</tool_call>"],
        ["Done."],
      ]),
      callMcpTool: async () => "ok",
    });
    const events = await drain(runner, { input: baseInput });
    const prose = events.filter((e) => e.type === "text_delta").map((e) => (e as { delta: string }).delta).join("");
    // Both prose segments (turn 1 before the tag + turn 2 after the tool) arrive,
    // but the <tool_call> markup itself is never emitted as prose.
    expect(prose).toBe("Working. Done.");
    expect(prose).not.toContain("<tool");
    expect(prose).not.toContain("noop_final");
  });
});

describe("ChatAgentRunner — reasoning (<think>) split", () => {
  it("routes <think> content to a thinking block and keeps it out of prose", async () => {
    const runner = new ChatAgentRunner({
      aiProvider: fakeAiProvider([["<think>Let me plan.</think>The answer is 42."]]),
    });
    const events = await drain(runner, { input: baseInput });

    const reasoning = events.filter((e) => e.type === "thinking_delta").map((e) => (e as { delta: string }).delta).join("");
    const prose = events.filter((e) => e.type === "text_delta").map((e) => (e as { delta: string }).delta).join("");
    expect(reasoning).toBe("Let me plan.");
    expect(prose).toBe("The answer is 42.");
    expect(prose).not.toContain("<think>");

    const done = events.at(-1);
    if (done?.type === "done") {
      const thinking = done.blocks.find((b) => b.type === "thinking");
      expect(thinking && thinking.type === "thinking" && thinking.done).toBe(true);
      // flattened content is the answer only — reasoning is never persisted as text.
      expect(done.content).toBe("The answer is 42.");
    }
  });

  it("handles <think>/</think> tags fragmented across deltas without leaking", async () => {
    const runner = new ChatAgentRunner({
      aiProvider: fakeAiProvider([["<thi", "nk>reason", "ing bits", "</thi", "nk>", "Final ", "answer."]]),
    });
    const events = await drain(runner, { input: baseInput });
    const reasoning = events.filter((e) => e.type === "thinking_delta").map((e) => (e as { delta: string }).delta).join("");
    const prose = events.filter((e) => e.type === "text_delta").map((e) => (e as { delta: string }).delta).join("");
    expect(reasoning).toBe("reasoning bits");
    expect(prose).toBe("Final answer.");
    expect(prose).not.toContain("think");
  });

  it("still parses a tool call that follows a reasoning block", async () => {
    const callMcpTool = vi.fn(async () => "done");
    const runner = new ChatAgentRunner({
      aiProvider: fakeAiProvider([
        ['<think>I should search.</think>Searching.\n<tool_call>{"action":"web_search","args":{"q":"x"}}</tool_call>'],
        ["Here you go."],
      ]),
      callMcpTool,
    });
    const events = await drain(runner, { input: baseInput });
    expect(callMcpTool).toHaveBeenCalledWith("web_search", { q: "x" });
    const reasoning = events.filter((e) => e.type === "thinking_delta").map((e) => (e as { delta: string }).delta).join("");
    expect(reasoning).toBe("I should search.");
    const prose = events.filter((e) => e.type === "text_delta").map((e) => (e as { delta: string }).delta).join("");
    expect(prose).toContain("Searching.");
    expect(prose).not.toContain("<think>");
    expect(prose).not.toContain("<tool_call>");
  });

  it("routes a provider's native `thinking` field to a thinking block, separate from prose", async () => {
    // Ollama ≥0.9 (and OpenAI-compatible reasoning models) stream reasoning on a
    // dedicated field — `content` is empty during that phase. The runner must
    // open a thinking block for it, close it when prose starts, and never mix it
    // into the answer text.
    const provider = {
      async *streamChat(): AsyncGenerator<ChatChunk> {
        yield { content: "", delta: "", done: false, thinking: "Weighing " };
        yield { content: "", delta: "", done: false, thinking: "options." };
        yield { content: "The ", delta: "The ", done: false };
        yield { content: "The answer.", delta: "answer.", done: true, totalTokens: 7 };
      },
    };
    const runner = new ChatAgentRunner({ aiProvider: provider });
    const events = await drain(runner, { input: baseInput });

    const reasoning = events.filter((e) => e.type === "thinking_delta").map((e) => (e as { delta: string }).delta).join("");
    const prose = events.filter((e) => e.type === "text_delta").map((e) => (e as { delta: string }).delta).join("");
    expect(reasoning).toBe("Weighing options.");
    expect(prose).toBe("The answer.");

    const done = events.at(-1);
    expect(done?.type).toBe("done");
    if (done?.type === "done") {
      const thinking = done.blocks.find((b) => b.type === "thinking");
      expect(thinking && thinking.type === "thinking" && thinking.done).toBe(true);
      // Reasoning is never persisted into the flattened answer text.
      expect(done.content).toBe("The answer.");
    }
  });
});

describe("ChatAgentRunner — edit_file", () => {
  it("computes a diff, writes on auto-approve, and reports the result", async () => {
    const writeFile = vi.fn(async () => {});
    const runner = new ChatAgentRunner({
      aiProvider: fakeAiProvider([
        ['Creating a file.\n<tool_call>{"action":"edit_file","path":"notes.txt","content":"line one\\nline two\\n"}</tool_call>'],
        ["All set."],
      ]),
      validatePath: async (p) => p,
      readFile: async () => {
        throw new Error("ENOENT");
      },
      writeFile,
    });

    const events = await drain(runner, {
      input: baseInput,
      rootDirectories: ["/data/projects/demo"],
      autoApprove: true,
    });

    // The edit box progressed start → (diff) update → running → success.
    const editEvents = events.filter((e) => "block" in e && e.block.type === "edit");
    const last = editEvents.at(-1);
    expect(last?.type).toBe("block_end");
    if (last && last.block.type === "edit") {
      expect(last.block.status).toBe("success");
      expect(last.block.diff?.additions).toBe(2);
    }
    expect(writeFile).toHaveBeenCalledWith(expect.stringContaining("notes.txt"), "line one\nline two\n");

    const done = events.at(-1);
    expect(done?.type).toBe("done");
  });

  it("requests approval and does NOT write when the user denies", async () => {
    const writeFile = vi.fn(async () => {});
    const approvals = new ToolApprovalRegistry();
    const runner = new ChatAgentRunner({
      aiProvider: fakeAiProvider([
        ['<tool_call>{"action":"edit_file","path":"a.ts","content":"x"}</tool_call>'],
        ["Understood, leaving it."],
      ]),
      approvals,
      validatePath: async (p) => p,
      readFile: async () => "old",
      writeFile,
    });

    const events = await drain(
      runner,
      { input: baseInput, userId: 7, rootDirectories: ["/data/projects/demo"] },
      approvals,
      () => ({ decision: "deny", denyReason: "not now" }),
    );

    const editEnd = events.find((e) => e.type === "block_end" && e.block.type === "edit");
    expect(editEnd && editEnd.block.type === "edit" && editEnd.block.status).toBe("denied");
    expect(writeFile).not.toHaveBeenCalled();
    expect(events.at(-1)?.type).toBe("done");
  });

  it("refuses edits when the active map has no root directory", async () => {
    const writeFile = vi.fn(async () => {});
    const runner = new ChatAgentRunner({
      aiProvider: fakeAiProvider([
        ['<tool_call>{"action":"edit_file","path":"a.ts","content":"x"}</tool_call>'],
        ["Cannot edit."],
      ]),
      validatePath: async (p) => p,
      writeFile,
    });
    const events = await drain(runner, { input: baseInput, autoApprove: true }); // no rootDirectories
    const editEnd = events.find((e) => e.type === "block_end" && e.block.type === "edit");
    expect(editEnd && editEnd.block.type === "edit" && editEnd.block.status).toBe("error");
    expect(writeFile).not.toHaveBeenCalled();
  });
});

describe("ChatAgentRunner — run_command", () => {
  it("spawns via ProcessManager, awaits completion, and streams output", async () => {
    const pm = new FakeProcessManager();
    const runner = new ChatAgentRunner({
      aiProvider: fakeAiProvider([
        ['Running it.\n<tool_call>{"action":"run_command","command":"echo","args":["hi"]}</tool_call>'],
        ["Command finished."],
      ]),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      processManager: pm as any,
    });

    const events = await drain(runner, {
      input: baseInput,
      rootDirectories: ["/data/projects/demo"],
      autoApprove: true,
    });

    expect(pm.spawned).toHaveLength(1);
    expect(pm.spawned[0]).toMatchObject({ command: "echo", args: ["hi"], cwd: "/data/projects/demo" });

    const cmdEnd = events.find((e) => e.type === "block_end" && e.block.type === "command");
    expect(cmdEnd && cmdEnd.block.type === "command" && cmdEnd.block.status).toBe("success");
    if (cmdEnd && cmdEnd.block.type === "command") {
      expect(cmdEnd.block.output).toContain("line-1");
      expect(cmdEnd.block.exitCode).toBe(0);
    }
  });
});

describe("ChatAgentRunner — native tool protocol (Model-Fabric Phase 2)", () => {
  it("decodes a structured native tool call and executes it, with zero tool-instruction text injected into the system prompt", async () => {
    const pm = new FakeProcessManager();
    const capturedInputs: ChatInput[] = [];
    const provider = fakeNativeAiProvider(
      [
        {
          deltas: ["Running it."],
          toolCalls: [{ id: "call_1", name: "run_command", arguments: JSON.stringify({ command: "echo", args: ["hi"] }) }],
        },
        { deltas: ["Command finished."] },
      ],
      (chatInput) => capturedInputs.push(chatInput),
    );
    const runner = new ChatAgentRunner({
      aiProvider: provider,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      processManager: pm as any,
    });

    const events = await drain(runner, {
      input: { ...baseInput, systemPrompt: "You are a coding assistant.", supportsNativeTools: true },
      rootDirectories: ["/data/projects/demo"],
      autoApprove: true,
    });

    expect(pm.spawned).toHaveLength(1);
    expect(pm.spawned[0]).toMatchObject({ command: "echo", args: ["hi"], cwd: "/data/projects/demo" });

    // Native mode passes the caller's system prompt through untouched — no
    // <tool_call> instructions/example text appended (that would be prompt
    // pollution for a model that already supports native tool-calling).
    expect(capturedInputs[0].systemPrompt).toBe("You are a coding assistant.");
    expect(capturedInputs[0].tools?.map((t) => t.function.name)).toEqual(
      expect.arrayContaining(["edit_file", "run_command", "start_job"]),
    );

    const cmdEnd = events.find((e) => e.type === "block_end" && e.block.type === "command");
    expect(cmdEnd && cmdEnd.block.type === "command" && cmdEnd.block.status).toBe("success");
  });

  it("falls back to parsing a stray text <tool_call> tag when no structured tool call comes back (safety net)", async () => {
    const pm = new FakeProcessManager();
    // The model ignored the native `tools` param and emitted the text
    // convention anyway — the native protocol must still honor it.
    const provider = fakeNativeAiProvider([
      { deltas: ['Running it.\n<tool_call>{"action":"run_command","command":"echo","args":["hi"]}</tool_call>'] },
      { deltas: ["Command finished."] },
    ]);
    const runner = new ChatAgentRunner({
      aiProvider: provider,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      processManager: pm as any,
    });

    await drain(runner, {
      input: { ...baseInput, supportsNativeTools: true },
      rootDirectories: ["/data/projects/demo"],
      autoApprove: true,
    });

    expect(pm.spawned).toHaveLength(1);
    expect(pm.spawned[0]).toMatchObject({ command: "echo", args: ["hi"] });
  });

  it("recovers from malformed native tool-call arguments via a retry, without crashing", async () => {
    const provider = fakeNativeAiProvider([
      { deltas: ["Let me check."], toolCalls: [{ name: "run_command", arguments: "not json" }] },
      { deltas: ["Recovered."] },
    ]);
    const runner = new ChatAgentRunner({ aiProvider: provider });

    const events = await drain(runner, { input: { ...baseInput, supportsNativeTools: true } });
    expect(events.some((e) => e.type === "error")).toBe(false);
    const done = events.at(-1);
    expect(done?.type).toBe("done");
    if (done?.type === "done") expect(done.content).toBe("Let me check.Recovered.");
  });
});

describe("ChatAgentRunner — start_job", () => {
  it("spawns + tracks a job, emits a running job block, and ends the turn", async () => {
    const pm = new FakeProcessManager();
    const track = vi.fn();
    const streamSpy = vi.fn();
    const provider = fakeAiProvider([
      ['Kicking off the build.\n<tool_call>{"action":"start_job","command":"pnpm","args":["build"],"label":"prod build","kind":"build"}</tool_call>'],
      ["should NOT be reached"],
    ]);
    const wrapped = {
      streamChat: (...a: unknown[]) => {
        streamSpy();
        // @ts-expect-error passthrough
        return provider.streamChat(...a);
      },
    };
    const runner = new ChatAgentRunner({
      aiProvider: wrapped,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      processManager: pm as any,
      asyncJob: { track },
    });

    const events = await drain(runner, {
      input: baseInput,
      conversationId: "c1",
      userId: 3,
      rootDirectories: ["/data/projects/demo"],
      autoApprove: true,
    });

    expect(track).toHaveBeenCalledTimes(1);
    expect(track.mock.calls[0][1]).toMatchObject({ conversationId: "c1", userId: 3, label: "prod build" });

    // The job flows through a single block: pending on start, running once
    // spawned. It never emits a throwaway command box for the approval step.
    expect(events.some((e) => "block" in e && e.block.type === "command")).toBe(false);
    const jobStart = events.find((e) => e.type === "block_start" && e.block.type === "job");
    expect(jobStart && jobStart.block.type === "job" && jobStart.block.status).toBe("pending");
    if (jobStart && jobStart.block.type === "job") expect(jobStart.block.command).toBe("pnpm");

    const jobEvents = events.filter((e) => "block" in e && e.block.type === "job");
    const jobRunning = jobEvents.at(-1);
    expect(jobRunning && jobRunning.block.type === "job" && jobRunning.block.status).toBe("running");
    if (jobRunning && jobRunning.block.type === "job") {
      expect(jobRunning.block.kind).toBe("build");
      expect(jobRunning.block.jobId).toBeTruthy();
    }

    // start_job ends the turn — the model is only streamed once.
    expect(streamSpy).toHaveBeenCalledTimes(1);
    expect(events.at(-1)?.type).toBe("done");
  });
});

describe("ChatAgentRunner — MCP passthrough with nested args", () => {
  it("parses a tool call whose args are a nested object (no brace truncation)", async () => {
    const callMcpTool = vi.fn(async () => "search results");
    const runner = new ChatAgentRunner({
      aiProvider: fakeAiProvider([
        ['Searching.\n<tool_call>{"action":"web_search","args":{"query":"omnecor","limit":5}}</tool_call>'],
        ["Here is what I found."],
      ]),
      callMcpTool,
    });

    const events = await drain(runner, { input: baseInput });
    // The nested object survived parsing intact.
    expect(callMcpTool).toHaveBeenCalledWith("web_search", { query: "omnecor", limit: 5 });
    const mcpEnd = events.find((e) => e.type === "block_end" && e.block.type === "mcp");
    expect(mcpEnd && mcpEnd.block.type === "mcp" && mcpEnd.block.status).toBe("success");
  });
});

describe("ChatAgentRunner — start_job denial", () => {
  it("lets the model react after a denied job start (does not force-end the turn)", async () => {
    const pm = new FakeProcessManager();
    const track = vi.fn();
    const approvals = new ToolApprovalRegistry();
    const runner = new ChatAgentRunner({
      aiProvider: fakeAiProvider([
        ['<tool_call>{"action":"start_job","command":"pnpm","args":["build"],"label":"build"}</tool_call>'],
        ["Okay, I won't start the build."],
      ]),
      approvals,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      processManager: pm as any,
      asyncJob: { track },
    });

    const events = await drain(
      runner,
      { input: baseInput, userId: 5, rootDirectories: ["/data/projects/demo"] },
      approvals,
      () => ({ decision: "deny" }),
    );

    expect(track).not.toHaveBeenCalled();
    // The single job box ends denied — no throwaway command box is emitted.
    expect(events.some((e) => "block" in e && e.block.type === "command")).toBe(false);
    const jobEnd = events.find((e) => e.type === "block_end" && e.block.type === "job");
    expect(jobEnd && jobEnd.block.type === "job" && jobEnd.block.status).toBe("denied");
    // The second turn ran, so its acknowledgment prose is present.
    const prose = events.filter((e) => e.type === "text_delta").map((e) => (e as { delta: string }).delta).join("");
    expect(prose).toContain("won't start the build");
    expect(events.at(-1)?.type).toBe("done");
  });
});

describe("extractFirstJsonObject", () => {
  it("extracts a balanced object with nested braces and ignores trailing prose", () => {
    expect(extractFirstJsonObject('{"a":{"b":1}} trailing')).toBe('{"a":{"b":1}}');
  });
  it("respects braces inside strings", () => {
    expect(extractFirstJsonObject('{"s":"a}b{c"}')).toBe('{"s":"a}b{c"}');
  });
  it("returns null when no object is present or it is unterminated", () => {
    expect(extractFirstJsonObject("no object here")).toBeNull();
    expect(extractFirstJsonObject('{"a":1')).toBeNull();
  });
});

describe("parseToolCallText", () => {
  it("parses a properly closed <tool_call>...</tool_call>", () => {
    const parsed = parseToolCallText('Hi.\n<tool_call>{"action":"run_command","command":"echo"}</tool_call>');
    expect(parsed.error).toBeUndefined();
    expect(parsed.request).toEqual({ action: "run_command", command: "echo" });
  });

  it("also parses an UNCLOSED <tool_call>{...} with no closing tag (llama-server grammar upgrade — Model-Fabric Phase 2)", () => {
    // extractFirstJsonObject finds the balanced object itself and ignores
    // anything after it, so a grammar-guaranteed-valid object needs no
    // closing tag to parse identically to the fully-closed form.
    const parsed = parseToolCallText('Hi.\n<tool_call>{"action":"run_command","command":"echo"}');
    expect(parsed.error).toBeUndefined();
    expect(parsed.request).toEqual({ action: "run_command", command: "echo" });
  });

  it("reports an error (not silence) for a <tool_call> tag with no JSON object after it", () => {
    const parsed = parseToolCallText("Hi.\n<tool_call>not json at all");
    expect(parsed.error).toMatch(/No JSON object/);
    expect(parsed.request).toBeUndefined();
  });

  it("returns neither a request nor an error when there is no tool-call marker at all", () => {
    expect(parseToolCallText("Just a plain final answer.")).toEqual({});
  });
});

describe("ToolApprovalRegistry", () => {
  it("resolves an owned approval and rejects a cross-user resolve", async () => {
    const reg = new ToolApprovalRegistry();
    const p = reg.waitFor("blk-1", 42);
    expect(reg.resolve("blk-1", 99, "approve")).toBe(false); // wrong owner
    expect(reg.size).toBe(1);
    expect(reg.resolve("blk-1", 42, "approve")).toBe(true);
    await expect(p).resolves.toEqual({ approved: true, denyReason: undefined });
    expect(reg.size).toBe(0);
  });

  it("supersedes an earlier waiter for the same id", async () => {
    const reg = new ToolApprovalRegistry();
    const first = reg.waitFor("blk-x", 1);
    const second = reg.waitFor("blk-x", 1);
    await expect(first).resolves.toMatchObject({ approved: false });
    reg.resolve("blk-x", 1, "approve");
    await expect(second).resolves.toMatchObject({ approved: true });
  });
});

describe("diff helpers", () => {
  it("counts additions and deletions via line LCS", () => {
    expect(countLineChanges("a\nb\nc", "a\nB\nc")).toEqual({ additions: 1, deletions: 1 });
    expect(countLineChanges("", "x\ny")).toEqual({ additions: 2, deletions: 0 });
    expect(countLineChanges("x\ny", "")).toEqual({ additions: 0, deletions: 2 });
  });

  it("derives a language hint from the file extension", () => {
    expect(buildFileDiff("", "code", "src/app.tsx").language).toBe("tsx");
    expect(buildFileDiff("", "code", "noext").language).toBeUndefined();
  });
});

describe("ChatAgentRunner — delegate_task (Mesh-Delegation.md)", () => {
  const delegateInput = {
    ...baseInput,
    messages: [{ role: "user" as const, content: "delegate a build" }],
  };

  it("is not offered (and refuses) when allowDelegation is unset", async () => {
    // A run without allowDelegation never advertises delegate_task; if the model
    // emits it anyway (or it's a delegated run on a peer) it must be refused so
    // delegation cannot chain peer-to-peer.
    const delegate = vi.fn(async () => ({ taskId: "t1", conversationId: "c1", nodeName: "peerA" }));
    const runner = new ChatAgentRunner({
      aiProvider: fakeAiProvider([
        ['<tool_call>{"action":"delegate_task","node":"peerA","task":"build it"}</tool_call>'],
        ["Cannot delegate."],
      ]),
      delegate,
      listPeerNames: () => ["peerA"],
    });
    const events = await drain(runner, { input: delegateInput }); // allowDelegation NOT set
    expect(delegate).not.toHaveBeenCalled();
    // No subagent block should have been created for a refused delegation.
    expect(events.some((e) => "block" in e && e.block.type === "subagent")).toBe(false);
    expect(events.at(-1)?.type).toBe("done");
  });

  it("HITL-gates the spawn, launches on approval, and ends the turn", async () => {
    const approvals = new ToolApprovalRegistry();
    const delegate = vi.fn(async () => ({ taskId: "task-9", conversationId: "conv-9", nodeName: "DadsPC" }));
    const runner = new ChatAgentRunner({
      aiProvider: fakeAiProvider([
        ['On it.\n<tool_call>{"action":"delegate_task","node":"DadsPC","task":"run the suite","label":"suite"}</tool_call>'],
        ["(should not reach a second turn — delegation ends the turn)"],
      ]),
      approvals,
      delegate,
      listPeerNames: () => ["DadsPC"],
    });

    const events = await drain(
      runner,
      { input: delegateInput, userId: 42, allowDelegation: true },
      approvals,
      () => ({ decision: "approve" }),
    );

    expect(delegate).toHaveBeenCalledTimes(1);
    expect(delegate.mock.calls[0][0]).toMatchObject({ targetNodeId: "DadsPC", task: "run the suite", label: "suite", userId: 42 });

    const subEvents = events.filter((e) => "block" in e && e.block.type === "subagent");
    const last = subEvents.at(-1);
    expect(last && last.block.type === "subagent" && last.block.status).toBe("running");
    if (last && last.block.type === "subagent") {
      expect(last.block.taskId).toBe("task-9");
      expect(last.block.conversationId).toBe("conv-9");
      expect(last.block.nodeName).toBe("DadsPC");
    }
    // start_job-style: the delegation ends the turn (no second model call).
    expect(events.at(-1)?.type).toBe("done");
  });

  it("does not spawn when the user denies the delegation", async () => {
    const approvals = new ToolApprovalRegistry();
    const delegate = vi.fn(async () => ({ taskId: "x", conversationId: "y", nodeName: "peerA" }));
    const runner = new ChatAgentRunner({
      aiProvider: fakeAiProvider([
        ['<tool_call>{"action":"delegate_task","node":"peerA","task":"do it"}</tool_call>'],
        ["OK, I won't."],
      ]),
      approvals,
      delegate,
      listPeerNames: () => ["peerA"],
    });
    const events = await drain(
      runner,
      { input: delegateInput, userId: 1, allowDelegation: true },
      approvals,
      () => ({ decision: "deny", denyReason: "not that node" }),
    );
    expect(delegate).not.toHaveBeenCalled();
    const end = events.find((e) => e.type === "block_end" && e.block.type === "subagent");
    expect(end && end.block.type === "subagent" && end.block.status).toBe("denied");
    // The runner gets a turn to acknowledge the denial → the run completes.
    expect(events.at(-1)?.type).toBe("done");
  });

  it("fails cleanly when the target node is not discoverable", async () => {
    const delegate = vi.fn(async () => ({ taskId: "x", conversationId: "y", nodeName: "peerA" }));
    const runner = new ChatAgentRunner({
      aiProvider: fakeAiProvider([
        ['<tool_call>{"action":"delegate_task","node":"ghost","task":"do it"}</tool_call>'],
        ["That node is offline."],
      ]),
      delegate,
      listPeerNames: () => ["peerA", "peerB"],
    });
    const events = await drain(runner, { input: delegateInput, userId: 1, allowDelegation: true });
    expect(delegate).not.toHaveBeenCalled();
    const end = events.find((e) => e.type === "block_end" && e.block.type === "subagent");
    expect(end && end.block.type === "subagent" && end.block.status).toBe("failed");
  });
});
