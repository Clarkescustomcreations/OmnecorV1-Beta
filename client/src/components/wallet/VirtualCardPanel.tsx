import React, { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CreditCard,
  Plus,
  ShieldCheck,
  Loader2,
  Lock,
  Eye,
  EyeOff,
  Copy,
  Activity,
  RefreshCw,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLocation } from "wouter";

export function VirtualCardPanel() {
  const [, setLocation] = useLocation();
  const [showSensitive, setShowSensitive] = useState(false);
  const [revealedPan, setRevealedPan] = useState<string | null>(null);
  const [isIssuing, setIsIssuing] = useState(false);
  const [limit, setLimit] = useState(50);
  const [memo, setMemo] = useState("AI Cloud Compute");

  const { data: isConfigured } = trpc.virtualCard.isConfigured.useQuery();
  const { data: cards = [], refetch: refetchCards } = trpc.virtualCard.listCards.useQuery(
    { projectId: undefined },
    { enabled: isConfigured === true }
  );

  // Use the most recently issued card
  const activeCard = cards[cards.length - 1] ?? null;

  const { data: transactions = [], isFetching: loadingTx, refetch: refetchTx } = trpc.virtualCard.listTransactions.useQuery(
    { cardToken: activeCard?.token ?? "" },
    { enabled: !!activeCard?.token }
  );

  const revealPanMutation = trpc.virtualCard.revealCardPan.useMutation({
    onSuccess: (data) => {
      setRevealedPan(data.pan);
      setShowSensitive(true);
    },
    onError: (e) => toast.error("Could not reveal card: " + e.message),
  });

  const issueMutation = trpc.virtualCard.issueCard.useMutation({
    onSuccess: (data) => {
      setIsIssuing(false);
      if (data.card) {
        toast.success("Virtual card issued successfully");
        refetchCards();
      } else {
        toast.info(data.message);
      }
    },
    onError: (e) => {
      setIsIssuing(false);
      toast.error(`Issuance failed: ${e.message}`);
    },
  });

  const handleIssue = () => {
    setIsIssuing(true);
    issueMutation.mutate({ spendLimitDollars: limit, memo });
  };

  const handleReveal = () => {
    if (!activeCard) return;
    if (revealedPan) {
      setShowSensitive(s => !s);
    } else {
      revealPanMutation.mutate({ cardToken: activeCard.token });
    }
  };

  const handleCopyPan = () => {
    if (!revealedPan) {
      toast.info("Reveal the card number first");
      return;
    }
    navigator.clipboard.writeText(revealedPan)
      .then(() => toast.success("Card number copied"))
      .catch(() => toast.error("Copy failed"));
  };

  if (isConfigured === false) {
    return (
      <Card className="bg-muted/30 border-dashed">
        <CardContent className="pt-6 flex flex-col items-center justify-center text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
            <Lock className="w-6 h-6 text-muted-foreground opacity-50" />
          </div>
          <div className="space-y-1">
            <p className="font-bold text-sm">Lithic API Not Configured</p>
            <p className="text-xs text-muted-foreground max-w-[240px]">
              Virtual card issuance requires a Lithic account. Add your API key to settings to enable this feature.
            </p>
          </div>
          <Button id="btn-wallet-configure-lithic" variant="outline" size="sm" onClick={() => setLocation("/settings?tab=api")}>Configure Lithic</Button>
        </CardContent>
      </Card>
    );
  }

  const formattedPan = revealedPan && showSensitive
    ? revealedPan.replace(/(\d{4})/g, "$1 ").trim()
    : "•••• •••• •••• " + (activeCard?.lastFour ?? "????");

  const formattedExpiry = activeCard
    ? (showSensitive && revealedPan
        ? `${String(activeCard.expMonth).padStart(2, "0")}/${String(activeCard.expYear).slice(-2)}`
        : "••/••")
    : null;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Card Display */}
        <Card className="bg-gradient-to-br from-slate-900 to-slate-950 border-border text-white relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-primary/10 blur-3xl -mr-16 -mt-16 group-hover:bg-primary/20 transition-colors" />
          <CardHeader className="pb-8">
            <div className="flex justify-between items-start">
              <CreditCard className="w-8 h-8 text-primary" />
              <div className="flex flex-col items-end">
                {activeCard ? (
                  <>
                    <Badge variant="outline" className={cn("text-[10px] h-5", activeCard.status === "OPEN" ? "border-accent-success/30 text-accent-success bg-accent-success/5" : "border-accent-warning/30 text-accent-warning bg-accent-warning/5")}>
                      {activeCard.status}
                    </Badge>
                    <p className="text-[9px] text-muted-foreground mt-1 uppercase font-bold tracking-tighter">Single Use</p>
                  </>
                ) : (
                  <Badge variant="outline" className="text-[10px] h-5 text-muted-foreground">No Card</Badge>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {!activeCard ? (
              <p className="text-sm text-muted-foreground italic">No virtual card issued yet. Issue one using the form.</p>
            ) : (
              <>
                <div className="space-y-1">
                  <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest">Card Number</p>
                  <div className="flex items-center gap-2">
                    <p className="font-mono text-lg tracking-[0.2em]">{formattedPan}</p>
                    <Button
                      id="btn-wallet-reveal-card"
                      size="icon" variant="ghost"
                      className="h-6 w-6 text-muted-foreground hover:text-white"
                      onClick={handleReveal}
                      disabled={revealPanMutation.isPending}
                    >
                      {revealPanMutation.isPending
                        ? <Loader2 className="w-3 h-3 animate-spin" />
                        : showSensitive ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest">Expiry</p>
                    <p className="font-mono text-sm">{formattedExpiry}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest">Limit</p>
                    <p className="font-mono text-sm">${((activeCard.spendLimitCents ?? 0) / 100).toFixed(2)}</p>
                  </div>
                </div>

                <div className="pt-2 border-t border-border flex justify-end">
                  <Button
                    id="btn-wallet-copy-card-number"
                    size="icon" variant="outline"
                    className="h-8 w-8 border-border bg-card/50 hover:bg-card"
                    onClick={handleCopyPan}
                    title="Copy card number"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Issue New Card Form */}
        <Card className="bg-muted/20 border-primary/10">
          <CardHeader>
            <CardTitle className="text-sm">Issue Task-Specific Card</CardTitle>
            <CardDescription className="text-xs">Create a new virtual card for a specific agentic task or project.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-[10px] uppercase font-bold">Spend Limit ($)</Label>
              <Input
                type="number"
                value={limit}
                onChange={(e) => setLimit(parseInt(e.target.value) || 0)}
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-[10px] uppercase font-bold">Purpose / Memo</Label>
              <Input
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="e.g. AWS Credits"
                className="h-9 text-sm"
              />
            </div>
            <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 space-y-2">
              <div className="flex items-center gap-2 text-primary">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span className="text-[10px] font-bold uppercase">HITL Security</span>
              </div>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                New card issuance requires administrator approval via the local interface.
              </p>
            </div>
            <Button
              id="btn-wallet-issue-card"
              className="w-full gap-2 h-10 bg-primary/10 text-accent-foreground"
              disabled={isIssuing}
              onClick={handleIssue}
            >
              {isIssuing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Request New Virtual Card
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Transaction Log */}
      <Card className="bg-card shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" /> Card Activity
            </CardTitle>
            <div className="flex items-center gap-2">
              {loadingTx && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
              {activeCard && (
                <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => refetchTx()}>
                  <RefreshCw className="w-3 h-3" /> Refresh
                </Button>
              )}
              <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={() => setLocation("/wallet")}>
                View All
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {!activeCard ? (
            <p className="text-xs text-muted-foreground italic p-4">Issue a virtual card to see transactions here.</p>
          ) : transactions.length === 0 && !loadingTx ? (
            <p className="text-xs text-muted-foreground italic p-4">No transactions yet on this card.</p>
          ) : (
            <div className="divide-y border-t">
              {transactions.map(tx => (
                <div key={tx.token} className="p-4 flex items-center justify-between hover:bg-muted/10 transition-colors card-content-safe">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded bg-muted flex items-center justify-center font-bold text-xs uppercase tracking-tighter">
                      {(tx.merchantDescriptor || "?").charAt(0)}
                    </div>
                    <div>
                      <p className="text-sm font-bold">{tx.merchantDescriptor || "Unknown"}</p>
                      <p className="text-[10px] text-muted-foreground">{tx.created ? new Date(tx.created).toLocaleDateString() : "—"}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-mono font-bold">${(tx.amount / 100).toFixed(2)}</p>
                    <Badge variant="outline" className={cn("text-[9px] h-4 uppercase",
                      tx.status === "SETTLED" ? "text-accent-success border-accent-success/20"
                      : tx.status === "PENDING" ? "text-accent-warning border-accent-warning/20"
                      : "text-muted-foreground border-muted"
                    )}>
                      {tx.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
