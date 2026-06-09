import React, { createContext, useContext, useState, useEffect, useRef, ReactNode, useCallback } from "react";
import { NeuralBrainMap, NeuralMapMode } from "@/types/neural";
import { v4 as uuidv4 } from "uuid";
import { trpc } from "@/lib/trpc";

interface NeuralMapContextType {
  maps: NeuralBrainMap[];
  activeMapId: string | null;
  activeMap: NeuralBrainMap | null;
  dbReady: boolean;
  createMap: (name: string, mode: NeuralMapMode, roots: string[]) => NeuralBrainMap;
  deleteMap: (id: string) => void;
  updateMap: (id: string, updates: Partial<NeuralBrainMap>) => void;
  setActiveMap: (id: string) => void;
  duplicateMap: (id: string) => void;
}

const NeuralMapContext = createContext<NeuralMapContextType | undefined>(undefined);

const STORAGE_KEY = "omnecor_neural_maps";
const ACTIVE_MAP_KEY = "omnecor_active_map_id";
const MIGRATED_KEY = "omnecor_neural_maps_migrated";

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

// ── Helpers ──────────────────────────────────────────────────────────────────

function rowToMap(row: Record<string, unknown>): NeuralBrainMap {
  return {
    id: row.id as string,
    name: row.name as string,
    mode: (row.mode as NeuralMapMode) ?? "standard",
    rootDirectories: (row.rootDirectories as string[]) ?? [],
    projectContext: (row.projectContext as NeuralBrainMap["projectContext"]) ?? undefined,
    labelOverrides: (row.labelOverrides as Record<string, string>) ?? undefined,
    settings: {
      ...DEFAULT_SETTINGS,
      ...(row.settings as Partial<typeof DEFAULT_SETTINGS>),
    },
    createdAt: row.createdAt instanceof Date
      ? (row.createdAt as Date).toISOString()
      : (row.createdAt as string) ?? new Date().toISOString(),
    updatedAt: row.updatedAt instanceof Date
      ? (row.updatedAt as Date).toISOString()
      : (row.updatedAt as string) ?? new Date().toISOString(),
  };
}

// ── Provider ─────────────────────────────────────────────────────────────────

