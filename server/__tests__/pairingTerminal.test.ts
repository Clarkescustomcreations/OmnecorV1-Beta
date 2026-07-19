import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, type TestDb } from "./_helpers/trpcHarness.js";
import { pairedDevices } from "../../drizzle/schema.js";

// PairingService calls getDb() from db.factory directly; redirect it to a fresh
// in-memory DB (real schema + migrations, so the terminalEnabled column exists)
// so getDevice/setTerminalEnabled genuinely execute against SQLite.
const h = vi.hoisted(() => ({ db: null as unknown as TestDb["db"] }));
vi.mock("../db.factory.js", async (orig) => {
  const actual = await orig<typeof import("../db.factory.js")>();
  return { ...actual, getDb: async () => h.db };
});

import { PairingService } from "../_core/pairing.js";

describe("PairingService — per-device terminal opt-in", () => {
  let test: TestDb;

  beforeEach(async () => {
    test = await createTestDb();
    h.db = test.db;
    await test.db.insert(pairedDevices).values({
      deviceId: "code:abc",
      openId: "local:owner",
      name: "My Phone",
      pairMethod: "code",
    });
  });

  it("defaults terminalEnabled to false (secure by default)", async () => {
    const d = await PairingService.getDevice("code:abc");
    expect(d).toBeDefined();
    expect(d!.terminalEnabled).toBe(false);
  });

  it("enables then disables terminal for the owner's own device", async () => {
    expect(await PairingService.setTerminalEnabled("local:owner", "code:abc", true)).toBe(true);
    expect((await PairingService.getDevice("code:abc"))!.terminalEnabled).toBe(true);

    expect(await PairingService.setTerminalEnabled("local:owner", "code:abc", false)).toBe(true);
    expect((await PairingService.getDevice("code:abc"))!.terminalEnabled).toBe(false);
  });

  it("won't toggle a device paired to a different account (openId scoping)", async () => {
    expect(await PairingService.setTerminalEnabled("someone-else", "code:abc", true)).toBe(false);
    // The device's flag is untouched by the foreign caller.
    expect((await PairingService.getDevice("code:abc"))!.terminalEnabled).toBe(false);
  });

  it("returns false / undefined for an unknown device", async () => {
    expect(await PairingService.setTerminalEnabled("local:owner", "code:missing", true)).toBe(false);
    expect(await PairingService.getDevice("code:missing")).toBeUndefined();
  });
});
