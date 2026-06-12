/**
 * Minimal tRPC-over-HTTP client (no generated types).
 *
 * The mobile app's bundled tRPC client only knows the stub auth router, so for
 * the PC's real procedures we call the HTTP endpoint directly — the same pattern
 * the Chat screen uses for `ai.chat`. The server speaks superjson, so inputs are
 * wrapped as `{ json: <input> }` and outputs are read from `result.data.json`.
 *
 * Works for single (non-batched) calls against `/api/trpc/<procedure>`.
 */
import { getServerBaseUrl, isServerConfigured } from "./server-config";
import * as Auth from "./auth";

function unwrap<T>(data: any): T {
  // superjson-wrapped first, then plain, as a fallback
  return (data?.result?.data?.json ?? data?.result?.data) as T;
}

async function authHeaders(extra?: Record<string, string>): Promise<Record<string, string>> {
  const token = await Auth.getSessionToken();
  return {
    ...(extra ?? {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/** Call a tRPC query procedure. Pass `input` only if the procedure takes one. */
export async function trpcQuery<T = any>(proc: string, input?: unknown): Promise<T> {
  if (!isServerConfigured()) throw new Error("No server configured");
  const base = getServerBaseUrl();
  const qs =
    input !== undefined
      ? `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`
      : "";
  const resp = await fetch(`${base}/api/trpc/${proc}${qs}`, {
    method: "GET",
    headers: await authHeaders(),
  });
  if (!resp.ok) throw new Error(`tRPC ${proc} → ${resp.status}`);
  return unwrap<T>(await resp.json());
}

/** Call a tRPC mutation procedure. */
export async function trpcMutate<T = any>(proc: string, input?: unknown): Promise<T> {
  if (!isServerConfigured()) throw new Error("No server configured");
  const base = getServerBaseUrl();
  const resp = await fetch(`${base}/api/trpc/${proc}`, {
    method: "POST",
    headers: await authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ json: input ?? null }),
  });
  if (!resp.ok) throw new Error(`tRPC ${proc} → ${resp.status}`);
  return unwrap<T>(await resp.json());
}
