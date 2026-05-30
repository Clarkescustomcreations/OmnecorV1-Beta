import React, { useCallback, useEffect } from 'react';
import ReactFlow, { 
  Background, 
  BackgroundVariant,
  Controls, 
  MiniMap, 
  useNodesState, 
  useEdgesState, 
  addEdge,
  Connection,
  Edge,
  Panel
} from 'reactflow';
import 'reactflow/dist/style.css';

import FileNode from './nodes/FileNode';
import { trpc } from '../../lib/trpc';
import { WebSocketManager } from '../../lib/websocket';
import { Button } from '../ui/button';
import { Search, Plus, LayoutGrid, Download } from 'lucide-react';
import { toast } from 'sonner';

const nodeTypes = {
  file: FileNode,
};

export const NeuralWorkspaceCanvas: React.FC<{ workspaceId: string }> = ({ workspaceId }) => {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  const workspaceQuery = trpc.project.getFileTree.useQuery({ projectId: workspaceId, rootDir: "." });

  const onConnect = useCallback(
    (params: Connection | Edge) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  useEffect(() => {
    if (workspaceQuery.data && Array.isArray(workspaceQuery.data)) {
      // Map project files to nodes for demonstration
      const initialNodes = workspaceQuery.data.slice(0, 5).map((file: any, i: number) => ({
        id: file.path || `file-${i}`,
        type: 'file',
        position: { x: 100 + (i * 200), y: 100 },
        data: { 
          label: file.name,
          path: file.path,
          language: file.name.split('.').pop() || 'text',
          size: file.size || 0,
          modified: file.modifiedAt || new Date().toISOString()
        },
      }));
      setNodes(initialNodes);
    }
  }, [workspaceQuery.data, setNodes]);

  useEffect(() => {
    const ws = WebSocketManager.getInstance();
    const unsubNode = ws.on("workspace.nodeAdded", (data: any) => {
      setNodes((nds) => [...nds, data.node]);
      toast.info(`Node added: ${data.node.data.label}`);
    });

    return () => unsubNode();
  }, [setNodes]);

  const handleAutoLayout = () => {
    toast.info("Computing optimal layout...");
    // Auto-layout logic would go here
  };

  return (
    <div className="w-full h-full bg-background relative">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        fitView
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
        <Controls />
        <MiniMap zoomable pannable />
        
        <Panel position="top-right" className="flex gap-2 bg-background/80 backdrop-blur p-2 rounded-lg border border-border shadow-sm">
          <Button variant="ghost" size="icon" className="h-8 w-8"><Search className="w-4 h-4" /></Button>
          <Button variant="ghost" size="icon" className="h-8 w-8"><Plus className="w-4 h-4" /></Button>
          <div className="w-[1px] h-8 bg-border mx-1" />
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleAutoLayout}><LayoutGrid className="w-4 h-4" /></Button>
          <Button variant="ghost" size="icon" className="h-8 w-8"><Download className="w-4 h-4" /></Button>
        </Panel>

        <Panel position="bottom-center" className="mb-4">
          <div className="bg-muted px-4 py-2 rounded-full border shadow-lg text-[10px] uppercase font-bold tracking-widest text-muted-foreground flex gap-4">
            <span>Nodes: {nodes.length}</span>
            <span>Edges: {edges.length}</span>
            <span className="text-green-500">Live Sync Active</span>
          </div>
        </Panel>
      </ReactFlow>
    </div>
  );
};
