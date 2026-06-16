import React, { useCallback, useMemo } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  Handle,
  Position,
  NodeProps,
  Connection,
  Edge,
  ReactFlowProvider
} from 'reactflow';
import 'reactflow/dist/style.css';

// -----------------------------------------------------
// Custom Node: Logic Gate / IC Chip
// -----------------------------------------------------
const ChipNode = ({ data }: NodeProps) => {
  return (
    <div className="bg-slate-900 border-2 border-amber-500 rounded text-amber-500 font-mono text-xs shadow-lg min-w-[80px] p-2 flex flex-col items-center">
      <Handle type="target" position={Position.Left} className="w-2 h-2 bg-amber-500 rounded-none border-none" style={{ top: '30%' }} id="in1" />
      <Handle type="target" position={Position.Left} className="w-2 h-2 bg-amber-500 rounded-none border-none" style={{ top: '70%' }} id="in2" />
      
      <div className="font-bold border-b border-amber-500/50 pb-1 mb-1 w-full text-center">{data.label}</div>
      <div className={`w-3 h-3 rounded-full mt-1 ${data.active ? 'bg-green-500 shadow-[0_0_8px_#22c55e]' : 'bg-red-900'}`} />

      <Handle type="source" position={Position.Right} className="w-2 h-2 bg-amber-500 rounded-none border-none" id="out" />
    </div>
  );
};

const initialNodes = [
  { id: '1', type: 'chip', position: { x: 100, y: 100 }, data: { label: 'AND Gate', active: true } },
  { id: '2', type: 'chip', position: { x: 100, y: 200 }, data: { label: 'OR Gate', active: false } },
  { id: '3', type: 'chip', position: { x: 300, y: 150 }, data: { label: 'CPU', active: true } },
];

const initialEdges = [
  { id: 'e1-3', source: '1', target: '3', sourceHandle: 'out', targetHandle: 'in1', animated: true, style: { stroke: '#f59e0b', strokeWidth: 2 } },
  { id: 'e2-3', source: '2', target: '3', sourceHandle: 'out', targetHandle: 'in2', style: { stroke: '#f59e0b', strokeWidth: 2 } },
];

export default function SchematicEditor() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const nodeTypes = useMemo(() => ({ chip: ChipNode }), []);

  const onConnect = useCallback(
    (params: Connection | Edge) => setEdges((eds) => addEdge({ ...params, style: { stroke: '#f59e0b', strokeWidth: 2 } }, eds)),
    [setEdges],
  );

  return (
    <ReactFlowProvider>
      <div className="w-full h-full bg-[#0a192f] rounded-md overflow-hidden relative" style={{ backgroundImage: 'radial-gradient(#1e293b 1px, transparent 1px)', backgroundSize: '20px 20px' }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          fitView
          className="pcb-flow"
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#334155" gap={20} />
          <Controls className="bg-slate-800 border-slate-700 fill-slate-300" />
          <MiniMap nodeColor="#f59e0b" maskColor="rgba(15, 23, 42, 0.7)" style={{ backgroundColor: '#1e293b' }} />
        </ReactFlow>
      </div>
    </ReactFlowProvider>
  );
}
