import { describe, it, expect } from "vitest";
import {
  blockDotIntent,
  isToolBlock,
  flattenBlocksToText,
  TOOL_FAILURE_STATUSES,
  type AssistantBlock,
  type CommandBlock,
  type EditBlock,
  type JobBlock,
  type McpBlock,
  type TextBlock,
  type ThinkingBlock,
} from "@shared/chatBlocks";

const text: TextBlock = { id: "t1", type: "text", text: "hello world" };
const thinking: ThinkingBlock = {
  id: "k1",
  type: "thinking",
  text: "let me reason",
  done: true,
};
const command = (status: CommandBlock["status"]): CommandBlock => ({
  id: "c1",
  type: "command",
  command: "pnpm",
  args: ["build"],
  cwd: "/repo",
  status,
  output: "done",
});
const edit = (status: EditBlock["status"]): EditBlock => ({
  id: "e1",
  type: "edit",
  path: "src/foo.ts",
  status,
});
const job = (status: JobBlock["status"]): JobBlock => ({
  id: "j1",
  type: "job",
  jobId: "job_123",
  label: "pnpm build",
  status,
});
const mcp: McpBlock = {
  id: "m1",
  type: "mcp",
  tool: "search",
  status: "success",
  result: "ok",
};

describe("isToolBlock", () => {
  it("classifies command/edit/job/mcp as tool boxes", () => {
    expect(isToolBlock(command("success"))).toBe(true);
    expect(isToolBlock(edit("success"))).toBe(true);
    expect(isToolBlock(job("running"))).toBe(true);
    expect(isToolBlock(mcp)).toBe(true);
  });

  it("excludes text and thinking", () => {
    expect(isToolBlock(text)).toBe(false);
    expect(isToolBlock(thinking)).toBe(false);
  });
});

describe("blockDotIntent", () => {
  it("text and thinking are idle", () => {
    expect(blockDotIntent(text)).toBe("idle");
    expect(blockDotIntent(thinking)).toBe("idle");
  });

  it("maps tool statuses to dot intent", () => {
    expect(blockDotIntent(command("success"))).toBe("success");
    expect(blockDotIntent(command("error"))).toBe("error");
    expect(blockDotIntent(command("denied"))).toBe("error");
    expect(blockDotIntent(command("running"))).toBe("running");
    expect(blockDotIntent(command("pending"))).toBe("idle");
    expect(blockDotIntent(command("pending_approval"))).toBe("idle");
  });

  it("maps job statuses to dot intent", () => {
    expect(blockDotIntent(job("completed"))).toBe("success");
    expect(blockDotIntent(job("failed"))).toBe("error");
    expect(blockDotIntent(job("cancelled"))).toBe("error");
    expect(blockDotIntent(job("running"))).toBe("running");
    expect(blockDotIntent(job("pending"))).toBe("idle");
  });
});

describe("TOOL_FAILURE_STATUSES", () => {
  it("contains exactly the red-dot tool statuses", () => {
    expect([...TOOL_FAILURE_STATUSES].sort()).toEqual(["denied", "error"]);
  });
});

describe("flattenBlocksToText", () => {
  it("keeps prose, omits reasoning, and summarizes tool boxes", () => {
    const blocks: AssistantBlock[] = [
      text,
      thinking,
      command("success"),
      edit("pending_approval"),
      job("running"),
      mcp,
    ];
    const out = flattenBlocksToText(blocks);
    expect(out).toContain("hello world");
    expect(out).not.toContain("let me reason");
    expect(out).toContain("$ pnpm build");
    expect(out).toContain("[edit: src/foo.ts — pending_approval]");
    expect(out).toContain("[job: pnpm build — running]");
    expect(out).toContain("[tool: search — success]");
  });

  it("returns an empty string for no blocks", () => {
    expect(flattenBlocksToText([])).toBe("");
  });
});
