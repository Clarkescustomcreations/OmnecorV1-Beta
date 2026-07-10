/**
 * Renderers for the individual agentic assistant blocks: the collapsible
 * thinking section, the click-to-expand tool boxes (command / edit / job / mcp)
 * with status dots and inline HITL approve/deny, and the hunk-only diff view
 * used inside the edit-box overlay.
 *
 * Each tool box is a compact chip; clicking it opens a Radix `Dialog` overlay
 * (Esc-to-close, focus-trapped) with the full detail. The status dot colour is
 * driven by the shared `blockDotIntent` helper so web + APK stay in lockstep.
 */
import { useMemo, useState } from "react";
import {
  Terminal,
  FilePen,
  Hammer,
  Wrench,
  ChevronRight,
  Loader2,
  Check,
  X,
  Ban,
  Network,
  ExternalLink,
} from "lucide-react";
import { Streamdown } from "streamdown";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { structuredPatch } from "diff";
import {
  blockDotIntent,
  type AssistantBlock,
  type CommandBlock,
  type EditBlock,
  type JobBlock,
  type McpBlock,
  type SubAgentBlock,
  type FileDiff,
} from "@shared/chatBlocks";

// ---------------------------------------------------------------------------
// Status dot
// ---------------------------------------------------------------------------

const DOT_CLASS: Record<ReturnType<typeof blockDotIntent>, string> = {
  success: "bg-accent-success",
  error: "bg-destructive",
  running: "bg-accent-cyan animate-pulse",
  idle: "bg-muted-foreground/40",
};

function StatusDot({ block }: { block: AssistantBlock }) {
  const intent = blockDotIntent(block);
  return (
    <span
      className={cn("inline-block w-2 h-2 rounded-full flex-shrink-0", DOT_CLASS[intent])}
      aria-hidden
    />
  );
}

/** Human status label shown on the right of a box. */
function statusLabel(block: CommandBlock | EditBlock | JobBlock | McpBlock | SubAgentBlock): string {
  if (block.status === "pending_approval") return "awaiting approval";
  if (block.type === "command" && block.status === "success" && typeof block.exitCode === "number") {
    return `exit ${block.exitCode}`;
  }
  return block.status;
}

// ---------------------------------------------------------------------------
// HITL approve / deny (inline on a pending_approval box)
// ---------------------------------------------------------------------------

interface ApprovalControls {
  onApprove: (id: string) => void;
  onDeny: (id: string, reason?: string) => void;
}

