/**
 * Safe localStorage/sessionStorage wrapper.
 * Falls back to an in-memory map when storage is unavailable
 * (private browsing, strict sandboxing, quota exceeded).
 */

const memoryFallback = new Map<string, string>();

export const safeStorage = {
  getItem(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return memoryFallback.get(key) ?? null;
    }
  },
  setItem(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      memoryFallback.set(key, value);
    }
  },
  removeItem(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      memoryFallback.delete(key);
    }
  },
};

const sessionMemoryFallback = new Map<string, string>();

export const safeSessionStorage = {
  getItem(key: string): string | null {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return sessionMemoryFallback.get(key) ?? null;
    }
  },
  setItem(key: string, value: string): void {
    try {
      sessionStorage.setItem(key, value);
    } catch {
      sessionMemoryFallback.set(key, value);
    }
  },
  removeItem(key: string): void {
    try {
      sessionStorage.removeItem(key);
    } catch {
      sessionMemoryFallback.delete(key);
    }
  },
};
