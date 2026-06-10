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

const jobTypeConfig: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; color: string }> = {
  lora_training: { label: "LoRA Training", icon: Activity, color: "text-amber-500" },
  blender: { label: "3D Render", icon: Activity, color: "text-blue-500" },
  esp_flash: { label: "Hardware Flash", icon: Activity, color: "text-emerald-500" },
  custom: { label: "Custom Task", icon: Terminal, color: "text-slate-400" },
};

const stateColors: Record<string, string> = {
  queued: "bg-slate-700 text-slate-300",
  running: "bg-blue-600 text-white animate-pulse",
  completed: "bg-green-600 text-white",
  failed: "bg-red-600 text-white",
  cancelled: "bg-slate-500 text-white",
};

export default function JobsPanel() {
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
    <Card className="bg-slate-950 border-slate-800">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div>
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <Activity className="w-4 h-4 text-accent" /> Background Jobs
          </CardTitle>
          <CardDescription className="text-[10px]">Real-time status of asynchronous tasks</CardDescription>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => pruneMutation.mutate({})}>
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {isLoading ? (
            <div className="flex justify-center p-8"><Loader2 className="w-6 h-6 animate-spin text-accent" /></div>
          ) : jobs.length === 0 ? (
            <div className="p-8 text-center border border-dashed rounded-xl bg-slate-900/50">
              <Clock className="w-8 h-8 mx-auto mb-2 opacity-20" />
              <p className="text-xs text-muted-foreground">No recent job activity.</p>
            </div>
          ) : (
            jobs.map((job) => {
              const config = jobTypeConfig[job.type] || jobTypeConfig.custom;
              const Icon = config.icon;
              return (
                <div key={job.jobId} className="p-3 rounded-lg border bg-slate-900 border-slate-800 flex items-center justify-between group">
                  <div className="flex items-center gap-3">
                    <div className={cn("p-1.5 rounded-md bg-slate-950", config.color)}>
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
                      <Button 
                        size="icon" 
                        variant="ghost" 
                        className="h-7 w-7 text-rose-500 hover:bg-rose-500/10"
                        onClick={() => cancelMutation.mutate({ jobId: job.jobId })}
                      >
                        <StopCircle className="w-4 h-4" />
                      </Button>
                    )}
                    {job.state === "completed" && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                    {job.state === "failed" && <XCircle className="w-4 h-4 text-rose-500" />}
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
