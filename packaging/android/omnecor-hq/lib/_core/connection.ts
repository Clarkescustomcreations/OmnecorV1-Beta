/**
 * PC connection monitor.
 *
 * The Omnecor HQ app is fully usable offline — it must NEVER block startup on
 * the network. This module tracks whether the desktop Omnecor instance is
 * reachable by periodically hitting `/health`, and exposes a tiny pub/sub so a
 * global indicator can show "No PC connection" without every screen polling.
 *
 * State:
 *  - configured: the user has saved a PC IP in Settings
 *  - online:     the PC answered /health within the timeout
 *  - checking:   a probe is in flight
 */
import { getServerBaseUrl, isServerConfigured } from "./server-config";

export interface ConnectionState {
  configured: boolean;
  online: boolean;
  checking: boolean;
  lastChecked: number | null;
}

let _state: ConnectionState = { configured: false, online: false, checking: false, lastChecked: null };
const listeners = new Set<(s: ConnectionState) => void>();
let _timer: ReturnType<typeof setInterval> | null = null;

function emit() {
  const snapshot = { ..._state };
  listeners.forEach((fn) => {
    try { fn(snapshot); } catch { /* ignore listener errors */ }
  });
}

function set(patch: Partial<ConnectionState>) {
  _state = { ..._state, ...patch };
  emit();
}

export function getConnectionState(): ConnectionState {
  return { ..._state };
}

export function subscribeConnection(fn: (s: ConnectionState) => void): () => void {
  listeners.add(fn);
  fn({ ..._state });
  return () => listeners.delete(fn);
}

/** Probe the PC /health endpoint once. Never throws. */
export async function checkConnection(): Promise<boolean> {
  const configured = isServerConfigured();
  if (!configured) {
    set({ configured: false, online: false, checking: false, lastChecked: Date.now() });
    return false;
  }
  set({ configured: true, checking: true });
  const base = getServerBaseUrl();
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(`${base}/health`, { signal: controller.signal });
    const ok = res.ok;
    set({ configured: true, online: ok, checking: false, lastChecked: Date.now() });
    return ok;
  } catch {
    set({ configured: true, online: false, checking: false, lastChecked: Date.now() });
    return false;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Start periodic health checks. Safe to call multiple times (idempotent).
 * Runs an immediate probe, then every `intervalMs` (default 15s).
 */
export function startConnectionMonitor(intervalMs = 15000): void {
  set({ configured: isServerConfigured() });
  void checkConnection();
  if (_timer) return;
  _timer = setInterval(() => { void checkConnection(); }, intervalMs);
}

export function stopConnectionMonitor(): void {
  if (_timer) { clearInterval(_timer); _timer = null; }
}
