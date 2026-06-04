import React, { useState } from "react";
import { useNeuralMap } from "@/contexts/NeuralMapContext";
import { NeuralMapMode } from "@/types/neural";
import { Plus, Trash2, Copy, Settings, Brain, Globe, Shield, Code, Book, Plug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { INTEGRATION_FEATURES, type IntegrationType } from "@/lib/integrations";

const NEURAL_MAP_INTEGRATION_ICONS: Partial<Record<IntegrationType, string>> = {
  outlook: "📧",
  gmail:   "✉️",
  github:  "🐙",
};

const MODE_ICONS: Record<NeuralMapMode, React.ReactNode> = {
  standard: <Globe className="w-4 h-4" />,
  fiction: <Shield className="w-4 h-4" />,
  research: <Book className="w-4 h-4" />,
  coding: <Code className="w-4 h-4" />,
  roleplay: <Brain className="w-4 h-4" />,
};

export default function MapManager() {
  const { maps, activeMapId, createMap, deleteMap, setActiveMap, duplicateMap } = useNeuralMap();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newMode, setNewMode] = useState<NeuralMapMode>("standard");
  const [newRoots, setNewRoots] = useState("");
  const [selectedIntegrations, setSelectedIntegrations] = useState<string[]>([]);

  const { data: integrations } = trpc.integrations.getIntegrations.useQuery(undefined, {
    staleTime: 60_000,
  });

  const neuralMapIntegrations = integrations?.filter(i =>
    i.isConnected && INTEGRATION_FEATURES[i.type as IntegrationType]?.includes("neural-map")
  ) ?? [];

  const toggleIntegration = (type: string) => {
    setSelectedIntegrations(prev =>
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    );
  };

  const handleCreate = () => {
    if (!newName.trim()) return;
    const roots = newRoots.split(",").map(r => r.trim()).filter(Boolean);
    // Encode selected integrations as special root entries so the indexer can resolve them
    const integrationRoots = selectedIntegrations.map(t => `integration://${t}`);
    createMap(newName, newMode, [...roots, ...integrationRoots]);
    setNewName("");
    setNewRoots("");
    setSelectedIntegrations([]);
    setIsCreateOpen(false);
  };

  return (
    <div className="flex flex-col h-full gap-4">
      <div className="flex items-center justify-between px-2">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Brain className="w-5 h-5 text-accent" />
          Neural Maps
        </h2>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline" className="gap-2">
              <Plus className="w-4 h-4" /> New Map
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Neural Brain Map</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Map Name</label>
                <Input
                  placeholder="e.g., Project Phoenix"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Mode</label>
                <Select value={newMode} onValueChange={(v: NeuralMapMode) => setNewMode(v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="standard">Standard</SelectItem>
                    <SelectItem value="fiction">Fiction (Isolated)</SelectItem>
                    <SelectItem value="research">Research</SelectItem>
                    <SelectItem value="coding">Coding</SelectItem>
                    <SelectItem value="roleplay">Roleplay</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Root Directories (comma separated)</label>
                <Input
                  placeholder="/home/user/project, /var/www/html"
                  value={newRoots}
                  onChange={e => setNewRoots(e.target.value)}
                />
              </div>

              {neuralMapIntegrations.length > 0 && (
                <div className="space-y-2">
                  <label className="text-sm font-medium flex items-center gap-2">
                    <Plug className="w-4 h-4 text-accent" />
                    Integration Data Sources
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Include emails or repository data from connected accounts.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {neuralMapIntegrations.map(i => {
                      const icon = NEURAL_MAP_INTEGRATION_ICONS[i.type as IntegrationType] ?? "🔌";
                      const meta = i.metadata as Record<string, unknown> | null;
                      const label = String(meta?.username ?? i.type);
                      const active = selectedIntegrations.includes(i.type);
                      return (
                        <button
                          key={i.type}
                          onClick={() => toggleIntegration(i.type)}
                          aria-pressed={active}
                          className={cn(
                            "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            active
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border bg-background hover:border-muted-foreground text-muted-foreground"
                          )}
                        >
                          <span>{icon}</span>
                          <span>{label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button onClick={handleCreate} disabled={!newName.trim()}>
                Create Map
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <ScrollArea className="flex-1 px-2">
        <div className="space-y-3">
          {maps.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p>No neural maps created yet.</p>
              <p className="text-xs">Create one to start indexing your workspace.</p>
            </div>
          ) : (
            maps.map(map => (
              <Card
                key={map.id}
                className={cn(
                  "cursor-pointer transition-all border-l-4",
                  activeMapId === map.id
                    ? "border-l-accent bg-muted/50"
                    : "border-l-transparent hover:bg-muted/30"
                )}
                onClick={() => setActiveMap(map.id)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{map.name}</span>
                        <Badge variant="secondary" className="text-[10px] gap-1 px-1.5">
                          {MODE_ICONS[map.mode]}
                          {map.mode}
                        </Badge>
                      </div>
                      {(() => {
                        const integrationSources = map.rootDirectories.filter(r => r.startsWith("integration://"));
                        const fileSources = map.rootDirectories.filter(r => !r.startsWith("integration://"));
                        return (
                          <>
                            {fileSources.length > 0 && (
                              <p className="text-xs text-muted-foreground truncate max-w-[200px]">
                                {fileSources.join(", ")}
                              </p>
                            )}
                            {integrationSources.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-0.5">
                                {integrationSources.map(s => {
                                  const type = s.replace("integration://", "") as IntegrationType;
                                  const icon = NEURAL_MAP_INTEGRATION_ICONS[type] ?? "🔌";
                                  return (
                                    <span key={s} className="text-[10px] bg-accent/20 text-accent-foreground rounded px-1.5 py-0.5">
                                      {icon} {type}
                                    </span>
                                  );
                                })}
                              </div>
                            )}
                            {map.rootDirectories.length === 0 && (
                              <p className="text-xs text-muted-foreground">No roots defined</p>
                            )}
                          </>
                        );
                      })()}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="w-8 h-8"
                        onClick={e => {
                          e.stopPropagation();
                          duplicateMap(map.id);
                        }}
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="w-8 h-8 text-destructive hover:text-destructive"
                        onClick={e => {
                          e.stopPropagation();
                          deleteMap(map.id);
                        }}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
