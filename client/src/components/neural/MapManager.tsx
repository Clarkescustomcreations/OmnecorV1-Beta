import React, { useState, useRef } from "react";
import { useNeuralMap } from "@/contexts/NeuralMapContext";
import { NeuralMapMode } from "@/types/neural";
import {
  Plus, Trash2, Copy, Brain, Globe, Shield, Code, Book,
  FolderOpen, Github, Mail, Cloud, X, ChevronDown, ChevronRight,
  CheckCircle2, AlertCircle, HardDrive, Package, Inbox,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import type { IntegrationType } from "@/lib/integrations";
import { toast } from "sonner";

const MODE_ICONS: Record<NeuralMapMode, React.ReactNode> = {
  standard: <Globe className="w-4 h-4" />,
  fiction:  <Shield className="w-4 h-4" />,
  research: <Book className="w-4 h-4" />,
  coding:   <Code className="w-4 h-4" />,
  roleplay: <Brain className="w-4 h-4" />,
};

// ─── Cloud/email source definitions ──────────────────────────────────────────

interface SourceDef {
  type: IntegrationType;
  label: string;
  icon: React.ReactNode;
  neuralMapSupported: boolean;
}

const CLOUD_SOURCES: SourceDef[] = [
  { type: "gmail",        label: "Gmail",        icon: <Inbox className="w-4 h-4" />,   neuralMapSupported: true  },
  { type: "outlook",      label: "Outlook",      icon: <Mail className="w-4 h-4" />,    neuralMapSupported: true  },
  { type: "google-drive", label: "Google Drive", icon: <Cloud className="w-4 h-4" />,   neuralMapSupported: false },
  { type: "dropbox",      label: "Dropbox",      icon: <Package className="w-4 h-4" />, neuralMapSupported: false },
  { type: "onedrive",     label: "OneDrive",     icon: <HardDrive className="w-4 h-4"/>,neuralMapSupported: false },
];

// ─── Section toggle helper ────────────────────────────────────────────────────

function SectionHeader({ label, open, onToggle, children }: { label: string; open: boolean; onToggle: () => void; children?: React.ReactNode }) {
  return (
    <button
      type="button"
      className="w-full flex items-center justify-between py-2 text-sm font-semibold hover:text-accent transition-colors"
      onClick={onToggle}
    >
      <span className="flex items-center gap-2">{label}{children}</span>
      {open ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
    </button>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function MapManager() {
  const { maps, activeMapId, createMap, deleteMap, setActiveMap, duplicateMap } = useNeuralMap();
  const [isOpen, setIsOpen] = useState(false);

  // — Form state —
  const [name, setName] = useState("");
  const [mode, setMode] = useState<NeuralMapMode>("standard");

  // Local folders
  const [localFolders, setLocalFolders] = useState<string[]>([]);
  const [folderInput, setFolderInput] = useState("");

  // GitHub repos
  const [githubRepos, setGithubRepos] = useState<string[]>([]);
  const [repoInput, setRepoInput] = useState("");

  // Cloud / email toggles
  const [selectedCloud, setSelectedCloud] = useState<Set<IntegrationType>>(new Set());

  // Section open state
  const [openSections, setOpenSections] = useState({ local: true, github: false, cloud: false });
  const toggleSection = (k: keyof typeof openSections) =>
    setOpenSections(s => ({ ...s, [k]: !s[k] }));

  // ─── Integrations query ──────────────────────────────────────────────────
  const { data: integrations } = trpc.integrations.getIntegrations.useQuery(undefined, { staleTime: 60_000 });
  const connectedTypes = new Set(integrations?.filter(i => i.isConnected).map(i => i.type) ?? []);
  const githubConnected = connectedTypes.has("github");

  // ─── Local folder picker ─────────────────────────────────────────────────
  const folderInputRef = useRef<HTMLInputElement>(null);

  const pickFolder = async () => {
    if (typeof window !== "undefined" && "showDirectoryPicker" in window) {
      try {
        const handle = await (window as any).showDirectoryPicker({ mode: "read" });
        addLocalFolder(handle.name); // name is the dir name; server needs full path
        toast.info(`Folder selected: ${handle.name}. If the full path differs, edit it below.`);
        setFolderInput(handle.name);
      } catch {
        // User cancelled or unsupported — fall through to text input
      }
    } else {
      folderInputRef.current?.focus();
    }
  };

  const addLocalFolder = (path: string) => {
    const trimmed = path.trim();
    if (!trimmed || localFolders.includes(trimmed)) return;
    setLocalFolders(f => [...f, trimmed]);
    setFolderInput("");
  };

  const removeLocalFolder = (path: string) =>
    setLocalFolders(f => f.filter(p => p !== path));

  // ─── GitHub repo helpers ─────────────────────────────────────────────────
  const normaliseRepo = (raw: string): string => {
    // Accept: owner/repo, https://github.com/owner/repo, github.com/owner/repo
    const match = raw.trim().match(/(?:https?:\/\/)?(?:www\.)?github\.com\/([^/]+\/[^/\s]+)/i)
      ?? raw.trim().match(/^([a-z0-9_.-]+\/[a-z0-9_.-]+)$/i);
    return match ? match[1].replace(/\.git$/, "") : raw.trim();
  };

  const addRepo = (raw: string) => {
    const repo = normaliseRepo(raw);
    if (!repo || githubRepos.includes(repo)) return;
    setGithubRepos(r => [...r, repo]);
    setRepoInput("");
  };

  const removeRepo = (repo: string) =>
    setGithubRepos(r => r.filter(x => x !== repo));

  // ─── Cloud toggle ────────────────────────────────────────────────────────
  const toggleCloud = (type: IntegrationType, supported: boolean) => {
    if (!supported) {
      toast.info(`${type} cloud indexing is coming soon for Neural Maps.`);
      return;
    }
    if (!connectedTypes.has(type)) {
      toast.info(`Connect ${type} in the Integrations page first.`);
      return;
    }
    setSelectedCloud(prev => {
      const next = new Set(prev);
      next.has(type) ? next.delete(type) : next.add(type);
      return next;
    });
  };

  // ─── Create map ──────────────────────────────────────────────────────────
  const handleCreate = () => {
    if (!name.trim()) return;
    const roots: string[] = [
      ...localFolders,
      ...githubRepos.map(r => `github://${r}`),
      ...Array.from(selectedCloud).map(t => `integration://${t}`),
    ];
    createMap(name.trim(), mode, roots);
    // Reset
    setName(""); setMode("standard");
    setLocalFolders([]); setFolderInput("");
    setGithubRepos([]); setRepoInput("");
    setSelectedCloud(new Set());
    setOpenSections({ local: true, github: false, cloud: false });
    setIsOpen(false);
  };

  const totalSources = localFolders.length + githubRepos.length + selectedCloud.size;

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Header */}
      <div className="flex items-center justify-between px-2">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Brain className="w-5 h-5 text-accent" />
          Neural Maps
        </h2>
        <Button size="sm" variant="outline" className="gap-2" onClick={() => setIsOpen(true)}>
          <Plus className="w-4 h-4" /> New Map
        </Button>
      </div>

      {/* Map list */}
      <ScrollArea className="flex-1 px-2">
        <div className="space-y-3">
          {maps.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p>No neural maps yet.</p>
              <p className="text-xs">Create one to start indexing your workspace.</p>
            </div>
          ) : (
            maps.map(map => {
              const integrationSources = map.rootDirectories.filter(r => r.startsWith("integration://") || r.startsWith("github://"));
              const fileSources = map.rootDirectories.filter(r => !r.startsWith("integration://") && !r.startsWith("github://"));
              return (
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
                      <div className="space-y-1 flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium">{map.name}</span>
                          <Badge variant="secondary" className="text-[10px] gap-1 px-1.5">
                            {MODE_ICONS[map.mode]}
                            {map.mode}
                          </Badge>
                        </div>
                        {fileSources.length > 0 && (
                          <p className="text-xs text-muted-foreground truncate max-w-[200px]">
                            <FolderOpen className="w-3 h-3 inline mr-1" />
                            {fileSources.join(", ")}
                          </p>
                        )}
                        {integrationSources.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-0.5">
                            {integrationSources.map(s => {
                              const isGithub = s.startsWith("github://");
                              const label = isGithub ? s.replace("github://", "") : s.replace("integration://", "");
                              const emoji = s.includes("github") ? "🐙" : s.includes("gmail") ? "✉️" : s.includes("outlook") ? "📧" : s.includes("google-drive") ? "☁️" : s.includes("dropbox") ? "📦" : "💼";
                              return (
                                <span key={s} className="text-[10px] bg-accent/20 text-accent-foreground rounded px-1.5 py-0.5">
                                  {emoji} {label}
                                </span>
                              );
                            })}
                          </div>
                        )}
                        {map.rootDirectories.length === 0 && (
                          <p className="text-xs text-muted-foreground italic">No sources defined</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 ml-2 shrink-0">
                        <Button size="icon" variant="ghost" className="w-8 h-8"
                          onClick={e => { e.stopPropagation(); duplicateMap(map.id); }}>
                          <Copy className="w-3.5 h-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="w-8 h-8 text-destructive hover:text-destructive"
                          onClick={e => { e.stopPropagation(); deleteMap(map.id); }}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      </ScrollArea>

      {/* ── Create Map Dialog ─────────────────────────────────────────────── */}
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Create Neural Brain Map</DialogTitle>
          </DialogHeader>

          <ScrollArea className="flex-1 -mx-1 px-1">
            <div className="space-y-5 py-2 pr-2">

              {/* Map name + mode */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5 col-span-2 sm:col-span-1">
                  <label className="text-sm font-medium">Map Name</label>
                  <Input
                    placeholder="e.g., Project Phoenix"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleCreate()}
                  />
                </div>
                <div className="space-y-1.5 col-span-2 sm:col-span-1">
                  <label className="text-sm font-medium">Mode</label>
                  <Select value={mode} onValueChange={(v: NeuralMapMode) => setMode(v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="standard">Standard</SelectItem>
                      <SelectItem value="fiction">Fiction (Isolated)</SelectItem>
                      <SelectItem value="research">Research</SelectItem>
                      <SelectItem value="coding">Coding</SelectItem>
                      <SelectItem value="roleplay">Roleplay</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="border-t pt-3 space-y-1">
                <p className="text-xs text-muted-foreground">
                  Add data sources — local folders, GitHub repos, or cloud accounts — that will be indexed into this map's knowledge graph.
                </p>
              </div>

              {/* ── Section A: Local Folders ─────────────────────────────── */}
              <div className="border rounded-lg px-3">
                <SectionHeader
                  label="Local Folders"
                  open={openSections.local}
                  onToggle={() => toggleSection("local")}
                >
                  {localFolders.length > 0 && (
                    <Badge variant="secondary" className="text-[10px] px-1.5">{localFolders.length}</Badge>
                  )}
                </SectionHeader>

                {openSections.local && (
                  <div className="pb-3 space-y-3">
                    <div className="flex gap-2">
                      <Input
                        ref={folderInputRef}
                        placeholder="/home/user/project"
                        value={folderInput}
                        onChange={e => setFolderInput(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && addLocalFolder(folderInput)}
                        className="text-sm"
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="shrink-0 gap-1.5"
                        onClick={pickFolder}
                        title="Browse for folder"
                      >
                        <FolderOpen className="w-4 h-4" />
                        Browse
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="shrink-0"
                        onClick={() => addLocalFolder(folderInput)}
                        disabled={!folderInput.trim()}
                      >
                        Add
                      </Button>
                    </div>

                    {localFolders.length > 0 && (
                      <ul className="space-y-1">
                        {localFolders.map(f => (
                          <li key={f} className="flex items-center justify-between gap-2 py-1 px-2 rounded bg-muted/50 text-xs font-mono group">
                            <FolderOpen className="w-3.5 h-3.5 text-accent shrink-0" />
                            <span className="flex-1 truncate">{f}</span>
                            <button
                              onClick={() => removeLocalFolder(f)}
                              className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>

              {/* ── Section B: GitHub Repos ──────────────────────────────── */}
              <div className="border rounded-lg px-3">
                <SectionHeader
                  label="GitHub Repositories"
                  open={openSections.github}
                  onToggle={() => toggleSection("github")}
                >
                  {githubRepos.length > 0 && (
                    <Badge variant="secondary" className="text-[10px] px-1.5">{githubRepos.length}</Badge>
                  )}
                  {!githubConnected && (
                    <Badge variant="outline" className="text-[10px] px-1.5 border-amber-500 text-amber-500">Not connected</Badge>
                  )}
                </SectionHeader>

                {openSections.github && (
                  <div className="pb-3 space-y-3">
                    {!githubConnected && (
                      <p className="text-xs text-amber-500 flex items-center gap-1.5">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        Connect GitHub in <a href="/integrations" className="underline">Integrations</a> to index private repos. Public repos can still be added.
                      </p>
                    )}

                    <div className="flex gap-2">
                      <Input
                        placeholder="owner/repo or github.com/owner/repo"
                        value={repoInput}
                        onChange={e => setRepoInput(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && addRepo(repoInput)}
                        className="text-sm"
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="shrink-0 gap-1.5"
                        onClick={() => addRepo(repoInput)}
                        disabled={!repoInput.trim()}
                      >
                        <Github className="w-3.5 h-3.5" />
                        Add
                      </Button>
                    </div>

                    {githubRepos.length > 0 && (
                      <ul className="space-y-1">
                        {githubRepos.map(r => (
                          <li key={r} className="flex items-center justify-between gap-2 py-1 px-2 rounded bg-muted/50 text-xs group">
                            <Github className="w-3.5 h-3.5 text-accent shrink-0" />
                            <span className="flex-1 truncate font-mono">{r}</span>
                            <button
                              onClick={() => removeRepo(r)}
                              className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>

              {/* ── Section C: Cloud & Email ─────────────────────────────── */}
              <div className="border rounded-lg px-3">
                <SectionHeader
                  label="Cloud & Email Sources"
                  open={openSections.cloud}
                  onToggle={() => toggleSection("cloud")}
                >
                  {selectedCloud.size > 0 && (
                    <Badge variant="secondary" className="text-[10px] px-1.5">{selectedCloud.size}</Badge>
                  )}
                </SectionHeader>

                {openSections.cloud && (
                  <div className="pb-3 space-y-2">
                    <p className="text-xs text-muted-foreground">
                      Index emails and cloud files into this map's knowledge graph.
                    </p>
                    <div className="grid grid-cols-1 gap-2">
                      {CLOUD_SOURCES.map(src => {
                        const connected = connectedTypes.has(src.type);
                        const selected = selectedCloud.has(src.type);
                        const available = src.neuralMapSupported && connected;
                        return (
                          <button
                            key={src.type}
                            type="button"
                            onClick={() => toggleCloud(src.type, src.neuralMapSupported)}
                            className={cn(
                              "flex items-center gap-3 w-full rounded-lg border px-3 py-2.5 text-sm transition-colors text-left",
                              selected
                                ? "border-accent bg-accent/10 text-accent"
                                : available
                                  ? "border-border hover:border-muted-foreground bg-background hover:bg-muted/30"
                                  : "border-border bg-muted/20 opacity-60 cursor-not-allowed"
                            )}
                          >
                            <span className={cn("shrink-0", selected ? "text-accent" : "text-muted-foreground")}>
                              {src.icon}
                            </span>
                            <span className="flex-1 font-medium">{src.label}</span>
                            {selected && <CheckCircle2 className="w-4 h-4 text-accent shrink-0" />}
                            {!connected && (
                              <span className="text-[10px] text-muted-foreground shrink-0">Not connected</span>
                            )}
                            {connected && !src.neuralMapSupported && (
                              <span className="text-[10px] text-muted-foreground shrink-0">Coming soon</span>
                            )}
                            {connected && src.neuralMapSupported && !selected && (
                              <span className="text-[10px] text-emerald-500 shrink-0 flex items-center gap-0.5">
                                <CheckCircle2 className="w-3 h-3" /> Connected
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Source summary */}
              {totalSources > 0 && (
                <div className="rounded-lg bg-accent/5 border border-accent/20 px-3 py-2 text-xs text-muted-foreground">
                  <span className="font-semibold text-accent">{totalSources}</span> source{totalSources !== 1 ? "s" : ""} will be indexed into this map.
                </div>
              )}

            </div>
          </ScrollArea>

          <DialogFooter className="gap-2 mt-2">
            <Button variant="ghost" onClick={() => setIsOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!name.trim()}>
              Create Map
              {totalSources > 0 && <Badge variant="secondary" className="ml-2 text-[10px]">{totalSources} sources</Badge>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
