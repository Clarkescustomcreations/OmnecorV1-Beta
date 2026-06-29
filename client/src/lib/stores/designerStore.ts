import { create } from "zustand";

interface DesignerState {
  // Window management state
  windowMode: 'embedded' | 'floating' | 'external';
  windowPosition: { x: number; y: number };
  windowSize: { width: number; height: number };
  
  setWindowMode: (mode: 'embedded' | 'floating' | 'external') => void;
  setWindowPosition: (pos: { x: number; y: number }) => void;
  setWindowSize: (size: { width: number; height: number }) => void;

  // Cross-system AI Context
  active3DContext: string | null;
  activePCBContext: string | null;
  setActive3DContext: (context: string | null) => void;
  setActivePCBContext: (context: string | null) => void;
}

const syncChannel = new BroadcastChannel('omnecor_designer_store');

export const useDesignerStore = create<DesignerState>((set) => ({
  windowMode: 'embedded',
  windowPosition: { x: 150, y: 150 },
  windowSize: { width: 900, height: 700 },

  setWindowMode: (mode) => {
    set({ windowMode: mode });
    syncChannel.postMessage({ type: 'setWindowMode', payload: mode });
  },
  
  setWindowPosition: (pos) => set({ windowPosition: pos }),
  setWindowSize: (size) => set({ windowSize: size }),

  active3DContext: null,
  activePCBContext: null,
  setActive3DContext: (context) => {
    if (useDesignerStore.getState().active3DContext === context) return;
    set({ active3DContext: context });
    syncChannel.postMessage({ type: 'setActive3DContext', payload: context });
  },
  setActivePCBContext: (context) => {
    // Guard: skip the Zustand update (and subscriber notifications) when the
    // value hasn't actually changed.  Without this, calling setActivePCBContext(null)
    // repeatedly while pcbProjects is loading always creates a new merged-state
    // object, which re-notifies every unselectored useDesignerStore() subscriber
    // and causes an infinite render loop in EnhancedPCBEditorInner.
    if (useDesignerStore.getState().activePCBContext === context) return;
    set({ activePCBContext: context });
    syncChannel.postMessage({ type: 'setActivePCBContext', payload: context });
  },
}));

// Listen for sync messages
syncChannel.onmessage = (event) => {
  const { type, payload } = event.data;
  const store = useDesignerStore.getState();
  
  switch (type) {
    case 'setWindowMode':
      if (store.windowMode !== payload) useDesignerStore.setState({ windowMode: payload });
      break;
    case 'setActive3DContext':
      if (store.active3DContext !== payload) useDesignerStore.setState({ active3DContext: payload });
      break;
    case 'setActivePCBContext':
      if (store.activePCBContext !== payload) useDesignerStore.setState({ activePCBContext: payload });
      break;
  }
};
