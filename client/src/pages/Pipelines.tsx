import { useState, useEffect } from "react";
import { OmnecorDashboardLayout } from "@/components/OmnecorDashboardLayout";
import { SpecializedModuleLauncher } from "@/components/SpecializedModuleLauncher";
import { PhaseOutputPanel } from "@/components/pipelines/PhaseOutputPanel";
import { JobsPanel } from "@/components/pipelines/JobsPanel";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Zap, ArrowLeft, Plus } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { useNeuralMap } from "@/contexts/NeuralMapContext";
import { Checkbox } from "@/components/ui/checkbox";

const phaseColor: Record<string, string> = {
  DEFINE: "bg-muted text-muted-foreground",
  PLAN: "bg-primary/80 text-primary-foreground",
  EXECUTE: "bg-accent-cyan/70 text-foreground",
  REVIEW: "bg-accent-purple/70 text-foreground",
  SHIP: "bg-accent-success/70 text-foreground",
  DONE: "bg-accent-success text-foreground",
};

export function Pipelines() {
  const utils = trpc.useUtils();
  const { activeMap } = useNeuralMap();

  const [selectedPipelineId, setSelectedPipelineId] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [scopeToProject, setScopeToProject] = useState(!!activeMap);
  const [activeTab, setActiveTab] = useState<"all" | "project" | "global">("all");

  useEffect(() => {
    setScopeToProject(!!activeMap);
  }, [activeMap]);

  useEffect(() => {
    if (!activeMap && activeTab === "project") {
      setActiveTab("all");
    }
  }, [activeMap, activeTab]);

  const listPipelines = trpc.pipeline.listPipelines.useQuery(undefined, {
    refetchInterval: 3000,
  });

  const createPipeline = trpc.pipeline.createPipeline.useMutation({
    onSuccess: () => {
      setShowCreateForm(false);
      setName("");
      setGoal("");
      utils.pipeline.listPipelines.invalidate();
    },
    onError: (err) => toast.error(`Failed to create pipeline: ${err.message}`),
  });

  const filteredPipelines = listPipelines.data?.filter((p) => {
    if (activeTab === "project") {
      return p.projectId === activeMap?.id;
    }
    if (activeTab === "global") {
      return !p.projectId;
    }
    return true;
  }) ?? [];

  if (selectedPipelineId) {
    return (
      <OmnecorDashboardLayout>
        <div className="h-full flex flex-col">
          <div className="border-b border-border bg-card px-4 sm:px-6 py-3 sm:py-4 flex items-center gap-3 min-w-0">
            <Button
              id="btn-back-to-pipelines"
              variant="ghost"
              size="sm"
              onClick={() => setSelectedPipelineId(null)}
              className="flex-shrink-0"
            >
              <ArrowLeft className="w-4 h-4 mr-1" /> Back
            </Button>
            <Zap className="w-5 h-5 text-primary flex-shrink-0" />
            <span className="font-semibold truncate">Pipeline Detail</span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-6">
            <PhaseOutputPanel pipelineId={selectedPipelineId} />
          </div>
        </div>
      </OmnecorDashboardLayout>
    );
  }

  return (
    <OmnecorDashboardLayout>
      <div className="h-full flex flex-col">
        <div className="border-b border-border bg-card px-4 sm:px-6 py-3 sm:py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <Zap className="w-6 h-6 text-primary flex-shrink-0" />
              <div className="min-w-0">
                <h1 className="text-xl font-bold truncate">GodMode Pipelines</h1>
                <p className="text-sm text-muted-foreground truncate">5-phase gated execution framework</p>
              </div>
            </div>
            <Button
              id="btn-new-pipeline"
              size="sm"
              onClick={() => setShowCreateForm(v => !v)}
              className="flex-shrink-0"
            >
              <Plus className="w-4 h-4 mr-1" /> New Pipeline
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            <div className="lg:col-span-2 space-y-6">
              {showCreateForm && (
                <div className="rounded-lg border border-border bg-card p-4 space-y-3">
                  <h2 className="text-sm font-semibold text-foreground">New Pipeline</h2>
                  <Input
                    id="input-pipeline-name"
                    placeholder="Pipeline name"
                    value={name}
                    onChange={e => setName(e.target.value)}
                  />
                  <Textarea
                    id="input-pipeline-goal"
                    placeholder="Describe the goal (min 10 chars)"
                    value={goal}
                    onChange={e => setGoal(e.target.value)}
                    rows={3}
                  />
                  {activeMap && (
                    <div className="flex items-center gap-2 py-1 select-none">
                      <Checkbox
                        id="toggle-scope-project"
                        checked={scopeToProject}
                        onCheckedChange={(checked) => setScopeToProject(!!checked)}
                      />
                      <label
                        htmlFor="toggle-scope-project"
                        className="text-xs text-muted-foreground cursor-pointer"
                      >
                        Scope to current project: <span className="font-semibold text-foreground">{activeMap.name}</span>
                      </label>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Button
                      id="btn-create-pipeline"
                      size="sm"
                      onClick={() =>
                        createPipeline.mutate({
                          name,
                          goal,
                          projectId: scopeToProject && activeMap ? activeMap.id : undefined,
                        })
                      }
                      disabled={createPipeline.isPending || name.length < 1 || goal.length < 10}
                    >
                      {createPipeline.isPending ? "Creating..." : "Create"}
                    </Button>
                    <Button
                      id="btn-cancel-create-pipeline"
                      size="sm"
                      variant="ghost"
                      onClick={() => setShowCreateForm(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                  {createPipeline.isError && (
                    <p className="text-destructive text-xs">{createPipeline.error?.message}</p>
                  )}
                </div>
              )}

              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-border">
                  <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Pipelines</h2>
                  <div className="flex items-center gap-1 bg-muted/60 p-0.5 rounded-md border border-border/40">
                    <Button
                      id="tab-filter-all"
                      variant={activeTab === "all" ? "secondary" : "ghost"}
                      size="sm"
                      onClick={() => setActiveTab("all")}
                      className={`h-7 px-3 text-xs font-medium rounded-sm transition-all ${
                        activeTab === "all"
                          ? "bg-card text-foreground shadow-xs border border-border/20"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      All
                    </Button>
                    {activeMap && (
                      <Button
                        id="tab-filter-project"
                        variant={activeTab === "project" ? "secondary" : "ghost"}
                        size="sm"
                        onClick={() => setActiveTab("project")}
                        className={`h-7 px-3 text-xs font-medium rounded-sm transition-all ${
                          activeTab === "project"
                            ? "bg-card text-foreground shadow-xs border border-border/20"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        Project ({activeMap.name})
                      </Button>
                    )}
                    <Button
                      id="tab-filter-global"
                      variant={activeTab === "global" ? "secondary" : "ghost"}
                      size="sm"
                      onClick={() => setActiveTab("global")}
                      className={`h-7 px-3 text-xs font-medium rounded-sm transition-all ${
                        activeTab === "global"
                          ? "bg-card text-foreground shadow-xs border border-border/20"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      Global
                    </Button>
                  </div>
                </div>

                {listPipelines.isLoading && <p className="text-muted-foreground text-sm">Loading...</p>}
                {!listPipelines.isLoading && filteredPipelines.length === 0 && (
                  <p className="text-muted-foreground text-sm">
                    {activeTab === "project"
                      ? `No pipelines scoped to the current project (${activeMap?.name}) yet.`
                      : activeTab === "global"
                      ? "No global workspace pipelines yet."
                      : "No pipelines yet. Create one above."}
                  </p>
                )}
                {filteredPipelines.map((p) => (
                  <div
                    key={p.id}
                    className="rounded-lg border border-border bg-card p-4 flex items-center justify-between transition-all hover:border-primary/30 group"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-foreground font-medium text-sm">{p.name}</span>
                        <Badge
                          className={`text-[10px] h-5 ${
                            phaseColor[p.currentPhase] ?? "bg-muted text-muted-foreground"
                          }`}
                        >
                          {p.currentPhase}
                        </Badge>
                        <Badge
                          variant="outline"
                          className={`text-[10px] h-5 ${
                            p.status === "complete"
                              ? "border-accent-success text-accent-success"
                              : p.status === "aborted"
                              ? "border-destructive text-destructive"
                              : "border-accent-cyan text-accent-cyan"
                          }`}
                        >
                          {p.status}
                        </Badge>
                      </div>
                      <p className="text-muted-foreground text-xs truncate">{p.goal}</p>
                    </div>
                    <Button
                      id={`btn-view-pipeline-${p.id}`}
                      size="sm"
                      variant="outline"
                      className="ml-4 shrink-0 group-hover:bg-primary/10 group-hover:text-accent-foreground"
                      onClick={() => setSelectedPipelineId(p.id)}
                    >
                      View Detail
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-6">
              <JobsPanel />
              <Card className="bg-primary/5 border-primary/20">
                <CardHeader className="p-4">
                  <CardTitle className="text-xs font-bold uppercase tracking-tighter text-primary">
                    Optimization Logic
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    Pipelines utilize the Valet Router to parallelize tasks across the OMMESH network. Check the Jobs
                    panel to monitor remote executions.
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>

          <div className="border-t border-border pt-6">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4">
              Specialized Modules
            </h2>
            <SpecializedModuleLauncher />
          </div>
        </div>
      </div>
    </OmnecorDashboardLayout>
  );
}

