import { useState, useEffect, useRef } from "react";
import { Terminal, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { FloatingWindow } from "@/components/window-system/FloatingWindow";
import { useNeuralMap } from "@/contexts/NeuralMapContext";
import { HowToTooltip } from "@/components/shell/HowToTooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import type { SelectedModel } from "@/lib/chatContext";

interface CliTerminalWindowProps {
  isOpen: boolean;
  onClose: () => void;
  sessionId?: string;
  selectedModel?: SelectedModel;
}

export function CliTerminalWindow({ isOpen, onClose, sessionId, selectedModel }: CliTerminalWindowProps) {
  const [logs, setLogs] = useState<string[]>([
    "[OMNECOR CLI] Ready. Type a prompt and click Launch to open in your system terminal.",
  ]);
  const [command, setCommand] = useState("");
  const [showWslDialog, setShowWslDialog] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { activeMap } = useNeuralMap();
  const { data: projects } = trpc.project.list.useQuery();

  // Update log header when active map changes
  useEffect(() => {
    const root = activeMap?.rootDirectories[0];
    if (root) {
      setLogs(prev => {
        const hasMapMsg = prev.some(l => l.startsWith("[MAP]"));
        const mapMsg = `[MAP] Active project: ${activeMap.name} → ${root}`;
        return hasMapMsg
          ? prev.map(l => l.startsWith("[MAP]") ? mapMsg : l)
          : [...prev, mapMsg];
      });
    }
  }, [activeMap]);

  const openTerminalMutation = trpc.system.openTerminal.useMutation({
    onSuccess: (data) => {
      if (data?.wslPrompt) {
        setShowWslDialog(true);
      } else {
        setLogs(prev => [...prev, "[CLI] External terminal launched successfully."]);
        toast.success("Terminal CLI opened successfully!");
      }
    },
    onError: (err) => {
      setLogs(prev => [...prev, `[ERROR] ${err.message}`]);
      toast.error(err.message);
    },
  });

  const { data: pendingCliOutput } = trpc.system.getPendingCliOutput.useQuery(
    { sessionId: sessionId ?? "" },
    { refetchInterval: 3000, enabled: isOpen && !!sessionId }
  );

  useEffect(() => {
    if (pendingCliOutput?.output) {
      setLogs(prev => [...prev, `[CLI OUTPUT]\n${pendingCliOutput.output}`]);
    }
  }, [pendingCliOutput?.output]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const handleLaunch = () => {
    // Use active neural map's root directory first, then fall back to first project, then cwd
    const rootDir = activeMap?.rootDirectories[0] || projects?.[0]?.rootDir || ".";
    const prompt = command.trim();
    openTerminalMutation.mutate({
      rootDir,
      prompt: prompt || undefined,
      providerId: selectedModel?.providerId,
      modelId: selectedModel?.modelId,
      sessionId,
    });
    if (prompt) setCommand("");
  };

  return (
    <>
      <FloatingWindow
        title="Terminal / CLI"
        isOpen={isOpen}
        onClose={onClose}
        initialPosition={{ x: 80, y: 80 }}
        initialSize={{ width: 640, height: 380 }}
      >
        <div className="flex flex-col h-full bg-background">
          <ScrollArea className="min-h-0 flex-1 p-3 font-mono text-xs">
            <div className="space-y-1">
              {logs.map((log, i) => (
                <div
                  key={i}
                  className={cn(
                    "break-words leading-relaxed whitespace-pre-wrap",
                    log.startsWith("[ERROR]") ? "text-destructive" :
                    log.startsWith("[CLI OUTPUT]") ? "text-accent-success" :
                    log.startsWith("[CLI]") ? "text-accent-cyan" :
                    "text-muted-foreground"
                  )}
                >
                  {log}
                </div>
              ))}
              <div ref={scrollRef} />
            </div>
          </ScrollArea>

          <form
            onSubmit={e => { e.preventDefault(); handleLaunch(); }}
            className="p-2 bg-card border-t border-border flex items-center gap-2"
          >
            <span className="text-primary font-bold font-mono ml-2">$</span>
            <input
              value={command}
              onChange={e => setCommand(e.target.value)}
              placeholder="Optional prompt to send to CLI on launch…"
              className="flex-1 bg-transparent border-none outline-none text-xs font-mono text-foreground placeholder:text-muted-foreground"
            />
            <HowToTooltip title="Launch Command" description="Send the prompt and launch the external terminal." side="top">
              <Button
                size="sm"
                type="submit"
                className="h-7 gap-1.5 text-[10px] bg-primary hover:bg-primary text-white"
                disabled={openTerminalMutation.isPending}
              >
                {openTerminalMutation.isPending
                  ? <Loader2 className="w-3 h-3 animate-spin" />
                  : <Terminal className="w-3 h-3" />}
                Launch
              </Button>
            </HowToTooltip>
          </form>
        </div>
      </FloatingWindow>

      <Dialog open={showWslDialog} onOpenChange={setShowWslDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-primary font-bold">
              Install WSL Ubuntu Required
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground leading-relaxed">
              WSL (Windows Subsystem for Linux) Ubuntu is required for terminal with shell access on Windows.
            </p>
            <p className="text-xs bg-background p-3 rounded font-mono text-primary select-all border border-primary/50">
              wsl --install -d Ubuntu
            </p>
            <p className="text-[11px] text-muted-foreground">
              Copy the command above, open Windows Command Prompt or PowerShell as Administrator, and run it to install. After installation, restart Omnecor.
            </p>
          </div>
          <DialogFooter>
            <Button onClick={() => setShowWslDialog(false)}>Dismiss</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
