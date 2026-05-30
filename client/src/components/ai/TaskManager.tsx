import React, { useState, useEffect } from "react";
import { trpc } from "../../lib/trpc";
import { WebSocketManager } from "../../lib/websocket";
import { Button } from "../ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "../ui/card";
import { ScrollArea } from "../ui/scroll-area";
import { Badge } from "../ui/badge";
import { Activity, XCircle, Terminal, Clock } from "lucide-react";
import { toast } from "sonner";

export const TaskManager: React.FC = () => {
  const jobsQuery = trpc.jobs.list.useQuery(undefined, {
    refetchInterval: 5000
  });

  const killMutation = trpc.jobs.cancel.useMutation({
    onSuccess: () => {
      toast.success("Task cancelled");
      jobsQuery.refetch();
    }
  });

  return (
    <div className="p-6 h-full flex flex-col gap-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="w-6 h-6 text-green-500" /> Neural Task Manager
          </h2>
          <p className="text-sm text-muted-foreground">Monitor and manage asynchronous autonomous processes.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 overflow-y-auto pr-2">
        {jobsQuery.data?.jobs.map((job: any) => (
          <Card key={job.id} className="border-none bg-muted/30 shadow-sm group">
            <CardContent className="p-4 flex items-center gap-4">
              <div className="w-10 h-10 rounded-lg bg-background border flex items-center justify-center shadow-inner">
                 <Terminal className="w-5 h-5 text-muted-foreground" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm">{job.label || "Unnamed Process"}</span>
                  <Badge variant="outline" className="text-[10px] uppercase font-mono">{job.id.slice(0,8)}</Badge>
                </div>
                <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground font-medium uppercase tracking-wider">
                   <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {new Date(job.createdAt).toLocaleTimeString()}</span>
                   <span className="flex items-center gap-1"><Activity className="w-3 h-3" /> {job.status}</span>
                </div>
              </div>
              <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="text-destructive hover:bg-destructive/10"
                  onClick={() => killMutation.mutate({ jobId: job.id })}
                >
                  <XCircle className="w-4 h-4 mr-2" /> Kill Process
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
        {jobsQuery.data?.jobs.length === 0 && (
          <div className="py-24 text-center border border-dashed rounded-xl flex flex-col items-center justify-center">
             <Activity className="w-12 h-12 text-muted-foreground opacity-10 mb-4" />
             <p className="text-muted-foreground italic text-sm">No active processes detected.</p>
          </div>
        )}
      </div>
    </div>
  );
};
