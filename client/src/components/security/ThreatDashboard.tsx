import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export default function ThreatDashboard() {
  const [activeTab, setActiveTab] = useState<"scan" | "ioc">("scan");
  const [targetPath, setTargetPath] = useState(".");

  const scanMut = (trpc as any).security?.runVulnerabilityScan?.useMutation?.({
    onError: (err: { message?: string }) => toast.error(`Scan failed: ${err?.message}`),
  });
  const iocQuery = (trpc as any).security?.getIoCFeed?.useQuery?.(undefined, { enabled: activeTab === "ioc" });

  const findings = (scanMut?.data as any)?.findings ?? [];
  const iocEntries = (iocQuery?.data as any[]) ?? [];

  return (
    <div className="space-y-4">
      <div className="flex gap-2 border-b border-border pb-2">
        {(["scan", "ioc"] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-1.5 rounded text-sm transition-colors ${activeTab === tab ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white"}`}
          >
            {tab === "scan" ? "Vulnerability Scan" : "IoC Feed"}
          </button>
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
            <Button
              size="sm"
              onClick={() => scanMut?.mutate?.({ targetPath })}
              disabled={scanMut?.isPending}
            >
              {scanMut?.isPending ? "Scanning..." : "Scan"}
            </Button>
          </div>

          {scanMut?.isError && (
            <p className="text-red-400 text-sm">{(scanMut.error as any)?.message}</p>
          )}

          {findings.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-gray-300">
                <thead>
                  <tr className="border-b border-gray-700 text-gray-500 uppercase">
                    <th className="text-left py-1 pr-3">Tool</th>
                    <th className="text-left py-1 pr-3">Rule</th>
                    <th className="text-left py-1 pr-3">File</th>
                    <th className="text-left py-1 pr-3">Line</th>
                    <th className="text-left py-1">Message</th>
                  </tr>
                </thead>
                <tbody>
                  {findings.map((f: any, i: number) => (
                    <tr key={i} className="border-b border-gray-800">
                      <td className="py-1 pr-3"><Badge className="text-xs">{f.tool}</Badge></td>
                      <td className="py-1 pr-3 font-mono">{f.rule}</td>
                      <td className="py-1 pr-3 font-mono truncate max-w-[200px]" title={f.file}>{f.file}</td>
                      <td className="py-1 pr-3">{f.line}</td>
                      <td className="py-1 text-gray-400">{f.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {scanMut?.isSuccess && findings.length === 0 && (
            <p className="text-green-400 text-sm">No findings.</p>
          )}
        </div>
      )}

      {activeTab === "ioc" && (
        <div className="space-y-3">
          {iocQuery?.isLoading && <p className="text-gray-400 text-sm">Loading IoC feed...</p>}
          {!iocQuery?.isLoading && iocEntries.length === 0 && (
            <div className="text-gray-500 text-sm p-4 rounded border border-gray-700 bg-gray-900">
              {process.env.NODE_ENV !== "production"
                ? "Configure MISP_URL environment variable to enable the IoC feed."
                : "No IoC entries. Configure MISP_URL to enable the IoC feed."}
            </div>
          )}
          {iocEntries.length > 0 && (
            <div className="space-y-2">
              {iocEntries.map((entry: any, i: number) => (
                <div key={i} className="flex items-center gap-3 p-2 rounded bg-gray-900 border border-gray-800 text-xs">
                  <Badge className="text-xs shrink-0">{entry.type}</Badge>
                  <span className="font-mono text-gray-200 flex-1 truncate">{entry.value}</span>
                  <span className="text-gray-500 shrink-0">{entry.category}</span>
                  <span className="text-gray-600 shrink-0">{entry.timestamp}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
