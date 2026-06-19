import { RadialBarChart, RadialBar, ResponsiveContainer, Tooltip } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Wallet, AlertTriangle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useWalletStore } from "@/lib/store/app.store";
import { BudgetConfigDialog } from "./BudgetConfigDialog";

interface BudgetPanelProps {
  projectId: string;
  className?: string;
}

export function BudgetPanel({ projectId, className }: BudgetPanelProps) {
  const { data: budget } = trpc.wallet.getBudget.useQuery({ projectId });
  const { data: summary } = trpc.wallet.getSpendSummary.useQuery({ projectId });

  // Subscribe to real-time wallet spend events to trigger re-renders
  useWalletStore((s) => s.walletSpend);

  const spentCents = (summary?.totalMicrocents ?? 0) / 1_000_000;
  const limitCents = budget?.limitCents ?? 0;
  const percentUsed = limitCents > 0 ? Math.min((spentCents / limitCents) * 100, 100) : 0;
  const isWarning = percentUsed >= (budget?.alertThreshold ?? 80);
  const isExhausted = limitCents > 0 && spentCents >= limitCents;

  const chartData = [
    { name: "Used", value: percentUsed, fill: isExhausted ? "hsl(var(--destructive))" : isWarning ? "oklch(0.75 0.18 60)" : "oklch(0.65 0.2 160)" },
  ];

  const formatCents = (cents: number) => `$${(cents / 100).toFixed(4)}`;

  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Wallet className="h-4 w-4" />
          Agentic Wallet
        </CardTitle>
        <div className="flex items-center gap-2">
          {isWarning && !isExhausted && (
            <Badge variant="outline" className="text-amber-500 border-amber-500 text-xs">
              <AlertTriangle className="h-3 w-3 mr-1" /> {Math.round(percentUsed)}%
            </Badge>
          )}
          {isExhausted && (
            <Badge variant="destructive" className="text-xs">Budget Exhausted</Badge>
          )}
          <BudgetConfigDialog projectId={projectId} />
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-4">
          <div className="flex flex-col items-center gap-1">
            <div className="w-24 h-24 flex-shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <RadialBarChart
                  cx="50%"
                  cy="50%"
                  innerRadius="60%"
                  outerRadius="100%"
                  data={chartData}
                  startAngle={90}
                  endAngle={-270}
                >
                  <RadialBar 
                    dataKey="value" 
                    cornerRadius={4} 
                    background={{ fill: "oklch(0.2 0 0)" }}
                    isAnimationActive={false}
                  />
                </RadialBarChart>
              </ResponsiveContainer>
            </div>
            <p className="text-xs font-bold font-mono text-accent tracking-tighter">
              %{percentUsed.toFixed(1)}
            </p>
          </div>
          <div className="flex-1 space-y-1">
            <p className="text-2xl font-bold">{formatCents(spentCents)}</p>
            <p className="text-xs text-muted-foreground">
              {limitCents > 0 ? `of ${formatCents(limitCents)} limit` : "No limit set"}
            </p>
            {summary?.byProvider && summary.byProvider.length > 0 && (
              <div className="mt-2 space-y-0.5">
                {summary.byProvider.map((p) => (
                  <div key={p.provider} className="flex justify-between text-xs text-muted-foreground">
                    <span className="capitalize">{p.provider}</span>
                    <span>{formatCents(p.totalMicrocents / 1_000_000)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
