import os

with open("client/src/App.tsx", "r") as f:
    app_code = f.read()

import_line = 'const AgenticWallet = lazy(() => import("@/pages/AgenticWallet"));'
if 'AgenticWallet' not in app_code:
    app_code = app_code.replace('const NotFound = lazy(() => import("@/pages/NotFound"));', 'const NotFound = lazy(() => import("@/pages/NotFound"));\n' + import_line)

route_line = '<Route path="/wallet" component={withBoundary(AgenticWallet)} />'
if '/wallet' not in app_code:
    app_code = app_code.replace('<Route path="/agent-networking" component={withBoundary(AgentNetworking)} />', '<Route path="/agent-networking" component={withBoundary(AgentNetworking)} />\n        ' + route_line)

with open("client/src/App.tsx", "w") as f:
    f.write(app_code)


with open("client/src/components/OmnecorDashboardLayout.tsx", "r") as f:
    layout_code = f.read()

import_lucide = 'import { Wallet } from "lucide-react";\n'
if 'Wallet' not in layout_code:
    layout_code = layout_code.replace('import { Link, useLocation } from "wouter";', import_lucide + 'import { Link, useLocation } from "wouter";')

nav_item = """
    {
      label: "Agentic Wallet",
      href: "/wallet",
      icon: Wallet,
      description: "Manage autonomous agent budgets",
    },
"""
if '/wallet' not in layout_code:
    layout_code = layout_code.replace('label: "Settings",\n      href: "/settings",', 'label: "Agentic Wallet",\n      href: "/wallet",\n      icon: Wallet,\n      description: "Manage autonomous agent budgets",\n    },\n    {\n      label: "Settings",\n      href: "/settings",')

with open("client/src/components/OmnecorDashboardLayout.tsx", "w") as f:
    f.write(layout_code)


agentic_wallet_page_code = """import React, { useState } from "react";
import OmnecorDashboardLayout from "@/components/OmnecorDashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { 
  Wallet, 
  CreditCard, 
  TrendingUp, 
  ShieldCheck, 
  Zap,
} from "lucide-react";

export default function AgenticWallet() {
  const { data: projects } = trpc.project.list.useQuery();
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  
  const { data: budget } = trpc.wallet.getBudget.useQuery(
    { projectId: selectedProjectId },
    { enabled: !!selectedProjectId }
  );
  
  const { data: spendSummary } = trpc.wallet.getSpendSummary.useQuery(
    { projectId: selectedProjectId },
    { enabled: !!selectedProjectId, refetchInterval: 10000 }
  );

  const spendPercent = budget && spendSummary 
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
          
          <div className="w-64">
            <select 
              className="w-full bg-background border rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 outline-none transition-all"
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
            >
              <option value="">Overview (Select a project)...</option>
              {projects?.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-6 space-y-6">
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
                <CardDescription>Real-time cost analysis for {projects?.find(p => p.id === selectedProjectId)?.name || "selected project"}.</CardDescription>
              </div>
              {selectedProjectId && budget && (
                <Badge variant={budget.mode === 'hard' ? "destructive" : "secondary"} className="h-6 px-3">
                  {budget.mode.toUpperCase()}
                </Badge>
              )}
            </CardHeader>
            <CardContent className="space-y-8 py-6">
              {!selectedProjectId ? (
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
        </div>
      </div>
    </OmnecorDashboardLayout>
  );
}
"""
with open("client/src/pages/AgenticWallet.tsx", "w") as f:
    f.write(agentic_wallet_page_code)
