import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { FictionState, FictionNodeData, FictionRelationship, FictionTimelineEvent } from "@/types/fiction";

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

export const FictionModeProvider: React.FC<{ children: ReactNode; mapId?: string }> = ({
  children,
  mapId,
}) => {
  const [isFictionMode, setIsFictionMode] = useState(false);
  const [fictionState, setFictionState] = useState<FictionState>(INITIAL_STATE);

  // Load isolated state based on mapId
  useEffect(() => {
    if (mapId) {
      const saved = localStorage.getItem(`omnecor_fiction_state_${mapId}`);
      if (saved) {
        try {
          setFictionState(JSON.parse(saved));
        } catch (e) {
          console.error("Failed to parse fiction state", e);
        }
      } else {
        setFictionState(INITIAL_STATE);
      }
    }
  }, [mapId]);

  // Save isolated state
  useEffect(() => {
    if (mapId && fictionState !== INITIAL_STATE) {
      localStorage.setItem(`omnecor_fiction_state_${mapId}`, JSON.stringify(fictionState));
    }
  }, [fictionState, mapId]);

  const toggleFictionMode = () => setIsFictionMode(prev => !prev);
  const setFictionMode = (enabled: boolean) => setIsFictionMode(enabled);

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
