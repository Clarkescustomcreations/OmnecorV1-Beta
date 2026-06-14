import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Node } from "reactflow";

export type LayoutEngine = "force" | "hierarchical" | "mindmap" | "circular";

type LockedPositions = Array<{ id: string; position: { x: number; y: number } }>;

interface VisualControlState {
  layout: LayoutEngine;
  nodeSize: number;        // 20–50, default 20
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

export const useVisualControlStore = create<VisualControlState>()(
  persist(
    (set, get) => ({
      layout: "force",
      nodeSize: 20,
      simSpeed: 1,
      gpuEnabled: true,
      autoClustering: false,
      showMiniMap: true,
      showHoverDescriptions: true,
      lockedLayouts: {},

      setLayout: (layout) => set({ layout }),
      setNodeSize: (nodeSize) => set({ nodeSize: Math.max(20, Math.min(50, nodeSize)) }),
      setSimSpeed: (simSpeed) => set({ simSpeed }),
      setGpuEnabled: (gpuEnabled) => set({ gpuEnabled }),
      setAutoClustering: (autoClustering) => set({ autoClustering }),
      setShowMiniMap: (showMiniMap) => set({ showMiniMap }),
      setShowHoverDescriptions: (showHoverDescriptions) => set({ showHoverDescriptions }),

      lockLayout: (key, nodes) => {
        const positions: LockedPositions = nodes.map(n => ({ id: n.id, position: n.position }));
        set(s => ({ lockedLayouts: { ...s.lockedLayouts, [key]: positions } }));
      },

      unlockLayout: (key) => {
        set(s => {
          const next = { ...s.lockedLayouts };
          delete next[key];
          return { lockedLayouts: next };
        });
      },

      isLayoutLocked: (key) => !!get().lockedLayouts[key],

      getLockedPositions: (key) => get().lockedLayouts[key] ?? null,
    }),
    { name: "omnecor_visual_control" }
  )
);
