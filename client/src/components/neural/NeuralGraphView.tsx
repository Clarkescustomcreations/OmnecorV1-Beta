"use client";

import React, { useMemo, useEffect, useCallback, useRef, useState } from "react";
import { GripVertical, FolderOpen, FolderClosed, FolderPlus, ExternalLink, Link2, FileCode, RotateCw } from "lucide-react";
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
  ControlButton,
} from "reactflow";
import "reactflow/dist/style.css";
import { NeuralNetwork } from "@/lib/neuralNodeTree";
import { useOmnecorSocket } from "@/hooks/useOmnecorSocket";
import { useBrainMapStore } from "@/lib/stores/brainMapStore";
import { useVisualControlStore } from "@/lib/stores/visualControlStore";
import { runLayout } from "@/lib/neuralLayoutClient";
import type { LayoutNode as EngineNode, LayoutEdge as EngineEdge, LayoutPosition } from "@/lib/neuralLayout";
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
// Layout engine glue
//
// The heavy layout math now runs off the render thread in a Web Worker (see
// neuralLayout.ts / neuralLayout.worker.ts). These helpers convert reactflow
// nodes/edges to the worker's slim shape and apply the computed positions back.
// ---------------------------------------------------------------------------

// Above this visible-node count React Flow virtualization is forced on (renders
// only on-screen nodes) regardless of the GPU toggle, so large maps don't mount
// thousands of DOM subtrees at once.
const VIRTUALIZE_THRESHOLD = 300;

function toEngineNodes(nodes: Node[]): EngineNode[] {
  return nodes.map(n => ({
    id: n.id,
    x: n.position.x,
    y: n.position.y,
    type: (n.data?.type as string) ?? "file",
  }));
}

function toEngineEdges(edges: Edge[]): EngineEdge[] {
  return edges.map(e => ({ source: e.source, target: e.target }));
}

/** Apply computed positions back onto reactflow nodes, matched by id. Nodes with
 *  no computed position (added after the request was sent) keep their position. */
function applyPositions(nodes: Node[], positions: LayoutPosition[]): Node[] {
  const posMap = new Map(positions.map(p => [p.id, p]));
  return nodes.map(n => {
    const p = posMap.get(n.id);
    return p ? { ...n, position: { x: p.x, y: p.y } } : n;
  });
}

/**
 * Resolve a CSS color expression (e.g. `var(--color-primary)`) to a concrete
 * computed color string. React Flow's MiniMap and Background paint via SVG
 * presentation attributes, which do NOT resolve `var()` — so they need resolved
 * values. Doing it this way keeps the colors driven by design tokens (still
 * theme-following) instead of hardcoded hex.
 */
