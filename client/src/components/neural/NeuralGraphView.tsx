"use client";

import React, { useMemo, useEffect, useCallback, useRef, useState } from "react";
import { GripVertical, FolderOpen, FolderClosed, ExternalLink, Link2, FileCode } from "lucide-react";
import { useNeuralContextStore, makeEntry, NEURAL_DRAG_KEY, type NeuralContextEntry } from "@/lib/neuralContextStore";
import ReactFlow, {
  Node,
  Edge,
  Controls,
  Background,
  MiniMap,
  Handle,
  Position,
  NodeProps,
  ReactFlowProvider,
  useReactFlow,
} from "reactflow";
import "reactflow/dist/style.css";
import { NeuralNetwork } from "@/lib/neuralNodeTree";
import { useOmnecorSocket } from "@/hooks/useOmnecorSocket";
import { useBrainMapStore } from "@/lib/stores/brainMapStore";
import { useVisualControlStore, type LayoutEngine } from "@/lib/stores/visualControlStore";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Layout algorithm helpers
// ---------------------------------------------------------------------------

const NODE_W = 180;
const NODE_H = 60;

function applyHierarchicalLayout(nodes: Node[], edges: Edge[]): Node[] {
  if (!nodes.length) return nodes;
  const H_GAP = 40;
  const V_GAP = 90;

  const children = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  nodes.forEach(n => { children.set(n.id, []); inDegree.set(n.id, 0); });
  edges.forEach(e => {
    children.get(e.source)?.push(e.target);
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
  });

  const roots = nodes.filter(n => (inDegree.get(n.id) ?? 0) === 0).map(n => n.id);
  if (!roots.length) roots.push(nodes[0].id);

  const depthMap = new Map<string, number>();
  const queue = [...roots];
  roots.forEach(r => depthMap.set(r, 0));
  while (queue.length) {
    const id = queue.shift()!;
    const d = depthMap.get(id)!;
    for (const c of children.get(id) ?? []) {
      if (!depthMap.has(c)) { depthMap.set(c, d + 1); queue.push(c); }
    }
  }
  nodes.forEach(n => { if (!depthMap.has(n.id)) depthMap.set(n.id, 0); });

  const byDepth = new Map<number, string[]>();
  depthMap.forEach((d, id) => {
    if (!byDepth.has(d)) byDepth.set(d, []);
    byDepth.get(d)!.push(id);
  });

  const posMap = new Map<string, { x: number; y: number }>();
  byDepth.forEach((ids, depth) => {
    const totalW = ids.length * (NODE_W + H_GAP) - H_GAP;
    ids.forEach((id, i) => {
      posMap.set(id, { x: i * (NODE_W + H_GAP) - totalW / 2, y: depth * (NODE_H + V_GAP) });
    });
  });

  return nodes.map(n => ({ ...n, position: posMap.get(n.id) ?? n.position }));
}

function applyCircularLayout(nodes: Node[]): Node[] {
  if (!nodes.length) return nodes;
  // Use a tighter radius so fitView shows everything in the viewport
  const R = Math.max(160, nodes.length * 18);
  return nodes.map((n, i) => ({
    ...n,
    position: {
      x: R * Math.cos((i * 2 * Math.PI) / nodes.length),
      y: R * Math.sin((i * 2 * Math.PI) / nodes.length),
    },
  }));
}

