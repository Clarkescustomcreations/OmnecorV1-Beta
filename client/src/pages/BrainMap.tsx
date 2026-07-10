import { OmnecorDashboardLayout } from "@/components/OmnecorDashboardLayout";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Brain, Grid3x3, List, Settings, Shield, Maximize2, Anchor, ExternalLink, PanelRightClose, PanelRightOpen, Palette, Layers, Activity, Filter, Zap, X as XIcon, Pencil, Lock, LockOpen, Map as MapIcon, MessageSquare, FolderOpen, Database, Loader2 } from "lucide-react";
import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { NeuralGraphView, BrainMapViewport } from "@/components/neural/NeuralGraphView";
import { NeuralTreeView } from "@/components/neural/NeuralTreeView";
import { MapManager } from "@/components/neural/MapManager";
import { FictionModePanel } from "@/components/neural/FictionModePanel";
import { FloatingWindow } from "@/components/window-system/FloatingWindow";
import { useBrainMapStore } from "@/lib/stores/brainMapStore";
import { useAppStore } from "@/lib/store/app.store";
import { trpc } from "@/lib/trpc";
import { fileTreeToNetwork, subtreeToNodes } from "@/lib/fileTreeToNetwork";
import { generateOmnecorProjectMock } from "@/lib/demoProject";
import { convertFileSystemToNeuralNetwork, buildMasterNetwork, type NeuralNetwork, type NeuralNode } from "@/lib/neuralNodeTree";
import { NeuralMapProvider, useNeuralMap } from "@/contexts/NeuralMapContext";
import { FictionModeProvider, useFictionMode } from "@/contexts/FictionModeContext";
import type { FictionState } from "@/types/fiction";
import { useUserPeerCard } from "@/lib/userPeerCard";
import { useNeuralContextStore, makeEntry, NEURAL_DRAG_KEY } from "@/lib/neuralContextStore";
import { IS_DEMO } from "@/lib/demo";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { HowToTooltip } from "@/components/shell/HowToTooltip";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { Query } from "@tanstack/react-query";
import { useVisualControlStore } from "@/lib/stores/visualControlStore";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

// ---------------------------------------------------------------------------
// Node description helper
// ---------------------------------------------------------------------------
function getNodeDescription(label: string, type: string, fileCount?: number): string {
  if (type === "project") return "Project root — the top-level workspace node.";
  if (type === "integration") return "Remote integration source (GitHub repo or cloud service).";
  if (type === "folder") return `Directory${fileCount !== undefined ? ` containing ${fileCount} items` : ""}.`;
  const ext = label.includes(".") ? (label.split(".").pop()?.toLowerCase() ?? "") : "";
  const descriptions: Record<string, string> = {
    ts: "TypeScript source file — compiled to JavaScript.", tsx: "React TypeScript component — renders UI.",
    js: "JavaScript module.", jsx: "React JSX component.", json: "JSON data or configuration file.",
    md: "Markdown documentation or notes.", mdx: "MDX — Markdown with embedded JSX.",
    css: "CSS stylesheet.", scss: "SCSS stylesheet with extended features.", html: "HTML document.",
    py: "Python script or module.", sh: "Shell script.", bash: "Bash shell script.",
    env: "Environment variables config — keep secret.", yaml: "YAML configuration file.",
    yml: "YAML configuration file.", toml: "TOML configuration file.", svg: "SVG vector graphic.",
    png: "PNG raster image.", jpg: "JPEG image.", jpeg: "JPEG image.", gif: "Animated GIF.",
    webp: "WebP image.", wasm: "WebAssembly binary module.", sql: "SQL query or schema.",
    prisma: "Prisma ORM schema file.", graphql: "GraphQL schema or query.", gql: "GraphQL file.",
    proto: "Protocol Buffers schema.", lock: "Package lock file — do not edit manually.",
    gitignore: "Git ignore rules.", rs: "Rust source file.", go: "Go source file.",
    java: "Java source file.", kt: "Kotlin source file.", cpp: "C++ source file.",
    c: "C source file.", h: "C/C++ header file.", vue: "Vue.js single-file component.",
    svelte: "Svelte component.", kicad_pcb: "KiCad PCB layout file.",
    kicad_sch: "KiCad schematic file.", kicad_pro: "KiCad project file.",
  };
  return descriptions[ext] ?? (ext ? `${ext.toUpperCase()} file.` : "File.");
}

/**
 * Visual Toolbar for Neural Map Controls
 * All settings persist via Zustand localStorage store and directly affect NeuralGraphView.
 */
