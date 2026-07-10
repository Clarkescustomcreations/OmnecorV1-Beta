/**
 * Native renderers for the agentic assistant blocks — the mobile port of
 * `client/src/components/chat/agentic/AgenticBlocks.tsx`.
 *
 * Each tool action (command / edit / job / mcp) renders as a compact chip with a
 * status dot; tapping it opens a shared detail overlay owned by the parent
 * `AssistantStream` (one Modal, not one-per-box). A box awaiting a Human-in-the-
 * Loop decision shows an inline Approve / Deny row. The status-dot colour comes
 * from the shared `blockDotIntent` helper so web + APK stay in lockstep.
 *
 * Per the mobile design (Claude-Code-APK style, remote-controlling the PC): full
 * command output and file diffs are collapsed behind the chip — the chip itself
 * is the "the AI is doing X" signal; the overlay carries the detail, with diffs
 * shown as a simplified, dependency-free line view rather than a full patch.
 */
import { useState } from "react";
import { View, Text, TextInput, ActivityIndicator } from "react-native";
import { Pressable } from "@/components/pressable";
import { useColors } from "@/hooks/use-colors";
import {
  blockDotIntent,
  type AssistantBlock,
  type CommandBlock,
  type EditBlock,
  type JobBlock,
  type McpBlock,
  type SubAgentBlock,
  type FileDiff,
} from "@/lib/_core/agent-blocks";

type ToolBlock = CommandBlock | EditBlock | JobBlock | McpBlock | SubAgentBlock;

// ── Status dot ───────────────────────────────────────────────────────────────

const DOT_BG: Record<ReturnType<typeof blockDotIntent>, string> = {
  success: "bg-success",
  error: "bg-error",
  running: "bg-accentCyan",
  idle: "bg-muted",
};

export function StatusDot({ block }: { block: AssistantBlock }) {
  const intent = blockDotIntent(block);
  return <View className={`w-2 h-2 rounded-full ${DOT_BG[intent]}`} />;
}

/** Human status label shown on the right of a box. */
export function statusLabel(block: ToolBlock): string {
  if (block.status === "pending_approval") return "awaiting approval";
  if (block.type === "command" && block.status === "success" && typeof block.exitCode === "number") {
    return `exit ${block.exitCode}`;
  }
  return block.status;
}

const TOOL_ICON: Record<ToolBlock["type"], string> = {
  command: "⌘",
  edit: "✎",
  job: "⚙",
  mcp: "🔧",
  subagent: "🕸",
};

/** One-line title for a tool block's chip + overlay header. */
export function blockTitle(block: ToolBlock): string {
  switch (block.type) {
    case "command":
      return [block.command, ...(block.args ?? [])].join(" ") || "(empty command)";
    case "edit":
      return block.path || "(no path)";
    case "job":
      return block.label;
    case "mcp":
      return block.title ?? block.tool;
    case "subagent":
      return `${block.nodeName ?? block.nodeId} — ${block.label}`;
  }
}

// ── HITL approve / deny (inline on a pending_approval box) ────────────────────

export interface ApprovalControls {
  onApprove: (id: string) => void;
  onDeny: (id: string, reason?: string) => void;
}

