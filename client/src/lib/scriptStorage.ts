export interface SavedScript {
  id: string;
  name: string;
  description: string;
  code: string;
  language: string;
  project: string;
  createdAt: string;
  updatedAt: string;
}

const STORAGE_KEY = "omnecor:saved_scripts";

export function getSavedScripts(): SavedScript[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch (e) {
    console.error("Failed to load saved scripts", e);
    return [];
  }
}

export function saveScript(script: Omit<SavedScript, "id" | "createdAt" | "updatedAt">): SavedScript {
  const scripts = getSavedScripts();
  const now = new Date().toISOString();
  const newScript: SavedScript = {
    ...script,
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
  };
  scripts.unshift(newScript);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(scripts));
  return newScript;
}

export function updateScript(id: string, updates: Partial<SavedScript>): SavedScript | null {
  const scripts = getSavedScripts();
  const idx = scripts.findIndex(s => s.id === id);
  if (idx === -1) return null;

  const updated = {
    ...scripts[idx],
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  scripts[idx] = updated;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(scripts));
  return updated;
}

export function deleteScript(id: string): void {
  const scripts = getSavedScripts().filter(s => s.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(scripts));
}

export function getProjects(): string[] {
  const scripts = getSavedScripts();
  const projects = new Set(scripts.map(s => s.project).filter(Boolean));
  return Array.from(projects).sort();
}
