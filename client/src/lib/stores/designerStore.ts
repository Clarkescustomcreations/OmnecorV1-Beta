import { create } from "zustand";

interface DesignerState {
  // Window management state
  windowMode: 'embedded' | 'floating' | 'external';
  windowPosition: { x: number; y: number };
  windowSize: { width: number; height: number };
  
  setWindowMode: (mode: 'embedded' | 'floating' | 'external') => void;
  setWindowPosition: (pos: { x: number; y: number }) => void;
  setWindowSize: (size: { width: number; height: number }) => void;
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
}));

// Listen for sync messages
syncChannel.onmessage = (event) => {
  const { type, payload } = event.data;
  const store = useDesignerStore.getState();
  
  switch (type) {
    case 'setWindowMode':
      if (store.windowMode !== payload) useDesignerStore.setState({ windowMode: payload });
      break;
  }
};
