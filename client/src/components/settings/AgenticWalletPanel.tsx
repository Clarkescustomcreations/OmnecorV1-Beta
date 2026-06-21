import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardHeader, CardTitle, CardContent, CardDescription, CardFooter } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DollarSign,
  Lock,
  Loader2,
  ShieldCheck,
  ShieldAlert,
  Check,
  X
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/lib/store/app.store";

export function AgenticWalletPanel() {
  const { data: projects } = trpc.project.list.useQuery();
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [limitDollars, setLimitDollars] = useState<string>("5.00");
  const [mode, setMode] = useState<"soft" | "hard">("soft");
  const [hitlDialogOpen, setHitlDialogOpen] = useState(false);
  // Execution mode gates whether financial HITL requests are permitted at all.
  // In sovereign (air-gapped) mode the Lithic cloud integration is disabled, so
  // there is nothing to request approval for.
  const executionMode = useAppStore((s) => s.executionMode);

  // Live HITL approval queue — admin-only. Polls while the dialog is open so a
  // pending card-issuance/order/model-deletion request appears within ~3s.
  const utils = trpc.useUtils();
  const pendingHitl = trpc.security.getPendingHitlActions.useQuery(undefined, {
    enabled: hitlDialogOpen,
    refetchInterval: hitlDialogOpen ? 3000 : false,
  });
  const resolveHitl = trpc.security.resolveHitlAction.useMutation({
    onSuccess: (res) => {
      toast.success(res.approved ? "Action approved" : "Action rejected");
      utils.security.getPendingHitlActions.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const setBudgetMutation = trpc.wallet.setBudget.useMutation({
    onSuccess: () => {
      toast.success("Budget updated");
    },
    onError: (e) => toast.error(e.message)
  });

  // trpc.virtualCard.issueCard — Lithic card issuance (Phase 14b)
  // Payload: { spendLimitDollars: number, memo?: string }
  // Rate-limited to 1 issuance per 60s per user. Requires LITHIC_API_KEY.
  // Gated behind HITL approval — mutation will block until an admin approves.
  const issueCardMutation = trpc.virtualCard.issueCard.useMutation({
    onSuccess: (data) => {
      if (data.card) {
        toast.success("Virtual card issued successfully");
      } else {
        toast.info(data.message ?? "Card issuance returned no card — check Lithic configuration.");
      }
    },
    onError: (e) => toast.error(`Card issuance failed: ${e.message}`),
  });

  const handleIssueProjectCard = () => {
    const parsedLimit = parseFloat(limitDollars);
    if (!selectedProjectId) {
      toast.warning("Select a project first.");
      return;
    }
    if (isNaN(parsedLimit) || parsedLimit <= 0) {
      toast.warning("Enter a valid spending limit before issuing a card.");
      return;
    }
    const projectName = projects?.find((p) => p.id === selectedProjectId)?.name ?? selectedProjectId;
    // memo is capped at 100 chars by the server schema
    const memo = `Project: ${projectName}`.slice(0, 100);
    issueCardMutation.mutate({ spendLimitDollars: parsedLimit, memo });
  };

  const handleSaveBudget = () => {
    if (!selectedProjectId) return;
    setBudgetMutation.mutate({
      projectId: selectedProjectId,
      limitCents: Math.round(parseFloat(limitDollars) * 100),
      mode,
      alertThreshold: 80
    });
  };

  /**
   * HITL Authorization — opens the live human-in-the-loop review queue.
   *
   * SECURITY: Card issuance and other high-value operations are gated
   * server-side. `virtualCard.issueCard` calls `HITLApprovalService.requestApproval`
   * and blocks until an administrator approves (5-minute timeout → auto-reject).
   *
   * The queue is backed by `security.getPendingHitlActions` (admin query) and
   * `security.resolveHitlAction({ id, approved })` (admin mutation). The dialog
   * polls the query every 3s while open and renders Approve/Reject per pending
   * action; the service audit-logs every resolution. Args are shown as-is from
   * HITLApprovalService, which already redacts sensitive fields server-side.
   */
  const handleOpenHitlQueue = () => {
    // Permission gate: sovereign (air-gapped) mode has no cloud financial ops,
    // so there is nothing that can require HITL financial authorization.
    if (executionMode === "sovereign") {
      toast.warning(
        "HITL financial authorization is unavailable in Sovereign mode (cloud card issuance is disabled)."
      );
      return;
    }
    setHitlDialogOpen(true);
    // Audit-safe notice — no transaction details are exposed here.
    toast.info("Opening human-in-the-loop review queue.");
  };

  return (
    <div className="space-y-6">
      {/* Project Selection & Budget Setting */}
      <Card className="shadow-md border-muted/50">
        <CardHeader>
          <CardTitle className="text-lg">Project Budgets</CardTitle>
          <CardDescription>Set financial boundaries for agentic workflows.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase text-muted-foreground">Select Project</Label>
            <select 
              className="w-full bg-background border rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 outline-none transition-all"
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
            >
              <option value="">Choose a project...</option>
              {projects?.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {selectedProjectId && (
            <>
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase text-muted-foreground">Spending Limit (USD)</Label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
                  <Input 
                    className="pl-9" 
                    placeholder="5.00" 
                    value={limitDollars}
                    onChange={(e) => setLimitDollars(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-3">
                <Label className="text-xs font-semibold uppercase text-muted-foreground">Enforcement Mode</Label>
                <RadioGroup value={mode} onValueChange={(v) => setMode(v as "soft" | "hard")} className="space-y-2">
                  <div className={cn(
                    "flex items-start gap-3 rounded-md border p-3 cursor-pointer transition-colors",
                    mode === "soft" ? "border-primary bg-primary/5" : "hover:bg-muted/50 border-transparent bg-muted/20"
                  )} onClick={() => setMode("soft")}>
                    <RadioGroupItem value="soft" id="mode-soft" className="mt-1" />
                    <div>
                      <Label htmlFor="mode-soft" className="font-medium cursor-pointer">Soft Limit</Label>
                      <p className="text-[10px] text-muted-foreground mt-0.5">Alert only. Agents will continue running.</p>
                    </div>
                  </div>
                  <div className={cn(
                    "flex items-start gap-3 rounded-md border p-3 cursor-pointer transition-colors",
                    mode === "hard" ? "border-primary bg-primary/5" : "hover:bg-muted/50 border-transparent bg-muted/20"
                  )} onClick={() => setMode("hard")}>
                    <RadioGroupItem value="hard" id="mode-hard" className="mt-1" />
                    <div>
                      <Label htmlFor="mode-hard" className="font-medium cursor-pointer">Hard Limit</Label>
                      <p className="text-[10px] text-muted-foreground mt-0.5">Block cloud calls & auto-downgrade to local models.</p>
                    </div>
                  </div>
                </RadioGroup>
              </div>
            </>
          )}
        </CardContent>
        <CardFooter>
          <Button 
            className="w-full font-bold uppercase tracking-wider text-xs h-10" 
            disabled={!selectedProjectId || setBudgetMutation.isPending}
            onClick={handleSaveBudget}
          >
            {setBudgetMutation.isPending ? "Updating..." : "Save Budget"}
          </Button>
        </CardFooter>
      </Card>

      {/* Lithic Integration */}
      <Card className="border-accent/30 bg-accent/5 shadow-inner">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Lock className="w-5 h-5 text-accent" /> Lithic Virtual Issuance
          </CardTitle>
          <CardDescription className="text-accent/80 font-medium">
            Generate single-use or project-isolated virtual credit cards to fund autonomous agents.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5 rounded-2xl border bg-card mb-6 shadow-sm">
            <div className="flex items-center gap-4 min-w-0">
              <div className="w-14 h-9 rounded-lg bg-gradient-to-br from-gray-800 to-black border-gray-700 border flex items-center justify-center shadow-lg relative overflow-hidden flex-shrink-0">
                <div className="absolute top-0 left-0 w-full h-full bg-white/5 opacity-20 pointer-events-none" />
                <span className="text-[10px] text-white/40 font-mono tracking-widest z-10">VISA</span>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold tracking-tight truncate">Lithic Integration Status</p>
                <p className="text-xs text-muted-foreground truncate">System authenticated and ready to issue</p>
              </div>
            </div>
            <Badge className="bg-green-500/20 text-green-500 border-green-500/30 font-bold px-4 py-1 flex-shrink-0">CONNECTED</Badge>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {/* Issue Card Option */}
            <div className="flex flex-col border border-muted bg-muted/10 rounded-xl p-5 shadow-sm min-h-[160px]">
              <h4 className="text-sm font-semibold text-foreground mb-1.5 flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-primary" /> Project Funding Card
              </h4>
              <p className="text-xs text-muted-foreground leading-relaxed mb-4 flex-1">
                Create a dedicated virtual card with automatic spending limits tied to the active project. Funding is routed via Lithic's virtual card issuer.
              </p>
              <Button
                className="w-full mt-auto h-9 font-medium"
                disabled={issueCardMutation.isPending}
                onClick={handleIssueProjectCard}
              >
                {issueCardMutation.isPending ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
                    Awaiting HITL Approval…
                  </span>
                ) : (
                  "Issue Project Card"
                )}
              </Button>
            </div>

            {/* HITL Authorization Option */}
            <div className="flex flex-col border border-muted bg-muted/10 rounded-xl p-5 shadow-sm min-h-[160px]">
              <h4 className="text-sm font-semibold text-foreground mb-1.5 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-accent" /> Security Authorization
              </h4>
              <p className="text-xs text-muted-foreground leading-relaxed mb-4 flex-1">
                Access the Human-in-the-Loop review queue to approve pending card issuance and audit high-value transaction requests.
              </p>
              <Button
                variant="outline"
                className="w-full mt-auto h-9 font-medium border-accent/40 text-accent hover:bg-accent/10"
                disabled={executionMode === "sovereign"}
                onClick={handleOpenHitlQueue}
                aria-label="Open HITL-review queue for pending card issuance and high-value transaction requests"
              >
                HITL Authorization
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Human-in-the-loop authorization queue. SECURITY: shows status only —
          no card numbers or processor data are ever rendered here. */}
      <Dialog open={hitlDialogOpen} onOpenChange={setHitlDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-amber-500" />
              HITL Authorization Queue
            </DialogTitle>
            <DialogDescription>
              High-value financial actions are gated behind administrator approval.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-3 text-sm">
            <p className="text-muted-foreground text-xs">
              High-value actions (card issuance, PCB orders, model deletion) suspend
              server-side and auto-reject after 5 minutes. Approving processes the
              request immediately; every decision is written to the audit trail.
            </p>

            {pendingHitl.isLoading && (
              <div className="flex items-center gap-2 text-muted-foreground text-xs py-4 justify-center">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading pending actions…
              </div>
            )}

            {pendingHitl.isError && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                {pendingHitl.error.message.includes("FORBIDDEN") || pendingHitl.error.data?.code === "FORBIDDEN"
                  ? "Administrator role required to review the approval queue."
                  : pendingHitl.error.message}
              </div>
            )}

            {pendingHitl.data && pendingHitl.data.length === 0 && (
              <div className="rounded-md border border-muted bg-muted/40 p-4 text-xs text-muted-foreground text-center">
                No actions are awaiting approval.
              </div>
            )}

            {pendingHitl.data?.map((action) => (
              <div
                id={`hitl-action-${action.id}`}
                key={action.id}
                className="rounded-md border border-border bg-card p-3 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-foreground text-sm break-words">{action.toolName}</span>
                  <Badge variant="outline" className="text-[10px] shrink-0">
                    {new Date(action.timestamp).toLocaleTimeString()}
                  </Badge>
                </div>
                <pre className="text-[11px] text-muted-foreground bg-muted/40 rounded p-2 overflow-x-auto max-w-full break-words whitespace-pre-wrap">
                  {JSON.stringify(action.args, null, 2)}
                </pre>
                <div className="flex items-center gap-2 justify-end">
                  <Button
                    id={`hitl-reject-${action.id}`}
                    size="sm"
                    variant="outline"
                    className="gap-1 cursor-pointer transition-colors"
                    disabled={resolveHitl.isPending}
                    onClick={() => resolveHitl.mutate({ id: action.id, approved: false })}
                  >
                    <X className="w-3.5 h-3.5" /> Reject
                  </Button>
                  <Button
                    id={`hitl-approve-${action.id}`}
                    size="sm"
                    className="gap-1 cursor-pointer transition-colors"
                    disabled={resolveHitl.isPending}
                    onClick={() => resolveHitl.mutate({ id: action.id, approved: true })}
                  >
                    <Check className="w-3.5 h-3.5" /> Approve
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHitlDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