function applyMindMapLayout(nodes: Node[], edges: Edge[]): Node[] {
  if (!nodes.length) return nodes;
  const STEP = 200;

  const degree = new Map<string, number>();
  nodes.forEach(n => degree.set(n.id, 0));
  edges.forEach(e => {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  });
  const center = nodes.reduce((best, n) => {
    if (n.data?.type === "project") return n;
    return (degree.get(n.id) ?? 0) > (degree.get(best.id) ?? 0) ? n : best;
  }, nodes[0]);

  const adj = new Map<string, string[]>();
  nodes.forEach(n => adj.set(n.id, []));
  edges.forEach(e => {
    adj.get(e.source)?.push(e.target);
    adj.get(e.target)?.push(e.source);
  });

  const posMap = new Map<string, { x: number; y: number }>();
  posMap.set(center.id, { x: 0, y: 0 });
  const visited = new Set<string>([center.id]);

  type BfsItem = { id: string; depth: number; aStart: number; aEnd: number };
  const bfsQ: BfsItem[] = [{ id: center.id, depth: 0, aStart: 0, aEnd: 2 * Math.PI }];

  while (bfsQ.length) {
    const { id, depth, aStart, aEnd } = bfsQ.shift()!;
    const unvisited = (adj.get(id) ?? []).filter(c => !visited.has(c));
    if (!unvisited.length) continue;
    const aStep = (aEnd - aStart) / unvisited.length;
    const r = (depth + 1) * STEP;
    unvisited.forEach((cid, i) => {
      visited.add(cid);
      const angle = aStart + (i + 0.5) * aStep;
      posMap.set(cid, { x: r * Math.cos(angle), y: r * Math.sin(angle) });
      bfsQ.push({ id: cid, depth: depth + 1, aStart: aStart + i * aStep, aEnd: aStart + (i + 1) * aStep });
    });
  }

  const orphans = nodes.filter(n => !posMap.has(n.id));
  const R2 = (Math.max(...Array.from(posMap.values()).map(p => Math.hypot(p.x, p.y)), 0) || STEP) + STEP;
  orphans.forEach((n, i) => {
    posMap.set(n.id, {
      x: R2 * Math.cos((i * 2 * Math.PI) / Math.max(orphans.length, 1)),
      y: R2 * Math.sin((i * 2 * Math.PI) / Math.max(orphans.length, 1)),
    });
  });

  return nodes.map(n => ({ ...n, position: posMap.get(n.id) ?? n.position }));
}

function applyClusteredForce(nodes: Node[]): Node[] {
  const typeOrder: Record<string, number> = { project: 0, folder: 1, file: 2, integration: 3 };
  const sorted = [...nodes].sort((a, b) => {
    const ao = typeOrder[a.data?.type as string] ?? 4;
    const bo = typeOrder[b.data?.type as string] ?? 4;
    return ao - bo;
  });
  const COLS = Math.ceil(Math.sqrt(sorted.length));
  return sorted.map((n, i) => ({
    ...n,
    position: {
      x: (i % COLS) * (NODE_W + 60) - (COLS * (NODE_W + 60)) / 2,
      y: Math.floor(i / COLS) * (NODE_H + 60),
    },
  }));
}

function computeLayout(layout: LayoutEngine, autoClustering: boolean, nodes: Node[], edges: Edge[]): Node[] {
  if (layout === "hierarchical") return applyHierarchicalLayout(nodes, edges);
  if (layout === "circular") return applyCircularLayout(nodes);
  if (layout === "mindmap") return applyMindMapLayout(nodes, edges);
  if (autoClustering) return applyClusteredForce(nodes);
  return nodes;
}

// ---------------------------------------------------------------------------
// Get all hidden node IDs (descendants of collapsed folder nodes)
// ---------------------------------------------------------------------------
function getHiddenNodeIds(collapsedIds: string[], edges: Edge[]): Set<string> {
  const hidden = new Set<string>();
  const queue = [...collapsedIds];
  while (queue.length) {
    const parentId = queue.shift()!;
    for (const edge of edges) {
      if (edge.source === parentId && !hidden.has(edge.target)) {
        hidden.add(edge.target);
        queue.push(edge.target);
      }
    }
  }
  return hidden;
}