function resolveCssColor(expr: string, fallback: string): string {
  if (typeof document === "undefined" || !document.body) return fallback;
  const probe = document.createElement("span");
  probe.style.color = expr;
  probe.style.display = "none";
  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  document.body.removeChild(probe);
  return resolved || fallback;
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
  const isTruncated = !!data.truncated;
  const childCount = data.fileCount as number | undefined;

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
        selected ? "border-primary/30 shadow-[0_0_15px_rgba(var(--accent-rgb),0.3)] scale-105" : "border-border shadow-md",
        data.type === "project" && "border-primary/30 bg-primary/5",
        inContext && "border-accent-success/70 bg-accent-success/5",
        dragging && "opacity-60",
        "hover:border-primary/30 group/node"
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
            "cursor-grab active:cursor-grabbing text-muted-foreground/30 hover:text-primary/70 transition-colors flex-shrink-0",
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
              data.type === "folder" ? "bg-primary" : "bg-accent-success",
              data.type === "project" && "bg-accent-purple",
              inContext && "bg-accent-success",
              "group-hover/node:animate-pulse"
            )} style={{ width: Math.max(4, Math.round(6 * scale)), height: Math.max(4, Math.round(6 * scale)) }} />
            <span className="font-bold font-mono tracking-tight whitespace-nowrap" style={{ fontSize }}>
              {label}
            </span>
            {isFolder && !isTruncated && (
              <span style={{ fontSize: Math.max(8, fontSize - 3) }} className="text-muted-foreground flex-shrink-0 opacity-60">
                {isCollapsed ? <FolderClosed style={{ width: fontSize - 3, height: fontSize - 3 }} /> : <FolderOpen style={{ width: fontSize - 3, height: fontSize - 3 }} />}
              </span>
            )}
            {isTruncated && (
              <span
                className="flex items-center gap-0.5 bg-primary/15 text-primary px-1 rounded leading-none flex-shrink-0"
                style={{ fontSize: Math.max(8, fontSize - 3), paddingTop: 1, paddingBottom: 1 }}
                title="Folder not loaded — double-click to expand"
              >
                <FolderPlus style={{ width: fontSize - 3, height: fontSize - 3 }} />
                {childCount !== undefined && childCount > 0 && <span>+{childCount}</span>}
              </span>
            )}
            {inContext && (
              <span style={{ fontSize: Math.max(8, fontSize - 3) }} className="bg-accent-success/20 text-accent-success px-1 rounded leading-none py-0.5 flex-shrink-0">
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
        <TooltipContent side="top" className="max-w-[220px] p-3 bg-card/95 border-primary/20 shadow-2xl backdrop-blur-md z-[100]">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-4 border-b border-border/50 pb-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-primary">{data.type}</span>
              {data.fileCount !== undefined && (
                <span className="text-[9px] text-muted-foreground">{data.fileCount} items</span>
              )}
            </div>
            <p className="text-xs leading-relaxed text-foreground/90">{description}</p>
            {isTruncated ? (
              <p className="text-[10px] text-primary mt-1">
                ⊞ {childCount !== undefined ? `${childCount} items — ` : ""}double-click to load this folder
              </p>
            ) : isFolder && (
              <p className="text-[10px] text-primary mt-1">⊞ Double-click to {isCollapsed ? "expand" : "collapse"} children</p>
            )}
            {!inContext && nodeType !== "project" && !isFolder && (
              <p className="text-[10px] text-muted-foreground mt-1">⋮⋮ Drag the grip to add to context</p>
            )}
            {inContext && <p className="text-[10px] text-accent-success mt-1">✓ In active context</p>}
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
  /** Lazily fetch + merge a truncated folder's subtree (its absolute path). */
  onRequestExpand?: (path: string) => void;
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
        <p className="text-[10px] font-bold uppercase tracking-widest text-primary">{menu.nodeType}</p>
        <p className="text-xs font-mono truncate max-w-[160px] text-foreground">{menu.nodeLabel}</p>
      </div>
      <button
        className="w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-primary/10 transition-colors"
        onClick={() => { onOpenInLocation(menu.nodePath); onClose(); }}
      >
        <FolderOpen className="w-3.5 h-3.5 text-primary" />
        Open in File Explorer
      </button>
      {menu.nodeType === "file" && (
        <button
          className="w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-primary/10 transition-colors"
          onClick={() => { onOpenInEditor(menu.nodePath, menu.nodeLabel); onClose(); }}
        >
          <FileCode className="w-3.5 h-3.5 text-accent-success" />
          Open in Editor / Code Tab
        </button>
      )}
      <button
        className="w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-primary/10 transition-colors"
        onClick={() => { onAddSymlink(menu.nodePath, menu.nodeLabel); onClose(); }}
      >
        <Link2 className="w-3.5 h-3.5 text-accent-purple" />
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
  onRequestExpand,
}: Partial<NeuralGraphViewProps>) {
  const { nodes, edges, onNodesChange, onEdgesChange, onConnect, projectId, collapsedFolderIds, toggleFolderCollapse, layoutComputing } = useBrainMapStore();
  const setStoreNodes = useBrainMapStore(s => s.setNodes);
  const setLayoutComputing = useBrainMapStore(s => s.setLayoutComputing);
  const { has } = useNeuralContextStore();

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

  // Re-layout whenever layout engine, clustering, or loaded project changes.
  // The heavy compute runs in a Web Worker so this never blocks the render thread.
  useEffect(() => {
    const { nodes: current, edges: currentEdges } = useBrainMapStore.getState();
    if (!current.length) return;

    // If this layout is locked for this project, restore saved positions (cheap, O(n)).
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

    let cancelled = false;
    const nodeSize = useVisualControlStore.getState().nodeSize;
    setLayoutComputing(true);
    runLayout({ layout, autoClustering, nodeSize }, toEngineNodes(current), toEngineEdges(currentEdges))
      .then(positions => {
        if (cancelled) return;
        // Apply onto the latest store nodes by id so a concurrent network update
        // (e.g. an incremental file event) isn't clobbered with a stale snapshot.
        setStoreNodes(applyPositions(useBrainMapStore.getState().nodes, positions));
        setLayoutComputing(false);
        requestAnimationFrame(() => fitView({ duration: 400, padding: 0.2 }));
      });
    return () => { cancelled = true; };
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

  const visibleEdges = useMemo(() => {
    const nodeMap = new Map(nodes.map(n => [n.id, n]));

    return edges
      .filter(e => !hiddenNodeIds.has(e.source) && !hiddenNodeIds.has(e.target))
      .map(edge => {
        const srcNode = nodeMap.get(edge.source);
        const tgtNode = nodeMap.get(edge.target);

        // Helper to check context
        const checkInContext = (path?: string) => {
          if (!path) return false;
          const hashKey = `nctx_${Math.abs(
            Array.from(path).reduce((h, c) => (Math.imul(31, h) + c.charCodeAt(0)) | 0, 0)
          ).toString(36)}`;
          return has(hashKey);
        };

        const srcInCtx = checkInContext(srcNode?.data?.path);
        const tgtInCtx = checkInContext(tgtNode?.data?.path);

        let color = "var(--color-muted-foreground)"; // slate-600

        if (srcInCtx || tgtInCtx) {
          color = "var(--color-accent-success)"; // Emerald context color
        } else if (tgtNode?.data?.type === "file" || srcNode?.data?.type === "file") {
          color = "var(--color-accent-success)"; // File green
        } else if (tgtNode?.data?.type === "folder" || srcNode?.data?.type === "folder") {
          color = "var(--color-primary)"; // Folder blue
        } else if (tgtNode?.data?.type === "project" || srcNode?.data?.type === "project") {
          color = "var(--color-accent-purple)"; // Project purple
        }

        return {
          ...edge,
          style: {
            stroke: color,
            strokeWidth: 2.5,
            opacity: 0.85,
          },
        };
      });
  }, [edges, nodes, hiddenNodeIds, has]);

  const edgeAnimDuration = `${(1 / simSpeed).toFixed(2)}s`;

  // Resolve MiniMap/Background colors from design tokens (see resolveCssColor).
  // Computed once per mount; fallbacks mirror the UI-Tokens palette.
  const themeColors = useMemo(() => {
    const bg = resolveCssColor("var(--color-background)", "rgb(0, 0, 0)");
    return {
      project: resolveCssColor("var(--color-accent-purple)", "rgb(139, 92, 246)"),
      folder: resolveCssColor("var(--color-primary)", "rgb(59, 130, 246)"),
      file: resolveCssColor("var(--color-accent-success)", "rgb(16, 185, 129)"),
      dot: resolveCssColor("var(--color-border)", "rgb(51, 51, 51)"),
      mask: bg.startsWith("rgb(") ? bg.replace("rgb(", "rgba(").replace(")", ", 0.45)") : "rgba(0, 0, 0, 0.45)",
    };
  }, []);

  const handleNodeDoubleClick = useCallback((_e: React.MouseEvent, n: Node) => {
    const isFolder = n.data?.type === "folder" || n.data?.type === "project";
    if (isFolder) {
      // A truncated folder wasn't loaded server-side — fetch + merge its subtree.
      // Once loaded it behaves like any folder (double-click toggles collapse).
      if (n.data?.truncated && onRequestExpand) {
        onRequestExpand(n.data.path as string);
      } else {
        toggleFolderCollapse(n.id);
      }
    }
    onNodeDoubleClick?.(n.id);
  }, [toggleFolderCollapse, onNodeDoubleClick, onRequestExpand]);

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

  const handleRotateCanvas = useCallback(() => {
    if (!nodes || nodes.length === 0) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    nodes.forEach(n => {
      const x = n.position.x;
      const y = n.position.y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    });
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    const rotated = nodes.map(n => {
      const rx = n.position.x - cx;
      const ry = n.position.y - cy;
      return {
        ...n,
        position: {
          x: cx - ry,
          y: cy + rx
        }
      };
    });
    setStoreNodes(rotated);
    requestAnimationFrame(() => fitView({ duration: 400, padding: 0.2 }));
    toast.success("Rotated neural map layout 90°");
  }, [nodes, setStoreNodes, fitView]);

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
        onlyRenderVisibleElements={!gpuEnabled || visibleNodes.length > VIRTUALIZE_THRESHOLD}
        className="bg-background/50"
        proOptions={{ hideAttribution: true }}
        selectionKeyCode="Shift"
        multiSelectionKeyCode="Shift"
        elementsSelectable={true}
      >
        <Background color={themeColors.dot} gap={20} />
        <Controls>
          <ControlButton onClick={handleRotateCanvas} title="Rotate 90°">
            <RotateCw className="w-3.5 h-3.5" />
          </ControlButton>
        </Controls>
        {showMiniMap && (
          <MiniMap
            nodeColor={(n) => {
              if (n.data?.type === "project") return themeColors.project;
              if (n.data?.type === "folder") return themeColors.folder;
              return themeColors.file;
            }}
            maskColor={themeColors.mask}
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

      {layoutComputing && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/60 backdrop-blur-sm pointer-events-none">
          <div className="flex items-center gap-2 rounded-md border border-primary/20 bg-card/90 px-4 py-2 text-sm text-muted-foreground shadow-lg">
            <RotateCw className="w-4 h-4 animate-spin text-primary" />
            Computing layout…
          </div>
        </div>
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
          stroke-width: 2.5;
          opacity: 0.85;
          transition: stroke 0.3s ease, stroke-width 0.3s ease;
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

export function NeuralGraphView(props: NeuralGraphViewProps) {
  const { network, projectId } = props;
  const setNodes = useBrainMapStore(s => s.setNodes);
  const setEdges = useBrainMapStore(s => s.setEdges);
  const setProjectId = useBrainMapStore(s => s.setProjectId);
  const setLayoutComputing = useBrainMapStore(s => s.setLayoutComputing);
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
          truncated: neuralNode.data.truncated,
          metadata: neuralNode.data.metadata,
          id: neuralNode.id,
        },
        position: neuralNode.position,
        className: neuralNode.type === "project" ? "border-primary/30 border-2" : "",
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

  // Load network into store, then apply active layout. Layout runs in a Web
  // Worker (off the render thread) so indexing a large map never freezes the UI.
  useEffect(() => {
    setProjectId(projectId || null);
    setEdges(initialEdges);

    // Seed the engine from nodes already on screen (same id) so expanding a
    // folder or a live file event nudges the new nodes into place instead of
    // reshuffling the whole map. Brand-new nodes keep their radial seed.
    const prevPos = new Map(useBrainMapStore.getState().nodes.map(n => [n.id, n.position]));
    const seeded = initialNodes.map(n => {
      const p = prevPos.get(n.id);
      return p ? { ...n, position: p } : n;
    });

    let cancelled = false;
    const nodeSize = useVisualControlStore.getState().nodeSize;
    setLayoutComputing(true);
    runLayout({ layout, autoClustering, nodeSize }, toEngineNodes(seeded), toEngineEdges(initialEdges))
      .then(positions => {
        if (cancelled) return;
        setNodes(applyPositions(initialNodes, positions));
        setLayoutComputing(false);
      });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialNodes, initialEdges, projectId, setNodes, setEdges, setProjectId]);

  // WebSocket Integration for incremental updates
  const { fileEvents } = useOmnecorSocket({ projectId });

  useEffect(() => {
    if (!projectId || !fileEvents.length) return;
    const latest = fileEvents[fileEvents.length - 1];
    // Node ids are keyed on the absolute path (`node-${absolutePath}`), so the
    // incremental update must use filePath too — otherwise it creates orphan
    // nodes that never dedupe against or link to the indexed tree.
    const absPath = latest.filePath ?? latest.relativePath;
    const nodeId = `node-${absPath}`;

    if (latest.eventType === "add" || latest.eventType === "addDir") {
      setNodes(prev => {
        if (prev.some(n => n.id === nodeId)) return prev;
        const newNode: Node = {
          id: nodeId,
          type: "neural",
          data: {
            label: absPath.split("/").pop() ?? absPath,
            type: latest.eventType === "addDir" ? "folder" : "file",
            path: absPath,
            id: nodeId,
          },
          position: { x: Math.random() * 200 - 100, y: Math.random() * 200 - 100 },
          className: "node-new",
        };
        return [...prev, newNode];
      });

      const pathParts = absPath.split("/");
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

  // Clear the (store-global) computing flag on unmount so a layout in flight when
  // the user navigates away can't leave a stale overlay for the next mount.
  useEffect(() => () => setLayoutComputing(false), [setLayoutComputing]);

  return (
    <ReactFlowProvider>
      <BrainMapViewportInner {...props} />
    </ReactFlowProvider>
  );
}
