import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface AppState {
  // WebSocket Status
  wsStatus: 'connecting' | 'connected' | 'reconnecting' | 'offline';
  setWsStatus: (status: AppState['wsStatus']) => void;

  // Chat Display Settings (Global)
  chatDisplaySettings: {
    showTimestamps: boolean;
    showTokenCounts: boolean;
    showModelName: boolean;
    showLatency: boolean;
    autoStoreMemory: boolean;
    showThinkingQuotes: boolean;
    quoteStyle: "random" | "funny" | "serious";
  };
  setChatDisplaySettings: (settings: Partial<AppState['chatDisplaySettings']>) => void;

  // Command Palette
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
  toggleCommandPalette: () => void;

  // AI & Models
  valetFallbackModel: { providerId: string; modelId: string } | null;
  setValetFallbackModel: (model: { providerId: string; modelId: string } | null) => void;

  // Chat conversation state
  conversationMessages: Array<{ role: string; content: string }>;
  clearConversation: () => void;

  // File History (Recent Files)
  fileHistory: string[];
  addToHistory: (path: string) => void;

  // Execution Mode
  executionMode: "sovereign" | "scrapper" | "big_spender";
  setExecutionMode: (mode: AppState['executionMode']) => void;

  // Sidebar persistence
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;

  // Chat Sidebar persistence
  chatHistoryCollapsed: boolean;
  setChatHistoryCollapsed: (collapsed: boolean) => void;
  chatContextCollapsed: boolean;
  setChatContextCollapsed: (collapsed: boolean) => void;

  // Brain Map Sidebar persistence
  brainMapLeftCollapsed: boolean;
  setBrainMapLeftCollapsed: (collapsed: boolean) => void;
  brainMapRightCollapsed: boolean;
  setBrainMapRightCollapsed: (collapsed: boolean) => void;
  brainMapToolbarCollapsed: boolean;
  setBrainMapToolbarCollapsed: (collapsed: boolean) => void;

  // Global "How To" Hover Tooltips
  showTooltips: boolean;
  setShowTooltips: (show: boolean) => void;

  // Agentic Wallet
  walletSpend: {
    projectId: string;
    provider: string;
    modelId: string;
    costMicrocents: number;
    promptTokens: number;
    completionTokens: number;
  } | null;
  setWalletSpend: (spend: AppState['walletSpend']) => void;

  // Fiction Mode (Global Toggle)
  isFictionMode: boolean;
  toggleFictionMode: () => void;
  setFictionMode: (enabled: boolean) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
  wsStatus: 'connecting',
  setWsStatus: (status) => set({ wsStatus: status }),

  chatDisplaySettings: {
    showTimestamps: true,
    showTokenCounts: true,
    showModelName: true,
    showLatency: false,
    autoStoreMemory: true,
    showThinkingQuotes: true,
    quoteStyle: "random",
  },
  setChatDisplaySettings: (settings) => set((state) => ({ 
    chatDisplaySettings: { ...state.chatDisplaySettings, ...settings } 
  })),

  commandPaletteOpen: false,
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  toggleCommandPalette: () => set((state) => ({ commandPaletteOpen: !state.commandPaletteOpen })),

  valetFallbackModel: { providerId: "ollama", modelId: "llama3.2:latest" },
  setValetFallbackModel: (model) => set({ valetFallbackModel: model }),

  conversationMessages: [],
  clearConversation: () => set({ conversationMessages: [] }),

  fileHistory: [],
  addToHistory: (path) => set((state) => {
    const newHistory = [path, ...state.fileHistory.filter(p => p !== path)].slice(0, 10);
    return { fileHistory: newHistory };
  }),

  executionMode: "scrapper",
  setExecutionMode: (mode) => set({ executionMode: mode }),

  sidebarOpen: true,
  setSidebarOpen: (open) => set({ sidebarOpen: open }),

  chatHistoryCollapsed: false,
  setChatHistoryCollapsed: (collapsed) => set({ chatHistoryCollapsed: collapsed }),

  chatContextCollapsed: false,
  setChatContextCollapsed: (collapsed) => set({ chatContextCollapsed: collapsed }),

  brainMapLeftCollapsed: false,
  setBrainMapLeftCollapsed: (collapsed) => set({ brainMapLeftCollapsed: collapsed }),
  brainMapRightCollapsed: false,
  setBrainMapRightCollapsed: (collapsed) => set({ brainMapRightCollapsed: collapsed }),
  brainMapToolbarCollapsed: false,
  setBrainMapToolbarCollapsed: (collapsed) => set({ brainMapToolbarCollapsed: collapsed }),

  showTooltips: true,
  setShowTooltips: (show) => set({ showTooltips: show }),

  walletSpend: null,
  setWalletSpend: (spend) => set({ walletSpend: spend }),

  isFictionMode: false,
  toggleFictionMode: () => set((state) => ({ isFictionMode: !state.isFictionMode })),
  setFictionMode: (enabled) => set({ isFictionMode: enabled }),
    }),
    {
      name: "omnecor-app-store",
      partialize: (state) => ({
        showTooltips: state.showTooltips,
        sidebarOpen: state.sidebarOpen,
        chatHistoryCollapsed: state.chatHistoryCollapsed,
        chatContextCollapsed: state.chatContextCollapsed,
        brainMapLeftCollapsed: state.brainMapLeftCollapsed,
        brainMapRightCollapsed: state.brainMapRightCollapsed,
        brainMapToolbarCollapsed: state.brainMapToolbarCollapsed,
        executionMode: state.executionMode,
        valetFallbackModel: state.valetFallbackModel,
        chatDisplaySettings: state.chatDisplaySettings,
      }),
    }
  )
);

// Alias for wallet-specific consumers
export const useWalletStore = useAppStore;
