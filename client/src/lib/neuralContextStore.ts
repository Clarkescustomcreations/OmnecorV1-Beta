import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface NeuralContextEntry {
  id: string;      // stable: sha-ish hash of path
  path: string;
  name: string;
  nodeType: "file" | "folder" | "project";
  addedAt: string; // ISO timestamp
}

interface NeuralContextStore {
  entries: NeuralContextEntry[];
  add: (entry: NeuralContextEntry) => void;
  remove: (id: string) => void;
  clear: () => void;
  has: (id: string) => boolean;
}

function hashPath(path: string): string {
  let h = 0;
  for (let i = 0; i < path.length; i++) {
    h = (Math.imul(31, h) + path.charCodeAt(i)) | 0;
  }
  return `nctx_${Math.abs(h).toString(36)}`;
}

export function makeEntry(
  path: string,
  name: string,
  nodeType: NeuralContextEntry["nodeType"]
): NeuralContextEntry {
  return { id: hashPath(path), path, name, nodeType, addedAt: new Date().toISOString() };
}

// Persisted so entries survive a page navigation from BrainMap → Chat
export const useNeuralContextStore = create<NeuralContextStore>()(
  persist(
    (set, get) => ({
      entries: [],
      add: (entry) =>
        set((s) => ({
          entries: s.entries.some((e) => e.id === entry.id)
            ? s.entries
            : [...s.entries, entry],
        })),
      remove: (id) =>
        set((s) => ({ entries: s.entries.filter((e) => e.id !== id) })),
      clear: () => set({ entries: [] }),
      has: (id) => get().entries.some((e) => e.id === id),
    }),
    { name: "omnecor_neural_context" }
  )
);

// HTML5 drag transfer key
export const NEURAL_DRAG_KEY = "application/omnecor-neural-node";
