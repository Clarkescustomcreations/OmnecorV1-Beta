import React, { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Brain, 
  Archive, 
  Lightbulb, 
  Trash2, 
  Loader2,
  Database,
  History,
  FileText
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface MemoryArchiverPanelProps {
  sessionId: string;
  projectId: string;
  selectedModel: { providerId: string; modelId: string; apiKey?: string; baseUrl?: string } | null | undefined;
}

export default function MemoryArchiverPanel({ sessionId, projectId, selectedModel }: MemoryArchiverPanelProps) {
  const [isArchiving, setIsArchiving] = useState(false);
  const utils = trpc.useUtils();

  // Queries
  const { data: kbStatus } = trpc.knowledgeBase.status.useQuery();
  
  // Mutations
  const archiveMutation = trpc.ai.summarizeAndPruneSession.useMutation({
    onSuccess: (data) => {
      setIsArchiving(false);
      if (data.success) {
        toast.success("Session archived to Episodic Memory");
      }
    },
    onError: (e) => {
      setIsArchiving(false);
      toast.error(`Archival failed: ${e.message}`);
    }
  });

  const handleArchive = () => {
    if (!selectedModel) {
      toast.error("Please select an AI model first.");
      return;
    }
    setIsArchiving(true);
    archiveMutation.mutate({
      sessionId,
      projectId,
      providerId: selectedModel.providerId,
      modelId: selectedModel.modelId
    });
  };

  return (
    <div className="flex flex-col h-full bg-slate-950 border-l border-slate-800 w-80 animate-in slide-in-from-right duration-300">
      <div className="p-4 border-b border-slate-800 bg-slate-900/50 flex items-center justify-between">
        <div className="flex items-center gap-2 text-accent">
          <Brain className="w-4 h-4" />
          <span className="text-xs font-bold uppercase tracking-wider">Memory Archiver</span>
        </div>
        <Badge variant="outline" className="text-[10px] h-5 border-accent/20 text-accent">D2/D3</Badge>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="p-4 space-y-6">
          {/* Status Section */}
          <Card className="bg-slate-900/50 border-slate-800 border-none shadow-none">
            <CardHeader className="p-4">
              <CardTitle className="text-sm">Long-Term Storage</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-3">
              <div className="flex items-center justify-between p-2 rounded-lg bg-slate-950 border border-slate-800">
                <div className="flex items-center gap-2">
                  <Database className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-[10px] font-medium">VectorDB</span>
                </div>
                <Badge variant={kbStatus?.online ? "default" : "secondary"} className="text-[9px] h-4">
                  {kbStatus?.online ? "Online" : "Offline"}
                </Badge>
              </div>
              <p className="text-[10px] text-muted-foreground italic leading-relaxed">
                Episodic memory allows the agent to recall specific details from past conversations without filling up your current context window.
              </p>
            </CardContent>
          </Card>

          {/* Action Section */}
          <div className="space-y-4">
            <h4 className="text-[10px] font-bold text-muted-foreground uppercase px-1">Context Pruning</h4>
            <Button 
              className="w-full gap-2 h-10 bg-accent text-accent-foreground hover:bg-accent/90"
              onClick={handleArchive}
              disabled={isArchiving}
            >
              {isArchiving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Archive className="w-4 h-4" />}
              Summarize & Prune
            </Button>
            <p className="text-[10px] text-center text-muted-foreground">
              Compress this entire thread into dense insights and move them to Vector storage.
            </p>
          </div>

          {/* Results Preview (If mutation succeeded) */}
          {archiveMutation.data?.success && (
            <div className="space-y-4 pt-4 border-t border-slate-800">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-emerald-400">
                  <Lightbulb className="w-3.5 h-3.5" />
                  <span className="text-[10px] font-bold uppercase">Captured Insights</span>
                </div>
                <div className="space-y-1.5">
                  {(archiveMutation.data.keyInsights ?? []).map((insight: string, i: number) => (
                    <div key={i} className="p-2 rounded bg-emerald-500/5 border border-emerald-500/20 text-[11px] leading-tight text-slate-300">
                      • {insight}
                    </div>
                  ))}
                </div>
              </div>
              
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sky-400">
                  <FileText className="w-3.5 h-3.5" />
                  <span className="text-[10px] font-bold uppercase">Dense Summary</span>
                </div>
                <div className="p-3 rounded bg-slate-900 border border-slate-800 text-[10px] text-muted-foreground italic line-clamp-6">
                  {archiveMutation.data.summary}
                </div>
              </div>
            </div>
          )}

          {/* History / Stats */}
          <div className="pt-6 border-t border-slate-800">
             <div className="flex items-center justify-between mb-3 px-1">
                <span className="text-[10px] font-bold text-muted-foreground uppercase">Episodic History</span>
                <History className="w-3.5 h-3.5 text-muted-foreground opacity-50" />
             </div>
             <div className="p-8 text-center border-2 border-dashed rounded-xl bg-slate-900/20 border-slate-800">
                <p className="text-[10px] text-muted-foreground">No previous snapshots for this project.</p>
             </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
