import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  Node,
  Panel
} from 'reactflow';
import 'reactflow/dist/style.css';

import FileNode from './nodes/FileNode';
import { trpc } from '../../lib/trpc';
import { WebSocketManager } from '../../lib/websocket';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Search, Plus, LayoutGrid, Download, X } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';

interface FileNodeData {
  label: string;
  path: string;
  language: string;
  size: number;
  modified: string;
}

interface WorkspaceNodeEvent { node: Node<FileNodeData>; }

const nodeTypes = {
  file: FileNode,
};

export const NeuralWorkspaceCanvas: React.FC<{ workspaceId: string }> = ({ workspaceId }) => {
  const [nodes, setNodes, onNodesChange] = useNodesState<FileNodeData>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [addNodeOpen, setAddNodeOpen] = useState(false);
  const [newNodePath, setNewNodePath] = useState('');

  const workspaceQuery = trpc.project.getFileTree.useQuery({ projectId: workspaceId, rootDir: "." });

  // Track whether we have already seeded nodes from the initial query result.
  // Subsequent refetches must NOT replace the node list — user may have added
  // nodes manually or received them via WebSocket.
  const initialLoadDone = useRef(false);

  const onConnect = useCallback(
    (params: Connection | Edge) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  useEffect(() => {
    if (!workspaceQuery.data || !Array.isArray(workspaceQuery.data)) return;
    if (initialLoadDone.current) return; // never overwrite after the first load

    const queryNodes = workspaceQuery.data.slice(0, 5).map((file, i) => ({
      id: file.path || `file-${i}`,
      type: 'file',
      position: { x: 100 + (i * 200), y: 100 },
      data: {
        label: file.name,
        path: file.path,
        language: file.name.split('.').pop() || 'text',
        size: file.size || 0,
        modified: file.modifiedAt || new Date().toISOString(),
      },
    }));
    setNodes(queryNodes);
    initialLoadDone.current = true;
  }, [workspaceQuery.data, setNodes]);

  useEffect(() => {
    const ws = WebSocketManager.getInstance();
    const unsubNode = ws.on<WorkspaceNodeEvent>("workspace.nodeAdded", (data) => {
      setNodes((nds) => [...nds, data.node]);
      toast.info(`Node added: ${data.node.data.label}`);
    });
    return () => unsubNode();
  }, [setNodes]);

  const handleAutoLayout = () => {
    toast.info("Computing optimal layout...");
    setNodes((nds) =>
      nds.map((n, i) => ({
        ...n,
        position: { x: (i % 4) * 220 + 60, y: Math.floor(i / 4) * 160 + 60 },
      }))
    );
  };

  // Filter nodes by search query (highlight via opacity)
  const displayedNodes = searchQuery
    ? nodes.map(n => ({
        ...n,
        style: {
          ...n.style,
          opacity:
            n.data.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
            n.data.path.toLowerCase().includes(searchQuery.toLowerCase())
              ? 1
              : 0.25,
        },
      }))
    : nodes;

  const handleAddNode = () => {
    if (!newNodePath.trim()) return;
    const name = newNodePath.split(/[\\/]/).pop() || newNodePath;
    const newNode: Node<FileNodeData> = {
      id: `custom-${Date.now()}`,
      type: 'file',
      position: { x: 80 + Math.random() * 400, y: 80 + Math.random() * 300 },
      data: {
        label: name,
        path: newNodePath.trim(),
        language: name.split('.').pop() || 'text',
        size: 0,
        modified: new Date().toISOString(),
      },
    };
    setNodes((nds) => [...nds, newNode]);
    toast.success(`Node added: ${name}`);
    setNewNodePath('');
    setAddNodeOpen(false);
  };

  const handleDownload = () => {
    const exportData = {
      workspaceId,
      exportedAt: new Date().toISOString(),
      nodeCount: nodes.length,
      edgeCount: edges.length,
      nodes: nodes.map(n => ({ id: n.id, position: n.position, data: n.data })),
      edges: edges.map(e => ({ id: e.id, source: e.source, target: e.target })),
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `workspace-${workspaceId}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${nodes.length} nodes to JSON`);
  };

  return (
    <div className="w-full h-full bg-background relative">
      <ReactFlow
        nodes={displayedNodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
        <Controls />
        <MiniMap zoomable pannable />

        <Panel position="top-right" className="flex gap-2 bg-background/80 backdrop-blur p-2 rounded-lg border border-border shadow-sm">
          {searchOpen ? (
            <div className="flex items-center gap-1">
              <Input
                autoFocus
                placeholder="Filter nodes..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="h-8 w-40 text-xs"
                onKeyDown={e => e.key === 'Escape' && (setSearchOpen(false), setSearchQuery(''))}
              />
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setSearchOpen(false); setSearchQuery(''); }}>
                <X className="w-4 h-4" />
              </Button>
            </div>
          ) : (
            <>
              <Button variant="ghost" size="icon" className="h-8 w-8" title="Search nodes" onClick={() => setSearchOpen(true)}>
                <Search className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8" title="Add node" onClick={() => setAddNodeOpen(true)}>
                <Plus className="w-4 h-4" />
              </Button>
              <div className="w-[1px] h-8 bg-border mx-1" />
              <Button variant="ghost" size="icon" className="h-8 w-8" title="Auto-layout" onClick={handleAutoLayout}>
                <LayoutGrid className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8" title="Export workspace as JSON" onClick={handleDownload}>
                <Download className="w-4 h-4" />
              </Button>
            </>
          )}
        </Panel>

        <Panel position="bottom-center" className="mb-4">
          <div className="bg-muted px-4 py-2 rounded-full border shadow-lg text-[10px] uppercase font-bold tracking-widest text-muted-foreground flex gap-4">
            <span>Nodes: {nodes.length}</span>
            <span>Edges: {edges.length}</span>
            {searchQuery && <span className="text-yellow-500">Filter: {searchQuery}</span>}
            <span className="text-green-500">Live Sync Active</span>
          </div>
        </Panel>
      </ReactFlow>

      {/* Add Node Dialog */}
      <Dialog open={addNodeOpen} onOpenChange={setAddNodeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Node to Workspace</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">Enter the file or directory path to add as a node.</p>
            <Input
              autoFocus
              placeholder="e.g. src/components/App.tsx"
              value={newNodePath}
              onChange={e => setNewNodePath(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAddNode()}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddNodeOpen(false)}>Cancel</Button>
            <Button onClick={handleAddNode} disabled={!newNodePath.trim()}>Add Node</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
