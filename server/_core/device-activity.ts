/**
 * Throttled "last seen" bump for paired devices.
 *
 * `sdk.authenticateRequest` calls `touchDevice(deviceId)` on every authenticated
 * request from a paired phone, so the Settings → Devices "Last seen" reflects real
 * activity rather than just the pairing time. Writing on every request would hammer
 * the DB on a hot path, so updates are throttled per-device (at most once per
 * `MIN_INTERVAL_MS`) and fire-and-forget — a failure never affects auth.
 *
 * Kept separate from `device-revocation.ts` (which is deliberately DB-free for the
 * O(1) revocation check) and from `pairing.ts` (which imports `sdk`, so importing it
 * back into `sdk` would create a cycle). This module imports only the DB layer.
 */
import { getDb } from "../db.factory.js";
import { pairedDevices } from "../../drizzle/schema.js";
import { eq } from "drizzle-orm";
import { createLogger } from "./logger.js";

const log = createLogger("device-activity");

const MIN_INTERVAL_MS = 5 * 60 * 1000; // at most one write per device per 5 min
const _lastWrite = new Map<string, number>();

/** Best-effort, throttled update of a paired device's `lastSeenAt`. Never throws. */
export function touchDevice(deviceId: string): void {
  const now = Date.now();
  const prev = _lastWrite.get(deviceId) ?? 0;
  if (now - prev < MIN_INTERVAL_MS) return;
  _lastWrite.set(deviceId, now);

  void (async () => {
    try {
      const db = await getDb();
      await db
        .update(pairedDevices)
        .set({ lastSeenAt: new Date() })
        .where(eq(pairedDevices.deviceId, deviceId));
    } catch (err) {
      log.warn("Failed to update device lastSeenAt", err);
    }
  })();
}
