import React, { useState } from "react";
import OmnecorDashboardLayout from "@/components/OmnecorDashboardLayout";
import { trpc } from "@/lib/trpc";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import VirtualCardPanel from "@/components/wallet/VirtualCardPanel";
import { 
  Wallet, 
  CreditCard, 
  TrendingUp, 
  ShieldCheck, 
  Zap,
} from "lucide-react";

const GLOBAL_WALLET_ID = "__global__";

export default function AgenticWallet() {
  const { data: projects } = trpc.project.list.useQuery();
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");

  // Global vs per-project wallet mode
  const [globalMode, setGlobalMode] = useState<boolean>(() => {
    try { return localStorage.getItem("omnecor:wallet_global_mode") !== "false"; } catch { return true; }
  });
  const handleGlobalModeToggle = (v: boolean) => {
    setGlobalMode(v);
    localStorage.setItem("omnecor:wallet_global_mode", String(v));
    if (v) setSelectedProjectId(GLOBAL_WALLET_ID);
  };

  // When global mode is on, use the global project id
  const effectiveProjectId = globalMode ? GLOBAL_WALLET_ID : selectedProjectId;
  
  const { data: budget } = trpc.wallet.getBudget.useQuery(
    { projectId: effectiveProjectId },
    { enabled: !!effectiveProjectId }
  );

  const { data: spendSummary } = trpc.wallet.getSpendSummary.useQuery(
    { projectId: effectiveProjectId },
    { enabled: !!effectiveProjectId, refetchInterval: 10000 }
  );

  const spendPercent = budget && spendSummary && spendSummary.totalCentsDollars !== undefined
    ? Math.min(100, (spendSummary.totalCentsDollars / (budget.limitCents / 100)) * 100)
    : 0;

  return (
    <OmnecorDashboardLayout>
      <div className="flex flex-col h-full bg-background overflow-hidden">
        <div className="border-b border-border bg-card px-6 py-4 flex-shrink-0 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Wallet className="w-6 h-6 text-accent" />
            <div>
              <h1 className="text-xl font-bold">Agentic Wallet Dashboard</h1>
              <p className="text-sm text-muted-foreground">
                Live financial monitoring and spend tracking for AI agents
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            {/* Global / Per-Project toggle */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-muted/30">
              <Label htmlFor="wallet-global-toggle" className="text-xs cursor-pointer whitespace-nowrap">
                {globalMode ? "Global Wallet" : "Per Project"}
              </Label>
              <Switch
                id="wallet-global-toggle"
                checked={globalMode}
                onCheckedChange={handleGlobalModeToggle}
                aria-label="Toggle global wallet mode"
              />
            </div>
            {/* Project selector — only when not in global mode */}
            {!globalMode && (
              <div className="w-56">
                <select
                  className="w-full bg-background border rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 outline-none transition-all"
                  value={selectedProjectId}
                  onChange={(e) => setSelectedProjectId(e.target.value)}
                >
                  <option value="">Select a project...</option>
                  {projects?.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-6 space-y-6">
          <Tabs defaultValue="tracking" className="space-y-6">
            <TabsList className="bg-muted/50 p-1">
              <TabsTrigger value="tracking" className="gap-2">
                <TrendingUp className="w-4 h-4" /> Spend Tracking
              </TabsTrigger>
              <TabsTrigger value="cards" className="gap-2">
                <CreditCard className="w-4 h-4" /> Virtual Cards
              </TabsTrigger>
            </TabsList>

            <TabsContent value="tracking" className="space-y-6 m-0">
              {/* Overview Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="bg-primary/5 border-primary/20 shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <Wallet className="w-4 h-4 text-primary" /> Total Tracked Spend
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">$12.45</div>
                    <p className="text-[10px] text-muted-foreground mt-1">Across all active projects</p>
                  </CardContent>
                </Card>
                <Card className="shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <CreditCard className="w-4 h-4 text-accent" /> Virtual Cards
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">3</div>
                    <p className="text-[10px] text-muted-foreground mt-1">Active Lithic containers</p>
                  </CardContent>
                </Card>
                <Card className="shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-green-500" /> Prevention
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">2</div>
                    <p className="text-[10px] text-muted-foreground mt-1">Runaway tasks blocked</p>
                  </CardContent>
                </Card>
              </div>

              {/* Live Tracking */}
              <Card className="shadow-md border-muted/50">
                <CardHeader className="flex flex-row items-center justify-between space-y-0">
                  <div>
                    <CardTitle className="text-lg">Live Spend Tracking</CardTitle>
                    <CardDescription>Real-time cost analysis for {globalMode ? "all projects (global wallet)" : projects?.find(p => p.id === selectedProjectId)?.name || "selected project"}.</CardDescription>
                  </div>
                  {selectedProjectId && budget && (
                    <Badge variant={budget.mode === 'hard' ? "destructive" : "secondary"} className="h-6 px-3">
                      {budget.mode.toUpperCase()}
                    </Badge>
                  )}
                </CardHeader>
                <CardContent className="space-y-8 py-6">
                  {!effectiveProjectId ? (
                    <div className="h-64 flex flex-col items-center justify-center text-muted-foreground border-2 border-dashed rounded-lg bg-muted/5">
                      <TrendingUp className="w-12 h-12 mb-4 opacity-20" />
                      <p className="text-sm italic">Select a project in the top right to view metrics</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div className="space-y-3">
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-medium">Budget Consumed</span>
                          <span className="font-mono text-xs font-bold">{spendPercent.toFixed(1)}%</span>
                        </div>
                        <Progress value={spendPercent} className="h-2.5 bg-muted" />
                        <div className="flex justify-between text-[10px] text-muted-foreground">
                          <span className="font-medium">${spendSummary?.totalCentsDollars?.toFixed(2) || "0.00"} spent</span>
                          <span className="font-medium">Limit: ${budget ? (budget.limitCents / 100).toFixed(2) : "0.00"}</span>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div className="text-xs uppercase font-bold text-muted-foreground tracking-widest mb-2">Provider Breakdown</div>
                        <div className="grid gap-3">
                          {spendSummary?.byProvider.map(p => (
                            <div key={p.provider} className="flex items-center justify-between p-4 rounded-xl bg-muted/30 border border-muted/50 hover:bg-muted/40 transition-colors">
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-lg bg-background flex items-center justify-center border shadow-sm">
                                  <Zap className="w-4 h-4 text-accent" />
                                </div>
                                <span className="text-sm font-semibold capitalize">{p.provider}</span>
                              </div>
                              <span className="text-sm font-mono font-bold">${(p.totalMicrocents / 1_000_000).toFixed(4)}</span>
                            </div>
                          ))}
                          {spendSummary?.byProvider.length === 0 && (
                            <div className="text-center py-8 border rounded-xl border-dashed bg-muted/5">
                              <p className="text-xs text-muted-foreground italic">No spend recorded yet for this project.</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="cards" className="m-0">
              <VirtualCardPanel />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </OmnecorDashboardLayout>
  );
}
