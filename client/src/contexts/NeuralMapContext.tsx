import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { NeuralBrainMap, NeuralMapMode } from "@/types/neural";
import { v4 as uuidv4 } from "uuid";

interface NeuralMapContextType {
  maps: NeuralBrainMap[];
  activeMapId: string | null;
  activeMap: NeuralBrainMap | null;
  createMap: (name: string, mode: NeuralMapMode, roots: string[]) => NeuralBrainMap;
  deleteMap: (id: string) => void;
  updateMap: (id: string, updates: Partial<NeuralBrainMap>) => void;
  setActiveMap: (id: string) => void;
  duplicateMap: (id: string) => void;
}

const NeuralMapContext = createContext<NeuralMapContextType | undefined>(undefined);

const STORAGE_KEY = "omnecor_neural_maps";
const ACTIVE_MAP_KEY = "omnecor_active_map_id";

const DEFAULT_SETTINGS = {
  autoWatch: true,
  realtimeSync: true,
  indexingEnabled: true,
  graphPhysics: true,
  maxDepth: 6,
  isolateMemory: true,
  enableAIContext: true,
  enableSemanticLinks: true,
};

export const NeuralMapProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [maps, setMaps] = useState<NeuralBrainMap[]>([]);
  const [activeMapId, setActiveMapId] = useState<string | null>(null);

  // Load from local storage
  useEffect(() => {
    const savedMaps = localStorage.getItem(STORAGE_KEY);
    const savedActiveId = localStorage.getItem(ACTIVE_MAP_KEY);

    if (savedMaps) {
      try {
        setMaps(JSON.parse(savedMaps));
      } catch (e) {
        console.error("Failed to parse saved maps", e);
      }
    }

    if (savedActiveId) {
      setActiveMapId(savedActiveId);
    }
  }, []);

  // Save to local storage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(maps));
  }, [maps]);

  useEffect(() => {
    if (activeMapId) {
      localStorage.setItem(ACTIVE_MAP_KEY, activeMapId);
    }
  }, [activeMapId]);

  const createMap = (name: string, mode: NeuralMapMode, roots: string[]) => {
    const newMap: NeuralBrainMap = {
      id: uuidv4(),
      name,
      mode,
      rootDirectories: roots,
      settings: { ...DEFAULT_SETTINGS, isolateMemory: mode === "fiction" },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    setMaps(prev => [...prev, newMap]);
    if (!activeMapId) {
      setActiveMapId(newMap.id);
    }
    return newMap;
  };

  const deleteMap = (id: string) => {
    setMaps(prev => prev.filter(m => m.id !== id));
    if (activeMapId === id) {
      const remaining = maps.filter(m => m.id !== id);
      setActiveMapId(remaining.length > 0 ? remaining[0].id : null);
    }
  };

  const updateMap = (id: string, updates: Partial<NeuralBrainMap>) => {
    setMaps(prev =>
      prev.map(m =>
        m.id === id
          ? { ...m, ...updates, updatedAt: new Date().toISOString() }
          : m
      )
    );
  };

  const setActiveMap = (id: string) => {
    setActiveMapId(id);
  };

  const duplicateMap = (id: string) => {
    const original = maps.find(m => m.id === id);
    if (!original) return;

    const duplicate: NeuralBrainMap = {
      ...original,
      id: uuidv4(),
      name: `${original.name} (Copy)`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    setMaps(prev => [...prev, duplicate]);
  };

  const activeMap = maps.find(m => m.id === activeMapId) || null;

  return (
    <NeuralMapContext.Provider
      value={{
        maps,
        activeMapId,
        activeMap,
        createMap,
        deleteMap,
        updateMap,
        setActiveMap,
        duplicateMap,
      }}
    >
      {children}
    </NeuralMapContext.Provider>
  );
};

export const useNeuralMap = () => {
  const context = useContext(NeuralMapContext);
  if (context === undefined) {
    throw new Error("useNeuralMap must be used within a NeuralMapProvider");
  }
  return context;
};
