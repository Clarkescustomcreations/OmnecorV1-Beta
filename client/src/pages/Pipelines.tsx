import { useState } from "react";
import OmnecorDashboardLayout from "@/components/OmnecorDashboardLayout";
import SpecializedModuleLauncher from "@/components/SpecializedModuleLauncher";
import PhaseOutputPanel from "@/components/pipelines/PhaseOutputPanel";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Zap, ArrowLeft, Plus } from "lucide-react";

const phaseColor: Record<string, string> = {
  DEFINE: "bg-slate-700",
  PLAN: "bg-blue-700",
  EXECUTE: "bg-amber-700",
  REVIEW: "bg-purple-700",
  SHIP: "bg-green-700",
  DONE: "bg-emerald-700",
};

export default function Pipelines() {
  const [selectedPipelineId, setSelectedPipelineId] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");

  const listPipelines = (trpc as any).pipeline?.listPipelines?.useQuery?.(undefined, {
    refetchInterval: 3000,
  });

  const createPipeline = (trpc as any).pipeline?.createPipeline?.useMutation?.({
    onSuccess: () => {
      setShowCreateForm(false);
      setName("");
      setGoal("");
      listPipelines?.refetch?.();
    },
  });

  if (selectedPipelineId) {
    return (
      <OmnecorDashboardLayout>
        <div className="h-full flex flex-col bg-background">
          <div className="border-b border-border bg-card px-6 py-4 flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => setSelectedPipelineId(null)}>
              <ArrowLeft className="w-4 h-4 mr-1" /> Back
            </Button>
            <Zap className="w-5 h-5 text-accent" />
            <span className="font-semibold">Pipeline Detail</span>
          </div>
          <div className="flex-1 overflow-auto p-6">
            <PhaseOutputPanel pipelineId={selectedPipelineId} />
          </div>
        </div>
      </OmnecorDashboardLayout>
    );
  }

  return (
    <OmnecorDashboardLayout>
      <div className="h-full flex flex-col bg-background">
        <div className="border-b border-border bg-card px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Zap className="w-6 h-6 text-accent" />
              <div>
                <h1 className="text-xl font-bold">GodMode Pipelines</h1>
                <p className="text-sm text-muted-foreground">5-phase gated execution framework</p>
              </div>
            </div>
            <Button size="sm" onClick={() => setShowCreateForm(v => !v)}>
              <Plus className="w-4 h-4 mr-1" /> New Pipeline
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-6 space-y-6">
          {showCreateForm && (
            <div className="rounded-lg border border-border bg-card p-4 space-y-3">
              <h2 className="text-sm font-semibold text-white">New Pipeline</h2>
              <Input placeholder="Pipeline name" value={name} onChange={e => setName(e.target.value)} />
              <Textarea
                placeholder="Describe the goal (min 10 chars)"
                value={goal}
                onChange={e => setGoal(e.target.value)}
                rows={3}
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => createPipeline?.mutate?.({ name, goal })}
                  disabled={createPipeline?.isPending || name.length < 1 || goal.length < 10}
                >
                  {createPipeline?.isPending ? "Creating..." : "Create"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowCreateForm(false)}>Cancel</Button>
              </div>
              {createPipeline?.isError && (
                <p className="text-red-400 text-xs">{createPipeline.error?.message}</p>
              )}
            </div>
          )}

          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Pipelines</h2>
            {listPipelines?.isLoading && <p className="text-gray-400 text-sm">Loading...</p>}
            {!listPipelines?.isLoading && (!listPipelines?.data || listPipelines.data.length === 0) && (
              <p className="text-gray-500 text-sm">No pipelines yet. Create one above.</p>
            )}
            {listPipelines?.data?.map((p: any) => (
              <div key={p.id} className="rounded-lg border border-border bg-card p-4 flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-white font-medium text-sm">{p.name}</span>
                    <Badge className={`text-xs ${phaseColor[p.currentPhase] ?? "bg-gray-700"}`}>
                      {p.currentPhase}
                    </Badge>
                    <Badge className={`text-xs ${p.status === "complete" ? "bg-emerald-700" : p.status === "aborted" ? "bg-red-700" : "bg-blue-700"}`}>
                      {p.status}
                    </Badge>
                  </div>
                  <p className="text-gray-400 text-xs truncate">{p.goal}</p>
                </div>
                <Button size="sm" variant="outline" className="ml-4 shrink-0" onClick={() => setSelectedPipelineId(p.id)}>
                  View
                </Button>
              </div>
            ))}
          </div>

          <div className="border-t border-border pt-6">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4">Specialized Modules</h2>
            <SpecializedModuleLauncher />
          </div>
        </div>
      </div>
    </OmnecorDashboardLayout>
  );
}
