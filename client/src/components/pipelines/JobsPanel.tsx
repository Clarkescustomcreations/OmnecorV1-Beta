import React from "react";
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
  Activity, 
  Clock, 
  CheckCircle2, 
  XCircle, 
  Loader2, 
  Trash2,
  Terminal,
  StopCircle
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { HowToTooltip } from "@/components/shell/HowToTooltip";

const jobTypeConfig: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; color: string }> = {
  lora_training: { label: "LoRA Training", icon: Activity, color: "text-accent-warning" },
  blender: { label: "3D Render", icon: Activity, color: "text-primary" },
  esp_flash: { label: "Hardware Flash", icon: Activity, color: "text-accent-success" },
  custom: { label: "Custom Task", icon: Terminal, color: "text-muted-foreground" },
};

const stateColors: Record<string, string> = {
  queued: "bg-muted text-foreground",
  running: "bg-primary text-white animate-pulse",
  completed: "bg-accent-success text-white",
  failed: "bg-destructive text-white",
  cancelled: "bg-muted text-muted-foreground",
};

export function JobsPanel() {
  const utils = trpc.useUtils();
  const { data: jobData, isLoading } = trpc.jobs.list.useQuery(undefined, {
    refetchInterval: 3000,
  });

  const cancelMutation = trpc.jobs.cancel.useMutation({
    onSuccess: () => {
      toast.success("Job cancellation requested");
      utils.jobs.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const pruneMutation = trpc.jobs.prune.useMutation({
    onSuccess: () => {
      toast.success("Job history pruned");
      utils.jobs.list.invalidate();
    },
    onError: (err) => toast.error("Prune failed: " + err.message),
  });

  const jobs = jobData?.jobs || [];

  return (
    <Card className="bg-background border-border">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div>
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" /> Background Jobs
          </CardTitle>
          <CardDescription className="text-[10px]">Real-time status of asynchronous tasks</CardDescription>
        </div>
        <HowToTooltip title="Clear History" description="Remove completed and failed jobs" side="top">
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => pruneMutation.mutate({})}>
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </HowToTooltip>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {isLoading ? (
            <div className="flex justify-center p-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
          ) : jobs.length === 0 ? (
            <div className="p-8 text-center border border-dashed rounded-xl bg-card/50">
              <Clock className="w-8 h-8 mx-auto mb-2 opacity-20" />
              <p className="text-xs text-muted-foreground">No recent job activity.</p>
            </div>
          ) : (
            jobs.map((job) => {
              const config = jobTypeConfig[job.type] || jobTypeConfig.custom;
              const Icon = config.icon;
              return (
                <div key={job.jobId} className="p-3 rounded-lg border bg-card border-border flex items-center justify-between group">
                  <div className="flex items-center gap-3">
                    <div className={cn("p-1.5 rounded-md bg-background", config.color)}>
                      <Icon className="w-3.5 h-3.5" />
                    </div>
                    <div>
                      <p className="text-xs font-bold">{job.label || config.label}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge className={cn("text-[8px] h-4 uppercase tracking-tighter px-1.5", stateColors[job.state])}>
                          {job.state}
                        </Badge>
                        <span className="text-[9px] text-muted-foreground font-mono truncate max-w-[120px]">{job.jobId.split('-')[0]}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {job.state === "running" && (
                      <HowToTooltip title="Cancel Job" description="Stop this running background task" side="left">
                        <Button 
                          size="icon" 
                          variant="ghost" 
                          className="h-7 w-7 text-destructive hover:bg-destructive/10"
                          onClick={() => cancelMutation.mutate({ jobId: job.jobId })}
                        >
                          <StopCircle className="w-4 h-4" />
                        </Button>
                      </HowToTooltip>
                    )}
                    {job.state === "completed" && <CheckCircle2 className="w-4 h-4 text-accent-success" />}
                    {job.state === "failed" && <XCircle className="w-4 h-4 text-destructive" />}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </CardContent>
    </Card>
  );
}
