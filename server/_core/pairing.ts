/**
 * Device pairing for the Omnecor HQ mobile app.
 *
 * The phone authenticates to the PC by redeeming a short-lived, single-use
 * pairing code (shown on the desktop) — or, on the same LAN with a shared
 * OMMESH_SECRET, automatically via the mesh handshake. Either way the PC mints
 * the SAME `app_session_id` JWT the phone already uses as a Bearer token; the
 * token carries a `deviceId` so a lost phone can be revoked.
 *
 *  • Pairing CODES are ephemeral (in-memory, single active code per user, 3-min
 *    TTL) — a PC restart mid-pairing just means "generate a new code".
 *  • Paired DEVICES are persistent (`paired_devices` table) so a paired phone
 *    never has to re-pair across PC restarts, and the user can see/revoke them.
 */
import { randomInt, randomBytes, createHash } from "crypto";
import { eq, and, desc, isNotNull } from "drizzle-orm";
import { getDb, getUserByOpenId } from "../db.factory.js";
import { pairedDevices, type PairedDevice } from "../../drizzle/schema.js";
import { sdk } from "./sdk.js";
import { markDeviceRevoked, unmarkDeviceRevoked, isDeviceRevoked, loadRevokedDevices } from "./device-revocation.js";
import { createLogger } from "./logger.js";

const log = createLogger("pairing");

const CODE_TTL_MS = 3 * 60 * 1000; // pairing codes live 3 minutes
// Paired-device session tokens are long-lived (a phone shouldn't re-pair daily)
// but NOT indefinite — a lost phone self-expires in 30 days even if never revoked.
const DEVICE_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface PendingPair {
  openId: string;
  name: string;
  expiresAt: number;
  code: string;   // short, for manual typing (brute-force-throttled by the limiter)
  secret: string; // long high-entropy value carried in the QR (brute-force-proof)
}

// One active pairing per desktop user at a time (generating a new one replaces
// it). Indexed by BOTH the short code and the long secret so either redeems.
// (Mirrors Jellyfin Quick Connect's split: a short code you can type + a long
// secret the device holds — the QR carries the secret so the scanned path never
// depends on the 6-digit entropy.)
const _pending = new Map<string, PendingPair>();    // code | secret → pair
const _pairByUser = new Map<string, PendingPair>(); // openId → pair

function genCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

function dropPair(pair: PendingPair | undefined): void {
  if (!pair) return;
  _pending.delete(pair.code);
  _pending.delete(pair.secret);
  if (_pairByUser.get(pair.openId) === pair) _pairByUser.delete(pair.openId);
}

function sweepExpired(): void {
  const now = Date.now();
  for (const pair of _pairByUser.values()) if (pair.expiresAt < now) dropPair(pair);
}

