import { create } from "zustand";
import { Node, Edge, Connection, addEdge, OnNodesChange, OnEdgesChange, applyNodeChanges, applyEdgeChanges } from "reactflow";

interface BrainMapState {
  nodes: Node[];
  edges: Edge[];
  projectId: string | null;

  // Folder collapse/expand state — IDs of folders whose children are hidden
  collapsedFolderIds: string[];

  // Actions
  setProjectId: (id: string | null) => void;
  setNodes: (nodes: Node[] | ((prev: Node[]) => Node[])) => void;
  setEdges: (edges: Edge[] | ((prev: Edge[]) => Edge[])) => void;
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  onConnect: (connection: Connection) => void;
  toggleFolderCollapse: (id: string) => void;
  isFolderCollapsed: (id: string) => boolean;

  // Window management state
  windowMode: 'embedded' | 'floating' | 'external';
  windowPosition: { x: number; y: number };
  windowSize: { width: number; height: number };

  setWindowMode: (mode: 'embedded' | 'floating' | 'external') => void;
  setWindowPosition: (pos: { x: number; y: number }) => void;
  setWindowSize: (size: { width: number; height: number }) => void;
}

const syncChannel = new BroadcastChannel('omnecor_brain_map_store');

export const useBrainMapStore = create<BrainMapState>((set, get) => ({
  nodes: [],
  edges: [],
  projectId: null,
  collapsedFolderIds: [],
  windowMode: 'embedded',
  windowPosition: { x: 100, y: 100 },
  windowSize: { width: 800, height: 600 },

  setProjectId: (id) => {
    set({ projectId: id, collapsedFolderIds: [] }); // reset collapse state on project switch
    syncChannel.postMessage({ type: 'setProjectId', payload: id });
  },

  setNodes: (nodesOrFn) => {
    const newNodes = typeof nodesOrFn === 'function' ? nodesOrFn(get().nodes) : nodesOrFn;
    set({ nodes: newNodes });
    syncChannel.postMessage({ type: 'setNodes', payload: newNodes });
  },

  setEdges: (edgesOrFn) => {
    const newEdges = typeof edgesOrFn === 'function' ? edgesOrFn(get().edges) : edgesOrFn;
    set({ edges: newEdges });
    syncChannel.postMessage({ type: 'setEdges', payload: newEdges });
  },

  onNodesChange: (changes) => {
    const nextNodes = applyNodeChanges(changes, get().nodes);
    set({ nodes: nextNodes });
    syncChannel.postMessage({ type: 'setNodes', payload: nextNodes });
  },

  onEdgesChange: (changes) => {
    const nextEdges = applyEdgeChanges(changes, get().edges);
    set({ edges: nextEdges });
    syncChannel.postMessage({ type: 'setEdges', payload: nextEdges });
  },

  onConnect: (connection) => {
    const nextEdges = addEdge(connection, get().edges);
    set({ edges: nextEdges });
    syncChannel.postMessage({ type: 'setEdges', payload: nextEdges });
  },

  toggleFolderCollapse: (id) => {
    set(s => ({
      collapsedFolderIds: s.collapsedFolderIds.includes(id)
        ? s.collapsedFolderIds.filter(x => x !== id)
        : [...s.collapsedFolderIds, id],
    }));
    syncChannel.postMessage({ type: 'toggleFolderCollapse', payload: id });
  },

  isFolderCollapsed: (id) => get().collapsedFolderIds.includes(id),

  setWindowMode: (mode) => {
    set({ windowMode: mode });
    syncChannel.postMessage({ type: 'setWindowMode', payload: mode });
  },

  setWindowPosition: (pos) => set({ windowPosition: pos }),
  setWindowSize: (size) => set({ windowSize: size }),
}));

// Listen for sync messages
syncChannel.onmessage = (event) => {
  const { type, payload } = event.data;
  const store = useBrainMapStore.getState();

  switch (type) {
    case 'setProjectId':
      if (store.projectId !== payload) useBrainMapStore.setState({ projectId: payload, collapsedFolderIds: [] });
      break;
    case 'setNodes':
      useBrainMapStore.setState({ nodes: payload });
      break;
    case 'setEdges':
      useBrainMapStore.setState({ edges: payload });
      break;
    case 'setWindowMode':
      if (store.windowMode !== payload) useBrainMapStore.setState({ windowMode: payload });
      break;
    case 'toggleFolderCollapse':
      useBrainMapStore.setState(s => ({
        collapsedFolderIds: s.collapsedFolderIds.includes(payload)
          ? s.collapsedFolderIds.filter((x: string) => x !== payload)
          : [...s.collapsedFolderIds, payload],
      }));
      break;
    case 'requestInitialState': {
      const s = useBrainMapStore.getState();
      syncChannel.postMessage({
        type: 'initialState',
        payload: {
          nodes: s.nodes,
          edges: s.edges,
          projectId: s.projectId,
          collapsedFolderIds: s.collapsedFolderIds,
        },
      });
      break;
    }
    case 'initialState':
      useBrainMapStore.setState({
        nodes: payload.nodes,
        edges: payload.edges,
        projectId: payload.projectId,
        collapsedFolderIds: payload.collapsedFolderIds,
      });
      break;
  }
};
