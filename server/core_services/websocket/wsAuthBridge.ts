/**
 * Bridge a mobile WebSocket `?token=` query parameter into an `Authorization`
 * header so the shared tRPC `createContext` → `sdk.authenticateRequest` (which
 * reads only the session cookie or a `Bearer` header) authenticates it.
 *
 * Why this exists: React Native WebSockets can't attach the SameSite cookie, and
 * neither browsers nor Electron can set an `Authorization` header on a WS upgrade
 * — so the Omnecor HQ APK passes its session token as `?token=` on the `/ws`
 * URL. The custom channel path (`OmnecorWebSocketServer.verifyClient`) already
 * accepts the connection on that token, but the tRPC subscription path
 * (`applyWSSHandler` → `createContext`) is separate and only knows cookie/Bearer.
 * Without this bridge a mobile tRPC subscription (e.g. `agentChatStream`) would
 * open the socket yet resolve no user and be rejected by `protectedProcedure`.
 *
 * Guarded to fire ONLY when neither a cookie nor an existing auth header is
 * present, so cookie (web) and Bearer (HTTP/desktop) callers are never altered.
 * Kept in its own module so the exact promotion logic is unit-testable without
 * standing up the whole WebSocket server.
 */

export interface WsAuthRequest {
  url?: string;
  headers: Record<string, string | string[] | undefined>;
}

/**
 * Promote a `?token=` query param on a WS upgrade request to an
 * `Authorization: Bearer <token>` header, in place. No-op when an auth header or
 * cookie is already present, when there is no `token` param, or when the URL is
 * malformed. Returns true when a header was written (mainly for tests/telemetry).
 */
export function bridgeWsAuthToken(req: WsAuthRequest | undefined | null): boolean {
  if (!req || !req.headers) return false;
  if (req.headers.authorization || req.headers.cookie) return false;
  let qToken: string | null = null;
  try {
    qToken = new URL(req.url ?? "/", "http://localhost").searchParams.get("token");
  } catch {
    return false; // malformed URL — leave unauthenticated
  }
  if (!qToken) return false;
  req.headers.authorization = `Bearer ${qToken}`;
  return true;
}
