/**
 * Enhanced PCB/Schematic Editor
 *
 * Features:
 * - Server-backed project persistence (auto-create + auto-save + load)
 * - Project selector in toolbar (switch/create projects)
 * - Drag-and-drop components from library panel onto canvas
 * - Click-to-add components from library panel
 * - Undo/redo with keyboard shortcuts (Ctrl+Z / Ctrl+Shift+Z)
 * - Multi-select with Ctrl+click
 * - Delete key removes selected nodes
 * - Ctrl+S saves immediately
 */

import React, { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import { useNeuralMap } from '@/contexts/NeuralMapContext';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  Edge,
  Node,
  NodeTypes,
  EdgeTypes,
  useReactFlow,
  ReactFlowProvider,
  ControlButton,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { RotateCw, FolderOpen, Plus, ChevronDown, Save, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

import { SchematicNode } from './SchematicNode';
import { PCBNode } from './PCBNode';
import { CustomEdge } from './CustomEdge';
import { EditorToolbar } from './EditorToolbar';
import { ComponentLibraryPanel } from './ComponentLibraryPanel';
import { PropertiesPanel } from './PropertiesPanel';
import { AIAssistantPanel } from './AIAssistantPanel';
import { NetlistPanel } from './NetlistPanel';
import { trpc } from '@/lib/trpc';
import { componentLibrary } from '@/lib/componentLibrary';
import { toast } from 'sonner';
import { useDesignerStore } from '@/lib/stores/designerStore';
import { HowToTooltip } from "@/components/shell/HowToTooltip";

// Stable empty-array default — inline `= []` creates a new reference every render → infinite loop. See TD-046.
const EMPTY_PROJECTS: { id: number; name: string; mode: string }[] = [];

// ─── Types ───────────────────────────────────────────────────────────────────

interface HistoryState {
  nodes: Node[];
  edges: Edge[];
}

// ─── Inner component (requires ReactFlowProvider above) ───────────────────────

interface EnhancedPCBEditorProps {
  onAIToggle?: (isOpen: boolean) => void;
}

const EnhancedPCBEditorInner: React.FC<EnhancedPCBEditorProps> = ({ onAIToggle }) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  // Selector — unselectored useDesignerStore() re-renders on every set(), causing an infinite loop. See TD-046.
  const setActivePCBContext = useDesignerStore((s) => s.setActivePCBContext);

  // Canvas state
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const { getNodes, getEdges, fitView, project } = useReactFlow();

  // Editor settings
  const [mode, setMode] = useState<'schematic' | 'pcb'>('schematic');
  const [gridVisible, setGridVisible] = useState(true);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [gridSize] = useState(20);
  const [showMiniMap, setShowMiniMap] = useState(true);

  // UI panels
  const [showLibrary, setShowLibrary] = useState(true);
  const [showProperties, setShowProperties] = useState(true);
  const [showAI, setShowAI] = useState(false);
  const [showNetlist, setShowNetlist] = useState(false);

  useEffect(() => {
    if (onAIToggle) onAIToggle(showAI);
  }, [showAI, onAIToggle]);

  // Reset parent state when this component unmounts (e.g. mode switch away from PCB),
  // so the parent's isAIPanelOpen doesn't linger and hide unrelated UI (3D Ask AI button).
  useEffect(() => {
    return () => { onAIToggle?.(false); };
  }, [onAIToggle]);

  // Undo/redo
  const [historyIndex, setHistoryIndex] = useState(-1);
  const historyRef = useRef<HistoryState[]>([]);

  // Save state
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  // Suppresses the redundant auto-save that fires immediately after loading a design
  const suppressAutoSaveRef = useRef(false);
  // Always-current refs so the auto-save timeout never captures a stale project/mode
  const pcbProjectIdRef = useRef<number | null>(null);
  const modeRef = useRef<'schematic' | 'pcb'>('schematic');

  // ── Project management ────────────────────────────────────────────────────

  const [pcbProjectId, setPcbProjectId] = useState<number | null>(null);
  const [showProjectDropdown, setShowProjectDropdown] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [showNewProjectInput, setShowNewProjectInput] = useState(false);
  const autoCreatedRef = useRef(false);
  const loadedProjectRef = useRef<number | null>(null);
  const projectDropdownRef = useRef<HTMLDivElement>(null);

  const trpcUtils = trpc.useUtils();

  // Active neural map — new PCB projects are linked to it so they scope to the
  // current map (the mobile viewer filters projects by mapId).
  const { activeMapId } = useNeuralMap();

  const { data: pcbProjects = EMPTY_PROJECTS, isLoading: projectsLoading } = trpc.pcbEditor.getProjects.useQuery(undefined, {
    staleTime: 30_000,
  });

  const createProjectMutation = trpc.pcbEditor.createProject.useMutation({
    onSuccess: (proj) => {
      trpcUtils.pcbEditor.getProjects.invalidate();
      setPcbProjectId(proj.id);
      toast.success(`Project "${proj.name}" created`);
    },
    onError: (err) => toast.error('Failed to create project: ' + err.message),
  });

  // Auto-select first project when projects load
  useEffect(() => {
    if (pcbProjectId !== null) return;
    if (pcbProjects.length > 0) {
      setPcbProjectId(pcbProjects[0].id);
    }
  }, [pcbProjects, pcbProjectId]);

  // Auto-create "Default Design" if user has no projects yet.
  // Guard on !projectsLoading so we never fire during the initial mount frame
  // (which overlaps with ThreeViewer's R3F Canvas cleanup and causes a React
  // "maximum update depth exceeded" error on first boot).
  useEffect(() => {
    if (autoCreatedRef.current) return;
    if (!projectsLoading && pcbProjects.length === 0 && pcbProjectId === null) {
      autoCreatedRef.current = true;
      createProjectMutation.mutate({ name: 'Default Design', mode: 'schematic', mapId: activeMapId ?? undefined });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pcbProjects, projectsLoading]);

  // Close project dropdown on outside click
  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (projectDropdownRef.current && !projectDropdownRef.current.contains(e.target as Element)) {
        setShowProjectDropdown(false);
        setShowNewProjectInput(false);
        setNewProjectName('');
      }
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  // ── Design load / auto-save ───────────────────────────────────────────────

  const saveDesignMutation = trpc.pcbEditor.saveDesign.useMutation({
    onSuccess: () => { setIsDirty(false); setLastSavedAt(new Date()); },
    onError: (err) => toast.error('Failed to save: ' + err.message),
  });

  const latestDesignQuery = trpc.pcbEditor.getLatestDesign.useQuery(
    { projectId: pcbProjectId! },
    {
      enabled: !!pcbProjectId,
      staleTime: Infinity,
      refetchOnWindowFocus: false,
    }
  );

  // Keep refs current so the auto-save timeout never reads a stale project/mode
  useEffect(() => { pcbProjectIdRef.current = pcbProjectId; }, [pcbProjectId]);
  useEffect(() => { modeRef.current = mode; }, [mode]);

  // Reset canvas when active project switches.
  // Skip setNodes/setEdges when already empty — avoids spurious state updates
  // that compound with R3F cleanup renders on first boot.
  useEffect(() => {
    if (pcbProjectId !== null && loadedProjectRef.current !== pcbProjectId) {
      const currentNodes = getNodes();
      const currentEdges = getEdges();
      if (currentNodes.length > 0) setNodes([]);
      if (currentEdges.length > 0) setEdges([]);
      historyRef.current = [];
      setHistoryIndex(-1);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pcbProjectId]);

  // Load design into canvas once per project
  useEffect(() => {
    if (!latestDesignQuery.data || loadedProjectRef.current === pcbProjectId) return;
    loadedProjectRef.current = pcbProjectId;
    const design = latestDesignQuery.data;
    try {
      const canvasData =
        typeof design.canvasData === 'string'
          ? JSON.parse(design.canvasData as string)
          : (design.canvasData as { nodes: Node[]; edges: Edge[]; metadata?: { mode?: string } });
      suppressAutoSaveRef.current = true;
      if (canvasData?.nodes) setNodes(canvasData.nodes);
      if (canvasData?.edges) setEdges(canvasData.edges);
      if (canvasData?.metadata?.mode) setMode(canvasData.metadata.mode as 'schematic' | 'pcb');
    } catch {
      // malformed saved data — start fresh
    }
  }, [latestDesignQuery.data, pcbProjectId, setNodes, setEdges]);

  // Auto-save 1.5s after any node/edge change.
  // suppressAutoSaveRef prevents a redundant write immediately after loading a design.
  // Reads pcbProjectIdRef/modeRef (not closed-over state) so a mid-debounce project
  // switch never saves canvas data to the wrong project.
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!pcbProjectId) return;
    if (suppressAutoSaveRef.current) {
      suppressAutoSaveRef.current = false;
      return;
    }
    setIsDirty(true);
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      const projectId = pcbProjectIdRef.current;
      if (!projectId) return;
      saveDesignMutation.mutate({
        projectId,
        name: `Autosave ${new Date().toLocaleString()}`,
        canvasData: { nodes, edges, metadata: { mode: modeRef.current } },
      });
    }, 1500);
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges]);

  // Compute PCB dimensions/context for the global store
  useEffect(() => {
    if (!pcbProjectIdRef.current || nodes.length === 0) {
      setActivePCBContext(null);
      return;
    }
    
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const comps: string[] = [];
    
    nodes.forEach(n => {
      if (n.position.x < minX) minX = n.position.x;
      if (n.position.x > maxX) maxX = n.position.x;
      if (n.position.y < minY) minY = n.position.y;
      if (n.position.y > maxY) maxY = n.position.y;
      
      const d = (n.data ?? {}) as Record<string, unknown>;
      const ref = String(d.reference ?? d.ref ?? d.name ?? d.label ?? n.id);
      comps.push(ref);
    });
    
    const width = Math.round(maxX - minX + 50); // Approximate padding
    const height = Math.round(maxY - minY + 50);
    const projectName = pcbProjects.find(p => p.id === pcbProjectIdRef.current)?.name || "Unknown";
    
    const contextStr = `PCB Project: ${projectName}\nDimensions (approx units): ${width}W x ${height}H\nComponents (${comps.length}): ${comps.join(", ")}`;
    setActivePCBContext(contextStr);
  }, [nodes, pcbProjects, setActivePCBContext]);

  // ── Node types / edge types ───────────────────────────────────────────────

  const nodeTypes: NodeTypes = useMemo(
    () => ({ schematic: SchematicNode, pcb: PCBNode }),
    []
  );

  const edgeTypes: EdgeTypes = useMemo(
    () => ({ custom: CustomEdge }),
    []
  );

  // ── History ───────────────────────────────────────────────────────────────

  const addToHistory = useCallback(() => {
    const currentState: HistoryState = { nodes: getNodes(), edges: getEdges() };
    const newHistory = historyRef.current.slice(0, historyIndex + 1);
    newHistory.push(currentState);
    historyRef.current = newHistory;
    setHistoryIndex(newHistory.length - 1);
  }, [historyIndex, getNodes, getEdges]);

  const handleUndo = useCallback(() => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      const state = historyRef.current[newIndex];
      if (state) {
        setNodes([...state.nodes]);
        setEdges([...state.edges]);
        setHistoryIndex(newIndex);
      }
    }
  }, [historyIndex, setNodes, setEdges]);

  const handleRedo = useCallback(() => {
    if (historyIndex < historyRef.current.length - 1) {
      const newIndex = historyIndex + 1;
      const state = historyRef.current[newIndex];
      if (state) {
        setNodes([...state.nodes]);
        setEdges([...state.edges]);
        setHistoryIndex(newIndex);
      }
    }
  }, [historyIndex, setNodes, setEdges]);

  // ── Canvas operations ─────────────────────────────────────────────────────

  const handleAddComponent = useCallback(
    (componentId: string, position: { x: number; y: number }) => {
      const component = componentLibrary.find(c => c.id === componentId);
      if (!component) return;
      const newNode: Node = {
        id: `node-${Date.now()}`,
        type: mode === 'schematic' ? 'schematic' : 'pcb',
        position,
        data: {
          component,
          reference: `U${nodes.length + 1}`,
          value: '',
          rotation: 0,
          layer: 'top',
          isSelected: false,
        },
      };
      setNodes((nds) => [...nds, newNode]);
      addToHistory();
    },
    [mode, nodes.length, setNodes, addToHistory]
  );

  const handleDeleteNodes = useCallback(() => {
    if (selectedNodeIds.length === 0) return;
    setNodes((nds) => nds.filter((n) => !selectedNodeIds.includes(n.id)));
    setEdges((eds) =>
      eds.filter(
        (e) =>
          !selectedNodeIds.includes(e.source) && !selectedNodeIds.includes(e.target)
      )
    );
    setSelectedNodeIds([]);
    addToHistory();
  }, [selectedNodeIds, setNodes, setEdges, addToHistory]);

  const handleRotateNode = useCallback(
    (angle: number) => {
      if (selectedNodeIds.length === 0) return;
      setNodes((nds) =>
        nds.map((n) =>
          selectedNodeIds.includes(n.id)
            ? { ...n, data: { ...n.data, rotation: ((n.data.rotation || 0) + angle) % 360 } }
            : n
        )
      );
      addToHistory();
    },
    [selectedNodeIds, setNodes, addToHistory]
  );

  const handleFlipNode = useCallback(
    (direction: 'horizontal' | 'vertical') => {
      if (selectedNodeIds.length === 0) return;
      setNodes((nds) =>
        nds.map((n) =>
          selectedNodeIds.includes(n.id)
            ? {
                ...n,
                data: {
                  ...n.data,
                  flipped: { ...n.data.flipped, [direction]: !n.data.flipped?.[direction] },
                },
              }
            : n
        )
      );
      addToHistory();
    },
    [selectedNodeIds, setNodes, addToHistory]
  );

  const handleRotateCanvas = useCallback(() => {
    if (!nodes.length) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    nodes.forEach((n) => {
      if (n.position.x < minX) minX = n.position.x;
      if (n.position.x > maxX) maxX = n.position.x;
      if (n.position.y < minY) minY = n.position.y;
      if (n.position.y > maxY) maxY = n.position.y;
    });
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    setNodes(
      nodes.map((n) => ({
        ...n,
        position: { x: cx - (n.position.y - cy), y: cy + (n.position.x - cx) },
      }))
    );
    addToHistory();
    requestAnimationFrame(() => fitView({ duration: 400, padding: 0.2 }));
    toast.success('Rotated layout 90°');
  }, [nodes, setNodes, fitView, addToHistory]);

  const handleSaveDesign = useCallback(async () => {
    if (!pcbProjectId) {
      toast.error('No project selected');
      return;
    }
    setIsSaving(true);
    try {
      await saveDesignMutation.mutateAsync({
        projectId: pcbProjectId,
        name: `Design ${new Date().toLocaleString()}`,
        canvasData: { nodes: getNodes(), edges: getEdges(), metadata: { mode } },
      });
      toast.success('Design saved');
      addToHistory();
    } finally {
      setIsSaving(false);
    }
  }, [pcbProjectId, saveDesignMutation, getNodes, getEdges, mode, addToHistory]);

  // ── Drag-and-drop onto canvas ─────────────────────────────────────────────

  const reactFlowWrapperRef = useRef<HTMLDivElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const componentId = e.dataTransfer.getData('componentId');
      if (!componentId || !reactFlowWrapperRef.current) return;

      const bounds = reactFlowWrapperRef.current.getBoundingClientRect();
      const position = project({
        x: e.clientX - bounds.left,
        y: e.clientY - bounds.top,
      });

      handleAddComponent(componentId, position);
    },
    [project, handleAddComponent]
  );

  // ── Keyboard shortcuts ────────────────────────────────────────────────────

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key === 'z') {
        e.preventDefault();
        e.shiftKey ? handleRedo() : handleUndo();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        // Only delete if canvas is focused (not inside an input)
        if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;
        e.preventDefault();
        handleDeleteNodes();
      } else if (ctrl && e.key === 's') {
        e.preventDefault();
        handleSaveDesign();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleUndo, handleRedo, handleDeleteNodes, handleSaveDesign]);

  // ── Selection ─────────────────────────────────────────────────────────────

  const handleNodeClick = useCallback((event: React.MouseEvent, node: Node) => {
    if (event.ctrlKey || event.metaKey) {
      setSelectedNodeIds((prev) =>
        prev.includes(node.id) ? prev.filter((id) => id !== node.id) : [...prev, node.id]
      );
    } else {
      setSelectedNodeIds([node.id]);
    }
  }, []);

  const handleCanvasClick = useCallback(() => {
    setSelectedNodeIds([]);
  }, []);

  const handleConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            type: 'custom',
            style: { stroke: '#f59e0b', strokeWidth: 2 },
            animated: true,
            data: { label: '' },
          },
          eds
        )
      );
      addToHistory();
    },
    [setEdges, addToHistory]
  );

  // ── Project selector helpers ──────────────────────────────────────────────

  const activeProject = pcbProjects.find((p) => p.id === pcbProjectId);

  const handleCreateProject = () => {
    const name = newProjectName.trim();
    if (!name) return;
    createProjectMutation.mutate({ name, mode: 'schematic', mapId: activeMapId ?? undefined });
    setNewProjectName('');
    setShowNewProjectInput(false);
    setShowProjectDropdown(false);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="w-full h-full flex flex-col bg-background">
      <style dangerouslySetInnerHTML={{ __html: `
        .react-flow__controls {
          box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1) !important;
          border: 1px solid var(--border) !important;
          border-radius: 0.375rem !important;
          overflow: hidden !important;
          background: var(--bg-elevated) !important;
          display: flex !important;
          flex-direction: column !important;
        }
        .react-flow__controls-button {
          background: var(--bg-elevated) !important;
          border-bottom: 1px solid var(--border) !important;
          color: var(--foreground) !important;
          fill: var(--muted-foreground) !important;
          border-left: none !important;
          border-right: none !important;
          border-top: none !important;
          width: 28px !important;
          height: 28px !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          transition: background-color 0.2s ease !important;
        }
        .react-flow__controls-button:last-child { border-bottom: none !important; }
        .react-flow__controls-button:hover { background: var(--bg-secondary) !important; }
        .react-flow__controls-button svg { fill: currentColor !important; }
      `}} />

      {/* ── Project Bar ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-card flex-shrink-0">
        <FolderOpen className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />

        <div className="relative" ref={projectDropdownRef}>
          <HowToTooltip title="Select Project" description="Switch between different designs" side="bottom">
            <button
              className="flex items-center gap-1.5 text-xs font-medium text-foreground hover:text-primary transition-colors"
              onClick={() => setShowProjectDropdown((v) => !v)}
            >
              <span className="max-w-[180px] truncate">
                {activeProject?.name ?? (createProjectMutation.isPending ? 'Creating…' : 'No project')}
              </span>
              <ChevronDown className="w-3 h-3 opacity-60" />
            </button>
          </HowToTooltip>

          {showProjectDropdown && (
            <div className="absolute top-full left-0 mt-1 w-56 bg-card border border-border rounded-md shadow-lg z-50 py-1">
              {pcbProjects.map((proj) => (
                <button
                  key={proj.id}
                  className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                    proj.id === pcbProjectId
                      ? 'bg-primary/10 text-primary font-semibold'
                      : 'text-foreground hover:bg-muted'
                  }`}
                  onClick={() => {
                    setPcbProjectId(proj.id);
                    setShowProjectDropdown(false);
                  }}
                >
                  {proj.name}
                </button>
              ))}

              <div className="border-t border-border mt-1 pt-1">
                {showNewProjectInput ? (
                  <div className="px-2 py-1 flex items-center gap-1">
                    <input
                      autoFocus
                      className="flex-1 bg-background border border-border rounded px-2 py-0.5 text-xs text-foreground outline-none focus:border-primary/30"
                      placeholder="Project name…"
                      value={newProjectName}
                      onChange={(e) => setNewProjectName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleCreateProject();
                        if (e.key === 'Escape') {
                          setShowNewProjectInput(false);
                          setNewProjectName('');
                        }
                      }}
                    />
                    <Button
                      size="sm"
                      variant="default"
                      className="h-5 px-2 text-[10px]"
                      onClick={handleCreateProject}
                      disabled={!newProjectName.trim() || createProjectMutation.isPending}
                    >
                      {createProjectMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Add'}
                    </Button>
                  </div>
                ) : (
                  <button
                    className="w-full text-left px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted flex items-center gap-1.5"
                    onClick={() => setShowNewProjectInput(true)}
                  >
                    <Plus className="w-3 h-3" /> New project…
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Save indicator */}
        <div className="ml-auto flex items-center gap-2">
          {isSaving ? (
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" /> Saving…
            </span>
          ) : isDirty ? (
            <span className="text-[10px] text-muted-foreground italic">Unsaved changes…</span>
          ) : lastSavedAt ? (
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Save className="w-3 h-3" /> Saved
            </span>
          ) : null}
          {!pcbProjectId && (
            <span className="text-[10px] text-muted-foreground italic">
              {createProjectMutation.isPending ? 'Setting up workspace…' : 'No project — create one to save'}
            </span>
          )}
        </div>
      </div>

      {/* ── Editor Toolbar ───────────────────────────────────────────────── */}
      <EditorToolbar
        mode={mode}
        onModeChange={setMode}
        gridVisible={gridVisible}
        onGridToggle={() => setGridVisible(!gridVisible)}
        snapToGrid={snapToGrid}
        onSnapToggle={() => setSnapToGrid(!snapToGrid)}
        onRotate={handleRotateNode}
        onFlip={handleFlipNode}
        onDelete={handleDeleteNodes}
        onShowLibrary={() => setShowLibrary(!showLibrary)}
        onShowProperties={() => setShowProperties(!showProperties)}
        onShowAI={() => setShowAI(!showAI)}
        onShowNetlist={() => {
          if (mode === 'pcb') {
            toast.info('Netlist is only available in Schematic mode');
            return;
          }
          setShowNetlist((v) => !v);
        }}
        showMiniMap={showMiniMap}
        onMiniMapToggle={() => setShowMiniMap(!showMiniMap)}
      />

      {/* ── Main Editor Area ─────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {showLibrary && (
          <ComponentLibraryPanel onClose={() => setShowLibrary(false)} onAddComponent={handleAddComponent} mode={mode} />
        )}

        {/* React Flow Canvas */}
        <div
          ref={reactFlowWrapperRef}
          className="flex-1 relative"
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={handleConnect}
            onNodeClick={handleNodeClick}
            onPaneClick={handleCanvasClick}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            fitView
            snapToGrid={snapToGrid}
            snapGrid={[gridSize, gridSize]}
            proOptions={{ hideAttribution: true }}
          >
            {gridVisible && (
              <Background
                color={isDark ? '#334155' : '#d1d5db'}
                gap={gridSize}
                size={1}
              />
            )}
            <Controls>
              <HowToTooltip title="Rotate View" description="Rotate the entire canvas view" side="right">
                <ControlButton onClick={handleRotateCanvas} title="Rotate Layout 90°">
                  <RotateCw className="w-3.5 h-3.5" />
                </ControlButton>
              </HowToTooltip>
            </Controls>
            {showMiniMap && (
              <MiniMap
                nodeColor="#f59e0b"
                maskColor={isDark ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.1)'}
                style={{
                  backgroundColor: isDark ? '#0f172a' : '#f3f4f6',
                  border: `1px solid ${isDark ? '#334155' : '#d1d5db'}`,
                  borderRadius: '0.375rem',
                  bottom: 75,
                }}
              />
            )}
          </ReactFlow>
        </div>

        {/* Properties Panel */}
        {showProperties && selectedNodeIds.length > 0 && (
          <PropertiesPanel
            selectedNodeId={selectedNodeIds[0]}
            nodes={nodes}
            onUpdateNode={(node: Node) => {
              setNodes((nds) => nds.map((n) => (n.id === node.id ? node : n)));
              addToHistory();
            }}
          />
        )}

        {/* AI Assistant */}
        {showAI && (
          <AIAssistantPanel
            canvasState={{ nodes, edges, mode }}
            onClose={() => setShowAI(false)}
          />
        )}

        {/* Netlist */}
        {showNetlist && mode === 'schematic' && (
          <NetlistPanel nodes={nodes} edges={edges} onClose={() => setShowNetlist(false)} />
        )}
      </div>
    </div>
  );
};

// ─── Public export (wraps with ReactFlowProvider) ─────────────────────────────

function EnhancedPCBEditor({ onAIToggle }: EnhancedPCBEditorProps) {
  return (
    <ReactFlowProvider>
      <EnhancedPCBEditorInner onAIToggle={onAIToggle} />
    </ReactFlowProvider>
  );
}

export { EnhancedPCBEditor };
