import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

const PHASES = ["DEFINE", "PLAN", "EXECUTE", "REVIEW", "SHIP"] as const;

const phaseStatusColor: Record<string, string> = {
  pending: "bg-gray-700 text-gray-300",
  awaiting_approval: "bg-amber-700 text-amber-100 animate-pulse",
  approved: "bg-green-700 text-green-100",
  complete: "bg-green-700 text-green-100",
  rejected: "bg-red-700 text-red-100",
};

export default function PhaseOutputPanel({ pipelineId }: { pipelineId: string }) {
  const result = trpc.pipeline.getPipeline.useQuery(
    { pipelineId },
    {
      refetchInterval: (query) => {
        const data = query.state.data;
        if (data?.pipeline?.status === "complete" || data?.pipeline?.status === "aborted") return false;
        return 2000;
      },
    }
  );

  const approvePhase = trpc.pipeline.approvePhase.useMutation({
    onError: (err) => toast.error(`Approval failed: ${err.message}`),
  });
  const abortPipeline = trpc.pipeline.abortPipeline.useMutation({
    onError: (err) => toast.error(`Abort failed: ${err.message}`),
  });

  if (result.isLoading) {
    return <div className="text-gray-400 text-sm p-4">Loading pipeline...</div>;
  }

  const { pipeline, phases } = result.data ?? { pipeline: null, phases: [] };

  if (!pipeline) return null;

  const canAbort = ["pending", "running", "paused"].includes(pipeline.status);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-white font-semibold">{pipeline.name}</h3>
          <p className="text-gray-400 text-sm truncate max-w-lg">{pipeline.goal}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge className={pipeline.status === "complete" ? "bg-green-700" : pipeline.status === "aborted" ? "bg-red-700" : "bg-blue-700"}>
            {pipeline.status.toUpperCase()}
          </Badge>
          {canAbort && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => abortPipeline.mutate({ pipelineId })}
              disabled={abortPipeline.isPending}
            >
              Abort
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-3">
        {PHASES.map((phaseName) => {
          const phaseData = phases?.find((p) => p.phase === phaseName);
          const isActive = pipeline.currentPhase === phaseName;

          return (
            <div key={phaseName} className={`rounded-lg border p-4 ${isActive ? "border-blue-600 bg-blue-950/30" : "border-gray-700 bg-gray-900/50"}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-white font-medium text-sm">{phaseName}</span>
                {phaseData && (
                  <span className={`text-xs px-2 py-0.5 rounded-full ${phaseStatusColor[phaseData.status] ?? "bg-gray-700 text-gray-300"}`}>
                    {phaseData.status.replace("_", " ")}
                  </span>
                )}
              </div>
              {phaseData?.outputText && (
                <pre className="text-gray-300 text-xs whitespace-pre-wrap break-words font-mono bg-black/30 rounded p-2 mt-2 max-h-48 overflow-y-auto">
                  {phaseData.outputText}
                </pre>
              )}
              {phaseData?.status === "awaiting_approval" && (
                <Button
                  size="sm"
                  className="mt-3"
                  onClick={() => approvePhase.mutate({ pipelineId, phase: phaseName })}
                  disabled={approvePhase.isPending}
                >
                  Approve
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