function NeuralMapToolbar() {
  const collapsed = useAppStore((s) => s.brainMapToolbarCollapsed);
  const setCollapsed = useAppStore((s) => s.setBrainMapToolbarCollapsed);

  const {
    layout, setLayout,
    nodeSize, setNodeSize,
    simSpeed, setSimSpeed,
    gpuEnabled, setGpuEnabled,
    autoClustering, setAutoClustering,
    showMiniMap, setShowMiniMap,
    showHoverDescriptions, setShowHoverDescriptions,
    lockLayout, unlockLayout, isLayoutLocked,
  } = useVisualControlStore();
  const { nodes: brainNodes, projectId: brainProjectId } = useBrainMapStore();
  const [unlockDialogOpen, setUnlockDialogOpen] = useState(false);

  // ── Layout prefs DB sync ──────────────────────────────────────────────────
  const { activeMap, updateMap } = useNeuralMap();
  const layoutSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRestoredMapIdRef = useRef<string | null>(null);

  // Restore layout prefs when switching maps
  useEffect(() => {
    if (!activeMap || lastRestoredMapIdRef.current === activeMap.id) return;
    lastRestoredMapIdRef.current = activeMap.id;
    const prefs = activeMap.settings.layoutPrefs;
    if (!prefs) return;
    if (prefs.layout) setLayout(prefs.layout as Parameters<typeof setLayout>[0]);
    if (prefs.nodeSize !== undefined) setNodeSize(prefs.nodeSize);
    if (prefs.simSpeed !== undefined) setSimSpeed(prefs.simSpeed);
    if (prefs.gpuEnabled !== undefined) setGpuEnabled(prefs.gpuEnabled);
    if (prefs.autoClustering !== undefined) setAutoClustering(prefs.autoClustering);
  }, [activeMap, setLayout, setNodeSize, setSimSpeed, setGpuEnabled, setAutoClustering]);

  // Debounced save of current layout prefs to DB (1 second after last change)
  const saveLayoutPrefsRef = useRef<() => void>(() => {});
  saveLayoutPrefsRef.current = () => {
    if (!activeMap) return;
    updateMap(activeMap.id, {
      settings: {
        ...activeMap.settings,
        layoutPrefs: { layout, nodeSize, simSpeed, gpuEnabled, autoClustering },
      },
    });
  };
  const scheduleLayoutSave = useCallback(() => {
    if (layoutSaveTimerRef.current) clearTimeout(layoutSaveTimerRef.current);
    layoutSaveTimerRef.current = setTimeout(() => saveLayoutPrefsRef.current(), 1000);
  }, []);

  const lockKey = `${brainProjectId}:${layout}`;
  const locked = isLayoutLocked(lockKey);

  return (
    <Card className={cn(
      "shadow-lg border-primary/20 bg-background/95 backdrop-blur-md transition-all duration-300",
      collapsed ? "w-10 overflow-hidden" : "w-auto min-w-[240px]"
    )}>
      <div className="flex items-center p-1.5 border-b border-border/50">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? <PanelRightOpen className="w-4 h-4" /> : <PanelRightClose className="w-4 h-4" />}
        </Button>
        {!collapsed && (
          <HowToTooltip title="Visual Controller" description="Adjust graph layout engines, rendering performance, and organization rules." side="bottom" align="start">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-2 cursor-help">
              Visual Controller
            </span>
          </HowToTooltip>
        )}
      </div>

      {!collapsed && (
        <div className="p-4 space-y-4">
          {/* Legend */}
          <div className="space-y-1.5 pb-3 border-b border-border/50">
            <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Legend</Label>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2 text-[11px]">
                <span className="w-3 h-3 rounded-full bg-primary flex-shrink-0" />
                <span className="text-muted-foreground">Folder</span>
              </div>
              <div className="flex items-center gap-2 text-[11px]">
                <span className="w-3 h-3 rounded-full bg-accent-success flex-shrink-0" />
                <span className="text-muted-foreground">File</span>
              </div>
              <div className="flex items-center gap-2 text-[11px]">
                <span className="w-3 h-3 rounded-full bg-accent-purple flex-shrink-0" />
                <span className="text-muted-foreground">Project</span>
              </div>
              <div className="flex items-center gap-2 text-[11px]">
                <span className="w-3 h-3 rounded-full bg-accent-success flex-shrink-0" />
                <span className="text-muted-foreground">In AI Context</span>
              </div>
            </div>
          </div>

          {/* Layout Engine + Lock */}
          <div className="space-y-2">
            <Label className="text-[11px] font-semibold flex items-center gap-2">
              <Layers className="w-3 h-3" /> Layout Engine
            </Label>
            <div className="flex gap-1.5">
              <Select value={layout} onValueChange={(v) => { setLayout(v as typeof layout); scheduleLayoutSave(); }}>
                <SelectTrigger className="h-8 text-xs flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="force">Force-Directed</SelectItem>
                  <SelectItem value="hierarchical">Hierarchical</SelectItem>
                  <SelectItem value="mindmap">Mind-Map</SelectItem>
                  <SelectItem value="circular">Circular</SelectItem>
                </SelectContent>
              </Select>
              <HowToTooltip
                title={locked ? "Layout Locked" : "Lock Layout"}
                description={locked
                  ? "This layout's arrangement is pinned. Node positions are saved per-project. Click to unlock (next layout switch will re-compute)."
                  : "Pin the current node arrangement for this layout. Switching layouts and back will restore this exact arrangement."}
                side="right"
              >
                <Button
                  size="icon"
                  variant={locked ? "default" : "outline"}
                  className={cn("h-8 w-8 flex-shrink-0", locked && "bg-accent-warning/20 border-accent-warning/50 text-accent-warning hover:bg-accent-warning/30")}
                  onClick={() => {
                    if (locked) {
                      setUnlockDialogOpen(true);
                    } else {
                      lockLayout(lockKey, brainNodes);
                      toast.success(`"${layout}" layout locked for this project.`);
                    }
                  }}
                >
                  {locked ? <Lock className="w-3.5 h-3.5" /> : <LockOpen className="w-3.5 h-3.5" />}
                </Button>
              </HowToTooltip>
            </div>
            {locked && (
              <p className="text-[10px] text-accent-warning flex items-center gap-1">
                <Lock className="w-2.5 h-2.5" /> Layout pinned — drag nodes freely
              </p>
            )}
          </div>

          {/* Rendering */}
          <div className="space-y-3">
            <Label className="text-[11px] font-semibold flex items-center gap-2">
              <Palette className="w-3 h-3" /> Rendering
            </Label>
            <div className="space-y-1.5">
              <div className="flex justify-between items-center text-[10px] text-muted-foreground">
                <span>Node Size</span>
                <span>{nodeSize}px</span>
              </div>
              <Slider
                value={[nodeSize]}
                onValueChange={([v]) => { setNodeSize(v); scheduleLayoutSave(); }}
                min={20}
                max={70}
                step={1}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-[10px] text-muted-foreground">GPU Acceleration</Label>
              <Switch checked={gpuEnabled} onCheckedChange={(v) => { setGpuEnabled(v); scheduleLayoutSave(); }} />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-[10px] text-muted-foreground flex items-center gap-1.5">
                <MapIcon className="w-3 h-3" /> Mini Map
              </Label>
              <Switch checked={showMiniMap} onCheckedChange={setShowMiniMap} />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-[10px] text-muted-foreground flex items-center gap-1.5">
                <MessageSquare className="w-3 h-3" /> Hover Info
              </Label>
              <Switch checked={showHoverDescriptions} onCheckedChange={setShowHoverDescriptions} />
            </div>
          </div>

          {/* Performance */}
          <div className="space-y-3 pt-2 border-t border-border/50">
            <Label className="text-[11px] font-semibold flex items-center gap-2">
              <Activity className="w-3 h-3" /> Performance
            </Label>
            <div className="space-y-1.5">
              <div className="flex justify-between items-center text-[10px] text-muted-foreground">
                <span>Anim Speed</span>
                <span>{simSpeed.toFixed(1)}x</span>
              </div>
              <Slider
                value={[simSpeed]}
                onValueChange={([v]) => { setSimSpeed(v); scheduleLayoutSave(); }}
                min={0.1}
                max={3}
                step={0.1}
              />
            </div>
          </div>

          {/* Organization */}
          <div className="space-y-2 pt-2 border-t border-border/50">
            <Label className="text-[11px] font-semibold flex items-center gap-2">
              <Filter className="w-3 h-3" /> Organization
            </Label>
            <div className="flex items-center justify-between">
              <Label className="text-[10px] text-muted-foreground">Auto-Clustering</Label>
              <Switch checked={autoClustering} onCheckedChange={(v) => { setAutoClustering(v); scheduleLayoutSave(); }} />
            </div>
          </div>
        </div>
      )}

      <AlertDialog open={unlockDialogOpen} onOpenChange={setUnlockDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unlock Layout?</AlertDialogTitle>
            <AlertDialogDescription>
              Unlocking will reset the current layout arrangement. Are you sure you want to proceed?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              unlockLayout(lockKey);
              toast.success(`"${layout}" layout unlocked — will auto-arrange on next switch.`);
            }}>
              Unlock Layout
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

/** Human label for a remote map-source URI (github:// / integration://). */
function remoteSourceLabel(uri: string): string {
  if (uri.startsWith("github://")) return `🐙 ${uri.slice("github://".length)}`;
  const type = uri.slice("integration://".length);
  const icons: Record<string, string> = {
    gmail: "✉️ Gmail", outlook: "📧 Outlook", "google-drive": "☁️ Drive",
    notion: "📝 Notion", slack: "💬 Slack", dropbox: "📦 Dropbox", onedrive: "💼 OneDrive",
  };
  return icons[type] ?? type;
}

/**
 * Neural Brain Map Page Content
 * Extracted to use contexts provided in the main BrainMap export
 */