function ApprovalRow({ id, onApprove, onDeny }: { id: string } & ApprovalControls) {
  const colors = useColors();
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState("");

  if (denying) {
    return (
      <View className="flex-row items-center gap-1.5 mt-2">
        <TextInput
          autoFocus
          testID={`input-deny-reason-${id}`}
          value={reason}
          onChangeText={setReason}
          placeholder="Reason (optional)"
          placeholderTextColor={colors.muted}
          className="flex-1 bg-background border border-border rounded-lg px-2 py-1.5 text-xs text-foreground"
          onSubmitEditing={() => onDeny(id, reason.trim() || undefined)}
        />
        <Pressable testID={`btn-deny-confirm-${id}`} onPress={() => onDeny(id, reason.trim() || undefined)}
          className="bg-error rounded-lg px-2.5 py-1.5 active:opacity-80">
          <Text className="text-xs font-semibold text-background">Deny</Text>
        </Pressable>
        <Pressable testID={`btn-deny-cancel-${id}`} onPress={() => setDenying(false)}
          className="rounded-lg px-2 py-1.5 active:opacity-60">
          <Text className="text-xs text-muted">Cancel</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="flex-row items-center gap-2 mt-2">
      <Pressable testID={`btn-approve-${id}`} onPress={() => onApprove(id)}
        className="flex-row items-center gap-1 bg-success rounded-lg px-3 py-1.5 active:opacity-80">
        <Text className="text-xs font-semibold text-background">✓ Approve</Text>
      </Pressable>
      <Pressable testID={`btn-deny-${id}`} onPress={() => setDenying(true)}
        className="flex-row items-center gap-1 bg-surface border border-border rounded-lg px-3 py-1.5 active:opacity-70">
        <Text className="text-xs font-semibold text-foreground">⊘ Deny</Text>
      </Pressable>
    </View>
  );
}

// ── Tool chip (tap → parent-owned overlay) ────────────────────────────────────

export function ToolChip({
  block,
  onOpen,
  approval,
}: {
  block: ToolBlock;
  onOpen: (block: ToolBlock) => void;
  approval?: ApprovalControls;
}) {
  const colors = useColors();
  const pending = block.status === "pending_approval";
  return (
    <View
      className={`rounded-md border bg-card px-2.5 py-2 ${pending ? "border-warning" : "border-border"}`}
    >
      <Pressable
        testID={`toolbox-${block.type}-${block.id}`}
        onPress={() => onOpen(block)}
        className="flex-row items-center gap-2"
      >
        <StatusDot block={block} />
        <Text className="text-xs">{TOOL_ICON[block.type]}</Text>
        <Text className="flex-1 text-xs font-mono text-foreground" numberOfLines={1}>
          {blockTitle(block)}
        </Text>
        <View className="flex-row items-center gap-1">
          {block.status === "running" && <ActivityIndicator size="small" color={colors.primary} />}
          <Text className="text-[10px] text-muted" numberOfLines={1}>{statusLabel(block)}</Text>
          <Text className="text-[10px] text-muted">›</Text>
        </View>
      </Pressable>
      {pending && approval && <ApprovalRow id={block.id} {...approval} />}
    </View>
  );
}

// ── Simplified line diff (dependency-free) ───────────────────────────────────

interface DiffRow {
  sign: "+" | "-" | " ";
  text: string;
}

/**
 * A compact LCS-based line diff — enough for the small search/replace edits the
 * agent makes, without pulling the `diff` package into the mobile bundle. Rows
 * are capped so a huge file rewrite doesn't blow up the overlay.
 */
export function computeLineDiff(before: string, after: string, cap = 200): { rows: DiffRow[]; truncated: boolean } {
  const a = before.length ? before.split("\n") : [];
  const b = after.length ? after.split("\n") : [];
  // LCS table (bounded — skip the algorithm for very large inputs, just show after).
  if (a.length * b.length > 400_000) {
    const rows = b.slice(0, cap).map((text) => ({ sign: "+" as const, text }));
    return { rows, truncated: b.length > cap };
  }
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      rows.push({ sign: " ", text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      rows.push({ sign: "-", text: a[i++] });
    } else {
      rows.push({ sign: "+", text: b[j++] });
    }
  }
  while (i < a.length) rows.push({ sign: "-", text: a[i++] });
  while (j < b.length) rows.push({ sign: "+", text: b[j++] });
  return { rows: rows.slice(0, cap), truncated: rows.length > cap };
}

export function DiffView({ diff, path }: { diff: FileDiff; path: string }) {
  if (diff.before === diff.after) {
    return <Text className="text-xs text-muted italic">No changes.</Text>;
  }
  const { rows, truncated } = computeLineDiff(diff.before, diff.after);
  return (
    <View className="rounded-md border border-border overflow-hidden">
      {rows.map((r, idx) => (
        <Text
          key={`${idx}-${r.sign}`}
          className={`text-[11px] font-mono px-2 py-0.5 ${
            r.sign === "+" ? "text-success bg-success/10" : r.sign === "-" ? "text-error bg-error/10" : "text-muted"
          }`}
        >
          {r.sign}
          {r.text || " "}
        </Text>
      ))}
      {truncated && <Text className="text-[10px] text-muted italic px-2 py-1">… diff truncated</Text>}
      <Text className="text-[10px] text-muted px-2 py-1 border-t border-border" numberOfLines={1}>{path}</Text>
    </View>
  );
}

// ── Detail body for the shared overlay ───────────────────────────────────────

function OutputPre({ output }: { output?: string }) {
  if (!output) return <Text className="text-xs text-muted italic">No output.</Text>;
  return (
    <View className="bg-background rounded-md p-2 border border-border">
      <Text className="text-[11px] font-mono text-foreground">{output}</Text>
    </View>
  );
}

/** The scrollable body rendered inside the parent's overlay for a tapped block. */
export function BlockDetail({ block }: { block: ToolBlock }) {
  switch (block.type) {
    case "command":
      return (
        <View className="gap-2">
          {block.cwd ? <Text className="text-[11px] text-muted">cwd: {block.cwd}</Text> : null}
          <OutputPre output={block.output} />
        </View>
      );
    case "edit":
      return block.diff ? (
        <DiffView diff={block.diff} path={block.path} />
      ) : (
        <Text className="text-xs text-muted italic">Diff not computed.</Text>
      );
    case "job":
      return (
        <View className="gap-2">
          {block.command ? (
            <Text className="text-[11px] font-mono text-muted">
              {[block.command, ...(block.args ?? [])].join(" ")}
            </Text>
          ) : null}
          {typeof block.progress === "number" ? (
            <Text className="text-xs text-muted">{block.progress}%</Text>
          ) : null}
          <OutputPre output={block.output} />
        </View>
      );
    case "mcp": {
      let argsStr = "";
      try {
        argsStr = JSON.stringify(block.args ?? {}, null, 2);
      } catch {
        argsStr = String(block.args ?? "");
      }
      return (
        <View className="gap-2">
          <Text className="text-[11px] font-semibold text-muted">Arguments</Text>
          <View className="bg-background rounded-md p-2 border border-border">
            <Text className="text-[11px] font-mono text-foreground">{argsStr}</Text>
          </View>
          <Text className="text-[11px] font-semibold text-muted">Result</Text>
          <OutputPre output={block.result} />
        </View>
      );
    }
    case "subagent":
      return (
        <View className="gap-2">
          <Text className="text-[11px] text-muted">Task: {block.label}</Text>
          {block.scopePath ? (
            <Text className="text-[11px] font-mono text-muted">scope: {block.scopePath}</Text>
          ) : null}
          {block.modelId ? <Text className="text-[11px] text-muted">model: {block.modelId}</Text> : null}
          {block.conversationId ? (
            <Text className="text-[11px] text-accentCyan">Open the “{block.nodeName ?? block.nodeId}” chat in the list to watch it live.</Text>
          ) : null}
          <Text className="text-[11px] font-semibold text-muted">Result</Text>
          <OutputPre output={block.output} />
        </View>
      );
  }
}

export function overlayTitle(block: ToolBlock): string {
  return `${TOOL_ICON[block.type]}  ${blockTitle(block)}`;
}

// ── Thinking section — collapsible, default-closed ───────────────────────────

export function ThinkingSection({ text, done }: { text: string; done: boolean }) {
  const colors = useColors();
  const [open, setOpen] = useState(false);
  return (
    <View>
      <Pressable
        testID="btn-thinking-toggle"
        onPress={() => setOpen((v) => !v)}
        className="flex-row items-center gap-1.5 py-0.5"
      >
        <Text className="text-[11px] text-muted">{open ? "▾" : "▸"}</Text>
        <Text className="text-[11px] text-muted">{done ? "Reasoning" : "Reasoning…"}</Text>
        {!done && <ActivityIndicator size="small" color={colors.muted} />}
      </Pressable>
      {open && (
        <View className="mt-1 ml-3 pl-2 border-l border-border">
          <Text className="text-[11px] text-muted">{text}</Text>
        </View>
      )}
    </View>
  );
}

export type { ToolBlock };
