/**
 * Local-first account / onboarding for Omnecor HQ.
 *
 * Goals (per product spec):
 *  - The app must be usable with NO PC connection. A user can create a local
 *    account by username (offline) or skip entirely for GUI testing.
 *  - No double login: the SAME identity created on the phone registers on the
 *    desktop the first time the PC is reachable (HQ-first setup), and if the PC
 *    already has a local account, the phone adopts it (PC-first setup).
 *
 * The desktop exposes (Express, see server/_core/oauth.ts):
 *    POST /api/auth/local/register { name, password }  → sets cookie, returns { ok, sessionToken, name }
 *    POST /api/auth/local/login    { password }        → sets cookie, returns { ok, sessionToken, name }
 *    GET  /api/auth/local/exists                        → { exists }
 *    GET  /api/oauth/google/login   /  /api/oauth/microsoft/login (browser redirect)
 *
 * We store the chosen username + an auto-generated password (when the user only
 * typed a username) in SecureStore so the phone can transparently register or
 * sign in on the PC without prompting again.
 */
import * as SecureStore from "expo-secure-store";
import { nanoid } from "nanoid";
import { getServerBaseUrl, isServerConfigured } from "./server-config";
import { setSessionToken, setUserInfo, removeSessionToken, clearUserInfo } from "./auth";

export type AuthMethod = "local" | "google" | "microsoft" | "skipped";

export interface Account {
  username: string;
  method: AuthMethod;
  onboarded: boolean;
  /** true once the identity has been registered/adopted on the desktop. */
  syncedToPc: boolean;
}

const ACCOUNT_KEY = "omnecor_account";
const LOCAL_PW_KEY = "omnecor_local_password";

let _account: Account | null = null;
const listeners = new Set<(a: Account | null) => void>();

function emit() {
  const snap = _account ? { ..._account } : null;
  listeners.forEach((fn) => { try { fn(snap); } catch { /* ignore */ } });
}

export function subscribeAccount(fn: (a: Account | null) => void): () => void {
  listeners.add(fn);
  fn(_account ? { ..._account } : null);
  return () => listeners.delete(fn);
}

export function getAccount(): Account | null {
  return _account ? { ..._account } : null;
}

export function isOnboarded(): boolean {
  return !!_account?.onboarded;
}

async function persist(acc: Account) {
  _account = acc;
  await SecureStore.setItemAsync(ACCOUNT_KEY, JSON.stringify(acc));
  emit();
}

/** Load persisted account into memory at startup. Never throws. */
export async function loadAccount(): Promise<Account | null> {
  try {
    const raw = await SecureStore.getItemAsync(ACCOUNT_KEY);
    _account = raw ? (JSON.parse(raw) as Account) : null;
  } catch {
    _account = null;
  }
  emit();
  return _account;
}

/**
 * Create (or update) the local account. Works fully offline; if the PC is
 * reachable it immediately registers/adopts the identity there.
 */
export async function createLocalAccount(opts: { username: string; password?: string }): Promise<void> {
  const username = opts.username.trim() || "Owner";
  // The desktop requires a >=8 char password; generate a strong one when the
  // user only gave a username so we can still register on the PC silently.
  const password = opts.password && opts.password.length >= 8 ? opts.password : `omn-${nanoid(20)}`;
  await SecureStore.setItemAsync(LOCAL_PW_KEY, password);
  await persist({ username, method: "local", onboarded: true, syncedToPc: false });
  // Best-effort immediate sync; ignored if the PC isn't reachable yet.
  await syncAccountToPc().catch(() => {});
}

/** Skip onboarding — GUI-only / offline testing. */
export async function skipOnboarding(): Promise<void> {
  await persist({ username: "Guest", method: "skipped", onboarded: true, syncedToPc: false });
}

/** Mark that the user completed an OAuth (Google/Microsoft) sign-in via the PC. */
export async function setOAuthAccount(method: "google" | "microsoft", username: string): Promise<void> {
  await persist({ username, method, onboarded: true, syncedToPc: true });
}

/**
 * Register or adopt the local identity on the desktop. Called after onboarding
 * and whenever the PC becomes reachable. Idempotent and safe offline.
 */
export async function syncAccountToPc(): Promise<boolean> {
  if (!_account || _account.method !== "local") return false;
  if (!isServerConfigured()) return false;
  const base = getServerBaseUrl();
  const password = await SecureStore.getItemAsync(LOCAL_PW_KEY);
  if (!password) return false;

  try {
    const existsRes = await fetch(`${base}/api/auth/local/exists`);
    const { exists } = (await existsRes.json()) as { exists: boolean };

    const endpoint = exists ? "login" : "register";
    const body = exists ? { password } : { name: _account.username, password };
    const res = await fetch(`${base}/api/auth/local/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { ok?: boolean; sessionToken?: string; name?: string };
    if (data.sessionToken) await setSessionToken(data.sessionToken);
    if (data.name) {
      await setUserInfo({
        id: 0,
        openId: "local:owner",
        name: data.name,
        email: null,
        loginMethod: "local",
        lastSignedIn: new Date(),
      });
    }
    await persist({ ..._account, syncedToPc: true });
    return true;
  } catch {
    return false;
  }
}

/** Build the desktop OAuth URL to open in a browser (requires PC connection). */
export function getOAuthLoginUrl(provider: "google" | "microsoft"): string | null {
  if (!isServerConfigured()) return null;
  return `${getServerBaseUrl()}/api/oauth/${provider}/login`;
}

export async function logout(): Promise<void> {
  _account = null;
  await SecureStore.deleteItemAsync(ACCOUNT_KEY);
  await SecureStore.deleteItemAsync(LOCAL_PW_KEY);
  await removeSessionToken();
  await clearUserInfo();
  emit();
}
