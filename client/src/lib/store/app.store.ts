import { create } from "zustand";

export interface AppState {
  // WebSocket Status
  wsStatus: 'connecting' | 'connected' | 'reconnecting' | 'offline';
  setWsStatus: (status: AppState['wsStatus']) => void;

  // Command Palette
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
  toggleCommandPalette: () => void;

  // AI & Models
  selectedModelId: string | null;
  setSelectedModelId: (id: string | null) => void;

  // File History (Recent Files)
  fileHistory: string[];
  addToHistory: (path: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
  wsStatus: 'connecting',
  setWsStatus: (status) => set({ wsStatus: status }),

  commandPaletteOpen: false,
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  toggleCommandPalette: () => set((state) => ({ commandPaletteOpen: !state.commandPaletteOpen })),

  selectedModelId: null,
  setSelectedModelId: (id) => set({ selectedModelId: id }),

  fileHistory: [],
  addToHistory: (path) => set((state) => {
    const newHistory = [path, ...state.fileHistory.filter(p => p !== path)].slice(0, 10);
    return { fileHistory: newHistory };
  }),
}));
