// Bearer-token session for the Electron desktop app.
//
// The desktop frontend is served from the privileged scheme app://omnecor and
// talks to the embedded backend cross-origin at http://localhost:<port>. The
// backend's session cookie is SameSite=Strict, so it is never sent on those
// cross-origin requests. Instead, the local-auth routes return the sessionToken
// in the response body; we persist it here and send it as Authorization: Bearer
// on every backend call. The backend accepts either the cookie or the Bearer
// token (see sdk.authenticateRequest).
//
// In the normal web build window.api is undefined, getSessionToken() returns
// null, and nothing changes — auth keeps working via the same-origin cookie.

const STORAGE_KEY = "omnecor:session_token";

/** True when running inside the Electron desktop shell (preload exposed window.api). */
export const isElectron =
  typeof window !== "undefined" &&
  !!(window as Window & { api?: { backendBase?: string } }).api?.backendBase;

export function getSessionToken(): string | null {
  if (!isElectron) return null;
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setSessionToken(token: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, token);
  } catch {
    /* storage unavailable — ignore */
  }
}

export function clearSessionToken(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Authorization header for backend calls, or {} on the web build / when signed out. */
export function authHeaders(): Record<string, string> {
  const token = getSessionToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
