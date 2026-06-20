import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Node } from "reactflow";

export type LayoutEngine = "force" | "hierarchical" | "mindmap" | "circular";

type LockedPositions = Array<{ id: string; position: { x: number; y: number } }>;

interface VisualControlState {
  layout: LayoutEngine;
  nodeSize: number;        // 20–70, default 40
  simSpeed: number;        // 0.1–3, default 1 (controls edge animation speed)
  gpuEnabled: boolean;     // default true — disabling hides animations
  autoClustering: boolean; // default false — groups same-type nodes spatially
  showMiniMap: boolean;    // default true — show/hide mini map overlay
  showHoverDescriptions: boolean; // default true — show/hide node hover tooltips
  // locked layout snapshots: key = `${projectId}:${layout}` → saved positions
  lockedLayouts: Record<string, LockedPositions>;

  setLayout: (layout: LayoutEngine) => void;
  setNodeSize: (size: number) => void;
  setSimSpeed: (speed: number) => void;
  setGpuEnabled: (enabled: boolean) => void;
  setAutoClustering: (enabled: boolean) => void;
  setShowMiniMap: (show: boolean) => void;
  setShowHoverDescriptions: (show: boolean) => void;
  lockLayout: (key: string, nodes: Node[]) => void;
  unlockLayout: (key: string) => void;
  isLayoutLocked: (key: string) => boolean;
  getLockedPositions: (key: string) => LockedPositions | null;
}

const syncChannel = new BroadcastChannel('omnecor_visual_control_sync');

export const useVisualControlStore = create<VisualControlState>()(
  persist(
    (set, get) => ({
      layout: "force",
      nodeSize: 40,
      simSpeed: 1,
      gpuEnabled: true,
      autoClustering: false,
      showMiniMap: true,
      showHoverDescriptions: true,
      lockedLayouts: {},

      setLayout: (layout) => {
        set({ layout });
        syncChannel.postMessage({ type: 'setLayout', payload: layout });
      },
      setNodeSize: (nodeSize) => {
        const size = Math.max(20, Math.min(70, nodeSize));
        set({ nodeSize: size });
        syncChannel.postMessage({ type: 'setNodeSize', payload: size });
      },
      setSimSpeed: (simSpeed) => {
        set({ simSpeed });
        syncChannel.postMessage({ type: 'setSimSpeed', payload: simSpeed });
      },
      setGpuEnabled: (gpuEnabled) => {
        set({ gpuEnabled });
        syncChannel.postMessage({ type: 'setGpuEnabled', payload: gpuEnabled });
      },
      setAutoClustering: (autoClustering) => {
        set({ autoClustering });
        syncChannel.postMessage({ type: 'setAutoClustering', payload: autoClustering });
      },
      setShowMiniMap: (showMiniMap) => {
        set({ showMiniMap });
        syncChannel.postMessage({ type: 'setShowMiniMap', payload: showMiniMap });
      },
      setShowHoverDescriptions: (showHoverDescriptions) => {
        set({ showHoverDescriptions });
        syncChannel.postMessage({ type: 'setShowHoverDescriptions', payload: showHoverDescriptions });
      },

      lockLayout: (key, nodes) => {
        const positions: LockedPositions = nodes.map(n => ({ id: n.id, position: n.position }));
        set(s => ({ lockedLayouts: { ...s.lockedLayouts, [key]: positions } }));
        syncChannel.postMessage({ type: 'lockLayout', payload: { key, positions } });
      },

      unlockLayout: (key) => {
        set(s => {
          const next = { ...s.lockedLayouts };
          delete next[key];
          return { lockedLayouts: next };
        });
        syncChannel.postMessage({ type: 'unlockLayout', payload: key });
      },

      isLayoutLocked: (key) => !!get().lockedLayouts[key],

      getLockedPositions: (key) => get().lockedLayouts[key] ?? null,
    }),
    { name: "omnecor_visual_control" }
  )
);

syncChannel.onmessage = (event) => {
  const { type, payload } = event.data;
  const store = useVisualControlStore.getState();

  switch (type) {
    case 'setLayout':
      if (store.layout !== payload) useVisualControlStore.setState({ layout: payload });
      break;
    case 'setNodeSize':
      if (store.nodeSize !== payload) useVisualControlStore.setState({ nodeSize: payload });
      break;
    case 'setSimSpeed':
      if (store.simSpeed !== payload) useVisualControlStore.setState({ simSpeed: payload });
      break;
    case 'setGpuEnabled':
      if (store.gpuEnabled !== payload) useVisualControlStore.setState({ gpuEnabled: payload });
      break;
    case 'setAutoClustering':
      if (store.autoClustering !== payload) useVisualControlStore.setState({ autoClustering: payload });
      break;
    case 'setShowMiniMap':
      if (store.showMiniMap !== payload) useVisualControlStore.setState({ showMiniMap: payload });
      break;
    case 'setShowHoverDescriptions':
      if (store.showHoverDescriptions !== payload) useVisualControlStore.setState({ showHoverDescriptions: payload });
      break;
    case 'lockLayout':
      useVisualControlStore.setState(s => ({
        lockedLayouts: { ...s.lockedLayouts, [payload.key]: payload.positions }
      }));
      break;
    case 'unlockLayout':
      useVisualControlStore.setState(s => {
        const next = { ...s.lockedLayouts };
        delete next[payload];
        return { lockedLayouts: next };
      });
      break;
    case 'requestInitialState': {
      const s = useVisualControlStore.getState();
      syncChannel.postMessage({
        type: 'initialState',
        payload: {
          layout: s.layout,
          nodeSize: s.nodeSize,
          simSpeed: s.simSpeed,
          gpuEnabled: s.gpuEnabled,
          autoClustering: s.autoClustering,
          showMiniMap: s.showMiniMap,
          showHoverDescriptions: s.showHoverDescriptions,
          lockedLayouts: s.lockedLayouts,
        },
      });
      break;
    }
    case 'initialState':
      useVisualControlStore.setState({
        layout: payload.layout,
        nodeSize: payload.nodeSize,
        simSpeed: payload.simSpeed,
        gpuEnabled: payload.gpuEnabled,
        autoClustering: payload.autoClustering,
        showMiniMap: payload.showMiniMap,
        showHoverDescriptions: payload.showHoverDescriptions,
        lockedLayouts: payload.lockedLayouts,
      });
      break;
  }
};