function BrainMapContent() {
  const [viewMode, setViewMode] = useState<"graph" | "tree" | "mcp3d">("graph");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const { maps, activeMap, updateMap } = useNeuralMap();
  const { setFictionMode, isFictionMode } = useFictionMode();
  const [masterView, setMasterView] = useState(false);
  const { card: userCard } = useUserPeerCard();

  const collapsedFolderIds = useBrainMapStore(s => s.collapsedFolderIds);
  const setCollapsedFolderIds = useBrainMapStore(s => s.setCollapsedFolderIds);

  // Absolute paths of truncated folders the user drilled into (lazy-loaded subtrees).
  const [expandedPaths, setExpandedPaths] = useState<string[]>([]);

  // Sync collapsedFolderIds FROM activeMap TO useBrainMapStore on mount/project switch
  const lastActiveMapIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (activeMap) {
      if (lastActiveMapIdRef.current !== activeMap.id) {
        lastActiveMapIdRef.current = activeMap.id;
        const dbCollapsed = activeMap.settings.collapsedFolderIds || [];
        setCollapsedFolderIds(dbCollapsed);
        setExpandedPaths([]); // drill-in state is per-map
      }
    } else {
      lastActiveMapIdRef.current = null;
      setExpandedPaths([]);
    }
  }, [activeMap, setCollapsedFolderIds]);

  // Sync collapsedFolderIds FROM useBrainMapStore TO database settings
  useEffect(() => {
    if (!activeMap) return;
    const dbCollapsed = activeMap.settings.collapsedFolderIds || [];
    const isSame = dbCollapsed.length === collapsedFolderIds.length &&
      dbCollapsed.every(id => collapsedFolderIds.includes(id));
    
    if (!isSame && lastActiveMapIdRef.current === activeMap.id) {
      updateMap(activeMap.id, {
        settings: {
          ...activeMap.settings,
          collapsedFolderIds,
        }
      });
    }
  }, [collapsedFolderIds, activeMap, updateMap]);

  // Local edit state for project peer card (synced to map on change)
  const [projectCardEditing, setProjectCardEditing] = useState(false);

  // Inline label editing state
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelDraft, setLabelDraft] = useState("");

  // Context drag-and-drop
  const { entries: contextEntries, add: addToContext, remove: removeFromContext, has: inContext } = useNeuralContextStore();
  const [dropZoneActive, setDropZoneActive] = useState(false);
  const pc = activeMap?.projectContext ?? {};
  const updateProjectCard = (key: string, value: unknown) => {
    if (!activeMap) return;
    updateMap(activeMap.id, {
      projectContext: { ...pc, [key]: value },
    });
  };

  // Sync fiction mode with active map mode
  useEffect(() => {
    if (activeMap) {
      setFictionMode(activeMap.mode === "fiction");
    }
  }, [activeMap, setFictionMode]);

  // Separate local filesystem roots from remote sources (integration:// github://)
  const localRoots = (activeMap?.rootDirectories ?? []).filter(
    r => !r.startsWith("integration://") && !r.startsWith("github://")
  );
  const remoteRoots = (activeMap?.rootDirectories ?? []).filter(
    r => r.startsWith("integration://") || r.startsWith("github://")
  );

  // Parallel queries for every local root — aggregates all sub-networks
  const fileTreeQueries = trpc.useQueries(t =>
    localRoots.map(dir =>
      t.project.getFileTree(
        { projectId: activeMap?.id ?? "", rootDir: dir },
        {
          enabled: !!activeMap,
          refetchInterval: activeMap?.settings.realtimeSync ? 30000 : false,
        }
      )
    )
  );

  // Remote sources (github:// / integration://) are ingested into real content
  // trees via integrations.fetchSourceTree — gated by the map's indexing setting.
  const indexingEnabled = activeMap?.settings.indexingEnabled ?? true;
  const remoteSourceQueries = trpc.useQueries(t =>
    remoteRoots.map(uri =>
      t.integrations.fetchSourceTree(
        { uri },
        {
          enabled: !!activeMap && indexingEnabled,
          refetchInterval: activeMap?.settings.realtimeSync ? 60000 : false,
          retry: false, // don't hammer external APIs on auth/not-connected errors
        }
      )
    )
  );

  // On-demand subtree fetches for folders the user drilled into. Each fetches a
  // shallow slice rooted at the truncated folder; results are merged into the
  // network below. getFileTree already accepts an arbitrary rootDir, so no new
  // procedure is needed.
  const subtreeQueries = trpc.useQueries(t =>
    expandedPaths.map(p =>
      t.project.getFileTree(
        { projectId: activeMap?.id ?? "", rootDir: p, maxDepth: 3 },
        {
          enabled: !!activeMap,
          retry: false,
          refetchInterval: activeMap?.settings.realtimeSync ? 60000 : false,
        }
      )
    )
  );

  const isLoading =
    fileTreeQueries.some(q => q.isLoading) || remoteSourceQueries.some(q => q.isLoading);
  const loadedCount = fileTreeQueries.filter(q => !!q.data).length;
  const remoteLoadedCount = remoteSourceQueries.filter(q => !!q.data).length;
  const subtreeLoadedCount = subtreeQueries.filter(q => !!q.data).length;

  // Tracks expansions whose toast has already resolved (success/error), so the
  // settle effect below fires exactly once per fetch and not on every refetch.
  const expandSettledRef = useRef<Set<string>>(new Set());

  const handleRequestExpand = useCallback((p: string) => {
    const name = p.split("/").pop() || p;
    expandSettledRef.current.delete(p); // re-arm feedback on retry
    setExpandedPaths(prev => (prev.includes(p) ? prev : [...prev, p]));
    toast.loading(`Loading ${name}…`, { id: `expand-${p}` });
  }, []);

  // Resolve each expansion's loading toast and surface failures. On error the
  // path is dropped so the folder reverts to a drill-in node the user can retry.
  useEffect(() => {
    subtreeQueries.forEach((q, i) => {
      const p = expandedPaths[i];
      if (!p || expandSettledRef.current.has(p)) return;
      const name = p.split("/").pop() || p;
      if (q.isSuccess) {
        expandSettledRef.current.add(p);
        toast.success(`Loaded ${name}`, { id: `expand-${p}`, duration: 1500 });
      } else if (q.isError) {
        expandSettledRef.current.add(p);
        toast.error(`Couldn't load ${name}: ${q.error?.message ?? "fetch failed"}`, { id: `expand-${p}` });
        setExpandedPaths(prev => prev.filter(x => x !== p));
      }
    });
  }, [subtreeQueries, expandedPaths]);

  // Register watchers for all local roots of the active map
  const registerProject = trpc.project.registerProject.useMutation({
    onError: (err) => toast.error("Failed to watch directory: " + err.message),
  });

  useEffect(() => {
    if (activeMap) {
      localRoots.forEach(dir => {
        registerProject.mutate({ projectId: activeMap.id, rootDir: dir });
      });
    }
  }, [activeMap?.id]); // Only on map switch

  // ── Remote-source VectorDB indexing (map RAG feed) ───────────────────────
  // Feeds this map's remote sources (github:// + integration://) into its
  // vector collection so chat RAG can use them. Gated by the map's indexing
  // setting; runs detached on the server and is polled for progress.
  const hasRemoteSources = remoteRoots.length > 0;
  const indexingOn = activeMap?.settings.indexingEnabled ?? true;

  const indexMutation = trpc.integrations.indexMapSources.useMutation();
  const indexStatusQuery = trpc.integrations.getMapIndexStatus.useQuery(
    { mapId: activeMap?.id ?? "" },
    {
      enabled: !!activeMap && hasRemoteSources,
      // Poll while a run is in flight; stop once it settles.
      refetchInterval: (q: any) => {
        const data = q?.state?.data as { state?: string } | null;
        return data?.state === "running" ? 1500 : false;
      },
    },
  );
  const indexStatus = indexStatusQuery.data;
  const isIndexing = indexMutation.isPending || indexStatus?.state === "running";

  const triggerIndex = useCallback((manual: boolean) => {
    if (!activeMap) return;
    indexMutation.mutate(
      { mapId: activeMap.id },
      {
        onSuccess: (r) => {
          if (manual) {
            if ("skipped" in r && r.skipped) toast.info(r.reason ?? "Nothing to index.");
            else if ("alreadyRunning" in r && r.alreadyRunning) toast.info("Indexing already in progress…");
            else toast.success("Indexing started — fetching remote source content…");
          }
          indexStatusQuery.refetch();
        },
        onError: (err) => { if (manual) toast.error("Indexing failed: " + err.message); },
      },
    );
  }, [activeMap?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-index once per map open (only when enabled and there are remote roots).
  const autoIndexedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!activeMap || !hasRemoteSources || !indexingOn) return;
    if (autoIndexedRef.current.has(activeMap.id)) return;
    autoIndexedRef.current.add(activeMap.id);
    triggerIndex(false);
  }, [activeMap?.id, hasRemoteSources, indexingOn, triggerIndex]);

  const neuralNetwork = useMemo(() => {
    // No map selected → render the labeled "Omnecor Demo" showcase network so
    // first-run users still see the product's flagship visualization.
    if (!activeMap) {
      return convertFileSystemToNeuralNetwork(generateOmnecorProjectMock(), "Omnecor Demo");
    }

    // Build one network per local root from its filesystem tree.
    const localNetworks = fileTreeQueries
      .map(q => q.data)
      .filter((t): t is NonNullable<typeof t> => !!t)
      .map((tree, i) =>
        fileTreeToNetwork(tree, {
          projectId: `${activeMap.id}:${i}`,
          projectName: localRoots[i]
            ? localRoots[i].split("/").pop() ?? activeMap.name
            : activeMap.name,
        })
      );

    // Build one network per remote source. When indexing is on and the fetch
    // returned content, render the REAL expandable tree (identical to a local
    // root); otherwise fall back to a single labelled placeholder node so the
    // source is still visible while loading / not-indexed / not-connected.
    const remoteNetworks = remoteRoots.map((uri, i) => {
      const tree = remoteSourceQueries[i]?.data;
      const label = remoteSourceLabel(uri);
      if (indexingEnabled && tree && tree.length > 0) {
        return fileTreeToNetwork(tree, {
          projectId: `${activeMap.id}:remote:${i}`,
          projectName: label,
        });
      }
      const placeholder: NeuralNode = {
        id: `remote:${uri}`,
        label,
        type: "integration",
        data: { path: uri, isRemote: true, depth: 0 },
        position: { x: 0, y: 0 },
      };
      return { id: `remote-${i}`, name: label, type: "project" as const, nodes: [placeholder], edges: [] };
    });

    const allNodes = [
      ...localNetworks.flatMap(n => n.nodes),
      ...remoteNetworks.flatMap(n => n.nodes),
    ];
    const allEdges = [
      ...localNetworks.flatMap(n => n.edges),
      ...remoteNetworks.flatMap(n => n.edges),
    ];

    // Merge lazily-expanded folder subtrees. Process shallowest paths first so a
    // parent folder's nodes exist before a deeper expansion links under them.
    if (expandedPaths.length > 0) {
      const nodeById = new Map(allNodes.map(n => [n.id, n]));
      const nodeIds = new Set(allNodes.map(n => n.id));
      const edgeIds = new Set(allEdges.map(e => e.id));
      const ordered = [...expandedPaths].sort((a, b) => a.length - b.length);
      for (const p of ordered) {
        const data = subtreeQueries[expandedPaths.indexOf(p)]?.data;
        const parent = nodeById.get(`node-${p}`);
        if (!data || !parent) continue;
        parent.data = { ...parent.data, truncated: false }; // it's loaded now
        const { nodes: subNodes, edges: subEdges } = subtreeToNodes(data, `node-${p}`, parent.data.depth);
        for (const sn of subNodes) {
          if (nodeIds.has(sn.id)) continue;
          nodeIds.add(sn.id);
          nodeById.set(sn.id, sn);
          allNodes.push(sn);
        }
        for (const se of subEdges) {
          if (edgeIds.has(se.id)) continue;
          edgeIds.add(se.id);
          allEdges.push(se);
        }
      }
    }

    // A real map whose roots produced no nodes (still resolving, empty directory,
    // or a load error) renders as a genuine empty network — never the demo. The
    // viewport below surfaces the loading spinner / empty-state message instead.
    return {
      id: activeMap.id,
      name: activeMap.name,
      type: "project" as const,
      nodes: allNodes,
      edges: allEdges,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMap?.id, loadedCount, remoteLoadedCount, subtreeLoadedCount, indexingEnabled, localRoots.join(","), remoteRoots.join(","), expandedPaths.join(",")]);

  // Global master network — aggregates all maps, no file-tree queries needed
  const masterNetwork = useMemo(() => buildMasterNetwork(maps), [maps]);

  // Use master view when toggled, otherwise use the per-map network.
  // Apply any custom label overrides stored on the active map.
  const displayNetwork = useMemo(() => {
    const base = masterView ? masterNetwork : neuralNetwork;
    const overrides = activeMap?.labelOverrides ?? {};
    if (Object.keys(overrides).length === 0) return base;
    return {
      ...base,
      nodes: base.nodes.map(n =>
        overrides[n.id] ? { ...n, label: overrides[n.id] } : n
      ),
    };
  }, [masterView, masterNetwork, neuralNetwork, activeMap?.labelOverrides]);

  const selectedNode = displayNetwork.nodes.find(
    (n) => n.id === selectedNodeId
  );

  // Clear the inline editor whenever the selected node changes
  useEffect(() => { setEditingLabel(false); }, [selectedNodeId]);

  // Persist a custom label back into the active map
  const saveLabel = () => {
    if (!activeMap || !selectedNode) return;
    updateMap(activeMap.id, {
      labelOverrides: {
        ...activeMap.labelOverrides,
        [selectedNode.id]: labelDraft.trim() || selectedNode.label,
      },
    });
    setEditingLabel(false);
  };

  const { windowMode, setWindowMode, windowPosition, windowSize } = useBrainMapStore();

  // ── Sidebar collapse state ──────────────────────────────────────────────
  const leftSidebarCollapsed = useAppStore((s) => s.brainMapLeftCollapsed);
  const setLeftSidebarCollapsed = useAppStore((s) => s.setBrainMapLeftCollapsed);
  const rightSidebarCollapsed = useAppStore((s) => s.brainMapRightCollapsed);
  const setRightSidebarCollapsed = useAppStore((s) => s.setBrainMapRightCollapsed);

  // Handle External Window Launching
  useEffect(() => {
    if (windowMode === "external") {
      const win = window.open(
        "/brain-map-external",
        "OmnecorNeuralMap",
        `width=${windowSize.width},height=${windowSize.height},left=${windowPosition.x},top=${windowPosition.y},menubar=no,toolbar=no,location=no,status=no`
      );

      if (!win) {
        alert("Pop-up blocked! Please allow pop-ups to use the external window mode.");
        setWindowMode("embedded");
      }
      
      const bc = new BroadcastChannel('omnecor_neural_sync');
      bc.onmessage = (event) => {
        if (event.data === 'redock_request') {
          setWindowMode("embedded");
        }
      };
      
      return () => {
        bc.postMessage('redock');
        bc.close();
      };
    }
  }, [windowMode, setWindowMode, windowPosition, windowSize]);

  return (
    <OmnecorDashboardLayout>
      <div className="h-full flex flex-col overflow-hidden relative">
        {/* Floating Window Overlay */}
        <FloatingWindow
          title={`${activeMap?.name || "Neural Map"} (Floating)`}
          isOpen={windowMode === "floating"}
          onClose={() => setWindowMode("embedded")}
          onDock={() => setWindowMode("embedded")}
          onExternal={() => setWindowMode("external")}
          initialPosition={windowPosition}
          initialSize={windowSize}
        >
          <BrainMapViewport onNodeClick={setSelectedNodeId} />
        </FloatingWindow>

        <ResizablePanelGroup direction="horizontal" className="flex-1">
          {/* Left Sidebar: Map Manager (Collapsible) */}
          <ResizablePanel 
            defaultSize={20} 
            minSize={15} 
            maxSize={30} 
            className={cn(
              "border-r border-border transition-all duration-300 flex flex-col",
              leftSidebarCollapsed && "max-w-[40px] flex-shrink-0"
            )}
          >
            <div className="p-2 border-b border-border flex justify-end">
              <HowToTooltip title={leftSidebarCollapsed ? "Expand Sidebar" : "Collapse Sidebar"} description="Manage your neural maps, create new cognitive environments, and switch between project views.">
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-6 w-6" 
                  onClick={() => setLeftSidebarCollapsed(!leftSidebarCollapsed)}
                >
                  {leftSidebarCollapsed ? <PanelRightOpen className="w-3.5 h-3.5" /> : <PanelRightClose className="w-3.5 h-3.5" />}
                </Button>
              </HowToTooltip>
            </div>
            {!leftSidebarCollapsed ? (
              <div className="flex-1 p-4 overflow-auto">
                <MapManager />
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center pt-8 gap-6 text-muted-foreground select-none">
                 <Grid3x3 className="w-4 h-4 opacity-50" />
                 <div className="[writing-mode:vertical-lr] text-[9px] font-bold uppercase tracking-widest opacity-30">
                   Map Manager
                 </div>
              </div>
            )}
          </ResizablePanel>
          
          <ResizableHandle withHandle />

          {/* Main Area: Graph/Tree View */}
          <ResizablePanel defaultSize={55} className="flex flex-col">
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Header */}
              <div className="border-b border-border bg-card px-4 sm:px-6 py-3 sm:py-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <Brain className="w-6 h-6 text-primary flex-shrink-0" />
                  <div className="min-w-0">
                    <h1 className="text-4xl font-bold tracking-tight flex flex-wrap items-center gap-2">
                      {activeMap?.name ?? "Omnecor Demo"}
                      {isFictionMode && (
                        <Badge variant="outline" className="text-primary border-primary/30 text-[10px] py-0">
                          Fiction Mode
                        </Badge>
                      )}
                      {!activeMap && (
                        <Badge variant="secondary" className="text-[10px] py-0 bg-primary/10 text-primary border-primary/20">
                          Omnecor Demo
                        </Badge>
                      )}
                    </h1>
                    <p className="text-sm text-muted-foreground">
                      {activeMap ? `Mode: ${activeMap.mode}` : "Exploring the Omnecor system architecture"}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {/* View Switchers */}
                  <div className="flex flex-wrap bg-muted rounded-md p-1 mr-1 sm:mr-4">
                    <HowToTooltip title="Graph View" description="A spatial, node-based visualization of your files and their relationships.">
                      <Button
                        size="sm"
                        variant={viewMode === "graph" ? "default" : "ghost"}
                        className="h-7 px-2 text-xs"
                        onClick={() => setViewMode("graph")}
                      >
                        <Grid3x3 className="w-3.5 h-3.5 mr-1.5" /> Graph
                      </Button>
                    </HowToTooltip>
                    <HowToTooltip title="Tree View" description="A traditional hierarchical folder list for standard project navigation.">
                      <Button
                        size="sm"
                        variant={viewMode === "tree" ? "default" : "ghost"}
                        className="h-7 px-2 text-xs"
                        onClick={() => setViewMode("tree")}
                      >
                        <List className="w-3.5 h-3.5 mr-1.5" /> Tree
                      </Button>
                    </HowToTooltip>
                    
                    <div className="w-px bg-border mx-1 self-stretch" />
                    
                    <HowToTooltip title="Codebase Memory 3D" description="Deep semantic 3D graph visualization powered by Codebase Memory MCP (requires MCP server to be running).">
                      <Button
                        size="sm"
                        variant={viewMode === "mcp3d" ? "default" : "ghost"}
                        className="h-7 px-2 text-xs"
                        onClick={() => setViewMode("mcp3d")}
                      >
                        <MapIcon className="w-3.5 h-3.5 mr-1.5" /> 3D Memory
                      </Button>
                    </HowToTooltip>

                    {/* Master View separator + toggle */}
                    <div className="w-px bg-border mx-1 self-stretch" />
                    <HowToTooltip
                      title="Master View"
                      description="Aggregates every neural map into one unified constellation — workspace hub at the centre, each map as a satellite cluster."
                    >
                      <Button
                        size="sm"
                        variant={masterView ? "default" : "ghost"}
                        className={cn(
                          "h-7 px-2 text-xs gap-1.5",
                          masterView && "bg-primary/10 text-accent-foreground"
                        )}
                        onClick={() => setMasterView(v => !v)}
                      >
                        <Layers className="w-3.5 h-3.5" /> Master
                        {masterView && (
                          <Badge variant="secondary" className="text-[9px] px-1 py-0 ml-0.5">
                            {maps.length} maps
                          </Badge>
                        )}
                      </Button>
                    </HowToTooltip>
                  </div>

                  {/* Window Controls */}
                  <HowToTooltip title="Floating Window" description="Detach the brain map into a draggable, resizable overlay within the workspace.">
                    <Button
                      size="icon"
                      variant={windowMode === "floating" ? "default" : "outline"}
                      className="h-8 w-8"
                      onClick={() => setWindowMode(windowMode === "floating" ? "embedded" : "floating")}
                    >
                      <Maximize2 className="w-4 h-4" />
                    </Button>
                  </HowToTooltip>
                  <HowToTooltip title="External Window" description="Pop the brain map out into a completely separate browser window for multi-monitor setups.">
                    <Button
                      size="icon"
                      variant={windowMode === "external" ? "default" : "outline"}
                      className="h-8 w-8"
                      onClick={() => setWindowMode("external")}
                    >
                      <ExternalLink className="w-4 h-4" />
                    </Button>
                  </HowToTooltip>

                  {/* Remote-source indexing — feeds GitHub & integration sources
                      into the map's knowledge base for chat RAG. */}
                  {activeMap && hasRemoteSources && (
                    <HowToTooltip
                      title="Index Remote Sources"
                      description="Fetch the content of this map's connected remote sources (GitHub & integrations) and embed it into the map's knowledge base, so chat can ground answers in it. Runs automatically when a map opens; click to re-index."
                    >
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1.5 text-xs"
                        onClick={() => triggerIndex(true)}
                        disabled={isIndexing || !indexingOn}
                      >
                        {isIndexing
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : <Database className="w-3.5 h-3.5" />}
                        {!indexingOn
                          ? "Indexing off"
                          : isIndexing
                            ? (indexStatus?.state === "running"
                                ? `Indexing ${indexStatus.completedSources}/${indexStatus.totalSources}…`
                                : "Indexing…")
                            : indexStatus?.state === "done"
                              ? `Indexed · ${indexStatus.totalChunks} chunks`
                              : "Index"}
                      </Button>
                    </HowToTooltip>
                  )}
                </div>
              </div>

              <div className="flex-1 p-6 overflow-hidden relative">
                {viewMode === "graph" && (
                  <div className="absolute top-4 left-4 z-20">
                    <NeuralMapToolbar />
                  </div>
                )}
                <Card className="h-full flex flex-col overflow-hidden">
                  <CardContent className="flex-1 p-0 flex overflow-hidden relative">
                    {isLoading && !masterView ? (
                      <div className="flex-1 flex items-center justify-center text-muted-foreground animate-pulse">
                        Indexing Neural Network...
                      </div>
                    ) : !masterView && activeMap && displayNetwork.nodes.length === 0 ? (
                      <div className="flex-1 flex flex-col items-center justify-center text-center p-12 bg-muted/20">
                        <div className="h-12 w-12 rounded-full bg-primary/20 flex items-center justify-center mb-4">
                          <Brain className="h-6 w-6 text-primary" />
                        </div>
                        <h3 className="text-lg font-semibold mb-2">No indexed files yet</h3>
                        <p className="text-sm text-muted-foreground max-w-md">
                          &ldquo;{activeMap.name}&rdquo; has no mapped files. Add a project
                          directory in the Map Manager to visualize it as a neural network.
                        </p>
                      </div>
                    ) : (
                      <>
                        {windowMode === "embedded" ? (
                          <>
                            <span className="sr-only">
                              Use arrow keys to navigate nodes, Enter to select
                            </span>
                            <div
                              aria-label="Neural brain map visualization"
                              className="flex-1 flex overflow-hidden"
                            >
                              {viewMode === "graph" ? (
                                <NeuralGraphView
                                  network={displayNetwork}
                                  projectId={masterView ? "master" : (activeMap?.id ?? "demo")}
                                  onNodeClick={setSelectedNodeId}
                                  onRequestExpand={masterView ? undefined : handleRequestExpand}
                                />
                              ) : viewMode === "tree" ? (
                                <NeuralTreeView
                                  network={displayNetwork}
                                  onNodeClick={setSelectedNodeId}
                                  onRequestExpand={masterView ? undefined : handleRequestExpand}
                                />
                              ) : viewMode === "mcp3d" ? (
                                <div className="flex-1 w-full h-full relative bg-black/90">
                                  <iframe 
                                    src="http://localhost:9749" 
                                    className="w-full h-full border-0 absolute inset-0" 
                                    title="Codebase Memory MCP 3D Graph"
                                  />
                                  <div className="absolute top-4 left-4 bg-background/80 backdrop-blur text-foreground px-3 py-1.5 rounded-md text-xs border border-border shadow-md">
                                    <strong>Note:</strong> Codebase Memory MCP must be running for this view to work.
                                  </div>
                                </div>
                              ) : null}
                            </div>
                            <details className="absolute bottom-2 left-14 z-10 text-xs bg-card/90 border border-border rounded p-1">
                              <summary className="cursor-pointer text-muted-foreground select-none">Text view</summary>
                              <ul className="mt-1 h-40 overflow-y-auto space-y-0.5 pl-2">
                                {displayNetwork.nodes.map(n => (
                                  <li key={n.id} className="text-foreground font-mono text-[10px]">{n.label}</li>
                                ))}
                                {displayNetwork.nodes.length === 0 && (
                                  <li className="text-muted-foreground">No nodes</li>
                                )}
                              </ul>
                            </details>
                          </>
                        ) : (
                          <div className="flex-1 flex flex-col items-center justify-center text-center p-12 bg-muted/20">
                            <div className="h-12 w-12 rounded-full bg-primary/20 flex items-center justify-center mb-4">
                              <Anchor className="h-6 w-6 text-primary animate-pulse" />
                            </div>
                            <h3 className="text-lg font-semibold mb-2">Neural Map Detached</h3>
                            <p className="text-sm text-muted-foreground max-w-md">
                              The brain map is currently active in a {windowMode} window. 
                              Click the dock icon or the button below to bring it back.
                            </p>
                            <Button 
                              variant="outline" 
                              className="mt-6 border-primary/30 hover:bg-primary/10"
                              onClick={() => setWindowMode("embedded")}
                            >
                              Re-dock to Workspace
                            </Button>
                          </div>
                        )}
                      </>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* Right Sidebar: Properties or Fiction Controls (Collapsible) */}
          <ResizablePanel 
            defaultSize={25} 
            minSize={20} 
            maxSize={35} 
            className={cn(
              "border-l border-border transition-all duration-300 flex flex-col",
              rightSidebarCollapsed && "max-w-[40px] flex-shrink-0"
            )}
          >
            <div className="h-full flex flex-col">
               <div className="p-2 border-b border-border flex justify-start">
                <HowToTooltip title={rightSidebarCollapsed ? "Expand Inspector" : "Collapse Inspector"} description="View detailed properties for the selected node or adjust global map settings." side="left">
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-6 w-6" 
                    onClick={() => setRightSidebarCollapsed(!rightSidebarCollapsed)}
                  >
                    {rightSidebarCollapsed ? <PanelRightClose className="w-3.5 h-3.5 rotate-180" /> : <PanelRightOpen className="w-3.5 h-3.5 rotate-180" />}
                  </Button>
                </HowToTooltip>
              </div>
              
              {!rightSidebarCollapsed ? (
                <div className="min-h-0 flex-1 overflow-auto">
                  {isFictionMode ? (
                    <FictionModePanel />
                  ) : (
                    <div className="p-4 space-y-4">
                      <Card>
                        <CardHeader>
                          <CardTitle className="text-base flex items-center gap-2">
                            <Settings className="w-4 h-4" /> Map Properties
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3 text-sm">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">View:</span>
                            <span className="font-medium">
                              {masterView ? (
                                <Badge variant="default" className="text-[10px] px-1.5 bg-primary/80">Master ({maps.length} maps)</Badge>
                              ) : (
                                activeMap?.name || "Omnecor Demo"
                              )}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Nodes:</span>
                            <span className="font-mono text-primary">{displayNetwork.nodes.length}</span>
                          </div>
                          {activeMap ? (
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Realtime Sync:</span>
                              <Badge variant={activeMap.settings.realtimeSync ? "default" : "secondary"}>
                                {activeMap.settings.realtimeSync ? "On" : "Off"}
                              </Badge>
                            </div>
                          ) : (
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Status:</span>
                              <Badge variant="outline" className="text-primary border-primary/30 bg-primary/5">Read Only</Badge>
                            </div>
                          )}
                        </CardContent>
                      </Card>

                      {/* Project Peer Card — per-project context known by the AI */}
                      {activeMap && (
                        <Card>
                          <CardHeader className="pb-2">
                            <CardTitle className="text-base flex items-center justify-between">
                              <span className="flex items-center gap-2">
                                <Brain className="w-4 h-4" /> Project Context
                              </span>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-6 w-6"
                                onClick={() => setProjectCardEditing(v => !v)}
                                title={projectCardEditing ? "Done editing" : "Edit project context"}
                              >
                                {projectCardEditing
                                  ? <Filter className="w-3.5 h-3.5 text-primary" />
                                  : <Settings className="w-3.5 h-3.5" />}
                              </Button>
                            </CardTitle>
                            <CardDescription className="text-[10px]">
                              Project-specific context the AI knows in this map
                            </CardDescription>
                          </CardHeader>
                          <CardContent className="space-y-2 text-sm">
                            {projectCardEditing ? (
                              <div className="space-y-2">
                                <div>
                                  <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Description</label>
                                  <textarea
                                    className="w-full mt-0.5 px-2 py-1 text-xs rounded border bg-background resize-none"
                                    rows={2}
                                    placeholder="What is this project?"
                                    value={pc.description ?? ""}
                                    onChange={e => updateProjectCard("description", e.target.value)}
                                  />
                                </div>
                                <div>
                                  <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Tech Stack (comma-sep)</label>
                                  <input
                                    className="w-full mt-0.5 px-2 py-1 text-xs rounded border bg-background"
                                    placeholder="React, Node, Postgres..."
                                    value={(pc.techStack ?? []).join(", ")}
                                    onChange={e => updateProjectCard("techStack", e.target.value.split(",").map(s => s.trim()).filter(Boolean))}
                                  />
                                </div>
                                <div>
                                  <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Goals (comma-sep)</label>
                                  <input
                                    className="w-full mt-0.5 px-2 py-1 text-xs rounded border bg-background"
                                    placeholder="Ship v2, reduce latency..."
                                    value={(pc.goals ?? []).join(", ")}
                                    onChange={e => updateProjectCard("goals", e.target.value.split(",").map(s => s.trim()).filter(Boolean))}
                                  />
                                </div>
                                <div>
                                  <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Team (comma-sep)</label>
                                  <input
                                    className="w-full mt-0.5 px-2 py-1 text-xs rounded border bg-background"
                                    placeholder="Alice, Bob..."
                                    value={(pc.team ?? []).join(", ")}
                                    onChange={e => updateProjectCard("team", e.target.value.split(",").map(s => s.trim()).filter(Boolean))}
                                  />
                                </div>
                                <div>
                                  <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Notes</label>
                                  <textarea
                                    className="w-full mt-0.5 px-2 py-1 text-xs rounded border bg-background resize-none"
                                    rows={2}
                                    placeholder="Anything else the AI should know..."
                                    value={pc.notes ?? ""}
                                    onChange={e => updateProjectCard("notes", e.target.value)}
                                  />
                                </div>
                              </div>
                            ) : (
                              <div className="space-y-1.5">
                                {pc.description ? (
                                  <p className="text-xs text-muted-foreground">{pc.description}</p>
                                ) : (
                                  <p className="text-xs text-muted-foreground italic">No project context yet — click ⚙ to add</p>
                                )}
                                {(pc.techStack ?? []).length > 0 && (
                                  <div className="flex flex-wrap gap-1">
                                    {pc.techStack!.map(t => (
                                      <span key={t} className="text-[10px] bg-primary/10 text-primary px-1.5 rounded">{t}</span>
                                    ))}
                                  </div>
                                )}
                                {(pc.goals ?? []).length > 0 && (
                                  <ul className="text-[10px] text-muted-foreground list-disc list-inside">
                                    {pc.goals!.map(g => <li key={g}>{g}</li>)}
                                  </ul>
                                )}
                              </div>
                            )}
                            {/* Peer context preview — what the AI will see */}
                            {(userCard.displayName || pc.description) && !projectCardEditing && (
                              <details className="mt-1">
                                <summary className="text-[10px] text-muted-foreground cursor-pointer hover:text-foreground">
                                  AI context preview
                                </summary>
                                <pre className="text-[9px] mt-1 p-1.5 rounded bg-muted overflow-auto max-h-24 whitespace-pre-wrap break-words">
                                  {`You are assisting: ${userCard.displayName || "?"} (${userCard.role || "?"})${pc.description ? `\nProject: ${pc.description}` : ""}${(pc.techStack ?? []).length ? `\nStack: ${pc.techStack!.join(", ")}` : ""}`}
                                </pre>
                              </details>
                            )}
                          </CardContent>
                        </Card>
                      )}

                      <Card>
                        <CardHeader>
                          <CardTitle className="text-base">Node Inspector</CardTitle>
                        </CardHeader>
                        <CardContent>
                          {selectedNode ? (
                            <div className="space-y-3 text-sm">
                              {/* Name (editable) */}
                              <div className="flex flex-col gap-1">
                                <span className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Name</span>
                                {editingLabel ? (
                                  <div className="flex gap-1">
                                    <input
                                      className="flex-1 text-sm font-mono bg-muted border border-primary/30 rounded px-2 py-0.5 outline-none"
                                      value={labelDraft}
                                      onChange={e => setLabelDraft(e.target.value)}
                                      onKeyDown={e => {
                                        if (e.key === "Enter") saveLabel();
                                        if (e.key === "Escape") { setEditingLabel(false); }
                                      }}
                                      autoFocus
                                    />
                                    <Button size="sm" variant="default" className="h-7 px-2 text-xs" onClick={saveLabel}>Save</Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 px-2 text-xs"
                                      onClick={() => {
                                        if (!activeMap || !selectedNode) return;
                                        updateMap(activeMap.id, {
                                          labelOverrides: Object.fromEntries(
                                            Object.entries(activeMap.labelOverrides ?? {}).filter(([k]) => k !== selectedNode.id)
                                          ),
                                        });
                                        setEditingLabel(false);
                                      }}
                                    >Reset</Button>
                                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setEditingLabel(false)}>✕</Button>
                                  </div>
                                ) : (
                                  <button
                                    className="text-left font-mono break-all hover:text-primary transition-colors group flex items-center gap-1"
                                    onClick={() => {
                                      setLabelDraft(activeMap?.labelOverrides?.[selectedNode.id] ?? selectedNode.label);
                                      setEditingLabel(true);
                                    }}
                                    title="Click to edit label"
                                  >
                                    {activeMap?.labelOverrides?.[selectedNode.id] ?? selectedNode.label}
                                    <Pencil className="w-3 h-3 opacity-0 group-hover:opacity-50 transition-opacity" />
                                  </button>
                                )}
                              </div>
                              {/* Type */}
                              <div className="flex flex-col gap-1">
                                <span className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Type</span>
                                <Badge className="w-fit capitalize">{selectedNode.type}</Badge>
                              </div>
                              {/* Path */}
                              <div className="flex flex-col gap-1">
                                <span className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Path</span>
                                <span className="font-mono text-[10px] break-all bg-muted p-1 rounded">
                                  {selectedNode.data?.path}
                                </span>
                              </div>
                              {/* Auto-generated description */}
                              <div className="flex flex-col gap-1">
                                <span className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Description</span>
                                <p className="text-[11px] text-foreground/80 leading-relaxed bg-muted/50 rounded p-1.5">
                                  {getNodeDescription(selectedNode.label, selectedNode.type, selectedNode.data?.fileCount)}
                                </p>
                              </div>
                              {/* Folder contents */}
                              {(selectedNode.type === "folder" || selectedNode.type === "project") && (() => {
                                const children = displayNetwork.nodes.filter(n =>
                                  displayNetwork.edges.some(e => e.source === selectedNode.id && e.target === n.id)
                                );
                                if (children.length === 0) return null;
                                return (
                                  <div className="flex flex-col gap-1">
                                    <span className="text-xs text-muted-foreground uppercase font-bold tracking-wider flex items-center gap-1">
                                      <FolderOpen className="w-3 h-3" /> Contents ({children.length})
                                    </span>
                                    <div className="h-32 overflow-y-auto overflow-x-hidden rounded border border-border/50 bg-muted/20">
                                      <ul className="p-1 space-y-0.5">
                                        {children.map(child => (
                                          <li
                                            key={child.id}
                                            className="flex items-center gap-1.5 px-1.5 py-1 rounded hover:bg-primary/10 cursor-pointer text-[10px] font-mono"
                                            onClick={() => setSelectedNodeId(child.id)}
                                          >
                                            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${child.type === "folder" ? "bg-primary" : "bg-accent-success"}`} />
                                            <span className="truncate">{child.label}</span>
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  </div>
                                );
                              })()}
                              {/* Add to context */}
                              {selectedNode.type !== "project" && selectedNode.type !== "integration" && (
                                <Button
                                  size="sm"
                                  variant={inContext(makeEntry(selectedNode.data?.path ?? "", selectedNode.label, selectedNode.type as "file" | "folder").id) ? "secondary" : "outline"}
                                  className="w-full h-7 text-xs gap-1.5 mt-1"
                                  onClick={() => {
                                    const entry = makeEntry(selectedNode.data?.path ?? "", selectedNode.label, selectedNode.type as "file" | "folder");
                                    if (inContext(entry.id)) {
                                      removeFromContext(entry.id);
                                    } else {
                                      addToContext(entry);
                                      toast.success(`"${selectedNode.label}" added to context`);
                                    }
                                  }}
                                >
                                  {inContext(makeEntry(selectedNode.data?.path ?? "", selectedNode.label, selectedNode.type as "file" | "folder").id)
                                    ? "✓ In context — click to remove"
                                    : "+ Add to AI context"}
                                </Button>
                              )}
                            </div>
                          ) : (
                            <div className="p-8 rounded-lg border border-dashed border-border flex items-center justify-center text-muted-foreground text-xs text-center">
                              Select a node in the graph to view its cognitive properties
                            </div>
                          )}
                        </CardContent>
                      </Card>

                      {/* Context Drop Zone */}
                      <Card>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-base flex items-center justify-between">
                            <span className="flex items-center gap-2">
                              <Zap className="w-4 h-4 text-primary" /> AI Context Files
                            </span>
                            {contextEntries.length > 0 && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 text-[10px] text-muted-foreground hover:text-destructive px-2"
                                onClick={() => useNeuralContextStore.getState().clear()}
                              >
                                Clear all
                              </Button>
                            )}
                          </CardTitle>
                          <CardDescription className="text-[10px]">
                            These files are injected into every AI message. Drag nodes here or use the inspector.
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-2">
                          {/* Drop zone */}
                          <div
                            onDragOver={(e) => {
                              if (e.dataTransfer.types.includes(NEURAL_DRAG_KEY)) {
                                e.preventDefault();
                                e.dataTransfer.dropEffect = "copy";
                                setDropZoneActive(true);
                              }
                            }}
                            onDragLeave={() => setDropZoneActive(false)}
                            onDrop={(e) => {
                              e.preventDefault();
                              setDropZoneActive(false);
                              const raw = e.dataTransfer.getData(NEURAL_DRAG_KEY);
                              if (!raw) return;
                              try {
                                const entry = JSON.parse(raw);
                                addToContext(entry);
                                toast.success(`"${entry.name}" added to context`);
                              } catch {
                                toast.error("Invalid drop payload");
                              }
                            }}
                            className={cn(
                              "rounded-lg border-2 border-dashed transition-all duration-200 flex items-center justify-center text-xs text-center min-h-[60px] p-3",
                              dropZoneActive
                                ? "border-primary/30 bg-primary/10 text-primary"
                                : "border-border/50 text-muted-foreground"
                            )}
                          >
                            {dropZoneActive ? (
                              <span className="font-semibold animate-pulse">Drop to add to context</span>
                            ) : (
                              <span>Drag file nodes here<br /><span className="text-[10px] opacity-60">or use the ⋮⋮ grip on any node</span></span>
                            )}
                          </div>

                          {/* Current context entries */}
                          {contextEntries.length > 0 && (
                            <div className="h-52 overflow-y-auto overflow-x-hidden mt-1">
                              <ul className="space-y-1 pr-0.5">
                                {contextEntries.map(entry => (
                                  <li
                                    key={entry.id}
                                    className="flex items-center gap-2 px-2 py-1.5 rounded bg-accent-success/10 border border-accent-success/20 group"
                                  >
                                    <span className={cn(
                                      "w-1.5 h-1.5 rounded-full flex-shrink-0",
                                      entry.nodeType === "folder" ? "bg-primary" : "bg-accent-success"
                                    )} />
                                    <span className="flex-1 text-[10px] font-mono truncate text-foreground">
                                      {entry.name}
                                    </span>
                                    <button
                                      onClick={() => removeFromContext(entry.id)}
                                      className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                                      title="Remove from context"
                                    >
                                      <XIcon className="w-3 h-3" />
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {contextEntries.length > 0 && (
                            <p className="text-[10px] text-accent-success flex items-center gap-1 mt-1">
                              <Zap className="w-3 h-3" />
                              {contextEntries.length} file{contextEntries.length !== 1 ? "s" : ""} active in AI context
                            </p>
                          )}
                        </CardContent>
                      </Card>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center pt-8 gap-6 text-muted-foreground select-none">
                   <Settings className="w-4 h-4 opacity-50" />
                   <div className="[writing-mode:vertical-lr] text-[9px] font-bold uppercase tracking-widest opacity-30">
                     Inspector
                   </div>
                </div>
              )}
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </OmnecorDashboardLayout>
  );
}

export function BrainMap() {
  return <NeuralMapWrapper />;
}

/**
 * Wrapper to access NeuralMapContext for FictionModeProvider
 */
function NeuralMapWrapper() {
  const { activeMapId, activeMap, updateMap } = useNeuralMap();

  const handleFictionStateChange = useCallback((mapId: string, state: FictionState) => {
    if (!activeMap || activeMap.id !== mapId) return;
    updateMap(mapId, {
      settings: { ...activeMap.settings, fictionState: state as unknown as Record<string, unknown> },
    });
  }, [activeMap, updateMap]);

  return (
    <FictionModeProvider
      mapId={activeMapId || undefined}
      dbFictionState={activeMap?.settings.fictionState as FictionState | undefined}
      onFictionStateChange={handleFictionStateChange}
    >
      <BrainMapContent />
    </FictionModeProvider>
  );
}
