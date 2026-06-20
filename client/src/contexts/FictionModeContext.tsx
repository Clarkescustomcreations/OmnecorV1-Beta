import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from "react";
import { FictionState, FictionNodeData, FictionRelationship, FictionTimelineEvent } from "@/types/fiction";
import { safeStorage } from "@/lib/safeStorage";
import { useAppStore } from "@/lib/store/app.store";

interface FictionModeContextType {
  isFictionMode: boolean;
  toggleFictionMode: () => void;
  setFictionMode: (enabled: boolean) => void;
  fictionState: FictionState;
  addFictionNode: (node: Omit<FictionNodeData, "id">) => void;
  updateFictionNode: (id: string, updates: Partial<FictionNodeData>) => void;
  removeFictionNode: (id: string) => void;
  addRelationship: (rel: Omit<FictionRelationship, "id">) => void;
  addTimelineEvent: (event: Omit<FictionTimelineEvent, "id">) => void;
  updateLore: (key: string, value: string) => void;
  clearFictionState: () => void;
}

const FictionModeContext = createContext<FictionModeContextType | undefined>(undefined);

const INITIAL_STATE: FictionState = {
  nodes: [],
  relationships: [],
  timeline: [],
  lore: {},
};

export const FictionModeProvider: React.FC<{
  children: ReactNode;
  mapId?: string;
  /** DB-loaded fiction state for this map — takes priority over localStorage on map switch. */
  dbFictionState?: FictionState | null;
  /** Called (debounced 1.5 s) whenever fiction state changes — use to persist to DB. */
  onFictionStateChange?: (mapId: string, state: FictionState) => void;
}> = ({
  children,
  mapId,
  dbFictionState,
  onFictionStateChange,
}) => {
  const isFictionMode = useAppStore(s => s.isFictionMode);
  const toggleFictionMode = useAppStore(s => s.toggleFictionMode);
  const setFictionMode = useAppStore(s => s.setFictionMode);
  const [fictionState, setFictionState] = useState<FictionState>(INITIAL_STATE);
  const isLoadingRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onStateChangeRef = useRef(onFictionStateChange);
  onStateChangeRef.current = onFictionStateChange;

  // Load state when mapId changes: DB takes priority, then localStorage, then INITIAL_STATE
  useEffect(() => {
    if (!mapId) return;
    isLoadingRef.current = true;
    if (dbFictionState && (dbFictionState.nodes?.length > 0 || dbFictionState.relationships?.length > 0 || Object.keys(dbFictionState.lore ?? {}).length > 0)) {
      setFictionState(dbFictionState);
      // Also update localStorage cache
      safeStorage.setItem(`omnecor_fiction_state_${mapId}`, JSON.stringify(dbFictionState));
    } else {
      const saved = safeStorage.getItem(`omnecor_fiction_state_${mapId}`);
      if (saved) {
        try { setFictionState(JSON.parse(saved)); }
        catch { setFictionState(INITIAL_STATE); }
      } else {
        setFictionState(INITIAL_STATE);
      }
    }
    // Allow the state-change effect to ignore this load
    requestAnimationFrame(() => { isLoadingRef.current = false; });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapId, dbFictionState]);

  // Save to localStorage (immediate) and notify parent for DB save (debounced)
  useEffect(() => {
    if (isLoadingRef.current) return;
    if (mapId) {
      safeStorage.setItem(`omnecor_fiction_state_${mapId}`, JSON.stringify(fictionState));
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        onStateChangeRef.current?.(mapId, fictionState);
      }, 1500);
    }
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fictionState, mapId]);

  const addFictionNode = (node: Omit<FictionNodeData, "id">) => {
    const newNode = { ...node, id: crypto.randomUUID() };
    setFictionState(prev => ({
      ...prev,
      nodes: [...prev.nodes, newNode],
    }));
  };

  const updateFictionNode = (id: string, updates: Partial<FictionNodeData>) => {
    setFictionState(prev => ({
      ...prev,
      nodes: prev.nodes.map(n => (n.id === id ? { ...n, ...updates } : n)),
    }));
  };

  const removeFictionNode = (id: string) => {
    setFictionState(prev => ({
      ...prev,
      nodes: prev.nodes.filter(n => n.id !== id),
      relationships: prev.relationships.filter(r => r.sourceId !== id && r.targetId !== id),
    }));
  };

  const addRelationship = (rel: Omit<FictionRelationship, "id">) => {
    const newRel = { ...rel, id: crypto.randomUUID() };
    setFictionState(prev => ({
      ...prev,
      relationships: [...prev.relationships, newRel],
    }));
  };

  const addTimelineEvent = (event: Omit<FictionTimelineEvent, "id">) => {
    const newEvent = { ...event, id: crypto.randomUUID() };
    setFictionState(prev => ({
      ...prev,
      timeline: [...prev.timeline, newEvent].sort((a, b) => a.order - b.order),
    }));
  };

  const updateLore = (key: string, value: string) => {
    setFictionState(prev => ({
      ...prev,
      lore: { ...prev.lore, [key]: value },
    }));
  };

  const clearFictionState = () => setFictionState(INITIAL_STATE);

  return (
    <FictionModeContext.Provider
      value={{
        isFictionMode,
        toggleFictionMode,
        setFictionMode,
        fictionState,
        addFictionNode,
        updateFictionNode,
        removeFictionNode,
        addRelationship,
        addTimelineEvent,
        updateLore,
        clearFictionState,
      }}
    >
      {children}
    </FictionModeContext.Provider>
  );
};

export const useFictionMode = () => {
  const context = useContext(FictionModeContext);
  if (context === undefined) {
    throw new Error("useFictionMode must be used within a FictionModeProvider");
  }
  return context;
};