// ---------------------------------------------------------------------------
// Custom Neural Node Component
// ---------------------------------------------------------------------------
const CustomNeuralNode = ({ data, selected }: NodeProps) => {
  const description = (data.metadata?.description as string) || (data.type === "folder" ? "Project directory" : "Source file");
  const [dragging, setDragging] = useState(false);
  const { has } = useNeuralContextStore();
  const nodeSize = useVisualControlStore(s => s.nodeSize);
  const showHoverDescriptions = useVisualControlStore(s => s.showHoverDescriptions);
  const { collapsedFolderIds } = useBrainMapStore();

  const nodeType = (data.type as NeuralContextEntry["nodeType"]) ?? "file";
  const path = (data.path as string) ?? "";
  const label = (data.label as string) ?? "";
  const isFolder = data.type === "folder" || data.type === "project";
  const isCollapsed = collapsedFolderIds.includes(data.id as string);

  const inContext = has(`nctx_${Math.abs(
    Array.from(path).reduce((h, c) => (Math.imul(31, h) + c.charCodeAt(0)) | 0, 0)
  ).toString(36)}`);

  const handleDragStart = (e: React.DragEvent) => {
    e.stopPropagation();
    setDragging(true);
    const entry = makeEntry(path, label, nodeType);
    e.dataTransfer.setData(NEURAL_DRAG_KEY, JSON.stringify(entry));
    e.dataTransfer.effectAllowed = "copy";
  };
  const handleDragEnd = () => setDragging(false);

  const scale = nodeSize / 10;
  const fontSize = Math.round(10 * scale);
  const paddingX = Math.round(12 * scale);
  const paddingY = Math.round(8 * scale);

  const nodeContent = (
    <div
      style={{ paddingLeft: paddingX, paddingRight: paddingX, paddingTop: paddingY, paddingBottom: paddingY }}
      className={cn(
        "rounded-lg border-2 bg-background/95 backdrop-blur-md transition-all duration-300",
        selected ? "border-accent shadow-[0_0_15px_rgba(var(--accent-rgb),0.3)] scale-105" : "border-border shadow-md",
        data.type === "project" && "border-accent bg-accent/5",
        inContext && "border-emerald-500/70 bg-emerald-500/5",
        dragging && "opacity-60",
        "hover:border-accent group/node"
      )}
    >
      <Handle type="target" position={Position.Top} className="opacity-0" />

      <div className="flex items-center gap-1.5">
        <span
          draggable
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onMouseDown={(e) => e.stopPropagation()}
          className={cn(
            "cursor-grab active:cursor-grabbing text-muted-foreground/30 hover:text-accent/70 transition-colors flex-shrink-0",
            "opacity-0 group-hover/node:opacity-100"
          )}
          title="Drag to add to context"
        >
          <GripVertical style={{ width: fontSize - 2, height: fontSize - 2 }} />
        </span>

        <div className="flex flex-col gap-0.5 min-w-0">
          <div className="flex items-center gap-1.5">
            <div className={cn(
              "rounded-full flex-shrink-0",
              data.type === "folder" ? "bg-blue-500" : "bg-green-500",
              data.type === "project" && "bg-purple-500",
              inContext && "bg-emerald-400",
              "group-hover/node:animate-pulse"
            )} style={{ width: Math.max(4, Math.round(6 * scale)), height: Math.max(4, Math.round(6 * scale)) }} />
            <span className="font-bold font-mono tracking-tight whitespace-nowrap" style={{ fontSize }}>
              {label}
            </span>
            {isFolder && (
              <span style={{ fontSize: Math.max(8, fontSize - 3) }} className="text-muted-foreground flex-shrink-0 opacity-60">
                {isCollapsed ? <FolderClosed style={{ width: fontSize - 3, height: fontSize - 3 }} /> : <FolderOpen style={{ width: fontSize - 3, height: fontSize - 3 }} />}
              </span>
            )}
            {inContext && (
              <span style={{ fontSize: Math.max(8, fontSize - 3) }} className="bg-emerald-500/20 text-emerald-400 px-1 rounded leading-none py-0.5 flex-shrink-0">
                ctx
              </span>
            )}
          </div>
          <span className="text-muted-foreground font-mono truncate max-w-[110px]" style={{ fontSize: Math.max(8, fontSize - 2) }}>
            {path}
          </span>
        </div>
      </div>

      <Handle type="source" position={Position.Bottom} className="opacity-0" />
    </div>
  );

  if (!showHoverDescriptions) return nodeContent;

  return (
    <TooltipProvider delayDuration={100}>
      <Tooltip>
        <TooltipTrigger asChild>{nodeContent}</TooltipTrigger>
        <TooltipContent side="top" className="max-w-[220px] p-3 bg-card/95 border-accent/20 shadow-2xl backdrop-blur-md z-[100]">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-4 border-b border-border/50 pb-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-accent">{data.type}</span>
              {data.fileCount !== undefined && (
                <span className="text-[9px] text-muted-foreground">{data.fileCount} items</span>
              )}
            </div>
            <p className="text-xs leading-relaxed text-foreground/90">{description}</p>
            {isFolder && (
              <p className="text-[10px] text-blue-400 mt-1">⊞ Double-click to {isCollapsed ? "expand" : "collapse"} children</p>
            )}
            {!inContext && nodeType !== "project" && !isFolder && (
              <p className="text-[10px] text-muted-foreground mt-1">⋮⋮ Drag the grip to add to context</p>
            )}
            {inContext && <p className="text-[10px] text-emerald-400 mt-1">✓ In active context</p>}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

const nodeTypes = { neural: CustomNeuralNode };

interface NeuralGraphViewProps {
  network: NeuralNetwork;
  projectId?: string;
  onNodeClick?: (nodeId: string) => void;
  onNodeDoubleClick?: (nodeId: string) => void;
  onEdgeClick?: (edgeId: string) => void;
  onOpenFile?: (path: string, label: string) => void;
  readOnly?: boolean;
}

// ---------------------------------------------------------------------------
// Context menu overlay
// ---------------------------------------------------------------------------
interface ContextMenuState {
  x: number;
  y: number;
  nodeId: string;
  nodePath: string;
  nodeType: string;
  nodeLabel: string;
}

function NodeContextMenu({
  menu,
  onClose,
  onOpenInLocation,
  onOpenInEditor,
  onAddSymlink,
}: {
  menu: ContextMenuState;
  onClose: () => void;
  onOpenInLocation: (path: string) => void;
  onOpenInEditor: (path: string, label: string) => void;
  onAddSymlink: (path: string, label: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as EventTarget & globalThis.Node)) onClose();
    };
    const escHandler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", escHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", escHandler);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="fixed z-[200] bg-card border border-border rounded-lg shadow-xl py-1 min-w-[180px]"
      style={{ left: menu.x, top: menu.y }}
    >
      <div className="px-3 py-1.5 border-b border-border/50 mb-1">
        <p className="text-[10px] font-bold uppercase tracking-widest text-accent">{menu.nodeType}</p>
        <p className="text-xs font-mono truncate max-w-[160px] text-foreground">{menu.nodeLabel}</p>
      </div>
      <button
        className="w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-accent/10 transition-colors"
        onClick={() => { onOpenInLocation(menu.nodePath); onClose(); }}
      >
        <FolderOpen className="w-3.5 h-3.5 text-blue-400" />
        Open in File Explorer
      </button>
      {menu.nodeType === "file" && (
        <button
          className="w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-accent/10 transition-colors"
          onClick={() => { onOpenInEditor(menu.nodePath, menu.nodeLabel); onClose(); }}
        >
          <FileCode className="w-3.5 h-3.5 text-green-400" />
          Open in Editor / Code Tab
        </button>
      )}
      <button
        className="w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-accent/10 transition-colors"
        onClick={() => { onAddSymlink(menu.nodePath, menu.nodeLabel); onClose(); }}
      >
        <Link2 className="w-3.5 h-3.5 text-purple-400" />
        Symlink to Neural Map
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inner viewport — must be inside ReactFlowProvider to call useReactFlow
// ---------------------------------------------------------------------------
function BrainMapViewportInner({
  onNodeClick,
  onNodeDoubleClick,
  onEdgeClick,
  onOpenFile,
}: Partial<NeuralGraphViewProps>) {
  const { nodes, edges, onNodesChange, onEdgesChange, onConnect, projectId, collapsedFolderIds, toggleFolderCollapse } = useBrainMapStore();
  const setStoreNodes = useBrainMapStore(s => s.setNodes);

  const {
    layout, gpuEnabled, simSpeed, autoClustering, showMiniMap,
    lockLayout, unlockLayout, isLayoutLocked, getLockedPositions,
  } = useVisualControlStore();

  const { fitView } = useReactFlow();
  const openPathMutation = trpc.project.openPath.useMutation({
    onError: (err) => toast.error("Could not open path: " + err.message),
  });

  // Context menu state
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // Save lock positions when nodes move while locked
  const lockKey = `${projectId}:${layout}`;
  const isLocked = isLayoutLocked(lockKey);
  const lockSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!isLocked || !nodes.length) return;
    if (lockSaveTimer.current) clearTimeout(lockSaveTimer.current);
    lockSaveTimer.current = setTimeout(() => {
      lockLayout(lockKey, nodes);
    }, 600);
    return () => { if (lockSaveTimer.current) clearTimeout(lockSaveTimer.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, isLocked, lockKey]);

  // Re-layout whenever layout engine, clustering, or loaded project changes
  useEffect(() => {
    const { nodes: current, edges: currentEdges } = useBrainMapStore.getState();
    if (!current.length) return;

    // If this layout is locked for this project, restore saved positions
    const savedPositions = getLockedPositions(lockKey);
    if (savedPositions) {
      const posMap = new Map(savedPositions.map(p => [p.id, p.position]));
      const restored = current.map(n => ({
        ...n,
        position: posMap.get(n.id) ?? n.position,
      }));
      setStoreNodes(restored);
      requestAnimationFrame(() => fitView({ duration: 400, padding: 0.2 }));
      return;
    }

    const recomputed = computeLayout(layout, autoClustering, current, currentEdges);
    setStoreNodes(recomputed);
    requestAnimationFrame(() => fitView({ duration: 400, padding: 0.2 }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, autoClustering, projectId]);

  // Compute which nodes/edges are hidden due to collapsed folders
  const hiddenNodeIds = useMemo(
    () => getHiddenNodeIds(collapsedFolderIds, edges),
    [collapsedFolderIds, edges]
  );

  const visibleNodes = useMemo(
    () => nodes.filter(n => !hiddenNodeIds.has(n.id)),
    [nodes, hiddenNodeIds]
  );

  const visibleEdges = useMemo(
    () => edges.filter(e => !hiddenNodeIds.has(e.source) && !hiddenNodeIds.has(e.target)),
    [edges, hiddenNodeIds]
  );

  const edgeAnimDuration = `${(1 / simSpeed).toFixed(2)}s`;

  const handleNodeDoubleClick = useCallback((_e: React.MouseEvent, n: Node) => {
    const isFolder = n.data?.type === "folder" || n.data?.type === "project";
    if (isFolder) {
      toggleFolderCollapse(n.id);
    }
    onNodeDoubleClick?.(n.id);
  }, [toggleFolderCollapse, onNodeDoubleClick]);

  const handleNodeContextMenu = useCallback((e: React.MouseEvent, n: Node) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      nodeId: n.id,
      nodePath: (n.data?.path as string) ?? "",
      nodeType: (n.data?.type as string) ?? "file",
      nodeLabel: (n.data?.label as string) ?? n.id,
    });
  }, []);

  const handleOpenInLocation = useCallback((path: string) => {
    if (!path) { toast.error("No path available for this node"); return; }
    openPathMutation.mutate({ path });
    toast.info(`Opening location: ${path}`);
  }, [openPathMutation]);

  const handleOpenInEditor = useCallback((path: string, label: string) => {
    if (onOpenFile) {
      onOpenFile(path, label);
    } else {
      // Navigate to 3D designer code tab
      window.location.href = `/3d-designer?file=${encodeURIComponent(path)}&mode=code`;
    }
  }, [onOpenFile]);

  const handleAddSymlink = useCallback((_path: string, label: string) => {
    toast.info(`Symlink for "${label}" — drag this node to another map to create a reference link.`);
  }, []);

  return (
    <div className="w-full h-full relative" onContextMenu={e => e.preventDefault()}>
      <ReactFlow
        nodes={visibleNodes}
        edges={visibleEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={(_e, n) => onNodeClick?.(n.id)}
        onNodeDoubleClick={handleNodeDoubleClick}
        onEdgeClick={(_e, e) => onEdgeClick?.(e.id)}
        onNodeContextMenu={handleNodeContextMenu}
        onPaneClick={() => setContextMenu(null)}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.02}
        maxZoom={20}
        onlyRenderVisibleElements={!gpuEnabled}
        className="bg-background/50"
      >
        <Background color="#333" gap={20} />
        <Controls />
        {showMiniMap && (
          <MiniMap
            nodeColor={(n) => {
              if (n.data?.type === "project") return "#8b5cf6";
              if (n.data?.type === "folder") return "#3b82f6";
              return "#10b981";
            }}
            maskColor="rgba(0, 0, 0, 0.4)"
          />
        )}
      </ReactFlow>

      {contextMenu && (
        <NodeContextMenu
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
          onOpenInLocation={handleOpenInLocation}
          onOpenInEditor={handleOpenInEditor}
          onAddSymlink={handleAddSymlink}
        />
      )}

      <style>{`
        .node-pulse {
          box-shadow: 0 0 20px 5px var(--accent-cyan);
          border-color: var(--accent-cyan);
          transition: all 0.3s ease;
        }
        .node-new {
          animation: node-appear 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        }
        @keyframes node-appear {
          from { opacity: 0; transform: scale(0.5); }
          to { opacity: 1; transform: scale(1); }
        }
        .react-flow__edge-path {
          stroke: var(--border);
          stroke-width: 1.5;
        }
        .react-flow__edge--animated .react-flow__edge-path {
          animation-duration: ${edgeAnimDuration};
        }
        .react-flow__controls-button {
          background: var(--bg-elevated);
          border-bottom: 1px solid var(--border);
          fill: var(--muted-foreground);
        }
        .react-flow__controls-button:hover { background: var(--bg-secondary); }
      `}</style>
    </div>
  );
}

