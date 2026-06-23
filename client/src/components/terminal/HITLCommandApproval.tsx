/**
 * HITL Command Approval Dialog
 *
 * Appears before any shell command runs — mirrors the Claude Code / VS Code
 * style prompt: Allow once / Allow for this project / Allow for all / Deny.
 *
 * Connected to useCommandAllowlistStore: call requestApproval() to trigger,
 * the store's _resolvePending() to confirm or deny.
 */

import { useEffect, useRef } from "react";
import { Shield, Terminal, CheckCircle2, Globe, FolderOpen, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useCommandAllowlistStore, type AllowScope } from "@/lib/stores/commandAllowlistStore";

export function HITLCommandApproval() {
  const { pending, _resolvePending } = useCommandAllowlistStore();
  const denyRef = useRef<HTMLButtonElement>(null);

  // Focus deny button on mount (safest default)
  useEffect(() => {
    if (pending) denyRef.current?.focus();
  }, [pending?.id]);

  // Keyboard: Escape = Deny
  useEffect(() => {
    if (!pending) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") _resolvePending(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [pending, _resolvePending]);

  if (!pending) return null;

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="w-full max-w-lg mx-4 bg-card border border-border rounded-xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border bg-accent-warning/5">
          <div className="w-8 h-8 rounded-full bg-accent-warning/20 flex items-center justify-center flex-shrink-0">
            <Shield className="w-4 h-4 text-accent-warning" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">Command Approval Required</p>
            <p className="text-[11px] text-muted-foreground">AI wants to run a shell command</p>
          </div>
        </div>

        {/* Command preview */}
        <div className="px-5 py-4 space-y-3">
          <div className="flex items-start gap-2 rounded-lg bg-background border border-border p-3">
            <Terminal className="w-4 h-4 text-accent-success mt-0.5 flex-shrink-0" />
            <pre className="text-xs font-mono text-accent-success whitespace-pre-wrap break-all leading-relaxed flex-1 min-w-0 max-h-40 overflow-y-auto">
              {pending.fullCommand}
            </pre>
          </div>

          {pending.cwd && (
            <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
              <FolderOpen className="w-3 h-3 flex-shrink-0" />
              <span className="font-mono truncate">{pending.cwd}</span>
            </p>
          )}

          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Choose how to handle <span className="font-mono text-foreground bg-muted px-1 rounded">{pending.cmd}</span>.
            Approvals are remembered so you're not asked again for the same tool.
          </p>
        </div>

        {/* Actions */}
        <div className="px-5 pb-5 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <ApproveButton
              label="Allow Once"
              description="Run now, ask next time"
              icon={<CheckCircle2 className="w-3.5 h-3.5" />}
              variant="outline"
              onClick={() => _resolvePending("once")}
              className="border-accent-success/30 hover:border-accent-success/60 hover:bg-accent-success/5 text-accent-success"
            />
            <ApproveButton
              label="Allow for Project"
              description={pending.projectId ? "Remember for this project" : "Remember for this session"}
              icon={<FolderOpen className="w-3.5 h-3.5" />}
              variant="outline"
              onClick={() => _resolvePending("project")}
              className="border-primary/30 hover:border-primary/60 hover:bg-primary/5 text-primary"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <ApproveButton
              label="Allow for All Projects"
              description="Never ask again for this tool"
              icon={<Globe className="w-3.5 h-3.5" />}
              variant="outline"
              onClick={() => _resolvePending("global")}
              className="border-accent-purple/30 hover:border-accent-purple/60 hover:bg-accent-purple/5 text-accent-purple"
            />
            <button
              ref={denyRef}
              className={cn(
                "flex flex-col items-start gap-0.5 rounded-lg border border-destructive/30 px-3 py-2.5",
                "hover:border-destructive/60 hover:bg-destructive/5 transition-colors text-left"
              )}
              onClick={() => _resolvePending(null)}
            >
              <span className="flex items-center gap-1.5 text-xs font-semibold text-destructive">
                <X className="w-3.5 h-3.5" />
                Deny
              </span>
              <span className="text-[10px] text-muted-foreground leading-tight">Block this command</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ApproveButton({
  label, description, icon, onClick, className, variant,
}: {
  label: string;
  description: string;
  icon: React.ReactNode;
  onClick: () => void;
  className?: string;
  variant?: "outline" | "default";
}) {
  return (
    <button
      className={cn(
        "flex flex-col items-start gap-0.5 rounded-lg border px-3 py-2.5 transition-colors text-left",
        className
      )}
      onClick={onClick}
    >
      <span className="flex items-center gap-1.5 text-xs font-semibold">
        {icon}
        {label}
      </span>
      <span className="text-[10px] text-muted-foreground leading-tight">{description}</span>
    </button>
  );
}