export const NeuralMapProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [maps, setMaps] = useState<NeuralBrainMap[]>([]);
  const [activeMapId, setActiveMapId] = useState<string | null>(null);
  const [dbReady, setDbReady] = useState(false);
  // Track whether the initial DB load happened so we don't double-apply localStorage
  const initialised = useRef(false);

  // ── tRPC mutations ──────────────────────────────────────────────────────
  const createMutation  = trpc.neuralMaps.create.useMutation();
  const updateMutation  = trpc.neuralMaps.update.useMutation();
  const deleteMutation  = trpc.neuralMaps.delete.useMutation();
  const migrateMutation = trpc.neuralMaps.migrate.useMutation();

  // ── DB load on mount ───────────────────────────────────────────────────
  // We use `useQuery` for the initial fetch. `trpc.neuralMaps.list` is a
  // protectedProcedure — it returns [] when the user is not logged in (sovereign
  // mode), so we fall back to localStorage in that case.
  const { data: dbMaps, isSuccess: dbLoaded, isError: dbError } =
    trpc.neuralMaps.list.useQuery(undefined, {
      retry: false,
      staleTime: Infinity,    // we manage cache manually
      refetchOnWindowFocus: false,
    });

  useEffect(() => {
    if (initialised.current) return;

    const savedActiveId = localStorage.getItem(ACTIVE_MAP_KEY);

    if (dbLoaded) {
      // DB is reachable
      initialised.current = true;
      setDbReady(true);

      if (dbMaps && dbMaps.length > 0) {
        // Use DB as source of truth
        const converted = (dbMaps as Record<string, unknown>[]).map(rowToMap);
        setMaps(converted);
        // Restore active map preference from localStorage if it still exists in DB
        if (savedActiveId && converted.some(m => m.id === savedActiveId)) {
          setActiveMapId(savedActiveId);
        } else if (converted.length > 0) {
          setActiveMapId(converted[0].id);
        }
        // Write back to localStorage cache
        localStorage.setItem(STORAGE_KEY, JSON.stringify(converted));
      } else {
        // DB is empty — migrate from localStorage if we haven't yet
        const rawLocal = localStorage.getItem(STORAGE_KEY);
        const alreadyMigrated = localStorage.getItem(MIGRATED_KEY) === "true";
        if (rawLocal && !alreadyMigrated) {
          try {
            const localMaps: NeuralBrainMap[] = JSON.parse(rawLocal);
            if (localMaps.length > 0) {
              setMaps(localMaps);
              if (savedActiveId && localMaps.some(m => m.id === savedActiveId)) {
                setActiveMapId(savedActiveId);
              } else {
                setActiveMapId(localMaps[0].id);
              }
              // Kick off one-time migration to DB
              migrateMutation.mutate(
                localMaps.map(m => ({
                  id: m.id,
                  name: m.name,
                  mode: m.mode,
                  rootDirectories: m.rootDirectories,
                  projectContext: (m.projectContext ?? null) as Record<string, unknown> | null,
                  labelOverrides: m.labelOverrides ?? null,
                  settings: m.settings as Record<string, unknown>,
                  createdAt: m.createdAt,
                })),
                { onSuccess: () => localStorage.setItem(MIGRATED_KEY, "true") }
              );
            }
          } catch {
            // corrupt localStorage — ignore
          }
        }
      }
    } else if (dbError) {
      // DB unreachable (offline / sovereign mode) — fall back to localStorage
      initialised.current = true;
      const rawLocal = localStorage.getItem(STORAGE_KEY);
      if (rawLocal) {
        try {
          setMaps(JSON.parse(rawLocal));
        } catch {
          /* ignore */
        }
      }
      if (savedActiveId) setActiveMapId(savedActiveId);
    }
  }, [dbLoaded, dbError, dbMaps]);

  // ── localStorage mirror ────────────────────────────────────────────────
  // Always keep localStorage in sync as a fast cache / offline fallback.
  useEffect(() => {
    if (maps.length > 0 || initialised.current) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(maps));
    }
  }, [maps]);

  useEffect(() => {
    if (activeMapId) localStorage.setItem(ACTIVE_MAP_KEY, activeMapId);
  }, [activeMapId]);

  // ── CRUD ───────────────────────────────────────────────────────────────

  const createMap = useCallback((name: string, mode: NeuralMapMode, roots: string[]): NeuralBrainMap => {
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
    setActiveMapId(id => id ?? newMap.id);

    if (dbReady) {
      createMutation.mutate({
        id: newMap.id,
        name: newMap.name,
        mode: newMap.mode,
        rootDirectories: newMap.rootDirectories,
        settings: newMap.settings as Record<string, unknown>,
      });
    }

    return newMap;
  }, [dbReady, createMutation]);

  const deleteMap = useCallback((id: string) => {
    setMaps(prev => {
      const remaining = prev.filter(m => m.id !== id);
      setActiveMapId(cur => {
        if (cur !== id) return cur;
        return remaining.length > 0 ? remaining[0].id : null;
      });
      return remaining;
    });

    if (dbReady) deleteMutation.mutate({ id });
  }, [dbReady, deleteMutation]);

  const updateMap = useCallback((id: string, updates: Partial<NeuralBrainMap>) => {
    const now = new Date().toISOString();
    setMaps(prev =>
      prev.map(m => m.id === id ? { ...m, ...updates, updatedAt: now } : m)
    );

    if (dbReady) {
      // Only send DB-storable fields
      updateMutation.mutate({
        id,
        ...(updates.name           !== undefined && { name: updates.name }),
        ...(updates.mode           !== undefined && { mode: updates.mode }),
        ...(updates.rootDirectories !== undefined && { rootDirectories: updates.rootDirectories }),
        ...(updates.projectContext  !== undefined && { projectContext: updates.projectContext ?? undefined }),
        ...(updates.labelOverrides  !== undefined && { labelOverrides: updates.labelOverrides ?? null }),
        ...(updates.settings        !== undefined && { settings: updates.settings as Record<string, unknown> | undefined }),
      });
    }
  }, [dbReady, updateMutation]);

  const setActiveMap = useCallback((id: string) => {
    setActiveMapId(id);
  }, []);

  const duplicateMap = useCallback((id: string) => {
    setMaps(prev => {
      const original = prev.find(m => m.id === id);
      if (!original) return prev;
      const duplicate: NeuralBrainMap = {
        ...original,
        id: uuidv4(),
        name: `${original.name} (Copy)`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      if (dbReady) {
        createMutation.mutate({
          id: duplicate.id,
          name: duplicate.name,
          mode: duplicate.mode,
          rootDirectories: duplicate.rootDirectories,
          projectContext: duplicate.projectContext ?? undefined,
          labelOverrides: duplicate.labelOverrides ?? undefined,
          settings: duplicate.settings as Record<string, unknown>,
        });
      }
      return [...prev, duplicate];
    });
  }, [dbReady, createMutation]);

  const activeMap = maps.find(m => m.id === activeMapId) ?? null;

  return (
    <NeuralMapContext.Provider
      value={{ maps, activeMapId, activeMap, dbReady, createMap, deleteMap, updateMap, setActiveMap, duplicateMap }}
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
