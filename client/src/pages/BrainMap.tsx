import OmnecorDashboardLayout from "@/components/OmnecorDashboardLayout";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Brain, Grid3x3, List, Settings, Shield, Maximize2, Anchor, ExternalLink, PanelRightClose, PanelRightOpen, Palette, Layers, Activity, Filter, Zap, X as XIcon, Pencil, Lock, LockOpen, Map, MessageSquare, FolderOpen } from "lucide-react";
import { useState, useMemo, useEffect, useCallback } from "react";
import NeuralGraphView, { BrainMapViewport } from "@/components/neural/NeuralGraphView";
import NeuralTreeView from "@/components/neural/NeuralTreeView";
import MapManager from "@/components/neural/MapManager";
import FictionModePanel from "@/components/neural/FictionModePanel";
import { FloatingWindow } from "@/components/window-system/FloatingWindow";
import { useBrainMapStore } from "@/lib/stores/brainMapStore";
import { useAppStore } from "@/lib/store/app.store";
import { trpc } from "@/lib/trpc";
import { fileTreeToNetwork } from "@/lib/fileTreeToNetwork";
import { generateOmnecorProjectMock } from "@/lib/demoProject";
import { convertFileSystemToNeuralNetwork, buildMasterNetwork, type NeuralNetwork, type NeuralNode } from "@/lib/neuralNodeTree";
import { NeuralMapProvider, useNeuralMap } from "@/contexts/NeuralMapContext";
import { FictionModeProvider, useFictionMode } from "@/contexts/FictionModeContext";
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
import { useVisualControlStore } from "@/lib/stores/visualControlStore";

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

  const lockKey = `${brainProjectId}:${layout}`;
  const locked = isLayoutLocked(lockKey);

  return (
    <Card className={cn(
      "shadow-lg border-accent/20 bg-background/95 backdrop-blur-md transition-all duration-300",
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
                <span className="w-3 h-3 rounded-full bg-blue-500 flex-shrink-0" />
                <span className="text-muted-foreground">Folder</span>
              </div>
              <div className="flex items-center gap-2 text-[11px]">
                <span className="w-3 h-3 rounded-full bg-green-500 flex-shrink-0" />
                <span className="text-muted-foreground">File</span>
              </div>
              <div className="flex items-center gap-2 text-[11px]">
                <span className="w-3 h-3 rounded-full bg-purple-500 flex-shrink-0" />
                <span className="text-muted-foreground">Project</span>
              </div>
              <div className="flex items-center gap-2 text-[11px]">
                <span className="w-3 h-3 rounded-full bg-emerald-400 flex-shrink-0" />
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
              <Select value={layout} onValueChange={(v) => setLayout(v as typeof layout)}>
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
                  className={cn("h-8 w-8 flex-shrink-0", locked && "bg-amber-500/20 border-amber-500/50 text-amber-400 hover:bg-amber-500/30")}
                  onClick={() => {
                    if (locked) {
                      unlockLayout(lockKey);
                      toast.success(`"${layout}" layout unlocked — will auto-arrange on next switch.`);
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
              <p className="text-[10px] text-amber-400 flex items-center gap-1">
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
                onValueChange={([v]) => setNodeSize(v)}
                min={5}
                max={30}
                step={1}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-[10px] text-muted-foreground">GPU Acceleration</Label>
              <Switch checked={gpuEnabled} onCheckedChange={setGpuEnabled} />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-[10px] text-muted-foreground flex items-center gap-1.5">
                <Map className="w-3 h-3" /> Mini Map
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
                onValueChange={([v]) => setSimSpeed(v)}
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
              <Switch checked={autoClustering} onCheckedChange={setAutoClustering} />
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

/**
 * Neural Brain Map Page Content
 * Extracted to use contexts provided in the main BrainMap export
 */
function BrainMapContent() {
  const [viewMode, setViewMode] = useState<"graph" | "tree">("graph");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const { maps, activeMap, updateMap } = useNeuralMap();
  const { setFictionMode, isFictionMode } = useFictionMode();
  const [masterView, setMasterView] = useState(false);
  const { card: userCard } = useUserPeerCard();

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

  const isLoading = fileTreeQueries.some(q => q.isLoading);
  const loadedCount = fileTreeQueries.filter(q => !!q.data).length;

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

  const neuralNetwork = useMemo(() => {
    if (!activeMap) {
      return convertFileSystemToNeuralNetwork(generateOmnecorProjectMock(), "Omnecor Workspace");
    }

    const loadedTrees = fileTreeQueries.map(q => q.data).filter(Boolean);

    if (loadedTrees.length === 0) {
      return convertFileSystemToNeuralNetwork(generateOmnecorProjectMock(), "Omnecor Workspace");
    }

    // Build one network per local root and merge them
    const networks = loadedTrees.map((tree, i) =>
      fileTreeToNetwork(tree!, {
        projectId: `${activeMap.id}:${i}`,
        projectName: localRoots[i]
          ? localRoots[i].split("/").pop() ?? activeMap.name
          : activeMap.name,
      })
    );

    // Represent remote sources as placeholder root nodes in the graph
    const remoteNodes: NeuralNode[] = remoteRoots.map(r => ({
      id: `remote:${r}`,
      label: r.replace("github://", "🐙 ").replace("integration://gmail", "✉️ Gmail").replace("integration://outlook", "📧 Outlook").replace("integration://", ""),
      type: "integration" as const,
      data: { path: r, isRemote: true, depth: 0 },
      position: { x: 0, y: 0 },
    }));

    return {
      id: activeMap.id,
      name: activeMap.name,
      type: "project" as const,
      nodes: [...networks.flatMap(n => n.nodes), ...remoteNodes],
      edges: networks.flatMap(n => n.edges),
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMap?.id, loadedCount, localRoots.join(","), remoteRoots.join(",")]);

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
      <div className="h-full flex flex-col bg-background overflow-hidden relative">
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
              <div className="border-b border-border bg-card px-6 py-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Brain className="w-6 h-6 text-accent" />
                  <div>
                    <h1 className="text-xl font-bold flex items-center gap-2">
                      {activeMap?.name ?? "Omnecor Workspace"}
                      {isFictionMode && (
                        <Badge variant="outline" className="text-accent border-accent text-[10px] py-0">
                          Fiction Mode
                        </Badge>
                      )}
                      {!activeMap && (
                        <Badge variant="secondary" className="text-[10px] py-0 bg-accent/10 text-accent border-accent/20">
                          Preview Mode
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
                  <div className="flex bg-muted rounded-md p-1 mr-4">
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
                          masterView && "bg-accent text-accent-foreground"
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
                                />
                              ) : (
                                <NeuralTreeView
                                  network={displayNetwork}
                                  onNodeClick={setSelectedNodeId}
                                />
                              )}
                            </div>
                            <details className="absolute bottom-2 left-2 z-10 text-xs bg-card/90 border border-border rounded p-1">
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
                            <div className="h-12 w-12 rounded-full bg-accent/20 flex items-center justify-center mb-4">
                              <Anchor className="h-6 w-6 text-accent animate-pulse" />
                            </div>
                            <h3 className="text-lg font-semibold mb-2">Neural Map Detached</h3>
                            <p className="text-sm text-muted-foreground max-w-md">
                              The brain map is currently active in a {windowMode} window. 
                              Click the dock icon or the button below to bring it back.
                            </p>
                            <Button 
                              variant="outline" 
                              className="mt-6 border-accent/30 hover:bg-accent/10"
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
                                <Badge variant="default" className="text-[10px] px-1.5 bg-accent/80">Master ({maps.length} maps)</Badge>
                              ) : (
                                activeMap?.name || "Omnecor Demo"
                              )}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Nodes:</span>
                            <span className="font-mono text-accent">{displayNetwork.nodes.length}</span>
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
                              <Badge variant="outline" className="text-accent border-accent/30 bg-accent/5">Read Only</Badge>
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
                                  ? <Filter className="w-3.5 h-3.5 text-accent" />
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
                                      <span key={t} className="text-[10px] bg-accent/10 text-accent px-1.5 rounded">{t}</span>
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
                                      className="flex-1 text-sm font-mono bg-muted border border-accent rounded px-2 py-0.5 outline-none"
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
                                    className="text-left font-mono break-all hover:text-accent transition-colors group flex items-center gap-1"
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
                                            className="flex items-center gap-1.5 px-1.5 py-1 rounded hover:bg-accent/10 cursor-pointer text-[10px] font-mono"
                                            onClick={() => setSelectedNodeId(child.id)}
                                          >
                                            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${child.type === "folder" ? "bg-blue-500" : "bg-green-500"}`} />
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
                              <Zap className="w-4 h-4 text-accent" /> AI Context Files
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
                                ? "border-accent bg-accent/10 text-accent"
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
                                    className="flex items-center gap-2 px-2 py-1.5 rounded bg-emerald-500/10 border border-emerald-500/20 group"
                                  >
                                    <span className={cn(
                                      "w-1.5 h-1.5 rounded-full flex-shrink-0",
                                      entry.nodeType === "folder" ? "bg-blue-400" : "bg-emerald-400"
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
                            <p className="text-[10px] text-emerald-400 flex items-center gap-1 mt-1">
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

export default function BrainMap() {
  return <NeuralMapWrapper />;
}

/**
 * Wrapper to access NeuralMapContext for FictionModeProvider
 */
function NeuralMapWrapper() {
  const { activeMapId } = useNeuralMap();
  return (
    <FictionModeProvider mapId={activeMapId || undefined}>
      <BrainMapContent />
    </FictionModeProvider>
  );
}
