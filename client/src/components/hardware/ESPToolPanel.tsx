import React, { useState, useEffect } from "react";
import { trpc } from "../../lib/trpc";
import { WebSocketManager } from "../../lib/websocket";
import { Button } from "../ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "../ui/card";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "../ui/select";
import { Progress } from "../ui/progress";
import { ScrollArea } from "../ui/scroll-area";
import { Badge } from "../ui/badge";
import { Terminal, Cpu, Zap, RefreshCw } from "lucide-react";
import { toast } from "sonner";

export const ESPToolPanel: React.FC = () => {
  const [selectedPort, setSelectedPort] = useState<string>("");
  const [flashProgress, setFlashProgress] = useState<number>(0);
  const [flashPhase, setFlashPhase] = useState<string>("");
  const [serialOutput, setSerialOutput] = useState<string[]>([]);
  
  const portsQuery = trpc.esp.detectPorts.useQuery(undefined, {
    refetchOnWindowFocus: true,
  });

  const flashMutation = trpc.esp.flash.useMutation({
    onSuccess: (data) => {
      toast.success("Flash job started: " + data.jobId);
    },
    onError: (err) => {
      toast.error("Flash failed: " + err.message);
    }
  });

  const detectChipMutation = trpc.esp.getChipInfo.useMutation();

  useEffect(() => {
    const ws = WebSocketManager.getInstance();
    const unsubProgress = ws.on("esptool.progress", (data: any) => {
      setFlashProgress(data.percent);
      setFlashPhase(data.phase);
    });

    const unsubSerial = ws.on("esptool.serial.rx", (data: any) => {
      setSerialOutput(prev => [...prev.slice(-100), data.line]);
    });

    return () => {
      unsubProgress();
      unsubSerial();
    };
  }, []);

  const handleFlash = () => {
    if (!selectedPort) return toast.error("Please select a port");
    flashMutation.mutate({ port: selectedPort, firmwarePath: "latest.bin" });
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cpu className="w-5 h-5" /> Hardware Discovery
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Select value={selectedPort} onValueChange={setSelectedPort}>
              <SelectTrigger>
                <SelectValue placeholder="Select Port" />
              </SelectTrigger>
              <SelectContent>
                {portsQuery.data?.map((port: any) => (
                  <SelectItem key={port.path} value={port.path}>
                    {port.path} ({port.description})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" onClick={() => portsQuery.refetch()}>
              <RefreshCw className={`w-4 h-4 ${portsQuery.isFetching ? 'animate-spin' : ''}`} />
            </Button>
          </div>

          <div className="flex gap-2">
            <Button 
              className="flex-1" 
              onClick={() => detectChipMutation.mutate({ port: selectedPort })}
              disabled={!selectedPort || detectChipMutation.isPending}
            >
              Detect Chip
            </Button>
            <Button 
              className="flex-1" 
              variant="destructive"
              onClick={handleFlash}
              disabled={!selectedPort || flashMutation.isPending}
            >
              <Zap className="w-4 h-4 mr-2" /> Flash Firmware
            </Button>
          </div>

          {flashMutation.isPending || flashProgress > 0 ? (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>{flashPhase || "Initializing..."}</span>
                <span>{flashProgress}%</span>
              </div>
              <Progress value={flashProgress} />
            </div>
          ) : null}

          {detectChipMutation.data && (
            <div className="p-3 bg-muted rounded-md text-xs font-mono">
              <p>Chip: {detectChipMutation.data.chipType}</p>
              <p>Chip ID: {detectChipMutation.data.chipId}</p>
              <p>MAC: {detectChipMutation.data.macAddress}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="flex flex-col h-[400px]">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="flex items-center gap-2">
            <Terminal className="w-5 h-5" /> Serial Monitor
          </CardTitle>
          <Badge variant="outline" className="font-mono">{selectedPort || "disconnected"}</Badge>
        </CardHeader>
        <CardContent className="flex-1 p-0 overflow-hidden">
          <ScrollArea className="h-full bg-black text-green-500 font-mono text-xs p-4">
            {serialOutput.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
            {serialOutput.length === 0 && <span className="opacity-50">Awaiting serial data...</span>}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
};