/**
 * Pure viewport component that renders the graph from the global store.
 */
export function BrainMapViewport(props: Partial<NeuralGraphViewProps>) {
  return <BrainMapViewportInner {...props} />;
}

export default function NeuralGraphView(props: NeuralGraphViewProps) {
  const { network, projectId } = props;
  const setNodes = useBrainMapStore(s => s.setNodes);
  const setEdges = useBrainMapStore(s => s.setEdges);
  const setProjectId = useBrainMapStore(s => s.setProjectId);
  const { layout, autoClustering } = useVisualControlStore();

  const initialNodes: Node[] = useMemo(
    () =>
      network.nodes.map(neuralNode => ({
        id: neuralNode.id,
        type: "neural",
        data: {
          label: neuralNode.label,
          type: neuralNode.type,
          path: neuralNode.data.path,
          fileCount: neuralNode.data.fileCount,
          metadata: neuralNode.data.metadata,
          id: neuralNode.id,
        },
        position: neuralNode.position,
        className: neuralNode.type === "project" ? "border-accent border-2" : "",
      })),
    [network.nodes]
  );

  const initialEdges: Edge[] = useMemo(
    () =>
      network.edges.map(neuralEdge => ({
        id: neuralEdge.id,
        source: neuralEdge.source,
        target: neuralEdge.target,
        type: "smoothstep",
        animated: neuralEdge.type === "folder-connection",
      })),
    [network.edges]
  );

  // Load network into store, then apply active layout
  useEffect(() => {
    setProjectId(projectId || null);
    const laid = computeLayout(layout, autoClustering, initialNodes, initialEdges);
    setNodes(laid);
    setEdges(initialEdges);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialNodes, initialEdges, projectId, setNodes, setEdges, setProjectId]);

  // WebSocket Integration for incremental updates
  const { fileEvents } = useOmnecorSocket({ projectId });

  useEffect(() => {
    if (!projectId || !fileEvents.length) return;
    const latest = fileEvents[fileEvents.length - 1];
    const nodeId = `node-${latest.relativePath}`;

    if (latest.eventType === "add" || latest.eventType === "addDir") {
      setNodes(prev => {
        if (prev.some(n => n.id === nodeId)) return prev;
        const newNode: Node = {
          id: nodeId,
          type: "neural",
          data: {
            label: latest.relativePath.split("/").pop() ?? latest.relativePath,
            type: latest.eventType === "addDir" ? "folder" : "file",
            path: latest.relativePath,
            id: nodeId,
          },
          position: { x: Math.random() * 200 - 100, y: Math.random() * 200 - 100 },
          className: "node-new",
        };
        return [...prev, newNode];
      });

      const pathParts = latest.relativePath.split("/");
      if (pathParts.length > 1) {
        pathParts.pop();
        const parentPath = pathParts.join("/");
        const parentId = `node-${parentPath}`;
        setEdges(prev => {
          const edgeId = `edge-${parentId}-${nodeId}`;
          if (prev.some(e => e.id === edgeId)) return prev;
          return [...prev, { id: edgeId, source: parentId, target: nodeId, type: "smoothstep", animated: latest.eventType === "addDir" }];
        });
      }
    } else if (latest.eventType === "unlink" || latest.eventType === "unlinkDir") {
      setNodes(prev => prev.filter(n => n.id !== nodeId));
      setEdges(prev => prev.filter(e => e.source !== nodeId && e.target !== nodeId));
    } else if (latest.eventType === "change") {
      setNodes(prev => prev.map(n => n.id === nodeId ? { ...n, className: "node-pulse" } : n));
      setTimeout(() => {
        setNodes(prev => prev.map(n => n.id === nodeId ? { ...n, className: "" } : n));
      }, 1500);
    }
  }, [fileEvents, projectId, setNodes, setEdges]);

  return (
    <ReactFlowProvider>
      <BrainMapViewportInner {...props} />
    </ReactFlowProvider>
  );
}
