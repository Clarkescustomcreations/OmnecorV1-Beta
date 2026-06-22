import { describe, it, expect, vi, beforeEach } from "vitest";
import { PairingService } from "../_core/pairing.js";
import { sdk } from "../_core/sdk.js";
import {
  markDeviceRevoked,
  isDeviceRevoked,
  loadRevokedDevices,
} from "../_core/device-revocation.js";

// The pairing-code lifecycle is pure/in-memory; the only side effects on the
// redeem success path are the device upsert (DB) and the JWT mint (jose). Mock
// both so these tests exercise PairingService's own logic deterministically.
beforeEach(() => {
  vi.restoreAllMocks();
  loadRevokedDevices([]); // reset the in-memory revoked set between tests
  vi.spyOn(PairingService, "recordDevice").mockResolvedValue();
  vi.spyOn(sdk, "createSessionToken").mockResolvedValue("header.payload.signature");
});

describe("PairingService — pairing codes", () => {
  it("issues a 6-digit code with a future expiry", () => {
    const { code, expiresAt } = PairingService.createCode("local:owner", "Owner");
    expect(code).toMatch(/^\d{6}$/);
    expect(expiresAt).toBeGreaterThan(Date.now());
  });

  it("rejects an unknown code", async () => {
    expect(await PairingService.redeem("123456", "Phone")).toBeNull();
  });

  it("keeps only one active code per user (creating a second replaces the first)", async () => {
    const a = PairingService.createCode("u-replace", "U").code;
    const b = PairingService.createCode("u-replace", "U").code;
    // Exactly one of the two codes is redeemable — holds whether or not the two
    // randomly-generated codes happen to collide.
    const results = [await PairingService.redeem(a, "Phone"), await PairingService.redeem(b, "Phone")];
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("redeems a valid code exactly once and mints a deviceId-scoped token", async () => {
    const { code } = PairingService.createCode("local:owner", "Owner");
    const result = await PairingService.redeem(code, "My Phone");
    expect(result).not.toBeNull();
    expect(result!.openId).toBe("local:owner");
    expect(result!.sessionToken).toBe("header.payload.signature");
    // the minted token is scoped to a generated device id (enables revocation)
    expect(sdk.createSessionToken).toHaveBeenCalledWith(
      "local:owner",
      expect.objectContaining({ deviceId: expect.any(String), name: "Owner" }),
    );
    // single-use: a second redeem of the same code fails
    expect(await PairingService.redeem(code, "My Phone")).toBeNull();
  });

  it("redeems via the long secret (QR path); consuming it also consumes the code", async () => {
    const { code, secret } = PairingService.createCode("local:owner", "Owner");
    expect(secret).toMatch(/^[0-9a-f]{64}$/); // 32 random bytes, hex
    expect(await PairingService.redeem(secret, "My Phone")).not.toBeNull();
    // single-use is shared across both keys
    expect(await PairingService.redeem(code, "My Phone")).toBeNull();
  });

  it("derives a stable deviceId from the install id (re-pair updates one device)", async () => {
    const a = PairingService.createCode("u-install", "U");
    const r1 = await PairingService.redeem(a.code, "Phone", "same-install");
    const b = PairingService.createCode("u-install", "U");
    const r2 = await PairingService.redeem(b.code, "Phone", "same-install");
    expect(r1!.deviceId).toMatch(/^code:[0-9a-f]{32}$/);
    expect(r2!.deviceId).toBe(r1!.deviceId); // deterministic per install
  });

  it("an explicit fresh-code re-pair clears a prior revocation for that device", async () => {
    const a = PairingService.createCode("local:owner", "Owner");
    const r1 = await PairingService.redeem(a.code, "Phone", "install-xyz");
    const deviceId = r1!.deviceId;

    markDeviceRevoked(deviceId);
    expect(isDeviceRevoked(deviceId)).toBe(true);

    const b = PairingService.createCode("local:owner", "Owner");
    const r2 = await PairingService.redeem(b.code, "Phone", "install-xyz");
    expect(r2!.deviceId).toBe(deviceId);
    expect(isDeviceRevoked(deviceId)).toBe(false); // deliberate re-pair lifts it
  });
});

describe("PairingService — OMMESH auto-pair (sticky revocation)", () => {
  it("skips minting for a revoked device — a reconnect must NOT re-authorize it", async () => {
    markDeviceRevoked("ommesh:node-9");
    expect(await PairingService.pairViaOmmesh("local:owner", "node-9", "Phone")).toBeUndefined();
  });

  it("mints a device-scoped token for a non-revoked node", async () => {
    const token = await PairingService.pairViaOmmesh("local:owner", "node-fresh", "Phone");
    expect(token).toBe("header.payload.signature");
    expect(sdk.createSessionToken).toHaveBeenCalledWith(
      "local:owner",
      expect.objectContaining({ deviceId: "ommesh:node-fresh", expiresInMs: expect.any(Number) }),
    );
  });
});
