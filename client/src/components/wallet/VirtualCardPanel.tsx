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
  AlertCircle,
  Loader2,
  Lock,
  Eye,
  EyeOff,
  Copy,
  Activity
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLocation } from "wouter";

export default function VirtualCardPanel() {
  const [, setLocation] = useLocation();
  const [showSensitive, setShowSensitive] = useState(false);
  const [isIssuing, setIsArchiving] = useState(false);
  const [limit, setLimit] = useState(50);
  const [memo, setMemo] = useState("AI Cloud Compute");
  const DEMO_CARD_NUMBER = "4242 8888 1234 5678";

  const { data: isConfigured } = trpc.virtualCard.isConfigured.useQuery();

  const issueMutation = trpc.virtualCard.issueCard.useMutation({
    onSuccess: (data) => {
      setIsArchiving(false);
      if (data.card) {
        toast.success("Virtual card issued successfully");
      } else {
        toast.info(data.message);
      }
    },
    onError: (e) => {
      setIsArchiving(false);
      toast.error(`Issuance failed: ${e.message}`);
    }
  });

  const handleIssue = () => {
    setIsArchiving(true);
    issueMutation.mutate({ spendLimitDollars: limit, memo });
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
                          <Button variant="outline" size="sm" onClick={() => setLocation("/settings?tab=api")}>Configure Lithic</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Existing Card Display */}
        <Card className="bg-gradient-to-br from-slate-900 to-slate-950 border-slate-800 text-white relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-accent/10 blur-3xl -mr-16 -mt-16 group-hover:bg-accent/20 transition-colors" />
          <CardHeader className="pb-8">
            <div className="flex justify-between items-start">
              <CreditCard className="w-8 h-8 text-accent" />
              <div className="flex flex-col items-end">
                <Badge variant="outline" className="text-[10px] h-5 border-emerald-500/30 text-emerald-400 bg-emerald-500/5">Active</Badge>
                <p className="text-[9px] text-muted-foreground mt-1 uppercase font-bold tracking-tighter">Single Use</p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-1">
              <p className="text-[10px] uppercase font-bold text-slate-500 tracking-widest">Card Number</p>
              <div className="flex items-center gap-2">
                <p className="font-mono text-lg tracking-[0.2em]">
                  {showSensitive ? "4242 8888 1234 5678" : "•••• •••• •••• 5678"}
                </p>
                <Button size="icon" variant="ghost" className="h-6 w-6 text-slate-500 hover:text-white" onClick={() => setShowSensitive(!showSensitive)}>
                  {showSensitive ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <p className="text-[10px] uppercase font-bold text-slate-500 tracking-widest">Expiry</p>
                <p className="font-mono text-sm">{showSensitive ? "08/28" : "••/••"}</p>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] uppercase font-bold text-slate-500 tracking-widest">CVV</p>
                <p className="font-mono text-sm">{showSensitive ? "123" : "•••"}</p>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-800 flex justify-between items-end">
               <div>
                 <p className="text-[10px] text-slate-500 uppercase font-bold">Limit Remaining</p>
                 <p className="text-xl font-bold text-accent">$42.15 <span className="text-[10px] text-slate-600 font-normal">/ $50.00</span></p>
               </div>
                               <Button
                  size="icon"
                  variant="outline"
                  className="h-8 w-8 border-slate-800 bg-slate-900/50 hover:bg-slate-800"
                  onClick={() => {
                    const num = showSensitive ? DEMO_CARD_NUMBER : DEMO_CARD_NUMBER.replace(/\d(?=.{4})/g, "•");
                    navigator.clipboard.writeText(DEMO_CARD_NUMBER).then(() => toast.success("Card number copied")).catch(() => toast.error("Copy failed"));
                  }}
                >
                 <Copy className="w-3.5 h-3.5" />
               </Button>
            </div>
          </CardContent>
        </Card>

        {/* Issue New Card Form */}
        <Card className="bg-muted/20 border-accent/10">
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
            <div className="p-3 rounded-lg bg-accent/5 border border-accent/20 space-y-2">
              <div className="flex items-center gap-2 text-accent">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span className="text-[10px] font-bold uppercase">HITL Security</span>
              </div>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                New card issuance requires administrator approval via the local interface.
              </p>
            </div>
            <Button 
              className="w-full gap-2 h-10 bg-accent text-accent-foreground"
              disabled={isIssuing}
              onClick={handleIssue}
            >
              {isIssuing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Request New Virtual Card
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Transaction Log Integration */}
      <Card className="bg-card shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="w-4 h-4 text-blue-500" /> Card Activity
            </CardTitle>
                            <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={() => setLocation("/wallet")}>View All</Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y border-t">
            {[
              { id: 1, merchant: "AWS", amount: 12.45, date: "2026-06-05", status: "cleared" },
              { id: 2, merchant: "PCBWay", amount: 35.00, date: "2026-06-04", status: "pending" },
              { id: 3, merchant: "OpenAI", amount: 2.10, date: "2026-06-03", status: "cleared" },
            ].map(tx => (
              <div key={tx.id} className="p-4 flex items-center justify-between hover:bg-muted/10 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded bg-muted flex items-center justify-center font-bold text-xs uppercase tracking-tighter">
                    {tx.merchant.charAt(0)}
                  </div>
                  <div>
                    <p className="text-sm font-bold">{tx.merchant}</p>
                    <p className="text-[10px] text-muted-foreground">{tx.date}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-mono font-bold">${tx.amount.toFixed(2)}</p>
                  <Badge variant="outline" className={cn("text-[9px] h-4 uppercase", tx.status === 'cleared' ? "text-emerald-500 border-emerald-500/20" : "text-amber-500 border-amber-500/20")}>
                    {tx.status}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
