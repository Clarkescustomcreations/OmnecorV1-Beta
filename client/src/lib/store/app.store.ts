import { create } from "zustand";
import { persist } from "zustand/middleware";

/** A single between-turn queued message (type-ahead while the AI is streaming). */
export interface QueuedMessage {
  id: string;
  content: string;
}

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
    /** Auto-approve agentic tool actions (commands/edits/jobs) scoped to the active map. */
    autoApproveTools: boolean;
    /** "Fabrication" toggle — expose the Blueprint Studio toolset in the main chat
     *  so the AI can create + build a Build Plan inline. Default off. */
    fabricationTools: boolean;
  };
  setChatDisplaySettings: (settings: Partial<AppState['chatDisplaySettings']>) => void;

  /** Brain Packs toggled on for the current chat (per-chat attach, Brains-Upgrade Phase 8). */
  activeBrainIds: string[];
  setActiveBrainIds: (ids: string[]) => void;
  toggleActiveBrain: (id: string) => void;

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

  // Between-turn message queue (type-ahead while the AI is streaming).
  // Deliberately NOT persisted — a stale queued turn must never auto-fire on
  // reload. Bound to the active chat conversation; cleared on conversation switch.
  messageQueue: QueuedMessage[];
  /** Append a message to the queue; returns the new queued-message id. */
  enqueueMessage: (content: string) => string;
  /** FIFO: remove and return the oldest queued message (drives the next turn). */
  dequeueMessage: () => QueuedMessage | undefined;
  /** LIFO: remove and return the newest queued message (up-arrow recall). */
  popLatestQueuedMessage: () => QueuedMessage | undefined;
  /** Remove a single queued message by id (chip ✕). */
  removeQueuedMessage: (id: string) => void;
  /** Drop the whole queue (conversation switch / unmount / stream error). */
  clearMessageQueue: () => void;

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
    (set, get) => ({
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
    autoApproveTools: false,
    fabricationTools: false,
  },
  setChatDisplaySettings: (settings) => set((state) => ({
    chatDisplaySettings: { ...state.chatDisplaySettings, ...settings }
  })),

  activeBrainIds: [],
  setActiveBrainIds: (ids) => set({ activeBrainIds: ids.slice(0, 16) }),
  toggleActiveBrain: (id) => set((state) => ({
    activeBrainIds: state.activeBrainIds.includes(id)
      ? state.activeBrainIds.filter((b) => b !== id)
      : [...state.activeBrainIds, id].slice(0, 16),
  })),

  commandPaletteOpen: false,
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  toggleCommandPalette: () => set((state) => ({ commandPaletteOpen: !state.commandPaletteOpen })),

  valetFallbackModel: { providerId: "ollama", modelId: "llama3.2:latest" },
  setValetFallbackModel: (model) => set({ valetFallbackModel: model }),

  conversationMessages: [],
  clearConversation: () => set({ conversationMessages: [] }),

  messageQueue: [],
  enqueueMessage: (content) => {
    const id = crypto.randomUUID();
    set((state) => ({ messageQueue: [...state.messageQueue, { id, content }] }));
    return id;
  },
  dequeueMessage: () => {
    const [next, ...rest] = get().messageQueue;
    if (!next) return undefined;
    set({ messageQueue: rest });
    return next;
  },
  popLatestQueuedMessage: () => {
    const queue = get().messageQueue;
    if (queue.length === 0) return undefined;
    const next = queue[queue.length - 1];
    set({ messageQueue: queue.slice(0, -1) });
    return next;
  },
  removeQueuedMessage: (id) =>
    set((state) => ({ messageQueue: state.messageQueue.filter((m) => m.id !== id) })),
  clearMessageQueue: () => set({ messageQueue: [] }),

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
        activeBrainIds: state.activeBrainIds,
      }),
    }
  )
);

// Alias for wallet-specific consumers
export const useWalletStore = useAppStore;