function ApprovalRow({ id, onApprove, onDeny }: { id: string } & ApprovalControls) {
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState("");
  if (denying) {
    return (
      <div className="flex items-center gap-1.5 mt-2" onClick={(e) => e.stopPropagation()}>
        <Input
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onDeny(id, reason.trim() || undefined)}
          placeholder="Reason (optional) — fed back to the AI"
          className="h-6 text-xs"
        />
        <Button size="sm" variant="destructive" className="h-6 text-[11px] px-2"
          onClick={() => onDeny(id, reason.trim() || undefined)}>
          Deny
        </Button>
        <Button size="sm" variant="ghost" className="h-6 text-[11px] px-2"
          onClick={() => setDenying(false)}>
          Cancel
        </Button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5 mt-2" onClick={(e) => e.stopPropagation()}>
      <Button size="sm" className="h-6 text-[11px] px-2 gap-1 bg-accent-success/90 hover:bg-accent-success text-white"
        onClick={() => onApprove(id)}>
        <Check className="w-3 h-3" /> Approve
      </Button>
      <Button size="sm" variant="outline" className="h-6 text-[11px] px-2 gap-1"
        onClick={() => setDenying(true)}>
        <Ban className="w-3 h-3" /> Deny
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Generic box chrome
// ---------------------------------------------------------------------------

function BoxChip({
  block,
  icon,
  title,
  subtitle,
  onOpen,
  approval,
}: {
  block: CommandBlock | EditBlock | JobBlock | McpBlock | SubAgentBlock;
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  onOpen: () => void;
  approval?: ApprovalControls;
}) {
  const pending = block.status === "pending_approval";
  return (
    <div
      className={cn(
        "rounded-md border bg-card/60 px-2.5 py-1.5 text-xs transition-colors",
        pending ? "border-accent-warning/50" : "border-border hover:border-border/80",
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex items-center gap-2 w-full text-left min-w-0"
      >
        <StatusDot block={block} />
        <span className="text-muted-foreground flex-shrink-0">{icon}</span>
        <span className="font-mono truncate text-foreground/90">{title}</span>
        {subtitle && <span className="text-muted-foreground/70 truncate hidden sm:inline">{subtitle}</span>}
        <span className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground/70 flex-shrink-0">
          {block.status === "running" && <Loader2 className="w-3 h-3 animate-spin" />}
          {statusLabel(block)}
          <ChevronRight className="w-3 h-3" />
        </span>
      </button>
      {pending && approval && <ApprovalRow id={block.id} {...approval} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hunk-only diff view (edit overlay)
// ---------------------------------------------------------------------------

export function DiffView({ diff, path }: { diff: FileDiff; path: string }) {
  const hunks = useMemo(() => {
    try {
      return structuredPatch(path, path, diff.before, diff.after, "", "", { context: 3 }).hunks;
    } catch {
      return [];
    }
  }, [diff.before, diff.after, path]);

  if (hunks.length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic">
        {diff.before === diff.after ? "No changes." : "New file — no prior content to diff."}
      </p>
    );
  }

  return (
    <div className="rounded-md border border-border overflow-hidden font-mono text-[11px] leading-relaxed">
      {hunks.map((h, hi) => (
        <div key={hi}>
          <div className="bg-muted/50 text-muted-foreground px-2 py-0.5 select-none">
            @@ -{h.oldStart},{h.oldLines} +{h.newStart},{h.newLines} @@
          </div>
          {h.lines.map((line, li) => {
            const kind = line[0];
            return (
              <div
                key={li}
                className={cn(
                  "px-2 whitespace-pre-wrap break-all",
                  kind === "+" && "bg-accent-success/10 text-accent-success",
                  kind === "-" && "bg-destructive/10 text-destructive",
                  kind === " " && "text-muted-foreground/80",
                )}
              >
                {line || " "}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-type boxes (chip + overlay)
// ---------------------------------------------------------------------------

function OverlayShell({
  open,
  onOpenChange,
  icon,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm font-mono break-all">
            {icon}
            {title}
          </DialogTitle>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

function OutputPre({ output }: { output?: string }) {
  if (!output) return <p className="text-xs text-muted-foreground italic">No output.</p>;
  return (
    <pre className="text-[11px] font-mono whitespace-pre-wrap break-all bg-muted/40 rounded-md p-2 max-h-[50vh] overflow-y-auto">
      {output}
    </pre>
  );
}

export function CommandBox({ block, approval }: { block: CommandBlock; approval: ApprovalControls }) {
  const [open, setOpen] = useState(false);
  const cmdLine = [block.command, ...(block.args ?? [])].join(" ");
  return (
    <>
      <BoxChip
        block={block}
        icon={<Terminal className="w-3.5 h-3.5" />}
        title={cmdLine || "(empty command)"}
        subtitle={block.cwd}
        onOpen={() => setOpen(true)}
        approval={approval}
      />
      <OverlayShell open={open} onOpenChange={setOpen} icon={<Terminal className="w-4 h-4" />} title={cmdLine}>
        {block.cwd && <p className="text-[11px] text-muted-foreground mb-2">cwd: {block.cwd}</p>}
        <OutputPre output={block.output} />
      </OverlayShell>
    </>
  );
}

export function EditBox({ block, approval }: { block: EditBlock; approval: ApprovalControls }) {
  const [open, setOpen] = useState(false);
  const counts = block.diff
    ? `+${block.diff.additions ?? 0}/-${block.diff.deletions ?? 0}`
    : undefined;
  return (
    <>
      <BoxChip
        block={block}
        icon={<FilePen className="w-3.5 h-3.5" />}
        title={block.path || "(no path)"}
        subtitle={counts}
        onOpen={() => setOpen(true)}
        approval={approval}
      />
      <OverlayShell open={open} onOpenChange={setOpen} icon={<FilePen className="w-4 h-4" />} title={block.path}>
        {block.diff ? (
          <DiffView diff={block.diff} path={block.path} />
        ) : (
          <p className="text-xs text-muted-foreground italic">Diff not computed.</p>
        )}
      </OverlayShell>
    </>
  );
}

export function JobBox({ block, approval }: { block: JobBlock; approval: ApprovalControls }) {
  const [open, setOpen] = useState(false);
  const cmdLine = block.command ? [block.command, ...(block.args ?? [])].join(" ") : block.label;
  return (
    <>
      <BoxChip
        block={block}
        icon={<Hammer className="w-3.5 h-3.5" />}
        title={block.label}
        subtitle={cmdLine !== block.label ? cmdLine : undefined}
        onOpen={() => setOpen(true)}
        approval={approval}
      />
      <OverlayShell open={open} onOpenChange={setOpen} icon={<Hammer className="w-4 h-4" />} title={block.label}>
        <p className="text-[11px] text-muted-foreground mb-2 font-mono break-all">{cmdLine}</p>
        {typeof block.progress === "number" && (
          <p className="text-xs text-muted-foreground mb-2">{block.progress}%</p>
        )}
        <OutputPre output={block.output} />
      </OverlayShell>
    </>
  );
}

export function McpBox({ block }: { block: McpBlock }) {
  const [open, setOpen] = useState(false);
  const argsStr = useMemo(() => {
    try {
      return JSON.stringify(block.args ?? {}, null, 2);
    } catch {
      return String(block.args ?? "");
    }
  }, [block.args]);
  return (
    <>
      <BoxChip
        block={block}
        icon={<Wrench className="w-3.5 h-3.5" />}
        title={block.title ?? block.tool}
        subtitle={block.server}
        onOpen={() => setOpen(true)}
      />
      <OverlayShell open={open} onOpenChange={setOpen} icon={<Wrench className="w-4 h-4" />} title={block.title ?? block.tool}>
        <p className="text-[11px] font-semibold text-muted-foreground mb-1">Arguments</p>
        <pre className="text-[11px] font-mono whitespace-pre-wrap break-all bg-muted/40 rounded-md p-2 mb-3">{argsStr}</pre>
        <p className="text-[11px] font-semibold text-muted-foreground mb-1">Result</p>
        <OutputPre output={block.result} />
      </OverlayShell>
    </>
  );
}

/**
 * Parent-side chip for a task delegated to a mesh peer (Mesh-Delegation.md).
 * The spawn is HITL-gated exactly like a job launch (inline approve/deny). Once
 * running, the chip taps through to the managed chat where the sub-agent's live
 * stream renders. The condensed result lands here on completion (green/red dot +
 * summary in the overlay), correlated by `taskId` via `applyJobCompletion`.
 */
export function SubAgentBox({
  block,
  approval,
  onOpen,
}: {
  block: SubAgentBlock;
  approval: ApprovalControls;
  /** Navigate to the managed chat for this delegated run. */
  onOpen?: (conversationId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const node = block.nodeName ?? block.nodeId;
  const canTapThrough = !!block.conversationId && !!onOpen;
  return (
    <>
      <BoxChip
        block={block}
        icon={<Network className="w-3.5 h-3.5" />}
        title={`${node} — ${block.label}`}
        subtitle={block.scopePath}
        onOpen={() => setOpen(true)}
        approval={approval}
      />
      <OverlayShell open={open} onOpenChange={setOpen} icon={<Network className="w-4 h-4" />} title={`Sub-agent @ ${node}`}>
        <p className="text-[11px] text-muted-foreground mb-1">Task: {block.label}</p>
        {block.scopePath && (
          <p className="text-[11px] text-muted-foreground mb-1 font-mono break-all">scope: {block.scopePath}</p>
        )}
        {block.modelId && <p className="text-[11px] text-muted-foreground mb-2">model: {block.modelId}</p>}
        {canTapThrough && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1 mb-3"
            onClick={() => {
              setOpen(false);
              onOpen!(block.conversationId!);
            }}
          >
            <ExternalLink className="w-3 h-3" /> Open managed chat
          </Button>
        )}
        <p className="text-[11px] font-semibold text-muted-foreground mb-1">Result</p>
        <OutputPre output={block.output} />
      </OverlayShell>
    </>
  );
}

// ---------------------------------------------------------------------------
// Thinking section — collapsible, default-closed
// ---------------------------------------------------------------------------

export function ThinkingSection({ text, done }: { text: string; done: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-muted-foreground/70 hover:text-muted-foreground"
      >
        <ChevronRight className={cn("w-3 h-3 transition-transform", open && "rotate-90")} />
        {done ? "Reasoning" : "Reasoning…"}
        {!done && <Loader2 className="w-3 h-3 animate-spin" />}
      </button>
      {open && (
        <div className="mt-1 ml-4 pl-2 border-l border-border/60 text-muted-foreground/80 whitespace-pre-wrap">
          <Streamdown>{text}</Streamdown>
        </div>
      )}
    </div>
  );
}

export { X };
