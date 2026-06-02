import React, { useState } from "react";
import { trpc } from "../../lib/trpc";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "../ui/card";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Label } from "../ui/label";
import { Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../ui/tabs";
import { ScrollArea } from "../ui/scroll-area";
import { toast } from "sonner";
import { Cloud, Cpu, CircleDot, Square, Plus, CreditCard, AlertCircle, CheckCircle2 } from "lucide-react";

const BILLING_LABELS: Record<string, string> = { minute: "per minute", hour: "per hour" };

// ---------------------------------------------------------------------------
// Provider catalog display
// ---------------------------------------------------------------------------

function ProviderCard({
  provider,
  onSelect,
  selected,
}: {
  provider: { id: string; name: string; description: string; configured: boolean; plans: readonly { id: string; label: string; vram: string; ratePerHourCents: number }[] };
  onSelect: (id: string) => void;
  selected: boolean;
}) {
  return (
    <button
      onClick={() => onSelect(provider.id)}
      aria-pressed={selected}
      className={`w-full text-left rounded-lg border-2 p-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
        ${selected ? "border-primary bg-primary/10" : "border-border bg-background hover:border-muted-foreground"}`}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="font-semibold text-sm">{provider.name}</span>
        {provider.configured
          ? <Badge variant="default" className="text-xs"><CheckCircle2 className="w-3 h-3 mr-1" />API Key Set</Badge>
          : <Badge variant="secondary" className="text-xs"><AlertCircle className="w-3 h-3 mr-1" />No API Key</Badge>
        }
      </div>
      <p className="text-xs text-muted-foreground">{provider.description}</p>
      <p className="text-xs text-muted-foreground mt-1">{provider.plans.length} GPU tiers available</p>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Start session form
// ---------------------------------------------------------------------------

function StartSessionForm({ onStarted }: { onStarted: () => void }) {
  const { data: providers, isLoading } = trpc.cloudCompute.listProviders.useQuery();
  const [selectedProvider, setSelectedProvider] = useState<string>("");
  const [selectedPlan, setSelectedPlan] = useState<string>("");
  const [billingUnit, setBillingUnit] = useState<"minute" | "hour">("hour");
  const [projectId, setProjectId] = useState("default");

  const estimateQuery = trpc.cloudCompute.estimateCost.useQuery(
    { provider: selectedProvider as "vastai" | "runpod" | "lambda", planId: selectedPlan, billingUnit, durationHours: 1 },
    { enabled: Boolean(selectedProvider && selectedPlan) }
  );

  const startMutation = trpc.cloudCompute.startSession.useMutation({
    onSuccess: (data) => {
      toast.success(`Session started on ${data.provider} — ${data.plan}`);
      if (!data.provisionedByApi) {
        toast.info("Session tracked locally. Add an API key in .env to provision real hardware.");
      }
      onStarted();
    },
    onError: (e) => toast.error(e.message),
  });

  const provider = providers?.find(p => p.id === selectedProvider);
  const supportedBillingUnits = provider?.billingUnits ?? ["hour"];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Plus className="w-4 h-4" /> Start Compute Session</CardTitle>
        <CardDescription>Rent GPU compute billed by the minute or hour. Costs are tracked in your Agentic Wallet.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <p className="text-sm text-muted-foreground" role="status">Loading providers…</p>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {(providers ?? []).map(p => (
                <ProviderCard
                  key={p.id}
                  provider={p}
                  selected={selectedProvider === p.id}
                  onSelect={(id) => { setSelectedProvider(id); setSelectedPlan(""); }}
                />
              ))}
            </div>

            {selectedProvider && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-1">
                  <Label htmlFor="plan-select">GPU Instance</Label>
                  <Select value={selectedPlan} onValueChange={setSelectedPlan}>
                    <SelectTrigger id="plan-select">
                      <SelectValue placeholder="Select GPU tier" />
                    </SelectTrigger>
                    <SelectContent>
                      {(provider?.plans ?? []).map(plan => (
                        <SelectItem key={plan.id} value={plan.id}>
                          {plan.label} — ${(plan.ratePerHourCents / 100).toFixed(2)}/hr
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="billing-select">Billing Unit</Label>
                  <Select value={billingUnit} onValueChange={(v) => setBillingUnit(v as "minute" | "hour")}>
                    <SelectTrigger id="billing-select">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {supportedBillingUnits.map(u => (
                        <SelectItem key={u} value={u}>{u === "minute" ? "Per minute" : "Per hour"}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="project-id">Wallet Project ID</Label>
                  <Input
                    id="project-id"
                    value={projectId}
                    onChange={e => setProjectId(e.target.value)}
                    placeholder="e.g. my-project"
                  />
                </div>
              </div>
            )}

            {estimateQuery.data && (
              <div className="rounded-md bg-muted/40 border px-4 py-2 text-sm flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-muted-foreground" />
                <span>Est. cost for 1 hour: <strong>${estimateQuery.data.totalDollars.toFixed(4)}</strong></span>
                <span className="text-muted-foreground">({BILLING_LABELS[billingUnit]})</span>
              </div>
            )}

            <Button
              disabled={!selectedProvider || !selectedPlan || !projectId || startMutation.isPending}
              onClick={() => startMutation.mutate({
                provider: selectedProvider as "vastai" | "runpod" | "lambda",
                planId: selectedPlan,
                billingUnit,
                projectId,
              })}
            >
              {startMutation.isPending ? "Starting…" : "Start Session"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Active sessions panel
// ---------------------------------------------------------------------------

function ActiveSessionsPanel() {
  const { data: sessions, refetch, isLoading } = trpc.cloudCompute.getActiveSessions.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  const stopMutation = trpc.cloudCompute.stopSession.useMutation({
    onSuccess: (data) => {
      toast.success(`Session stopped — $${data.totalCostDollars.toFixed(4)} charged to wallet`);
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground py-4 text-center" role="status">Loading sessions…</p>;
  if (!sessions?.length) return <p className="text-sm text-muted-foreground py-4 text-center">No active sessions.</p>;

  return (
    <div className="space-y-3">
      {sessions.map(s => (
        <div key={s.id} className="flex items-center justify-between rounded-lg border px-4 py-3 gap-4">
          <div className="flex items-center gap-3">
            <CircleDot className="w-4 h-4 text-green-500 animate-pulse" />
            <div>
              <p className="text-sm font-medium">{s.instanceLabel}</p>
              <p className="text-xs text-muted-foreground capitalize">{s.provider} · {s.projectId} · {s.elapsedMinutes} min</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm font-mono text-amber-500">${s.currentCostDollars.toFixed(4)}</span>
            <Button
              size="sm"
              variant="destructive"
              disabled={stopMutation.isPending}
              onClick={() => stopMutation.mutate({ sessionId: s.id })}
            >
              <Square className="w-3 h-3 mr-1" />Stop
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Session history
// ---------------------------------------------------------------------------

function SessionHistoryPanel() {
  const { data: history, isLoading } = trpc.cloudCompute.getSessionHistory.useQuery({ limit: 50 });

  if (isLoading) return <p className="text-sm text-muted-foreground py-4 text-center" role="status">Loading history…</p>;
  if (!history?.length) return <p className="text-sm text-muted-foreground py-4 text-center">No session history yet.</p>;

  return (
    <ScrollArea className="h-80 rounded-md border">
      <table className="w-full text-xs" aria-label="Cloud compute session history">
        <thead className="sticky top-0 bg-muted">
          <tr>
            <th className="text-left px-3 py-2 font-semibold">Provider</th>
            <th className="text-left px-3 py-2 font-semibold">Instance</th>
            <th className="text-left px-3 py-2 font-semibold">Project</th>
            <th className="text-left px-3 py-2 font-semibold">Status</th>
            <th className="text-right px-3 py-2 font-semibold">Cost</th>
            <th className="text-left px-3 py-2 font-semibold">Started</th>
          </tr>
        </thead>
        <tbody>
          {history.map(s => (
            <tr key={s.id} className="border-t border-border hover:bg-muted/40">
              <td className="px-3 py-2 capitalize">{s.provider}</td>
              <td className="px-3 py-2">{s.instanceLabel}</td>
              <td className="px-3 py-2 text-muted-foreground">{s.projectId}</td>
              <td className="px-3 py-2">
                <Badge variant={s.status === "running" ? "default" : s.status === "stopped" ? "secondary" : "destructive"} className="text-xs">
                  {s.status}
                </Badge>
              </td>
              <td className="px-3 py-2 text-right font-mono">
                {s.totalCostMicrocents > 0 ? `$${(s.totalCostMicrocents / 1_000_000).toFixed(4)}` : "—"}
              </td>
              <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                {new Date(s.startedAt).toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollArea>
  );
}

// ---------------------------------------------------------------------------
// Subscription management
// ---------------------------------------------------------------------------

function SubscriptionPanel() {
  const { data: subs, refetch } = trpc.cloudCompute.getSubscriptions.useQuery();
  const [provider, setProvider] = useState<"vastai" | "runpod" | "lambda">("runpod");
  const [planName, setPlanName] = useState("");
  const [monthlyCents, setMonthlyCents] = useState("");
  const [notes, setNotes] = useState("");

  const addMutation = trpc.cloudCompute.setSubscription.useMutation({
    onSuccess: () => { toast.success("Subscription registered"); refetch(); setPlanName(""); setMonthlyCents(""); setNotes(""); },
    onError: (e) => toast.error(e.message),
  });

  const cancelMutation = trpc.cloudCompute.cancelSubscription.useMutation({
    onSuccess: () => { toast.success("Subscription cancelled"); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Monthly Subscriptions</CardTitle>
          <CardDescription>Track your pre-paid cloud compute plans. Costs are visible in wallet spend summaries.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="space-y-1">
              <Label htmlFor="sub-provider">Provider</Label>
              <Select value={provider} onValueChange={(v) => setProvider(v as "vastai" | "runpod" | "lambda")}>
                <SelectTrigger id="sub-provider"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="vastai">Vast.ai</SelectItem>
                  <SelectItem value="runpod">RunPod</SelectItem>
                  <SelectItem value="lambda">Lambda Labs</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="sub-plan">Plan Name</Label>
              <Input id="sub-plan" value={planName} onChange={e => setPlanName(e.target.value)} placeholder="e.g. RunPod $50 Credit" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="sub-cost">Monthly Cost (USD)</Label>
              <Input id="sub-cost" type="number" min={0} step={0.01} value={monthlyCents} onChange={e => setMonthlyCents(e.target.value)} placeholder="50.00" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="sub-notes">Notes</Label>
              <Input id="sub-notes" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional" />
            </div>
          </div>
          <Button
            size="sm"
            disabled={!planName || !monthlyCents || addMutation.isPending}
            onClick={() => addMutation.mutate({
              provider,
              planName,
              monthlyCents: Math.round(parseFloat(monthlyCents) * 100),
              notes: notes || undefined,
            })}
          >
            {addMutation.isPending ? "Saving…" : "Register Subscription"}
          </Button>

          {(subs ?? []).length > 0 && (
            <div className="space-y-2 mt-2">
              {(subs ?? []).map(s => (
                <div key={s.id} className="flex items-center justify-between rounded-md border px-3 py-2">
                  <div>
                    <span className="text-sm font-medium capitalize">{s.provider}</span>
                    <span className="text-sm text-muted-foreground ml-2">{s.planName}</span>
                    {s.notes && <span className="text-xs text-muted-foreground ml-2">— {s.notes}</span>}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-mono">${(s.monthlyCents / 100).toFixed(2)}/mo</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      disabled={cancelMutation.isPending}
                      onClick={() => cancelMutation.mutate({ subscriptionId: s.id })}
                    >
                      Cancel
                    </Button>
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

// ---------------------------------------------------------------------------
// Root panel
// ---------------------------------------------------------------------------

const CloudComputePanel: React.FC = () => {
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Cloud className="w-5 h-5 text-primary" />
        <div>
          <h2 className="text-lg font-semibold">Cloud Compute Rental</h2>
          <p className="text-sm text-muted-foreground">Rent GPU instances from Vast.ai, RunPod, or Lambda Labs. Session costs flow into your Agentic Wallet.</p>
        </div>
      </div>

      <div className="rounded-md bg-muted/40 border px-4 py-3 text-sm flex items-start gap-2">
        <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
        <div>
          <p className="font-medium">API Keys Required for Live Provisioning</p>
          <p className="text-muted-foreground text-xs mt-0.5">
            Add <code className="bg-muted px-1 rounded">VASTAI_API_KEY</code>, <code className="bg-muted px-1 rounded">RUNPOD_API_KEY</code>, or <code className="bg-muted px-1 rounded">LAMBDA_API_KEY</code> to your <code className="bg-muted px-1 rounded">.env</code> file.
            Sessions are tracked locally in all cases and costs flow to your wallet budget.
          </p>
        </div>
      </div>

      <Tabs defaultValue="sessions">
        <TabsList>
          <TabsTrigger value="sessions"><Cpu className="w-3.5 h-3.5 mr-1.5" />Active Sessions</TabsTrigger>
          <TabsTrigger value="start"><Plus className="w-3.5 h-3.5 mr-1.5" />Start Session</TabsTrigger>
          <TabsTrigger value="history"><Cloud className="w-3.5 h-3.5 mr-1.5" />History</TabsTrigger>
          <TabsTrigger value="subscriptions"><CreditCard className="w-3.5 h-3.5 mr-1.5" />Subscriptions</TabsTrigger>
        </TabsList>

        <TabsContent value="sessions" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Running Sessions</CardTitle>
              <CardDescription>Live cost updates every 30 seconds. Stop a session to write its cost to your wallet.</CardDescription>
            </CardHeader>
            <CardContent>
              <ActiveSessionsPanel key={refreshKey} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="start" className="mt-4">
          <StartSessionForm onStarted={() => setRefreshKey(k => k + 1)} />
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Session History</CardTitle>
            </CardHeader>
            <CardContent>
              <SessionHistoryPanel />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="subscriptions" className="mt-4">
          <SubscriptionPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default CloudComputePanel;
