"use client";

import React, { useMemo, useCallback, useEffect } from "react";
import ReactFlow, {
  Node,
  Edge,
  Controls,
  Background,
  MiniMap,
} from "reactflow";
import "reactflow/dist/style.css";
import { NeuralNetwork } from "@/lib/neuralNodeTree";
import { useOmnecorSocket } from "@/hooks/useOmnecorSocket";
import { useBrainMapStore } from "@/lib/stores/brainMapStore";

interface NeuralGraphViewProps {
  network: NeuralNetwork;
  projectId?: string;
  onNodeClick?: (nodeId: string) => void;
  onNodeDoubleClick?: (nodeId: string) => void;
  onEdgeClick?: (edgeId: string) => void;
  readOnly?: boolean;
}

/**
 * Pure viewport component that renders the graph from the global store.
 * Can be reused in floating and external windows.
 */
export function BrainMapViewport({
  onNodeClick,
  onNodeDoubleClick,
  onEdgeClick,
  readOnly = false,
}: Partial<NeuralGraphViewProps>) {
  const { nodes, edges, onNodesChange, onEdgesChange, onConnect } = useBrainMapStore();

  return (
    <div className="w-full h-full relative">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={(_e, n) => onNodeClick?.(n.id)}
        onNodeDoubleClick={(_e, n) => onNodeDoubleClick?.(n.id)}
        onEdgeClick={(_e, e) => onEdgeClick?.(e.id)}
        fitView
        className="bg-background/50"
      >
        <Background color="#333" gap={20} />
        <Controls />
        <MiniMap 
          nodeColor={(n) => {
            if (n.data?.type === 'project') return 'var(--accent-purple)';
            if (n.data?.type === 'folder') return 'var(--bg-elevated)';
            return 'var(--bg-secondary)';
          }}
          maskColor="rgba(0, 0, 0, 0.4)"
        />
      </ReactFlow>
      
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
        .react-flow__node {
          background: var(--bg-secondary);
          color: var(--foreground);
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 8px 12px;
          font-size: 11px;
          font-weight: 500;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
          transition: border-color 0.18s cubic-bezier(.2,.8,.2,1);
        }
        .react-flow__node:hover {
          border-color: var(--accent-cyan);
        }
        .react-flow__edge-path {
          stroke: var(--border);
          stroke-width: 1.5;
        }
        .react-flow__controls-button {
          background: var(--bg-elevated);
          border-bottom: 1px solid var(--border);
          fill: var(--muted-foreground);
        }
        .react-flow__controls-button:hover {
          background: var(--bg-secondary);
        }
      `}</style>
    </div>
  );
}

export default function NeuralGraphView(props: NeuralGraphViewProps) {
  const { network, projectId } = props;
  const setNodes = useBrainMapStore(s => s.setNodes);
  const setEdges = useBrainMapStore(s => s.setEdges);
  const setProjectId = useBrainMapStore(s => s.setProjectId);

  // Convert neural nodes to React Flow nodes
  const initialNodes: Node[] = useMemo(
    () =>
      network.nodes.map(neuralNode => ({
        id: neuralNode.id,
        data: {
          label: neuralNode.label,
          type: neuralNode.type,
          path: neuralNode.data.path,
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

  useEffect(() => {
    setProjectId(projectId || null);
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, projectId, setNodes, setEdges, setProjectId]);

  // WebSocket Integration for incremental updates
  const { fileEvents } = useOmnecorSocket({ projectId });

  useEffect(() => {
    if (!projectId || !fileEvents.length) return;
    const latest = fileEvents[fileEvents.length - 1];
    const nodeId = `node-${latest.relativePath}`;

    if (latest.eventType === "add" || latest.eventType === "addDir") {
      // Avoid duplicates
      setNodes(prev => {
        if (prev.some(n => n.id === nodeId)) return prev;
        
        const newNode: Node = {
          id: nodeId,
          data: {
            label: latest.relativePath.split("/").pop() ?? latest.relativePath,
            type: latest.eventType === "addDir" ? "folder" : "file",
            path: latest.relativePath,
          },
          // Random position near center for new nodes
          position: { x: Math.random() * 200 - 100, y: Math.random() * 200 - 100 },
          className: "node-new",
        };
        return [...prev, newNode];
      });
      
      // Auto-connect to parent if possible
      const pathParts = latest.relativePath.split("/");
      if (pathParts.length > 1) {
        pathParts.pop();
        const parentPath = pathParts.join("/");
        const parentId = `node-${parentPath}`;
        
        setEdges(prev => {
          const edgeId = `edge-${parentId}-${nodeId}`;
          if (prev.some(e => e.id === edgeId)) return prev;
          return [...prev, {
            id: edgeId,
            source: parentId,
            target: nodeId,
            type: "smoothstep",
            animated: latest.eventType === "addDir",
          }];
        });
      }
    } else if (latest.eventType === "unlink" || latest.eventType === "unlinkDir") {
      setNodes(prev => prev.filter(n => n.id !== nodeId));
      setEdges(prev => prev.filter(e => e.source !== nodeId && e.target !== nodeId));
    } else if (latest.eventType === "change") {
      setNodes(prev =>
        prev.map(n =>
          n.id === nodeId ? { ...n, className: "node-pulse" } : n
        )
      );
      setTimeout(() => {
        setNodes(prev =>
          prev.map(n => (n.id === nodeId ? { ...n, className: "" } : n))
        );
      }, 1500);
    }
  }, [fileEvents, projectId, setNodes, setEdges]);

  return <BrainMapViewport {...props} />;
}
