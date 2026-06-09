import re

with open("client/src/components/settings/AgenticWalletPanel.tsx", "r") as f:
    content = f.read()

# Replace the layout from AgenticWalletPanel to only contain the Project Budgets and Lithic Integration.
new_panel = """import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardHeader, CardTitle, CardContent, CardDescription, CardFooter } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { 
  DollarSign,
  Lock
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export default function AgenticWalletPanel() {
  const { data: projects } = trpc.project.list.useQuery();
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  
  const setBudgetMutation = trpc.wallet.setBudget.useMutation({
    onSuccess: () => {
      toast.success("Budget updated");
    },
    onError: (e) => toast.error(e.message)
  });

  const [limitDollars, setLimitDollars] = useState<string>("5.00");
  const [mode, setMode] = useState<"soft" | "hard">("soft");

  const handleSaveBudget = () => {
    if (!selectedProjectId) return;
    setBudgetMutation.mutate({
      projectId: selectedProjectId,
      limitCents: Math.round(parseFloat(limitDollars) * 100),
      mode,
      alertThreshold: 80
    });
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
                <RadioGroup value={mode} onValueChange={(v: any) => setMode(v)} className="space-y-2">
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
          <div className="flex items-center justify-between p-5 rounded-2xl border bg-card mb-6 shadow-sm">
            <div className="flex items-center gap-5">
              <div className="w-14 h-9 rounded-lg bg-gradient-to-br from-gray-800 to-black border-gray-700 border flex items-center justify-center shadow-lg relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-full bg-white/5 opacity-20 pointer-events-none" />
                <span className="text-[10px] text-white/40 font-mono tracking-widest z-10">VISA</span>
              </div>
              <div>
                <p className="text-sm font-bold tracking-tight">Lithic Integration Status</p>
                <p className="text-xs text-muted-foreground">System authenticated and ready to issue</p>
              </div>
            </div>
            <Badge className="bg-green-500/20 text-green-500 border-green-500/30 font-bold px-4 py-1">CONNECTED</Badge>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Button variant="outline" className="h-auto py-5 px-6 flex-col items-start gap-2 hover:bg-background hover:border-primary/50 transition-all border-muted-foreground/20">
              <span className="text-sm font-bold">Issue Project Card</span>
              <span className="text-[10px] text-muted-foreground font-normal leading-relaxed text-left">Create a dedicated virtual card with automatic spending limits tied to {projects?.find(p => p.id === selectedProjectId)?.name || "a project"}.</span>
            </Button>
            <Button variant="outline" className="h-auto py-5 px-6 flex-col items-start gap-2 hover:bg-background hover:border-primary/50 transition-all border-muted-foreground/20">
              <span className="text-sm font-bold">HITL Authorization</span>
              <span className="text-[10px] text-muted-foreground font-normal leading-relaxed text-left">Human-in-the-loop review queue for pending card issuance and high-value transaction requests.</span>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
"""

with open("client/src/components/settings/AgenticWalletPanel.tsx", "w") as f:
    f.write(new_panel)
