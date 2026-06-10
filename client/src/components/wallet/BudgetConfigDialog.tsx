import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Settings2, CreditCard, AlertTriangle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

interface BudgetConfigDialogProps {
  projectId: string;
}

export default function BudgetConfigDialog({ projectId }: BudgetConfigDialogProps) {
  const [open, setOpen] = useState(false);
  const { data: budget } = trpc.wallet.getBudget.useQuery({ projectId }, { enabled: open });
  const utils = trpc.useUtils();

  const [limitDollars, setLimitDollars] = useState("");
  const [alertThreshold, setAlertThreshold] = useState(80);
  const [mode, setMode] = useState<"soft" | "hard">("soft");

  const setBudget = trpc.wallet.setBudget.useMutation({
    onSuccess: () => {
      utils.wallet.getBudget.invalidate({ projectId });
      utils.wallet.getSpendSummary.invalidate({ projectId });
      setOpen(false);
    },
    onError: (err) => toast.error(`Failed to save budget: ${err.message}`),
  });

  const handleOpen = (o: boolean) => {
    if (o && budget) {
      setLimitDollars((budget.limitCents / 100).toFixed(2));
      setAlertThreshold(budget.alertThreshold);
      setMode(budget.mode);
    }
    setOpen(o);
  };

  const handleSave = () => {
    const limitCents = Math.round(parseFloat(limitDollars || "0") * 100);
    setBudget.mutate({ projectId, limitCents, alertThreshold, mode });
  };

  const { data: cardConfig } = trpc.virtualCard.isConfigured.useQuery(undefined, { enabled: open });
  const [cardLimit, setCardLimit] = useState("10.00");
  const [cardMemo, setCardMemo] = useState("");
  const issueCard = trpc.virtualCard.issueCard.useMutation({
    onError: (err) => toast.error(`Card issuance failed: ${err.message}`),
  });

  const handleIssueCard = () => {
    issueCard.mutate({
      spendLimitDollars: parseFloat(cardLimit || "10"),
      memo: cardMemo || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger asChild>
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
        <Button variant="ghost" size="icon" className="h-7 w-7">
          <Settings2 className="h-4 w-4" />
          <span className="sr-only">Configure budget</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Budget Configuration</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="budget" className="mt-2">
          <TabsList className="w-full">
            <TabsTrigger value="budget" className="flex-1">Budget</TabsTrigger>
            <TabsTrigger value="cards" className="flex-1 flex items-center gap-1.5">
              <CreditCard className="h-3.5 w-3.5" />
              Virtual Cards
            </TabsTrigger>
          </TabsList>

          <TabsContent value="budget" className="space-y-5 pt-4">
            <div className="space-y-2">
              <Label htmlFor="limit">Spend Limit (USD, 0 = unlimited)</Label>
              <Input
                id="limit"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={limitDollars}
                onChange={(e) => setLimitDollars(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Alert Threshold: {alertThreshold}%</Label>
              <Slider
                min={10}
                max={100}
                step={5}
                value={[alertThreshold]}
                onValueChange={([v]) => setAlertThreshold(v)}
              />
            </div>
            <div className="space-y-2">
              <Label>Enforcement Mode</Label>
              <RadioGroup value={mode} onValueChange={(v) => setMode(v as "soft" | "hard")} className="space-y-1">
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="soft" id="soft" />
                  <Label htmlFor="soft" className="font-normal cursor-pointer">
                    <span className="font-medium">Soft</span> — Alert only, continue with cloud
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="hard" id="hard" />
                  <Label htmlFor="hard" className="font-normal cursor-pointer">
                    <span className="font-medium">Hard</span> — Auto-downgrade to local Ollama
                  </Label>
                </div>
              </RadioGroup>
            </div>
            <Button onClick={handleSave} disabled={setBudget.isPending} className="w-full">
              {setBudget.isPending ? "Saving..." : "Save Budget"}
            </Button>
          </TabsContent>

          <TabsContent value="cards" className="pt-4 space-y-4">
            {!cardConfig ? (
              <div className="rounded-md border border-muted p-4 text-center space-y-2">
                <CreditCard className="h-8 w-8 text-muted-foreground mx-auto" />
                <p className="text-sm font-medium">Virtual Cards Not Configured</p>
                <p className="text-xs text-muted-foreground">
                  Add <code className="font-mono text-xs bg-muted px-1 rounded">LITHIC_API_KEY</code> to your{" "}
                  <code className="font-mono text-xs bg-muted px-1 rounded">.env</code> to enable ephemeral virtual
                  credit cards for isolated cloud spending.
                </p>
                <Badge variant="outline" className="text-xs">
                  <AlertTriangle className="h-3 w-3 mr-1" /> Opt-in feature
                </Badge>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-xs text-muted-foreground">
                  Issue an ephemeral virtual card with a fixed spend limit. The card number is encrypted and never
                  stored in plaintext. Rate-limited to 1 card per minute.
                </p>
                <div className="space-y-2">
                  <Label htmlFor="card-limit">Card Spend Limit (USD)</Label>
                  <Input
                    id="card-limit"
                    type="number"
                    min="1"
                    max="1000"
                    step="1"
                    value={cardLimit}
                    onChange={(e) => setCardLimit(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="card-memo">Memo (optional)</Label>
                  <Input
                    id="card-memo"
                    placeholder="e.g. GPU burst run"
                    value={cardMemo}
                    onChange={(e) => setCardMemo(e.target.value)}
                    maxLength={100}
                  />
                </div>
                {issueCard.data?.card && (
                  <div className="rounded-md bg-muted p-3 text-xs space-y-1 font-mono">
                    <div>Last 4: •••• {issueCard.data.card.last4}</div>
                    <div>Exp: {issueCard.data.card.expMonth}/{issueCard.data.card.expYear}</div>
                    <div className="text-muted-foreground">Card issued — token encrypted at rest</div>
                  </div>
                )}
                <Button
                  onClick={handleIssueCard}
                  disabled={issueCard.isPending}
                  className="w-full"
                  variant="outline"
                >
                  <CreditCard className="h-4 w-4 mr-2" />
                  {issueCard.isPending ? "Issuing..." : "Issue Virtual Card"}
                </Button>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
