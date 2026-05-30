import React, { useState, useEffect } from "react";
import { trpc } from "../../lib/trpc";
import { WebSocketManager } from "../../lib/websocket";
import { Button } from "../ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "../ui/card";
import { ScrollArea } from "../ui/scroll-area";
import { Badge } from "../ui/badge";
import { Play, FileText, Image as ImageIcon, Box } from "lucide-react";
import { toast } from "sonner";

export const BlenderPanel: React.FC = () => {
  const [stdout, setStdout] = useState<string[]>([]);
  const [renderProgress, setRenderProgress] = useState<number>(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const statusQuery = trpc.blender.status.useQuery(undefined, {
    refetchInterval: 5000
  });

  const executeMutation = trpc.blender.executeScript.useMutation({
    onSuccess: () => toast.success("Script executed"),
    onError: (err) => toast.error("Execution failed: " + err.message)
  });

  const renderMutation = trpc.blender.render.useMutation({
    onSuccess: () => toast.success("Render job submitted")
  });

  useEffect(() => {
    const ws = WebSocketManager.getInstance();
    const unsubStdout = ws.on("blender.stdout", (data: any) => {
      setStdout(prev => [...prev.slice(-200), data.line]);
    });

    const unsubRender = ws.on("blender.renderProgress", (data: any) => {
      setRenderProgress(data.percent);
      if (data.preview) setPreviewUrl(data.preview);
    });

    return () => {
      unsubStdout();
      unsubRender();
    };
  }, []);

  const isRunning = statusQuery.data?.isInstalled;

  return (
    <div className="flex flex-col gap-4 p-4 h-full">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-4">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Box className="w-6 h-6" /> Blender Bridge
          </h2>
          <Badge variant={isRunning ? "default" : "secondary"}>
            {isRunning ? "Ready" : "Not Detected"}
          </Badge>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => renderMutation.mutate({})}>
            <ImageIcon className="w-4 h-4 mr-2" /> Quick Render
          </Button>
          <Button size="sm" onClick={() => executeMutation.mutate({ scriptPath: "init.py" })}>
            <Play className="w-4 h-4 mr-2" /> Run Init Script
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 flex-1 overflow-hidden">
        <Card className="lg:col-span-2 flex flex-col h-[500px]">
          <CardHeader className="py-3 border-b">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <FileText className="w-4 h-4" /> Console Output
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 p-0 overflow-hidden bg-zinc-950">
            <ScrollArea className="h-full font-mono text-xs text-zinc-400 p-4">
              {stdout.map((line, i) => (
                <div key={i} className="mb-1">{line}</div>
              ))}
              {stdout.length === 0 && <div className="opacity-30 italic">Awaiting bridge output...</div>}
            </ScrollArea>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4 h-[500px]">
          <Card className="flex-1 overflow-hidden flex flex-col">
            <CardHeader className="py-3 border-b">
              <CardTitle className="text-sm font-medium">Render Preview</CardTitle>
            </CardHeader>
            <CardContent className="flex-1 p-0 flex items-center justify-center bg-zinc-900 relative">
              {previewUrl ? (
                <img src={previewUrl} alt="Preview" className="max-h-full object-contain" />
              ) : (
                <div className="text-zinc-500 text-xs italic">No preview available</div>
              )}
              {renderProgress > 0 && (
                <div className="absolute bottom-4 left-4 right-4 space-y-1">
                  <div className="text-[10px] uppercase font-bold text-white drop-shadow-md">Rendering {renderProgress}%</div>
                  <div className="h-1 bg-white/20 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 transition-all duration-300" style={{ width: `${renderProgress}%` }} />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};
