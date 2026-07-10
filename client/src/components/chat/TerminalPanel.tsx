/**
 * Sandboxed Terminal Panel
 *
 * Docker-sandboxed terminal shared between the user and the AI:
 *  - User types commands; HITL approval fires before execution
 *  - AI can push sandbox commands via "omnecor:sandbox_command" CustomEvent
 *    (bridge from chat → sandbox)
 *  - Output is echoed back to chat via "omnecor:sandbox_output" CustomEvent
 *  - Password/secret mode: input is masked (●●●) in the log, value still sent
 *  - Redacted lines show as [REDACTED] in the log export
 */

import { useState, useEffect, useRef } from "react";
import {
  Terminal, Play, Loader2, Eye, EyeOff, Shield, ShieldAlert, Trash2, Copy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { FloatingWindow } from "@/components/window-system/FloatingWindow";
import { useCommandAllowlistStore } from "@/lib/stores/commandAllowlistStore";
import { toast } from "sonner";
import { HowToTooltip } from "@/components/shell/HowToTooltip";

interface LogEntry {
  id: string;
  text: string;
  kind: "system" | "user" | "output" | "error" | "ai" | "redacted";
}

interface TerminalPanelProps {
  isOpen: boolean;
  onToggle: () => void;
  projectId?: string;
}

export function TerminalPanel({ isOpen, onToggle, projectId }: TerminalPanelProps) {
  const [logs, setLogs] = useState<LogEntry[]>([
    { id: "s0", text: "Omnecor Sandbox Terminal ready. AI and user share this session.", kind: "system" },
    { id: "s1", text: "Commands are gated by HITL approval. Toggle Secret Mode for passwords.", kind: "system" },
  ]);
  const [command, setCommand] = useState("");
  const [secretMode, setSecretMode] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { requestApproval } = useCommandAllowlistStore();

  const execMutation = trpc.jobs.runSandboxCommand.useMutation({
    onSuccess: (data) => {
      addLog(`Job queued — ID: ${data.jobId}`, "output");
      // Emit output to chat bridge
      window.dispatchEvent(new CustomEvent("omnecor:sandbox_output", {
        detail: `Sandbox job ${data.jobId} queued.`,
      }));
    },
    onError: (e) => {
      addLog(e.message, "error");
    },
    onSettled: () => setIsRunning(false),
  });

  const addLog = (text: string, kind: LogEntry["kind"]) => {
    setLogs(prev => [
      ...prev,
      { id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, text, kind },
    ]);
  };

  // ── Auto-scroll ──────────────────────────────────────────────────────────

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // ── Bridge: AI-initiated sandbox commands ────────────────────────────────

  useEffect(() => {
    const handler = async (e: Event) => {
      const { command: cmd, description } = (e as CustomEvent<{ command: string; description?: string }>).detail;
      if (!cmd) return;

      addLog(`[AI] Requesting: ${cmd}${description ? ` (${description})` : ""}`, "ai");

      const scope = await requestApproval(cmd, undefined, projectId);
      if (scope === null) {
        addLog(`[HITL] Denied: ${cmd}`, "error");
        return;
      }

      addLog(`[HITL] Approved (${scope}): ${cmd}`, "system");
      setIsRunning(true);
      execMutation.mutate({ command: cmd });
    };
    window.addEventListener("omnecor:sandbox_command", handler);
    return () => window.removeEventListener("omnecor:sandbox_command", handler);
  }, [requestApproval, projectId, execMutation]);

  // ── Bridge: sandbox output → chat ────────────────────────────────────────

  useEffect(() => {
    const handler = (e: Event) => {
      const output = (e as CustomEvent<string>).detail;
      if (!output) return;
      window.dispatchEvent(new CustomEvent("omnecor:terminal_output", { detail: `[Sandbox] ${output}` }));
    };
    window.addEventListener("omnecor:sandbox_output", handler);
    return () => window.removeEventListener("omnecor:sandbox_output", handler);
  }, []);

  // ── Submit command ────────────────────────────────────────────────────────

  const handleRun = async (e: React.FormEvent) => {
    e.preventDefault();
    const cmd = command.trim();
    if (!cmd) return;

    // Display — redact if secret mode
    if (secretMode) {
      addLog("●●●●●●●●", "redacted");
    } else {
      addLog(`$ ${cmd}`, "user");
    }

    setCommand("");

    // HITL approval
    const scope = await requestApproval(cmd, undefined, projectId);
    if (scope === null) {
      addLog("[HITL] Command denied.", "error");
      setIsRunning(false);
      return;
    }

    addLog(`[HITL] Approved (${scope})`, "system");
    setIsRunning(true);
    execMutation.mutate({ command: cmd });
  };

  const handleClearLogs = () => setLogs([
    { id: "c0", text: "Log cleared.", kind: "system" },
  ]);

  const handleCopyLogs = () => {
    const text = logs
      .map(l => l.kind === "redacted" ? "[REDACTED]" : l.text)
      .join("\n");
    navigator.clipboard.writeText(text);
    toast.success("Logs copied to clipboard");
  };

  return (
    <>
      <FloatingWindow
        title="Sandbox Terminal"
        isOpen={isOpen}
        onClose={onToggle}
        initialPosition={{ x: 260, y: 120 }}
        initialSize={{ width: 700, height: 460 }}
      >
        <div className="flex flex-col h-full bg-background">
          {/* Status bar */}
          <div className="flex items-center gap-3 px-3 py-1.5 border-b border-border bg-card/60 flex-shrink-0">
            <Terminal className="w-3.5 h-3.5 text-accent-success flex-shrink-0" />
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-accent-success animate-pulse" />
              <span className="text-[9px] text-accent-success/70 font-mono uppercase tracking-widest">
                SANDBOX READY
              </span>
            </div>
            <div className="ml-auto flex items-center gap-1">
              {/* Secret mode toggle */}
              <HowToTooltip title="Toggle Secret Mode" description="Mask your input from the visible terminal logs." side="bottom">
                <button
                  onClick={() => setSecretMode(v => !v)}
                  className={cn(
                    "flex items-center gap-1 text-[9px] px-2 py-0.5 rounded-full border transition-colors font-mono font-bold",
                    secretMode
                      ? "border-accent-warning/50 text-accent-warning bg-accent-warning/10"
                      : "border-border text-muted-foreground hover:text-foreground"
                  )}
                >
                  {secretMode ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                  {secretMode ? "SECRET ON" : "SECRET"}
                </button>
              </HowToTooltip>
              <HowToTooltip title="Copy Logs" description="Copy the current terminal session logs to clipboard." side="bottom">
                <button
                  onClick={handleCopyLogs}
                  className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-card transition-colors"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </HowToTooltip>
              <HowToTooltip title="Clear Logs" description="Erase all current terminal output." side="bottom">
                <button
                  onClick={handleClearLogs}
                  className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-card transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </HowToTooltip>
            </div>
          </div>

          {/* Log area */}
          <ScrollArea className="min-h-0 flex-1 p-3 font-mono text-xs">
            <div className="space-y-0.5">
              {logs.map(log => (
                <div
                  key={log.id}
                  className={cn(
                    "break-words leading-5 whitespace-pre-wrap",
                    log.kind === "user"    && "text-foreground",
                    log.kind === "output"  && "text-accent-success",
                    log.kind === "error"   && "text-destructive",
                    log.kind === "system"  && "text-accent-cyan/80",
                    log.kind === "ai"      && "text-accent-purple",
                    log.kind === "redacted" && "text-accent-warning/60 italic select-none",
                  )}
                >
                  {log.text}
                </div>
              ))}
              <div ref={scrollRef} />
            </div>
          </ScrollArea>

          {/* HITL badge + input */}
          <form
            onSubmit={handleRun}
            className="p-2 bg-card border-t border-border flex items-center gap-2 flex-shrink-0"
          >
            <Shield className="w-3.5 h-3.5 text-accent-warning flex-shrink-0 ml-1" />
            <input
              ref={inputRef}
              value={command}
              onChange={e => setCommand(e.target.value)}
              placeholder={secretMode ? "Secret input (hidden from logs)…" : "Type sandbox command — HITL gated"}
              type={secretMode ? "password" : "text"}
              className="flex-1 bg-transparent border-none outline-none text-xs font-mono text-foreground placeholder:text-muted-foreground"
              autoComplete="off"
              spellCheck={false}
            />
            <HowToTooltip title="Execute Command" description="Run the command in the sandboxed terminal." side="top">
              <Button
                size="sm"
                type="submit"
                variant="ghost"
                className="h-7 gap-1 text-[10px] text-muted-foreground hover:text-foreground flex-shrink-0"
                disabled={isRunning || !command.trim()}
              >
                {isRunning
                  ? <Loader2 className="w-3 h-3 animate-spin" />
                  : <Play className="w-3 h-3" />}
                Run
              </Button>
            </HowToTooltip>
          </form>

          {/* HITL legend */}
          <div className="px-3 pb-2 flex items-center gap-2 text-[9px] text-muted-foreground font-mono">
            <ShieldAlert className="w-3 h-3 text-accent-warning/50" />
            Every command requires HITL approval · AI-initiated commands appear in purple
          </div>
        </div>
      </FloatingWindow>
    </>
  );
}
