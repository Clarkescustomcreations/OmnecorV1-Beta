/**
 * In-memory set of revoked paired-device ids (mirrors `paired_devices.revokedAt`).
 *
 * Kept deliberately standalone — no `sdk`/`db` imports — so the auth hot path
 * (`sdk.authenticateRequest`) can check revocation in O(1) without a per-request
 * DB read and without an import cycle (PairingService imports `sdk`, `sdk` reads
 * this). Loaded once at boot from the DB and updated whenever a device is revoked.
 */
const _revoked = new Set<string>();

/** Replace the revoked set (called at boot from the DB). */
export function loadRevokedDevices(deviceIds: string[]): void {
  _revoked.clear();
  for (const id of deviceIds) _revoked.add(id);
}

/** Mark a device revoked (called when the desktop revokes a device). */
export function markDeviceRevoked(deviceId: string): void {
  _revoked.add(deviceId);
}

/**
 * Clear a device's revoked status (called only on an EXPLICIT fresh-code re-pair —
 * a deliberate user action). Passive OMMESH auto-reconnect must NOT call this, so a
 * revoked phone stays locked out until the owner intentionally re-pairs it.
 */
export function unmarkDeviceRevoked(deviceId: string): void {
  _revoked.delete(deviceId);
}

/** True if the device's session tokens should be rejected. */
export function isDeviceRevoked(deviceId: string): boolean {
  return _revoked.has(deviceId);
}
