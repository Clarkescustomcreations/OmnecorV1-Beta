"use client";

import React, { useMemo, useCallback, useEffect } from "react";
import ReactFlow, {
  Node,
  Edge,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  MiniMap,
  Connection,
  addEdge,
} from "reactflow";
import "reactflow/dist/style.css";
import { NeuralNetwork } from "@/lib/neuralNodeTree";
import { useOmnecorSocket } from "@/hooks/useOmnecorSocket";

interface NeuralGraphViewProps {
  network: NeuralNetwork;
  projectId?: string;
  onNodeClick?: (nodeId: string) => void;
  onNodeDoubleClick?: (nodeId: string) => void;
  onEdgeClick?: (edgeId: string) => void;
  readOnly?: boolean;
}

export default function NeuralGraphView({
  network,
  projectId,
  onNodeClick,
  onNodeDoubleClick,
  onEdgeClick,
  readOnly = false,
}: NeuralGraphViewProps) {
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

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

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

  const onConnect = useCallback(
    (connection: Connection) =>
      !readOnly && setEdges(eds => addEdge(connection, eds)),
    [readOnly, setEdges]
  );

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
            if (n.data?.type === 'project') return 'oklch(0.65 0.15 260)';
            if (n.data?.type === 'folder') return 'oklch(0.35 0.1 260)';
            return 'oklch(0.2 0.05 260)';
          }}
          maskColor="rgba(0, 0, 0, 0.1)"
        />
      </ReactFlow>
      
      <style>{`
        .node-pulse { 
          box-shadow: 0 0 20px 5px oklch(0.72 0.18 210 / 0.5); 
          border-color: oklch(0.72 0.18 210);
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
          background: oklch(0.16 0.015 260);
          color: oklch(0.9 0.01 260);
          border: 1px solid oklch(0.3 0.02 260);
          border-radius: 8px;
          padding: 8px 12px;
          font-size: 11px;
          font-weight: 500;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
        }
        .react-flow__edge-path {
          stroke: oklch(0.4 0.03 260);
          stroke-width: 1.5;
        }
        .react-flow__controls-button {
          background: oklch(0.2 0.02 260);
          border-bottom: 1px solid oklch(0.3 0.02 260);
          fill: oklch(0.8 0.01 260);
        }
        .react-flow__controls-button:hover {
          background: oklch(0.25 0.02 260);
        }
      `}</style>
    </div>
  );
}
