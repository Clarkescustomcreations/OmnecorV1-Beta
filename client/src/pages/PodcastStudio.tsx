import React, { useState, useRef, useCallback, useEffect } from "react";
import OmnecorDashboardLayout from "@/components/OmnecorDashboardLayout";
import { useNeuralMap } from "@/contexts/NeuralMapContext";
import { useNeuralContextStore } from "@/lib/neuralContextStore";
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
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Mic2,
  Play,
  Download,
  Plus,
  Trash2,
  Loader2,
  RefreshCw,
  History,
  Music,
  User,
  Settings2,
  Share2,
  Zap,
  FileText,
  Globe,
  Cloud,
  Search,
  Upload,
  ChevronDown,
  ChevronUp,
  X,
  Link,
  HardDrive,
  Brain,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DialogueTurn {
  id: string;
  speakerId: string;
  text: string;
  emotion: string;
}

type SourceKind = "audio" | "file" | "text" | "website" | "cloud" | "discovery";

interface PodcastSource {
  id: string;
  kind: SourceKind;
  label: string;
  content: string;
  selected: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_TURNS: DialogueTurn[] = [
  { id: "1", speakerId: "Alex", text: "Welcome to the Omnecor Pulse. I'm your host, Alex.", emotion: "excited" },
  { id: "2", speakerId: "Sam", text: "And I'm Sam. Today we're exploring local voice cloning technologies.", emotion: "thoughtful" },
];

const KIND_ICON: Record<SourceKind, React.ReactNode> = {
  audio: <Music className="w-3 h-3" />,
  file: <FileText className="w-3 h-3" />,
  text: <FileText className="w-3 h-3" />,
  website: <Globe className="w-3 h-3" />,
  cloud: <Cloud className="w-3 h-3" />,
  discovery: <Search className="w-3 h-3" />,
};

const KIND_COLOR: Record<SourceKind, string> = {
  audio: "text-purple-400",
  file: "text-blue-400",
  text: "text-green-400",
  website: "text-amber-400",
  cloud: "text-cyan-400",
  discovery: "text-accent",
};

// ─── Sources Sidebar ──────────────────────────────────────────────────────────

interface SourcesSidebarProps {
  sources: PodcastSource[];
  onAdd: (src: Omit<PodcastSource, "id" | "selected">) => void;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
}

function SourcesSidebar({ sources, onAdd, onToggle, onDelete, onSelectAll, onDeselectAll }: SourcesSidebarProps) {
  const [addMode, setAddMode] = useState<SourceKind | null>(null);
  const [textDraft, setTextDraft] = useState("");
  const [textLabel, setTextLabel] = useState("");
  const [urlDraft, setUrlDraft] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const audioRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const fetchDiscovery = trpc.discovery.fetchArticles.useMutation({
    onSuccess: (data) => {
      toast.success(`Found ${data.articlesAdded} articles — fetching for source list`);
    },
    onError: (e) => toast.error(`Search failed: ${e.message}`),
  });

  const discoveryList = trpc.discovery.listUnprocessed.useQuery({ limit: 20 });

  const handleFileUpload = useCallback((files: FileList | null, kind: "audio" | "file") => {
    if (!files) return;
    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = e => {
        onAdd({ kind, label: file.name, content: e.target?.result as string });
      };
      reader.readAsText(file);
      toast.success(`Added: ${file.name}`);
    });
  }, [onAdd]);

  const handleAddUrl = () => {
    if (!urlDraft.trim()) return;
    onAdd({ kind: "website", label: urlDraft.trim(), content: urlDraft.trim() });
    setUrlDraft("");
    setAddMode(null);
  };

  const handleAddText = () => {
    if (!textDraft.trim()) return;
    onAdd({ kind: "text", label: textLabel.trim() || "Text snippet", content: textDraft.trim() });
    setTextDraft("");
    setTextLabel("");
    setAddMode(null);
  };

  const handleAddDiscoveryArticle = (article: { title?: string | null; summary?: string | null; content?: string | null }) => {
    onAdd({
      kind: "discovery",
      label: article.title || "Untitled article",
      content: article.summary || article.content?.slice(0, 500) || "",
    });
    toast.success("Source added from discovery");
  };

  const handleSearchOnline = () => {
    if (!searchQuery.trim()) return;
    fetchDiscovery.mutate({ source: searchQuery.trim() });
    discoveryList.refetch();
  };

  const selectedCount = sources.filter(s => s.selected).length;

  return (
    <div className="flex flex-col h-full border-r border-border bg-card/30">
      {/* Header */}
      <div className="p-3 border-b border-border">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Sources</p>
          <Badge variant="outline" className="text-[10px] h-4">
            {selectedCount}/{sources.length}
          </Badge>
        </div>
        {sources.length > 0 && (
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" className="h-5 text-[10px] px-1.5" onClick={onSelectAll}>All</Button>
            <Button variant="ghost" size="sm" className="h-5 text-[10px] px-1.5" onClick={onDeselectAll}>None</Button>
          </div>
        )}
      </div>

      {/* Source list */}
      <ScrollArea className="min-h-0 flex-1 min-h-0">
        <div className="p-2 space-y-1">
          {sources.length === 0 && (
            <p className="text-[10px] text-muted-foreground italic text-center py-6">No sources yet. Add some below.</p>
          )}
          {sources.map(src => (
            <div
              key={src.id}
              className={cn(
                "flex items-start gap-2 p-2 rounded-lg border text-[11px] group transition-colors",
                src.selected ? "bg-accent/10 border-accent/30" : "bg-muted/10 border-border hover:border-border/80"
              )}
            >
              <Checkbox
                checked={src.selected}
                onCheckedChange={() => onToggle(src.id)}
                className="mt-0.5 h-3 w-3 shrink-0"
              />
              <div className="flex-1 min-w-0">
                <div className={cn("flex items-center gap-1 mb-0.5", KIND_COLOR[src.kind])}>
                  {KIND_ICON[src.kind]}
                  <span className="uppercase text-[9px] font-bold tracking-wider">{src.kind}</span>
                </div>
                <p className="text-foreground leading-snug line-clamp-2">{src.label}</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                onClick={() => onDelete(src.id)}
              >
                <X className="w-3 h-3" />
              </Button>
            </div>
          ))}
        </div>
      </ScrollArea>

      {/* Add sources */}
      <div className="border-t border-border p-3 space-y-2">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Add Source</p>

        {/* Quick-add buttons */}
        <div className="grid grid-cols-3 gap-1">
          {([
            { kind: "audio" as SourceKind, icon: <Music className="w-3 h-3" />, label: "Audio" },
            { kind: "file" as SourceKind, icon: <FileText className="w-3 h-3" />, label: "File" },
            { kind: "text" as SourceKind, icon: <Plus className="w-3 h-3" />, label: "Text" },
            { kind: "website" as SourceKind, icon: <Globe className="w-3 h-3" />, label: "URL" },
            { kind: "cloud" as SourceKind, icon: <Cloud className="w-3 h-3" />, label: "Cloud" },
            { kind: "discovery" as SourceKind, icon: <Search className="w-3 h-3" />, label: "Search" },
          ] as const).map(btn => (
            <button
              key={btn.kind}
              onClick={() => {
                if (btn.kind === "audio") { audioRef.current?.click(); return; }
                if (btn.kind === "file") { fileRef.current?.click(); return; }
                setAddMode(prev => prev === btn.kind ? null : btn.kind);
              }}
              className={cn(
                "flex flex-col items-center gap-0.5 p-1.5 rounded border text-[9px] font-bold uppercase tracking-wider transition-colors",
                addMode === btn.kind
                  ? "bg-accent/20 border-accent/40 text-accent"
                  : "border-border text-muted-foreground hover:border-accent/30 hover:text-foreground"
              )}
            >
              {btn.icon}
              {btn.label}
            </button>
          ))}
        </div>

        {/* Hidden file inputs */}
        <input ref={audioRef} type="file" accept="audio/*" multiple className="sr-only"
          onChange={e => handleFileUpload(e.target.files, "audio")} />
        <input ref={fileRef} type="file" accept=".pdf,.txt,.md,.docx,.csv" multiple className="sr-only"
          onChange={e => handleFileUpload(e.target.files, "file")} />

        {/* Inline forms */}
        {addMode === "text" && (
          <div className="space-y-1.5 animate-in slide-in-from-top-1 duration-150">
            <Input
              placeholder="Label (optional)"
              value={textLabel}
              onChange={e => setTextLabel(e.target.value)}
              className="h-6 text-[11px]"
            />
            <Textarea
              placeholder="Paste or type source text..."
              value={textDraft}
              onChange={e => setTextDraft(e.target.value)}
              className="text-[11px] min-h-[60px] resize-none"
            />
            <div className="flex gap-1">
              <Button size="sm" className="flex-1 h-6 text-[10px]" onClick={handleAddText}>Add</Button>
              <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => setAddMode(null)}>Cancel</Button>
            </div>
          </div>
        )}

        {addMode === "website" && (
          <div className="space-y-1.5 animate-in slide-in-from-top-1 duration-150">
            <div className="flex gap-1">
              <Input
                placeholder="https://..."
                value={urlDraft}
                onChange={e => setUrlDraft(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleAddUrl()}
                className="h-6 text-[11px] flex-1"
              />
              <Button size="sm" className="h-6 text-[10px] px-2" onClick={handleAddUrl}>Add</Button>
            </div>
            <Button size="sm" variant="ghost" className="w-full h-5 text-[10px]" onClick={() => setAddMode(null)}>Cancel</Button>
          </div>
        )}

        {addMode === "cloud" && (
          <div className="space-y-1 animate-in slide-in-from-top-1 duration-150">
            <p className="text-[9px] text-muted-foreground italic">Connect a cloud storage provider:</p>
            {[
              { label: "Google Drive", icon: "G", color: "text-blue-400", provider: "google_drive" },
              { label: "Dropbox", icon: "⬡", color: "text-blue-500", provider: "dropbox" },
              { label: "OneDrive", icon: "☁", color: "text-cyan-400", provider: "onedrive" },
            ].map(p => (
              <button
                key={p.label}
                onClick={() => {
                  // Cloud publishing (Spotify/Apple): requires OAuth integration — see Phase 35.
                  // Planned for v3.1.0. Local export is fully functional.
                  toast.info(`${p.label}: Connect your account in Settings > Integrations`);
                }}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded border border-border text-[10px] hover:bg-muted/30 transition-colors"
              >
                <span className={cn("font-bold text-sm", p.color)}>{p.icon}</span>
                <span>{p.label}</span>
                <Badge variant="outline" className="ml-auto text-[8px] h-4">Connect</Badge>
              </button>
            ))}
            <Button size="sm" variant="ghost" className="w-full h-5 text-[10px]" onClick={() => setAddMode(null)}>Cancel</Button>
          </div>
        )}

        {addMode === "discovery" && (
          <div className="space-y-2 animate-in slide-in-from-top-1 duration-150">
            <div className="flex gap-1">
              <Input
                placeholder="Search topic..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSearchOnline()}
                className="h-6 text-[11px] flex-1"
              />
              <Button
                size="sm"
                className="h-6 text-[10px] px-2"
                onClick={handleSearchOnline}
                disabled={fetchDiscovery.isPending}
              >
                {fetchDiscovery.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
              </Button>
            </div>
            {discoveryList.data && discoveryList.data.length > 0 && (
              <ScrollArea className="h-[140px]">
                <div className="space-y-1">
                  {discoveryList.data.map((article) => (
                    <button
                      key={article.id}
                      onClick={() => handleAddDiscoveryArticle(article)}
                      className="w-full text-left p-1.5 rounded border border-border text-[10px] hover:bg-accent/10 hover:border-accent/30 transition-colors leading-snug"
                    >
                      <span className="font-medium line-clamp-2">{article.title || "Untitled"}</span>
                      <span className="text-muted-foreground block">{article.source}</span>
                    </button>
                  ))}
                </div>
              </ScrollArea>
            )}
            <Button size="sm" variant="ghost" className="w-full h-5 text-[10px]" onClick={() => setAddMode(null)}>Close</Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const LENGTH_OPTIONS = [
  { value: "short", label: "Short", desc: "~5 min · 4–6 turns" },
  { value: "medium", label: "Medium", desc: "~15 min · 10–14 turns" },
  { value: "long", label: "Long", desc: "~30 min · 20–26 turns" },
  { value: "deep-dive", label: "Deep Dive", desc: "~60 min · 40+ turns" },
] as const;

type PodcastLength = typeof LENGTH_OPTIONS[number]["value"];

export default function PodcastStudio() {
  const [turns, setTurns] = useState<DialogueTurn[]>(DEFAULT_TURNS);
  const [sources, setSources] = useState<PodcastSource[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<{ segments: { speaker: string; text?: string; content?: string; audioUrl?: string | null }[] } | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [podcastLength, setPodcastLength] = useState<PodcastLength>("medium");

  // Neural map link
  const { activeMap } = useNeuralMap();
  const { entries: neuralContextFiles } = useNeuralContextStore();
  const [linkedToMap, setLinkedToMap] = useState<boolean>(() => {
    try { return localStorage.getItem("omnecor:podcast_linked_to_map") === "true"; } catch { return false; }
  });
  const handleLinkToggle = (v: boolean) => {
    setLinkedToMap(v);
    localStorage.setItem("omnecor:podcast_linked_to_map", String(v));
    if (v && activeMap) toast.success(`Podcast Studio linked to "${activeMap.name}"`);
    else toast.info("Podcast Studio unlinked from neural map");
  };

  const addNeuralMapSources = useCallback(() => {
    if (!neuralContextFiles.length) {
      toast.info("No files pinned in the neural map context store. Pin files from Brain Map first.");
      return;
    }
    const newSources: PodcastSource[] = neuralContextFiles.map(f => ({
      id: crypto.randomUUID(),
      kind: "file" as SourceKind,
      label: `[Neural Map] ${f.name} (${f.path})`,
      content: f.path,
      selected: true,
    }));
    setSources(prev => {
      const existing = new Set(prev.map(s => s.label));
      return [...prev, ...newSources.filter(s => !existing.has(s.label))];
    });
    toast.success(`Added ${newSources.length} neural map file${newSources.length !== 1 ? "s" : ""} as sources`);
  }, [neuralContextFiles]);

  // Source management
  const addSource = useCallback((src: Omit<PodcastSource, "id" | "selected">) => {
    setSources(prev => [...prev, { ...src, id: crypto.randomUUID(), selected: true }]);
  }, []);

  const toggleSource = (id: string) => setSources(prev => prev.map(s => s.id === id ? { ...s, selected: !s.selected } : s));
  const deleteSource = (id: string) => setSources(prev => prev.filter(s => s.id !== id));
  const selectAll = () => setSources(prev => prev.map(s => ({ ...s, selected: true })));
  const deselectAll = () => setSources(prev => prev.map(s => ({ ...s, selected: false })));

  const selectedSources = sources.filter(s => s.selected);

  // Mutations
  const generateScriptMutation = trpc.ai.chat.useMutation({
    onSuccess: (data) => {
      try {
        const jsonMatch = data.content.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const newTurns = JSON.parse(jsonMatch[0]);
          setTurns((newTurns as DialogueTurn[]).map((t) => ({
            ...t,
            id: Math.random().toString(36).substring(7),
          })));
          toast.success("AI Script generated!");
        }
      } catch {
        toast.error("Failed to parse AI script. Check logs.");
      }
    },
    onError: (err) => toast.error("Script generation failed: " + err.message),
  });

  const handleGenerateScript = () => {
    const topic = window.prompt("What should the podcast be about?", "The impact of sovereign AI on local privacy");
    if (!topic) return;

    const lengthSpec = LENGTH_OPTIONS.find(l => l.value === podcastLength)!;
    const turnCount = podcastLength === "short" ? 5 : podcastLength === "medium" ? 12 : podcastLength === "long" ? 23 : 42;

    const sourceContext = selectedSources.length > 0
      ? `\n\nUse these sources as context:\n${selectedSources.map((s, i) => `[${i + 1}] ${s.label}:\n${s.content}`).join("\n\n")}`
      : "";

    generateScriptMutation.mutate({
      providerId: "openai",
      messages: [{
        role: "user",
        content: `Generate a ${turnCount}-turn podcast script (${lengthSpec.desc}) between two hosts (Alex and Sam) about: "${topic}".${sourceContext}
        Return ONLY a JSON array of objects with keys: speakerId (Alex or Sam), text, emotion (excited, thoughtful, neutral, whispering).
        Example: [{"speakerId": "Alex", "text": "Hello!", "emotion": "excited"}]`
      }],
      modelId: "gpt-4o"
    });
  };

  const generateMutation = trpc.podcast.generate.useMutation({
    onSuccess: (data) => {
      setIsGenerating(false);
      setResult(data as { segments: { speaker: string; text?: string; content?: string; audioUrl?: string | null }[] });
      toast.success("Podcast generated successfully using local mesh!");
    },
    onError: (e) => {
      setIsGenerating(false);
      toast.error(`Generation failed: ${e.message}`);
    }
  });

  const addTurn = () => {
    const lastSpeaker = turns[turns.length - 1]?.speakerId;
    const nextSpeaker = lastSpeaker === "Alex" ? "Sam" : "Alex";
    setTurns([...turns, {
      id: Math.random().toString(36).substring(7),
      speakerId: nextSpeaker,
      text: "",
      emotion: "neutral"
    }]);
  };

  const removeTurn = (id: string) => setTurns(turns.filter(t => t.id !== id));

  const updateTurn = (id: string, field: keyof DialogueTurn, value: string) => {
    setTurns(turns.map(t => t.id === id ? { ...t, [field]: value } : t));
  };

  const handleGenerate = () => {
    if (turns.some(t => !t.text.trim())) {
      toast.error("Please fill in all dialogue turns.");
      return;
    }
    setIsGenerating(true);
    generateMutation.mutate({
      title: "New Podcast Episode",
      turns: turns.map(t => ({ speakerId: t.speakerId, text: t.text, emotion: t.emotion }))
    });
  };

  return (
    <OmnecorDashboardLayout>
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="border-b border-border bg-card px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between shrink-0 flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <Mic2 className="w-5 h-5 text-accent" /> Podcast Studio
            </h1>
            <p className="text-muted-foreground text-xs mt-0.5">Multi-speaker dialogue orchestration using local XTTS-v2 & RVC.</p>
          </div>
          <div className="flex gap-2 flex-wrap items-center">
            {/* Link To Neural Map toggle */}
            <div className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-colors",
              linkedToMap ? "bg-accent/10 border-accent/40 text-accent" : "border-border text-muted-foreground"
            )}>
              <Brain className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="text-xs font-medium whitespace-nowrap">
                {linkedToMap && activeMap ? activeMap.name : "Link To Neural Map"}
              </span>
              <Switch
                checked={linkedToMap}
                onCheckedChange={handleLinkToggle}
                className="scale-75"
                aria-label="Link Podcast Studio to active neural map"
              />
            </div>
            {/* Add sources from neural map */}
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={addNeuralMapSources}
              title="Add pinned neural map files as podcast sources"
            >
              <Brain className="w-4 h-4" />
              Add from Map
            </Button>
            {selectedSources.length > 0 && (
              <Badge className="bg-accent/10 text-accent border-accent/20 text-xs gap-1">
                <HardDrive className="w-3 h-3" />
                {selectedSources.length} source{selectedSources.length !== 1 ? "s" : ""} active
              </Badge>
            )}
            <Button variant="outline" size="sm" className="gap-2" onClick={handleGenerateScript} disabled={generateScriptMutation.isPending}>
              {generateScriptMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              AI Script Gen
            </Button>
            <Button variant="outline" size="sm" className="gap-2" onClick={() => toast.info("Podcast history: browse completed episodes in the podcast list page or check your /podcast-studio/history.")}>
              <History className="w-4 h-4" /> History
            </Button>
            <Button size="sm" className="gap-2" onClick={handleGenerate} disabled={isGenerating}>
              {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              Generate Podcast
            </Button>
          </div>
        </div>

        {/* Body: 3-panel layout — stacks on mobile, 2-col on tablet, 3-col on desktop */}
        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[240px_1fr] lg:grid-cols-[280px_1fr_280px] overflow-auto md:overflow-hidden">

          {/* Left: Sources */}
          <SourcesSidebar
            sources={sources}
            onAdd={addSource}
            onToggle={toggleSource}
            onDelete={deleteSource}
            onSelectAll={selectAll}
            onDeselectAll={deselectAll}
          />

          {/* Center: Script Editor */}
          <div className="overflow-auto p-6">
            <Card className="border-accent/10 shadow-xl bg-card/50 backdrop-blur-sm">
              <CardHeader className="flex flex-row items-center justify-between border-b pb-4">
                <div>
                  <CardTitle className="text-lg">Dialogue Script</CardTitle>
                  <CardDescription>Compose your multi-voice conversation below.</CardDescription>
                </div>
                <Button size="sm" variant="ghost" className="h-8 gap-1" onClick={() => setTurns(DEFAULT_TURNS)}>
                  <RefreshCw className="w-3.5 h-3.5" /> Reset
                </Button>
              </CardHeader>
              <CardContent className="pt-6">
                <div className="space-y-6">
                  {turns.map((turn, index) => (
                    <div key={turn.id} className="relative animate-in fade-in slide-in-from-left duration-300">
                      <div className="flex items-center gap-3 mb-2">
                        <div className={cn(
                          "w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs border shadow-sm",
                          turn.speakerId === "Alex" ? "bg-blue-500/10 text-blue-500 border-blue-500/20" : "bg-purple-500/10 text-purple-500 border-purple-500/20"
                        )}>
                          {turn.speakerId.charAt(0)}
                        </div>
                        <select
                          className="bg-transparent text-sm font-bold focus:outline-none cursor-pointer"
                          value={turn.speakerId}
                          onChange={(e) => updateTurn(turn.id, "speakerId", e.target.value)}
                        >
                          <option value="Alex">Alex (Male)</option>
                          <option value="Sam">Sam (Female)</option>
                          <option value="Guest">Guest (Custom)</option>
                        </select>
                        <Badge variant="outline" className="text-[9px] h-4 uppercase tracking-tighter opacity-50">Local Clone</Badge>
                        <div className="flex-1" />
                        <select
                          className="text-[10px] bg-muted/50 rounded px-1.5 py-0.5 border-none focus:ring-1 focus:ring-accent"
                          value={turn.emotion}
                          onChange={(e) => updateTurn(turn.id, "emotion", e.target.value)}
                        >
                          <option value="neutral">Neutral</option>
                          <option value="excited">Excited</option>
                          <option value="thoughtful">Thoughtful</option>
                          <option value="whispering">Whispering</option>
                        </select>
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => removeTurn(turn.id)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                      <Textarea
                        placeholder="Type dialogue here..."
                        value={turn.text}
                        onChange={(e) => updateTurn(turn.id, "text", e.target.value)}
                        className="resize-none min-h-[60px] bg-muted/20 border-accent/5 focus:border-accent/40"
                      />
                      {index < turns.length - 1 && (
                        <div className="absolute -bottom-4 left-4 w-px h-4 bg-muted-foreground/10" />
                      )}
                    </div>
                  ))}
                  <Button
                    variant="outline"
                    className="w-full border-dashed border-2 py-8 hover:bg-accent/5 transition-all group"
                    onClick={addTurn}
                  >
                    <Plus className="w-5 h-5 mr-2 text-muted-foreground group-hover:text-accent" />
                    <span className="text-muted-foreground group-hover:text-accent">Add Dialogue Turn</span>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right: Settings & Output */}
          <div className="overflow-auto p-6 space-y-6 border-l border-border">
            <Card className="bg-muted/10 border-dashed">
              <CardHeader className="p-4">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Settings2 className="w-4 h-4 text-accent" /> Orchestration Rules
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-4">
                <div className="space-y-2">
                  <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest">Episode Length</p>
                  <div className="grid grid-cols-2 gap-1">
                    {LENGTH_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => setPodcastLength(opt.value)}
                        className={cn(
                          "p-2 rounded border text-left transition-colors",
                          podcastLength === opt.value
                            ? "bg-accent/20 border-accent/50 text-accent"
                            : "border-border text-muted-foreground hover:border-border/80 hover:text-foreground"
                        )}
                      >
                        <p className="text-[11px] font-bold">{opt.label}</p>
                        <p className="text-[9px] leading-tight mt-0.5">{opt.desc}</p>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest">Model Pipeline</p>
                  <div className="p-3 rounded-lg bg-background border flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Zap className="w-4 h-4 text-amber-500" />
                      <span className="text-xs font-semibold">XTTS-v2 + RVC Post</span>
                    </div>
                    <Badge variant="outline" className="text-[9px] h-4">Sovereign</Badge>
                  </div>
                </div>
                <div className="space-y-2">
                  <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest">Parallelism</p>
                  <div className="flex items-center justify-between">
                    <span className="text-xs">Mesh Rendering</span>
                    <Badge className="bg-green-500/10 text-green-500 border-green-500/20 text-[9px] h-4">Enabled</Badge>
                  </div>
                  <p className="text-[9px] text-muted-foreground italic">Distributing synthesis across 3 local nodes.</p>
                </div>
              </CardContent>
            </Card>

            <Card className={cn(
              "border-accent/20 transition-all duration-500",
              result ? "bg-accent/5" : "bg-muted/5 opacity-50"
            )}>
              <CardHeader className="p-4">
                <CardTitle className="text-sm">Output Stream</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                {!result ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center space-y-3">
                    <Music className="w-8 h-8 text-muted-foreground opacity-20" />
                    <p className="text-[10px] text-muted-foreground italic">No audio generated yet.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="p-3 rounded-xl bg-background border shadow-inner">
                      <p className="text-[10px] font-bold text-muted-foreground mb-2">MASTER MIX</p>
                      <audio controls className="w-full h-8" src={audioUrl ?? undefined} />
                    </div>
                    <div className="space-y-2">
                      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Segment Breakdown</p>
                      {result.segments.map((seg, i) => (
                        <div key={i} className="flex items-center justify-between p-2 rounded bg-background border text-[10px]">
                          <div className="flex items-center gap-2">
                            <User className="w-3 h-3 text-accent" />
                            <span className="font-bold">{seg.speaker}</span>
                          </div>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6"
                            onClick={() => {
                              const text = seg.text || seg.content || "";
                              if (text && "speechSynthesis" in window) {
                                window.speechSynthesis.cancel();
                                const utt = new SpeechSynthesisUtterance(text);
                                window.speechSynthesis.speak(utt);
                              }
                            }}
                          >
                            <Play className="w-3 h-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 gap-2 pt-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-[10px] h-8 gap-1.5"
                        onClick={() => {
                          if (!result) return;
                          const text = result.segments.map(s => `[${s.speaker}]: ${s.text || s.content || ""}`).join("\n\n");
                          const blob = new Blob([text], { type: "text/plain" });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = "podcast-transcript.txt";
                          a.click();
                          URL.revokeObjectURL(url);
                        }}
                      >
                        <Download className="w-3 h-3" /> WAV
                      </Button>
                      <Button
                        size="sm"
                        className="text-[10px] h-8 gap-1.5"
                        onClick={() => {
                          if (!result) return;
                          const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = "podcast-export.json";
                          a.click();
                          URL.revokeObjectURL(url);
                          toast.success("Podcast exported");
                        }}
                      >
                        <Share2 className="w-3 h-3" /> Export
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </OmnecorDashboardLayout>
  );
}
