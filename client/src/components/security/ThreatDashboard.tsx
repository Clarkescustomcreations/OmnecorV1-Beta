import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { HowToTooltip } from "@/components/shell/HowToTooltip";

type Finding = { tool: string; rule: string; file: string; line: number; message: string };

export function ThreatDashboard() {
  const [activeTab, setActiveTab] = useState<"scan" | "ioc">("scan");
  const [targetPath, setTargetPath] = useState(".");

  const scanMut = trpc.security.runVulnerabilityScan.useMutation({
    onError: (err) => toast.error(`Scan failed: ${err.message}`),
  });
  const iocQuery = trpc.security.getIoCFeed.useQuery(undefined, { enabled: activeTab === "ioc" });

  const findings: Finding[] = scanMut.data?.findings ?? [];
  const iocEntries = iocQuery.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex gap-2 border-b border-border pb-2">
        {(["scan", "ioc"] as const).map(tab => (
          <HowToTooltip key={tab} title="Switch View" description="Toggle between the vulnerability scanner and the Indicators of Compromise feed." side="bottom">
            <button
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1.5 rounded text-sm transition-colors ${activeTab === tab ? "bg-primary text-white" : "text-muted-foreground hover:text-white"}`}
            >
              {tab === "scan" ? "Vulnerability Scan" : "IoC Feed"}
            </button>
          </HowToTooltip>
        ))}
      </div>

      {activeTab === "scan" && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={targetPath}
              onChange={e => setTargetPath(e.target.value)}
              placeholder="Target path"
              className="flex-1"
            />
            <HowToTooltip title="Run Scan" description="Execute a vulnerability scan on the specified target path." side="bottom">
              <Button
                size="sm"
                onClick={() => scanMut.mutate({ targetPath })}
                disabled={scanMut.isPending}
              >
                {scanMut.isPending ? "Scanning..." : "Scan"}
              </Button>
            </HowToTooltip>
          </div>

          {scanMut.isError && (
            <p className="text-destructive text-sm">{scanMut.error?.message}</p>
          )}

          {findings.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-foreground">
                <thead>
                  <tr className="border-b border-border text-muted-foreground uppercase">
                    <th className="text-left py-1 pr-3">Tool</th>
                    <th className="text-left py-1 pr-3">Rule</th>
                    <th className="text-left py-1 pr-3">File</th>
                    <th className="text-left py-1 pr-3">Line</th>
                    <th className="text-left py-1">Message</th>
                  </tr>
                </thead>
                <tbody>
                  {findings.map((f, i) => (
                    <tr key={i} className="border-b border-border">
                      <td className="py-1 pr-3"><Badge className="text-xs">{f.tool}</Badge></td>
                      <td className="py-1 pr-3 font-mono">{f.rule}</td>
                      <td className="py-1 pr-3 font-mono truncate max-w-[200px]" title={f.file}>{f.file}</td>
                      <td className="py-1 pr-3">{f.line}</td>
                      <td className="py-1 text-muted-foreground">{f.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {scanMut.isSuccess && findings.length === 0 && (
            <p className="text-accent-success text-sm">No findings.</p>
          )}
        </div>
      )}

      {activeTab === "ioc" && (
        <div className="space-y-3">
          {iocQuery.isLoading && <p className="text-muted-foreground text-sm">Loading IoC feed...</p>}
          {!iocQuery.isLoading && iocEntries.length === 0 && (
            <div className="text-muted-foreground text-sm p-4 rounded border border-border bg-card">
              {process.env.NODE_ENV !== "production"
                ? "Configure MISP_URL environment variable to enable the IoC feed."
                : "No IoC entries. Configure MISP_URL to enable the IoC feed."}
            </div>
          )}
          {iocEntries.length > 0 && (
            <div className="space-y-2">
              {iocEntries.map((entry, i) => (
                <div key={i} className="flex items-center gap-3 p-2 rounded bg-card border border-border text-xs">
                  <Badge className="text-xs shrink-0">{entry.type}</Badge>
                  <span className="font-mono text-foreground flex-1 truncate">{entry.value}</span>
                  <span className="text-muted-foreground shrink-0">{entry.category}</span>
                  <span className="text-muted-foreground shrink-0">{entry.timestamp}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
