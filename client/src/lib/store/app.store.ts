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

  // Chat conversation state
  conversationMessages: Array<{ role: string; content: string }>;
  clearConversation: () => void;

  // File History (Recent Files)
  fileHistory: string[];
  addToHistory: (path: string) => void;

  // Execution Mode
  executionMode: "sovereign" | "scrapper" | "big_spender";
  setExecutionMode: (mode: AppState['executionMode']) => void;

  // Agentic Wallet
  walletSpend: {
    projectId: string;
    provider: string;
    modelId: string;
    costMicrocents: number;
    promptTokens: number;
    completionTokens: number;
  } | null;
  setWalletSpend: (event: AppState['walletSpend']) => void;
}

export const useAppStore = create<AppState>((set) => ({
  wsStatus: 'connecting',
  setWsStatus: (status) => set({ wsStatus: status }),

  commandPaletteOpen: false,
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  toggleCommandPalette: () => set((state) => ({ commandPaletteOpen: !state.commandPaletteOpen })),

  selectedModelId: null,
  setSelectedModelId: (id) => set({ selectedModelId: id }),

  conversationMessages: [],
  clearConversation: () => set({ conversationMessages: [] }),

  fileHistory: [],
  addToHistory: (path) => set((state) => {
    const newHistory = [path, ...state.fileHistory.filter(p => p !== path)].slice(0, 10);
    return { fileHistory: newHistory };
  }),

  executionMode: "scrapper",
  setExecutionMode: (mode) => set({ executionMode: mode }),

  walletSpend: null,
  setWalletSpend: (event) => set({ walletSpend: event }),
}));

// Alias for wallet-specific consumers
export const useWalletStore = useAppStore;
