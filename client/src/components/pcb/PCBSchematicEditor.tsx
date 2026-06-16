/**
 * PCBSchematicEditor Component
 * 
 * Main editor component that integrates:
 * - React Flow canvas
 * - Toolbar with editor controls
 * - Component library sidebar
 * - Properties panel
 * - AI assistant panel
 * - Netlist display
 */

import React, { useCallback, useMemo, useState } from 'react';
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
  ReactFlowProvider,
  useReactFlow,
  ControlButton,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { RotateCw } from 'lucide-react';


import { SchematicNode } from './SchematicNode';
import { PCBNode } from './PCBNode';
import { EditorToolbar } from './EditorToolbar';
import { ComponentLibraryPanel } from './ComponentLibraryPanel';
import { PropertiesPanel } from './PropertiesPanel';
import { AIAssistantPanel } from './AIAssistantPanel';
import { NetlistPanel } from './NetlistPanel';

export interface PCBSchematicEditorProps {
  projectId?: string;
  onSave?: (data: Record<string, unknown>) => void;
}

export const PCBSchematicEditorInner: React.FC<PCBSchematicEditorProps> = ({
  projectId,
  onSave,
}) => {
  // Canvas state
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const { fitView } = useReactFlow();

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

  // Node types for React Flow
  const nodeTypes: NodeTypes = useMemo(
    () => ({
      schematic: SchematicNode,
      pcb: PCBNode,
    }),
    []
  );

  // Handle node selection
  const handleNodeClick = useCallback(
    (event: React.MouseEvent, node: Node) => {
      setSelectedNodeId(node.id);
    },
    []
  );

  // Handle canvas click to deselect
  const handleCanvasClick = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  // Handle edge connection
  const handleConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            style: { stroke: '#f59e0b', strokeWidth: 2 },
            animated: true,
          },
          eds
        )
      );
    },
    [setEdges]
  );

  // Handle adding component from library
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
    },
    [mode, nodes.length, setNodes]
  );

  // Handle delete selected node
  const handleDeleteNode = useCallback(() => {
    if (selectedNodeId) {
      setNodes((nds) => nds.filter((n) => n.id !== selectedNodeId));
      setEdges((eds) =>
        eds.filter((e) => e.source !== selectedNodeId && e.target !== selectedNodeId)
      );
      setSelectedNodeId(null);
    }
  }, [selectedNodeId, setNodes, setEdges]);

  // Handle rotate selected node
  const handleRotateNode = useCallback(
    (angle: number) => {
      if (selectedNodeId) {
        setNodes((nds) =>
          nds.map((n) =>
            n.id === selectedNodeId
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
      }
    },
    [selectedNodeId, setNodes]
  );

  // Handle flip selected node
  const handleFlipNode = useCallback(
    (direction: 'horizontal' | 'vertical') => {
      if (selectedNodeId) {
        setNodes((nds) =>
          nds.map((n) =>
            n.id === selectedNodeId
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
      }
    },
    [selectedNodeId, setNodes]
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
    requestAnimationFrame(() => fitView({ duration: 400, padding: 0.2 }));
  }, [nodes, setNodes, fitView]);

  return (
    <div className="w-full h-full flex flex-col bg-slate-50">
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
        onDelete={handleDeleteNode}
        onShowLibrary={() => setShowLibrary(!showLibrary)}
        onShowProperties={() => setShowProperties(!showProperties)}
        onShowAI={() => setShowAI(!showAI)}
        onShowNetlist={() => setShowNetlist(!showNetlist)}
        showMiniMap={showMiniMap}
        onMiniMapToggle={() => setShowMiniMap(!showMiniMap)}
      />

      {/* Main Editor Area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Component Library Sidebar */}
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
            fitView
            snapToGrid={snapToGrid}
            snapGrid={[gridSize, gridSize]}
            proOptions={{ hideAttribution: true }}
          >
            {gridVisible && (
              <Background
                color="#d1d5db"
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
                maskColor="rgba(0, 0, 0, 0.1)"
                style={{
                  backgroundColor: '#f3f4f6',
                  border: '1px solid #d1d5db',
                  borderRadius: '0.375rem',
                  bottom: 75,
                }}
              />
            )}
          </ReactFlow>
        </div>

        {/* Properties Panel */}
        {showProperties && (
          <PropertiesPanel
            selectedNodeId={selectedNodeId}
            nodes={nodes}
            onUpdateNode={(node: Node) => {
              setNodes((nds) =>
                nds.map((n) => (n.id === node.id ? node : n))
              );
            }}
          />
        )}

        {/* AI Assistant Panel */}
        {showAI && (
          <AIAssistantPanel
            canvasState={{ nodes, edges, mode }}
            onClose={() => setShowAI(false)}
          />
        )}

        {/* Netlist Panel */}
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

export const PCBSchematicEditor: React.FC<PCBSchematicEditorProps> = (props) => {
  return (
    <ReactFlowProvider>
      <PCBSchematicEditorInner {...props} />
    </ReactFlowProvider>
  );
};

export default PCBSchematicEditor;
