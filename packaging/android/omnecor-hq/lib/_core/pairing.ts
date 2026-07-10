/**
 * Device pairing — the phone's primary way to authenticate to its Omnecor PC.
 *
 * Instead of OAuth, the PC (desktop Settings → Devices) shows a 6-digit code and
 * a QR. The phone scans the QR (which carries host+port+secret) or types the
 * code, then redeems it at `POST /api/pair/redeem` for the same `app_session_id`
 * JWT it uses as a Bearer token everywhere else. The token persists in
 * SecureStore, so the phone stays paired across PC restarts.
 */
import "react-native-get-random-values";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { saveServerConfig, getServerBaseUrl, isServerConfigured } from "./server-config";
import { setSessionToken, setUserInfo, type User } from "./auth";
import { setPairedAccount } from "./account";

export interface PairTarget {
  host: string;
  port: string;
  secret?: string;
}

const INSTALL_ID_KEY = "omnecor_install_id";

function randomHex(byteLen: number): string {
  const arr = new Uint8Array(byteLen);
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c?.getRandomValues) {
    c.getRandomValues(arr);
  } else {
    // Non-secure fallback — fine for a stable install identifier (the server only
    // hashes it to derive a deviceId; it is not a credential).
    for (let i = 0; i < byteLen; i++) arr[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * A stable per-install identifier persisted in SecureStore. Sent on redeem so the
 * PC maps this phone to one deterministic `deviceId` (re-pairing updates the same
 * paired-devices row instead of accumulating, and revocation is stable per device).
 */
export async function getOrCreateInstallId(): Promise<string> {
  try {
    if (Platform.OS === "web") {
      let id = window.localStorage.getItem(INSTALL_ID_KEY);
      if (!id) {
        id = randomHex(16);
        window.localStorage.setItem(INSTALL_ID_KEY, id);
      }
      return id;
    }
    let id = await SecureStore.getItemAsync(INSTALL_ID_KEY);
    if (!id) {
      id = randomHex(16);
      await SecureStore.setItemAsync(INSTALL_ID_KEY, id);
    }
    return id;
  } catch {
    // Storage unavailable — pairing still works, it just won't dedupe across pairs.
    return randomHex(16);
  }
}

/** Parse a scanned QR payload of the form `omnecor://pair?host=&port=&secret=`. */
export function parsePairingPayload(raw: string): PairTarget | null {
  const s = (raw ?? "").trim();
  if (!s.toLowerCase().startsWith("omnecor://pair")) return null;
  const qIndex = s.indexOf("?");
  if (qIndex < 0) return null;
  const params = new URLSearchParams(s.slice(qIndex + 1));
  const host = params.get("host") ?? "";
  if (!host) return null;
  return {
    host,
    port: params.get("port") ?? "3000",
    secret: params.get("secret") ?? undefined,
  };
}

async function redeem(
  baseUrl: string,
  body: { code?: string; secret?: string; deviceName: string },
): Promise<void> {
  const installId = await getOrCreateInstallId();
  const res = await fetch(`${baseUrl}/api/pair/redeem`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, installId }),
  });
  if (!res.ok) {
    if (res.status === 401) throw new Error("That pairing code is invalid or has expired.");
    throw new Error(`Pairing failed (${res.status}). Check the PC address and try a new code.`);
  }
  const data = (await res.json()) as { app_session_id?: string; user?: unknown };
  if (!data.app_session_id) throw new Error("Pairing did not return a session.");
  await setSessionToken(data.app_session_id);
  const user = data.user as User | undefined;
  if (user) await setUserInfo(user);
  // Persist onboarded state so a paired phone never sees the login screen again.
  await setPairedAccount(user?.name ?? body.deviceName);
}

/** Scan-to-pair: store the PC address from the QR, then redeem with the secret. */
export async function pairFromQr(target: PairTarget, deviceName: string): Promise<void> {
  await saveServerConfig({ ip: target.host, port: target.port });
  await redeem(getServerBaseUrl(), { secret: target.secret, deviceName });
}

/** Manual pair: the PC address must already be set; redeem the typed 6-digit code. */
export async function pairWithCode(code: string, deviceName: string): Promise<void> {
  if (!isServerConfigured()) throw new Error("Set your PC's address in Settings first.");
  await redeem(getServerBaseUrl(), { code: code.trim(), deviceName });
}

/** Manual pair from onboarding: set the PC address, then redeem the typed code. */
export async function pairWithCodeAt(
  host: string,
  port: string,
  code: string,
  deviceName: string,
): Promise<void> {
  await saveServerConfig({ ip: host.trim(), port: port.trim() || "3000" });
  await redeem(getServerBaseUrl(), { code: code.trim(), deviceName });
}
