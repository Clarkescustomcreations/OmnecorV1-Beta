import React, { useState } from "react";
import { trpc } from "../../lib/trpc";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "../ui/card";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { Badge } from "../ui/badge";
import { Box, Play, RefreshCw, Layers } from "lucide-react";
import { toast } from "sonner";

export const ComfyPanel: React.FC = () => {
  const [prompt, setPrompt] = useState("");
  
  const statusQuery = trpc.comfy.getSystemStats.useQuery(undefined, {
    refetchInterval: 5000
  });

  const queueMutation = trpc.comfy.queuePrompt.useMutation({
    onSuccess: () => {
      toast.success("Prompt queued in ComfyUI");
      setPrompt("");
    },
    onError: (err) => toast.error("ComfyUI error: " + err.message)
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Layers className="w-6 h-6 text-orange-500" /> ComfyUI Node Bridge
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
            <Button 
              className="w-full" 
              onClick={() => queueMutation.mutate({ prompt })}
              disabled={!prompt || queueMutation.isPending || !statusQuery.data?.online}
            >
              {queueMutation.isPending ? "Queuing..." : <><Play className="w-4 h-4 mr-2" /> Execute Workflow</>}
            </Button>
          </CardContent>
        </Card>

        <Card className="flex flex-col h-[400px]">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 border-b">
            <CardTitle className="text-sm font-medium">Active Queue</CardTitle>
            <Button variant="ghost" size="icon" className="h-8 w-8"><RefreshCw className="w-3 h-3" /></Button>
          </CardHeader>
          <CardContent className="flex-1 p-0 overflow-y-auto bg-muted/20">
            <div className="p-4 text-center text-muted-foreground italic text-xs py-12">
               No active jobs in ComfyUI queue.
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