export const PairingService = {
  /**
   * Create (or replace) the active pairing for a desktop user. Returns a short
   * `code` (manual entry) and a long `secret` (encoded in the QR); both map to
   * the same single-use pairing.
   */
  createCode(openId: string, name: string): { code: string; secret: string; expiresAt: number } {
    sweepExpired();
    dropPair(_pairByUser.get(openId));
    let code = genCode();
    while (_pending.has(code)) code = genCode(); // avoid the rare collision
    const secret = randomBytes(32).toString("hex");
    const expiresAt = Date.now() + CODE_TTL_MS;
    const pair: PendingPair = { openId, name, expiresAt, code, secret };
    _pending.set(code, pair);
    _pending.set(secret, pair);
    _pairByUser.set(openId, pair);
    return { code, secret, expiresAt };
  },

  /**
   * Redeem a pairing code OR secret → mint a device-scoped session token.
   * Returns null on an unknown / expired value (caller surfaces a generic 401).
   * Single-use: redeeming either the code or the secret consumes both.
   */
  async redeem(
    codeOrSecret: string,
    deviceName: string,
    installId?: string,
  ): Promise<{ sessionToken: string; openId: string; deviceId: string } | null> {
    sweepExpired();
    const pair = _pending.get(codeOrSecret);
    if (!pair) return null;
    if (pair.expiresAt < Date.now()) {
      dropPair(pair);
      return null;
    }
    dropPair(pair); // single-use on success
    // Deterministic deviceId keyed on the phone's stable install id, so re-pairing
    // the same phone updates one row (no accumulation) and its revocation is stable.
    // Falls back to a random id when the phone sends no installId (older APK).
    const deviceId = installId
      ? `code:${createHash("sha256").update(installId).digest("hex").slice(0, 32)}`
      : randomBytes(16).toString("hex");
    // An explicit fresh-code redeem is a deliberate user action → it clears any
    // prior revocation for this device.
    await this.recordDevice(deviceId, pair.openId, deviceName || "Phone", "code", { clearRevocation: true });
    unmarkDeviceRevoked(deviceId);
    const sessionToken = await sdk.createSessionToken(pair.openId, {
      name: pair.name,
      deviceId,
      expiresInMs: DEVICE_TOKEN_TTL_MS,
    });
    return { sessionToken, openId: pair.openId, deviceId };
  },

  /**
   * OMMESH zero-touch auto-pair: the phone already authenticated over the mesh
   * (matching OMMESH_SECRET), so hand it a session token too. Deterministic
   * deviceId keyed on the mesh nodeId so re-registers update the same record.
   */
  async pairViaOmmesh(openId: string, nodeId: string, name: string): Promise<string | undefined> {
    const deviceId = `ommesh:${nodeId}`;
    // Sticky revocation: a revoked device must NOT re-authorize just by
    // reconnecting over the mesh. Skip minting; the owner has to re-pair
    // explicitly (a fresh code) to lift the revocation.
    if (isDeviceRevoked(deviceId)) return undefined;
    await this.recordDevice(deviceId, openId, name || "Phone", "ommesh", { clearRevocation: false });
    return sdk.createSessionToken(openId, {
      name: name || "Phone",
      deviceId,
      expiresInMs: DEVICE_TOKEN_TTL_MS,
    });
  },

  /**
   * Upsert the persistent paired-device record. Passive updates (OMMESH reconnect,
   * last-seen refresh) leave `revokedAt` untouched; only an explicit re-pair passes
   * `clearRevocation` to lift a prior revocation.
   */
  async recordDevice(
    deviceId: string,
    openId: string,
    name: string,
    method: "code" | "ommesh",
    opts: { clearRevocation?: boolean } = {},
  ): Promise<void> {
    const db = await getDb();
    const set: { name: string; lastSeenAt: Date; revokedAt?: Date | null } = {
      name,
      lastSeenAt: new Date(),
    };
    if (opts.clearRevocation) set.revokedAt = null;
    await db
      .insert(pairedDevices)
      .values({ deviceId, openId, name, pairMethod: method })
      .onConflictDoUpdate({
        target: pairedDevices.deviceId,
        set,
      });
  },

  /** List a user's paired devices, most-recently-seen first. */
  async listDevices(openId: string): Promise<PairedDevice[]> {
    const db = await getDb();
    return db
      .select()
      .from(pairedDevices)
      .where(eq(pairedDevices.openId, openId))
      .orderBy(desc(pairedDevices.lastSeenAt));
  },

  /** Revoke a device — its existing session tokens stop authenticating at once. */
  async revokeDevice(openId: string, deviceId: string): Promise<boolean> {
    const db = await getDb();
    const rows = await db
      .update(pairedDevices)
      .set({ revokedAt: new Date() })
      .where(and(eq(pairedDevices.openId, openId), eq(pairedDevices.deviceId, deviceId)))
      .returning({ id: pairedDevices.id });
    if (rows.length > 0) markDeviceRevoked(deviceId);
    return rows.length > 0;
  },

  /** Refresh the in-memory revoked-device set from the DB (called at boot). */
  async loadRevoked(): Promise<void> {
    try {
      const db = await getDb();
      const rows = await db
        .select({ deviceId: pairedDevices.deviceId })
        .from(pairedDevices)
        .where(isNotNull(pairedDevices.revokedAt));
      loadRevokedDevices(rows.map((r) => r.deviceId));
    } catch (err) {
      log.warn("Failed to load revoked devices at boot", err);
    }
  },
};

export { getUserByOpenId };
