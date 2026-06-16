/**
 * Enhanced PCB/Schematic Editor
 * 
 * Complete implementation with:
 * - Proper undo/redo with keyboard shortcuts
 * - Multi-select support
 * - Save/load integration
 * - Real AI assistant
 * - Custom edges
 */

import React, { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import { useTheme } from '@/contexts/ThemeContext';
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
import { RotateCw } from 'lucide-react';


import { SchematicNode } from './SchematicNode';
import { PCBNode } from './PCBNode';
import { CustomEdge } from './CustomEdge';
import { EditorToolbar } from './EditorToolbar';
import { ComponentLibraryPanel } from './ComponentLibraryPanel';
import { PropertiesPanel } from './PropertiesPanel';
import { AIAssistantPanel } from './AIAssistantPanel';
import { NetlistPanel } from './NetlistPanel';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';

export interface EnhancedPCBEditorProps {
  projectId?: number;
}

interface HistoryState {
  nodes: Node[];
  edges: Edge[];
}

export const EnhancedPCBEditor: React.FC<EnhancedPCBEditorProps> = ({
  projectId,
}) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  // Canvas state
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const { getNodes, getEdges, fitView } = useReactFlow();

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

  // Undo/redo
  const [history, setHistory] = useState<HistoryState[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const historyRef = useRef<HistoryState[]>([]);

  // Save/load
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);


  // tRPC mutations + queries
  const saveDesignMutation = trpc.pcbEditor.saveDesign.useMutation({
    onError: (err) => toast.error("Failed to save design: " + err.message),
  });

  // Auto-load latest design when projectId is known
  const latestDesignQuery = trpc.pcbEditor.getLatestDesign.useQuery(
    { projectId: projectId! },
    {
      enabled: !!projectId,
      staleTime: Infinity,
      refetchOnWindowFocus: false,
    }
  );

  // Load into canvas on first fetch
  const hasLoadedRef = useRef(false);
  useEffect(() => {
    if (hasLoadedRef.current || !latestDesignQuery.data) return;
    hasLoadedRef.current = true;
    const design = latestDesignQuery.data;
    if (!design) return;
    try {
      const canvasData = typeof design.canvasData === "string"
        ? JSON.parse(design.canvasData)
        : (design.canvasData as { nodes: Node[]; edges: Edge[]; metadata?: { mode?: string } });
      if (canvasData?.nodes) setNodes(canvasData.nodes);
      if (canvasData?.edges) setEdges(canvasData.edges);
      if (canvasData?.metadata?.mode) setMode(canvasData.metadata.mode as "schematic" | "pcb");
    } catch {
      // malformed saved data — start fresh
    }
  }, [latestDesignQuery.data, setNodes, setEdges]);

  // Auto-save debounced after node/edge changes
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Node types
  const nodeTypes: NodeTypes = useMemo(
    () => ({
      schematic: SchematicNode,
      pcb: PCBNode,
    }),
    []
  );

  // Edge types
  const edgeTypes: EdgeTypes = useMemo(
    () => ({
      custom: CustomEdge,
    }),
    []
  );

  // Auto-save node positions when they change (debounced, only when projectId is set)
  useEffect(() => {
    if (!projectId || !nodes.length) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      saveDesignMutation.mutate({
        projectId,
        name: `Autosave ${new Date().toLocaleString()}`,
        canvasData: { nodes, edges, metadata: { mode } },
      });
    }, 1500);
    return () => { if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges]);

  // Add to history
  const addToHistory = useCallback(() => {
    const currentState: HistoryState = {
      nodes: getNodes(),
      edges: getEdges(),
    };

    const newHistory = historyRef.current.slice(0, historyIndex + 1);
    newHistory.push(currentState);
    historyRef.current = newHistory;
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  }, [historyIndex, getNodes, getEdges]);

  // Undo
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

  // Redo
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

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      } else if (e.key === 'Delete') {
        e.preventDefault();
        handleDeleteNodes();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSaveDesign();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo]);

  // Handle node selection
  const handleNodeClick = useCallback(
    (event: React.MouseEvent, node: Node) => {
      if (event.ctrlKey || event.metaKey) {
        // Multi-select
        setSelectedNodeIds((prev) =>
          prev.includes(node.id)
            ? prev.filter((id) => id !== node.id)
            : [...prev, node.id]
        );
      } else {
        // Single select
        setSelectedNodeIds([node.id]);
      }
    },
    []
  );

  // Handle canvas click
  const handleCanvasClick = useCallback(() => {
    setSelectedNodeIds([]);
  }, []);

  // Handle edge connection
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

  // Handle add component
  const handleAddComponent = useCallback(
    (componentId: string, position: { x: number; y: number }) => {
      const newNode: Node = {
        id: `node-${Date.now()}`,
        type: mode === 'schematic' ? 'schematic' : 'pcb',
        position,
        data: {
          component: componentId,
          reference: `R${nodes.length + 1}`,
          value: '10k',
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

  // Handle delete
  const handleDeleteNodes = useCallback(() => {
    if (selectedNodeIds.length === 0) return;

    setNodes((nds) => nds.filter((n) => !selectedNodeIds.includes(n.id)));
    setEdges((eds) =>
      eds.filter(
        (e) =>
          !selectedNodeIds.includes(e.source) &&
          !selectedNodeIds.includes(e.target)
      )
    );
    setSelectedNodeIds([]);
    addToHistory();
  }, [selectedNodeIds, setNodes, setEdges, addToHistory]);

  // Handle rotate
  const handleRotateNode = useCallback(
    (angle: number) => {
      if (selectedNodeIds.length === 0) return;

      setNodes((nds) =>
        nds.map((n) =>
          selectedNodeIds.includes(n.id)
            ? {
                ...n,
                data: {
                  ...n.data,
                  rotation: ((n.data.rotation || 0) + angle) % 360,
                },
              }
            : n
        )
      );
      addToHistory();
    },
    [selectedNodeIds, setNodes, addToHistory]
  );

  // Handle flip
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
                  flipped: {
                    ...n.data.flipped,
                    [direction]: !n.data.flipped?.[direction],
                  },
                },
              }
            : n
        )
      );
      addToHistory();
    },
    [selectedNodeIds, setNodes, addToHistory]
  );

  // Handle rotate canvas layout by 90 degrees
  const handleRotateCanvas = useCallback(() => {
    if (!nodes || nodes.length === 0) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    nodes.forEach((n) => {
      const x = n.position.x;
      const y = n.position.y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    });
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    const rotated = nodes.map((n) => {
      const rx = n.position.x - cx;
      const ry = n.position.y - cy;
      return {
        ...n,
        position: {
          x: cx - ry,
          y: cy + rx,
        },
      };
    });
    setNodes(rotated);
    addToHistory();
    requestAnimationFrame(() => fitView({ duration: 400, padding: 0.2 }));
    toast.success("Rotated schematic/PCB layout 90°");
  }, [nodes, setNodes, fitView, addToHistory]);

  // Save design
  const handleSaveDesign = useCallback(async () => {
    if (!projectId) {
      toast.error('No project selected');
      return;
    }

    setIsSaving(true);
    try {
      await saveDesignMutation.mutateAsync({
        projectId,
        name: `Design ${new Date().toLocaleString()}`,
        canvasData: {
          nodes: getNodes(),
          edges: getEdges(),
          metadata: { mode },
        },
      });
      toast.success('Design saved successfully');
      addToHistory();
    } catch (error) {
      toast.error('Failed to save design');
      console.error(error);
    } finally {
      setIsSaving(false);
    }
  }, [projectId, saveDesignMutation, getNodes, getEdges, mode, addToHistory]);

  // Load design
  const handleLoadDesign = useCallback(async (designId: number) => {
    setIsLoading(true);
    try {
      // Fetch design data directly via tRPC
      const response = await fetch(
        `/api/trpc/editor.loadDesign?input=${encodeURIComponent(JSON.stringify({ designSaveId: designId }))}`
      );
      const data = await response.json();
      if (data.result?.data) {
        const design = data.result.data;
        const canvasData = typeof design.canvasData === 'string'
          ? JSON.parse(design.canvasData)
          : design.canvasData;
        setNodes(canvasData.nodes);
        setEdges(canvasData.edges);
        setMode(canvasData.metadata?.mode || 'schematic');
        toast.success('Design loaded');
        addToHistory();
      }
    } catch (error) {
      toast.error('Failed to load design');
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  }, [setNodes, setEdges, addToHistory]);

  return (
    <div className="w-full h-full flex flex-col bg-background">
      <style dangerouslySetInnerHTML={{ __html: `
        .react-flow__controls {
          box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1) !important;
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
        .react-flow__controls-button:last-child {
          border-bottom: none !important;
        }
        .react-flow__controls-button:hover {
          background: var(--bg-secondary) !important;
        }
        .react-flow__controls-button svg {
          fill: currentColor !important;
        }
      `}} />

      {/* Toolbar */}
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
        onShowNetlist={() => setShowNetlist(!showNetlist)}
        showMiniMap={showMiniMap}
        onMiniMapToggle={() => setShowMiniMap(!showMiniMap)}
      />

      {/* Main Editor Area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Component Library */}
        {showLibrary && (
          <ComponentLibraryPanel
            onAddComponent={handleAddComponent}
            mode={mode}
          />
        )}

        {/* React Flow Canvas */}
        <div className="flex-1 relative">
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
              <ControlButton onClick={handleRotateCanvas} title="Rotate Layout 90°">
                <RotateCw className="w-3.5 h-3.5" />
              </ControlButton>
            </Controls>
            {showMiniMap && (
              <MiniMap
                nodeColor="#f59e0b"
                maskColor={isDark ? 'rgba(0, 0, 0, 0.4)' : 'rgba(0, 0, 0, 0.1)'}
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
              setNodes((nds) =>
                nds.map((n) => (n.id === node.id ? node : n))
              );
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
          <NetlistPanel
            nodes={nodes}
            edges={edges}
            onClose={() => setShowNetlist(false)}
          />
        )}
      </div>
    </div>
  );
};

function EnhancedPCBEditorWithProvider(props: EnhancedPCBEditorProps) {
  return (
    <ReactFlowProvider>
      <EnhancedPCBEditor {...props} />
    </ReactFlowProvider>
  );
}

export default EnhancedPCBEditorWithProvider;
