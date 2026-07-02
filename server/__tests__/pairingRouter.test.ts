/**
 * Route-level integration tests for `pairingRouter`.
 *
 * The pairing-code lifecycle itself is covered service-level in
 * `pairing.test.ts`; this suite drives the tRPC surface against the real
 * in-memory DB:
 *  - createCode returns the QR payload (code/secret/expiry/port) and is
 *    blocked for the paired-device role (nonDeviceProcedure)
 *  - listDevices returns only the caller's devices, most-recently-seen first
 *  - revokeDevice flips revokedAt for the caller's own device only
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { TRPCError } from "@trpc/server";

const h = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("../db.factory.js", async importActual => {
  const actual = await importActual<typeof import("../db.factory.js")>();
  return { ...actual, getDb: async () => h.db };
});

vi.mock("../phase2/services/AuditLogService.js", () => ({
  AuditLogService: {
    getInstance: () => ({ log: vi.fn().mockResolvedValue(undefined) }),
  },
}));

import { appRouter } from "../routers.js";
import { pairedDevices, type User } from "../../drizzle/schema.js";
import { loadRevokedDevices, isDeviceRevoked } from "../_core/device-revocation.js";
import { createTestDb, seedUser, makeContext, type TestDb } from "./_helpers/trpcHarness.js";
import type { Db } from "../db.js";

type Caller = ReturnType<typeof appRouter.createCaller>;
let store: TestDb;
let db: Db;

async function seedDevice(user: User, over: Partial<typeof pairedDevices.$inferInsert> = {}) {
  const [row] = await db.insert(pairedDevices).values({
    deviceId: over.deviceId ?? `dev-${Math.random().toString(36).slice(2)}`,
    openId: user.openId,
    name: over.name ?? "Phone",
    pairMethod: over.pairMethod ?? "code",
    ...over,
  }).returning();
  return row;
}

beforeEach(async () => {
  store = await createTestDb();
  db = store.db;
  h.db = db;
  loadRevokedDevices([]); // reset the in-memory revoked set between tests
});

describe("auth boundary", () => {
  it("rejects unauthenticated listDevices", async () => {
    const caller = appRouter.createCaller(makeContext(null, db));
    await expect(caller.pairing.listDevices()).rejects.toThrow(TRPCError);
  });
});

describe("pairing.createCode", () => {
  it("returns a 6-digit code, a long QR secret, a future expiry and a port", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const res = await caller.pairing.createCode();
    expect(res.code).toMatch(/^\d{6}$/);
    expect(res.secret.length).toBeGreaterThan(20);
    expect(res.expiresAt).toBeGreaterThan(Date.now());
    expect(typeof res.port).toBe("number");
  });

  it("is FORBIDDEN for the paired-device role (a phone cannot mint new codes)", async () => {
    const device = await seedUser(db, { role: "device" });
    const caller: Caller = appRouter.createCaller(makeContext(device, db));
    await expect(caller.pairing.createCode()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("pairing.listDevices", () => {
  it("returns only the caller's devices, most-recently-seen first", async () => {
    const alice = await seedUser(db, { openId: "alice", email: "a@x.com" });
    const bob = await seedUser(db, { openId: "bob", email: "b@x.com" });
    await seedDevice(alice, { deviceId: "d-old", name: "Old Phone", lastSeenAt: new Date(Date.now() - 60_000) });
    await seedDevice(alice, { deviceId: "d-new", name: "New Phone", lastSeenAt: new Date() });
    await seedDevice(bob, { deviceId: "d-bob", name: "Bob Phone" });

    const res = await appRouter.createCaller(makeContext(alice, db)).pairing.listDevices();
    expect(res.devices.map(d => d.deviceId)).toEqual(["d-new", "d-old"]);
  });

  it("a paired device may view the device list (protectedProcedure, not nonDevice)", async () => {
    const device = await seedUser(db, { role: "device" });
    const res = await appRouter.createCaller(makeContext(device, db)).pairing.listDevices();
    expect(res.devices).toEqual([]);
  });
});

describe("pairing.revokeDevice", () => {
  it("revokes the caller's own device (revokedAt set + in-memory revocation marked)", async () => {
    const user = await seedUser(db);
    await seedDevice(user, { deviceId: "d-revoke" });
    const caller: Caller = appRouter.createCaller(makeContext(user, db));

    const res = await caller.pairing.revokeDevice({ deviceId: "d-revoke" });
    expect(res.revoked).toBe(true);
    expect(isDeviceRevoked("d-revoke")).toBe(true);

    const { devices } = await caller.pairing.listDevices();
    expect(devices[0].revokedAt).not.toBeNull();
  });

  it("cannot revoke another user's device (revoked:false, row untouched)", async () => {
    const alice = await seedUser(db, { openId: "a2", email: "a2@x.com" });
    const bob = await seedUser(db, { openId: "b2", email: "b2@x.com" });
    await seedDevice(alice, { deviceId: "d-alice" });

    const res = await appRouter.createCaller(makeContext(bob, db)).pairing.revokeDevice({ deviceId: "d-alice" });
    expect(res.revoked).toBe(false);
    expect(isDeviceRevoked("d-alice")).toBe(false);
  });

  it("is FORBIDDEN for the paired-device role (a phone cannot revoke devices)", async () => {
    const device = await seedUser(db, { role: "device" });
    await expect(
      appRouter.createCaller(makeContext(device, db)).pairing.revokeDevice({ deviceId: "x" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
