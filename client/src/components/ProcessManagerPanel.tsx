import React, { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { Badge } from "./ui/badge";
import { Progress } from "./ui/progress";
import { ScrollArea } from "./ui/scroll-area";
import { Terminal, CheckCircle2, XCircle, Clock, Loader2 } from "lucide-react";
import { useOmnecorSocket } from "@/hooks/useOmnecorSocket";

interface JobDisplayData {
  jobId: string;
  type: string;
  status: "idle" | "started" | "running" | "progress" | "completed" | "failed";
  percent: number;
  message: string;
  timestamp: string;
  error?: string;
}

export function ProcessManagerPanel() {
  // We subscribe to 'voice:all' and ideally 'hardware:all' / 'training:all' if they were exposed as options
  // For now, we'll configure the hook to listen to all voice jobs as a start, and we can
  // assume the hook might be expanded to listen to all global events.
  const { connected, subscribe, unsubscribe } = useOmnecorSocket();
  const [activeJobs, setActiveJobs] = useState<Record<string, JobDisplayData>>(
    {}
  );

  useEffect(() => {
    if (!connected) return;

    // We manually subscribe to global broadcast channels to monitor all background jobs
    subscribe("hardware:all");
    subscribe("training:all");
    subscribe("voice:all");

    return () => {
      unsubscribe("hardware:all");
      unsubscribe("training:all");
      unsubscribe("voice:all");
    };
  }, [connected, subscribe, unsubscribe]);

  // We need a custom message listener because useOmnecorSocket currently only keeps track
  // of single jobProgress/jobLifecycle state, which isn't sufficient for a multi-job dashboard.
  useEffect(() => {
    if (!connected) return;

    // We tap directly into the WebSocket if possible, or we could extend the hook.
    // For this UI component, extending the hook or adding a direct listener is needed.
    // Since we don't have direct access to the socket from the hook, we will rely on
    // a simplified approach or we'd need to modify the hook to return all events.
    // Let's implement a direct WS listener for the dashboard to track MULTIPLE jobs effectively.
    const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:3000/ws";
    const socket = new WebSocket(WS_URL);

    socket.onopen = () => {
      socket.send(
        JSON.stringify({ type: "subscribe", channel: "hardware:all" })
      );
      socket.send(
        JSON.stringify({ type: "subscribe", channel: "training:all" })
      );
      socket.send(JSON.stringify({ type: "subscribe", channel: "voice:all" }));
    };

    socket.onmessage = event => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "trainingProgress" || msg.type === "lifecycle") {
          const data = msg.data;

          setActiveJobs(prev => {
            const existing = prev[data.jobId] || {
              jobId: data.jobId,
              type: data.type || "unknown",
              status: "idle",
              percent: 0,
              message: "Initializing...",
              timestamp: data.timestamp || new Date().toISOString(),
            };

            const updated = { ...existing };
            updated.timestamp = data.timestamp || updated.timestamp;

            if (msg.type === "trainingProgress") {
              updated.status = data.status || "running";
              if (data.percent !== undefined) updated.percent = data.percent;
              if (data.message) updated.message = data.message;
            } else if (msg.type === "lifecycle") {
              updated.status = data.status || data.state;
              if (data.error) {
                updated.error = data.error;
                updated.message = `Failed: ${data.error}`;
              } else if (updated.status === "completed") {
                updated.percent = 100;
                updated.message = "Completed successfully.";
              }
            }

            return { ...prev, [data.jobId]: updated };
          });
        }
      } catch (e) {
        console.error("Failed to parse process message", e);
      }
    };

    return () => {
      socket.close();
    };
  }, [connected]);

  const jobsList = Object.values(activeJobs).sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed":
        return <CheckCircle2 className="w-4 h-4 text-accent-success" />;
      case "failed":
        return <XCircle className="w-4 h-4 text-destructive" />;
      case "idle":
        return <Clock className="w-4 h-4 text-muted-foreground" />;
      default:
        return <Loader2 className="w-4 h-4 text-primary animate-spin" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed":
        return "bg-accent-success/10 text-accent-success border-accent-success/20";
      case "failed":
        return "bg-destructive/10 text-destructive border-destructive/20";
      case "idle":
        return "bg-muted text-muted-foreground";
      default:
        return "bg-primary/10 text-primary border-primary/20";
    }
  };

  return (
    <Card className="flex flex-col h-full bg-card/50 backdrop-blur-sm border-border/50">
      <CardHeader className="border-b border-border/50 pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Terminal className="w-5 h-5 text-primary" />
            <CardTitle className="text-lg">Process Manager</CardTitle>
          </div>
          <Badge variant={connected ? "default" : "destructive"}>
            {connected ? "Connected" : "Offline"}
          </Badge>
        </div>
        <CardDescription>
          Live monitoring of backend hardware, voice, and training jobs
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1 p-0 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="p-4 space-y-4">
            {jobsList.length === 0 ? (
              <div className="text-center text-sm text-muted-foreground py-8">
                No active processes running.
              </div>
            ) : (
              jobsList.map(job => (
                <div
                  key={job.jobId}
                  className="flex flex-col gap-2 p-3 rounded-lg border border-border bg-background/50"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex flex-col">
                      <span className="text-sm font-medium capitalize flex items-center gap-2">
                        {getStatusIcon(job.status)}
                        {job.type.replace("_", " ")}
                      </span>
                      <span className="text-xs text-muted-foreground font-mono mt-1">
                        {job.jobId.split("-")[0]}...
                      </span>
                    </div>
                    <Badge
                      variant="outline"
                      className={getStatusColor(job.status)}
                    >
                      {job.status}
                    </Badge>
                  </div>
                  <div className="mt-2">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-muted-foreground truncate max-w-[80%]">
                        {job.message}
                      </span>
                      <span className="font-mono">{job.percent}%</span>
                    </div>
                    <Progress value={job.percent} className="h-1.5" />
                  </div>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
