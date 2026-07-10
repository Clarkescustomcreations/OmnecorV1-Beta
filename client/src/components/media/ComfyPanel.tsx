import React, { useState } from "react";
import { trpc } from "../../lib/trpc";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "../ui/card";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { Badge } from "../ui/badge";
import { Box, Play, RefreshCw, Layers } from "lucide-react";
import { toast } from "sonner";
import { HowToTooltip } from "@/components/shell/HowToTooltip";

export const ComfyPanel: React.FC = () => {
  const [prompt, setPrompt] = useState("");
  // prompt_id of the most recently queued job, so we can poll its outputs and
  // offer to pull any generated 3D mesh into the shared model library.
  const [lastPromptId, setLastPromptId] = useState<string | null>(null);

  const statusQuery = trpc.comfy.getSystemStats.useQuery(undefined, {
    refetchInterval: 5000
  });

  const queueMutation = trpc.comfy.queuePrompt.useMutation({
    onSuccess: (res: any) => {
      toast.success("Prompt queued in ComfyUI");
      setPrompt("");
      if (res?.prompt_id) setLastPromptId(res.prompt_id as string);
    },
    onError: (err) => toast.error("ComfyUI error: " + err.message)
  });

  // Poll the queued job's history until it completes; surface mesh outputs so
  // the "Save to 3D Library" action can appear the moment a mesh is ready.
  const historyQuery = trpc.comfy.getHistory.useQuery(
    { promptId: lastPromptId ?? "" },
    {
      enabled: !!lastPromptId,
      refetchInterval: (query) => (query.state.data?.done ? false : 2000),
    }
  );

  const saveMeshMutation = trpc.comfy.saveMeshToLibrary.useMutation({
    onSuccess: (res) => {
      toast.success(
        `Saved ${res.count} mesh${res.count === 1 ? "" : "es"} to the 3D library — open the 3D Viewer to load ${res.count === 1 ? "it" : "them"}.`
      );
    },
    onError: (err) => toast.error("Save to library failed: " + err.message),
  });

  const meshCount = historyQuery.data?.meshCount ?? 0;
  const jobDone = historyQuery.data?.done ?? false;

  const handleQueue = () => {
    // The ComfyUI /prompt API requires a workflow graph object, not free text.
    let workflow: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(prompt);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("not an object");
      }
      workflow = parsed as Record<string, unknown>;
    } catch {
      toast.error("Enter a valid ComfyUI workflow JSON object (export it from ComfyUI via Save (API Format)).");
      return;
    }
    queueMutation.mutate({ prompt: workflow });
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Layers className="w-6 h-6 text-accent-warning" /> ComfyUI Node Bridge
          </h2>
          <p className="text-sm text-muted-foreground">Orchestrate complex image and video workflows via local ComfyUI API.</p>
        </div>
        <Badge variant={statusQuery.data?.online ? "default" : "destructive"}>
          {statusQuery.data?.online ? "ComfyUI Online" : "ComfyUI Offline"}
        </Badge>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Visual Flow Orchestrator</CardTitle>
            <CardDescription>Enter a JSON workflow or a high-level prompt description.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea 
              placeholder="Paste ComfyUI workflow JSON or enter prompt..."
              className="min-h-[200px] font-mono text-xs"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
            <HowToTooltip title="Queue Generation" description="Send workflow to ComfyUI for processing" side="top">
              <Button 
                className="w-full" 
                onClick={handleQueue}
                disabled={!prompt || queueMutation.isPending || !statusQuery.data?.online}
              >
                {queueMutation.isPending ? "Queuing..." : <><Play className="w-4 h-4 mr-2" /> Execute Workflow</>}
              </Button>
            </HowToTooltip>
          </CardContent>
        </Card>

        <Card className="flex flex-col min-h-0 h-[400px]">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 border-b">
            <CardTitle className="text-sm font-medium">Active Queue</CardTitle>
            <HowToTooltip title="Refresh Status" description="Check the current ComfyUI queue status" side="top">
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => statusQuery.refetch()} title="Refresh queue"><RefreshCw className="w-3 h-3" /></Button>
            </HowToTooltip>
          </CardHeader>
          <CardContent className="flex-1 p-0 overflow-y-auto bg-muted/20">
            {lastPromptId ? (
              <div className="p-4 space-y-3">
                <div className="flex items-center gap-2 text-xs">
                  <Badge variant={jobDone ? "default" : "secondary"}>
                    {jobDone ? "Complete" : "Running…"}
                  </Badge>
                  <span className="font-mono text-muted-foreground truncate">{lastPromptId}</span>
                </div>
                {jobDone && (
                  meshCount > 0 ? (
                    <div className="space-y-2 rounded-md border border-primary/40 bg-primary/5 p-3">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <Box className="w-4 h-4 text-primary" />
                        {meshCount} 3D mesh{meshCount === 1 ? "" : "es"} generated
                      </div>
                      <HowToTooltip title="Save to 3D Library" description="Copy the generated mesh into the shared model library so the desktop and mobile 3D viewers can load it" side="top">
                        <Button
                          size="sm"
                          className="w-full"
                          disabled={saveMeshMutation.isPending}
                          onClick={() => lastPromptId && saveMeshMutation.mutate({ promptId: lastPromptId })}
                        >
                          {saveMeshMutation.isPending ? "Saving…" : <><Box className="w-4 h-4 mr-2" /> Save to 3D Library</>}
                        </Button>
                      </HowToTooltip>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground italic">
                      Job complete — no 3D mesh in the outputs. Use a workflow with a SaveGLB / mesh-export node to send models to the 3D viewers.
                    </p>
                  )
                )}
              </div>
            ) : (
              <div className="p-4 text-center text-muted-foreground italic text-xs py-12">
                 No active jobs in ComfyUI queue.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
