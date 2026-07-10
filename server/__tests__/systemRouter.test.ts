/**
 * Batch G tail — route-level tests for `systemRouter` (the app's system/settings
 * control plane in server/_core).
 *
 * Covers the harness-drivable subset (no shell-out / hardware): health, the
 * config-status queries (loginProviders / aiProviders / oauthStatus /
 * integrationsStatus — booleans only, never secrets), the settings read/write
 * round-trip incl. the admin-only `sovereignBlockAiOnly` guard, RBAC
 * (getMyPermissions), and the DB-backed user-admin procedures (setExecutionMode,
 * listUsers, setUserRole with its self-demotion guard + admin gate).
 *
 * Isolation: HOME + OMNECOR_DATA are redirected to a temp dir BEFORE import so
 * the settings file (`PATHS.base/settings.json`) round-trips in a throwaway
 * location; `../db.js` `getDb` is redirected at the DB layer so both the
 * re-exported `getDb` and `updateUserExecutionMode` hit the in-memory test DB.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

const H = vi.hoisted(() => {
  const prevHome = process.env.HOME;
  const prevData = process.env.OMNECOR_DATA;
  const home = `/tmp/omnecor-system-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  process.env.HOME = home;
  process.env.OMNECOR_DATA = `${home}/.omnecor`;
  return { home, prevHome, prevData };
});

const dbh = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("../db.js", async importActual => {
  const actual = await importActual<typeof import("../db.js")>();
  return { ...actual, getDb: async () => dbh.db };
});

vi.mock("../core_services/services/AuditLogService.js", () => ({
  AuditLogService: {
    getInstance: () => ({ log: vi.fn().mockResolvedValue(undefined) }),
  },
}));

import path from "node:path";
import { rmSync } from "node:fs";
import { eq } from "drizzle-orm";
import { appRouter } from "../routers.js";
import { PATHS } from "../_core/paths.js";
import { users } from "../../drizzle/schema.js";
import { createTestDb, seedUser, makeContext, type TestDb } from "./_helpers/trpcHarness.js";
import type { Db } from "../db.js";
import type { User } from "../../drizzle/schema.js";

type Caller = ReturnType<typeof appRouter.createCaller>;
let store: TestDb;
let db: Db;
let user: User;
let admin: User;

const SETTINGS_FILE = path.join(PATHS.base, "settings.json");

beforeEach(async () => {
  store = await createTestDb();
  db = store.db;
  dbh.db = db;
  user = await seedUser(db);
  admin = await seedUser(db, { openId: "admin", email: "admin@x.com", role: "admin" });
  rmSync(SETTINGS_FILE, { force: true }); // clean settings between tests
});

afterAll(() => {
  if (H.prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = H.prevHome;
  if (H.prevData === undefined) delete process.env.OMNECOR_DATA;
  else process.env.OMNECOR_DATA = H.prevData;
  rmSync(H.home, { recursive: true, force: true });
});

describe("system.health", () => {
  it("reports ok with a bounded cpu percent (public)", async () => {
    const caller: Caller = appRouter.createCaller(makeContext(null, db));
    const res = await caller.system.health({ timestamp: Date.now() });
    expect(res.ok).toBe(true);
    expect(res.cpu.percent).toBeGreaterThanOrEqual(0);
    expect(res.cpu.percent).toBeLessThanOrEqual(100);
  });
});

describe("system settings round-trip", () => {
  it("returns null before any settings are saved", async () => {
    const caller: Caller = appRouter.createCaller(makeContext(null, db));
    expect(await caller.system.getSettings()).toBeNull();
  });

  it("saveSettings persists values and getSettings reads them back", async () => {
    const caller: Caller = appRouter.createCaller(makeContext(null, db));
    expect(await caller.system.saveSettings({ settings: { comfyUrl: "http://localhost:8188" } }))
      .toEqual({ saved: true });
    expect(await caller.system.getSettings()).toMatchObject({ comfyUrl: "http://localhost:8188" });
  });

  it("saveSettings strips the admin-guarded sovereignBlockAiOnly flag", async () => {
    const caller: Caller = appRouter.createCaller(makeContext(null, db));
    await caller.system.saveSettings({ settings: { foo: "bar", sovereignBlockAiOnly: true } });
    const saved = (await caller.system.getSettings()) as Record<string, unknown>;
    expect(saved.foo).toBe("bar");
    expect(saved.sovereignBlockAiOnly).toBeUndefined(); // never settable unauthenticated
  });
});

describe("system.setSovereignBlockAiOnly — admin gate", () => {
  it("forbids a non-admin", async () => {
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    await expect(caller.system.setSovereignBlockAiOnly({ enabled: true })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("lets an admin toggle it and persists to the settings file", async () => {
    const caller: Caller = appRouter.createCaller(makeContext(admin, db));
    expect(await caller.system.setSovereignBlockAiOnly({ enabled: true })).toEqual({ enabled: true });
    const saved = (await caller.system.getSettings()) as Record<string, unknown>;
    expect(saved.sovereignBlockAiOnly).toBe(true);
  });
});

describe("system config-status queries (booleans/urls, never secrets)", () => {
  it("aiProviders reflects a saved key without leaking it", async () => {
    // saveKeys is admin-only; aiProviders is a public status query.
    await appRouter.createCaller(makeContext(admin, db)).system.saveKeys({
      keys: { openai: "sk-super-secret" },
    });
    const caller: Caller = appRouter.createCaller(makeContext(null, db));
    const res = (await caller.system.aiProviders()) as Record<string, unknown>;
    expect(res.openai).toBe(true); // settings OR env → true once saved
    // The secret itself is never part of the status payload.
    expect(JSON.stringify(res)).not.toContain("sk-super-secret");
  });

  it("loginProviders + oauthStatus flip to true once client creds are saved", async () => {
    const caller: Caller = appRouter.createCaller(makeContext(null, db));
    await caller.system.saveSettings({
      settings: { googleClientId: "gid", googleClientSecret: "gsecret" },
    });
    expect((await caller.system.loginProviders()).google).toBe(true);
    expect((await caller.system.oauthStatus()).google).toBe(true);
  });

  it("integrationsStatus returns platforms + per-platform booleans + a callback base", async () => {
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const res = await caller.system.integrationsStatus();
    expect(Array.isArray(res.platforms)).toBe(true);
    expect(res.configured).toBeTypeOf("object");
    for (const p of res.platforms) expect(typeof res.configured[p]).toBe("boolean");
    expect(res.callbackBase).toMatch(/^https?:\/\//);
  });
});

describe("system.getMyPermissions — RBAC", () => {
  it("returns the caller's role and its permission set", async () => {
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const res = await caller.system.getMyPermissions();
    expect(res.role).toBe("user");
    expect(res.permissions).toBeTruthy();
  });
});

describe("system.setExecutionMode", () => {
  it("persists the caller's execution mode to the DB", async () => {
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    expect(await caller.system.setExecutionMode({ mode: "sovereign" })).toEqual({ mode: "sovereign" });
    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row.executionMode).toBe("sovereign");
  });
});

describe("system.listUsers — admin gate", () => {
  it("forbids a non-admin", async () => {
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    await expect(caller.system.listUsers()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("returns only safe columns for an admin", async () => {
    const caller: Caller = appRouter.createCaller(makeContext(admin, db));
    const res = await caller.system.listUsers();
    expect(res.users.length).toBeGreaterThanOrEqual(2);
    const row = res.users.find(u => u.id === user.id)!;
    expect(row).toHaveProperty("email");
    expect(row).not.toHaveProperty("passwordHash"); // no secret columns selected
  });
});

describe("system.setUserRole — admin gate + self-demotion guard", () => {
  it("forbids a non-admin", async () => {
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    await expect(
      caller.system.setUserRole({ userId: admin.id, role: "user" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lets an admin change another user's role", async () => {
    const caller: Caller = appRouter.createCaller(makeContext(admin, db));
    expect(await caller.system.setUserRole({ userId: user.id, role: "admin" })).toEqual({ ok: true });
    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row.role).toBe("admin");
  });

  it("blocks an admin from changing their own role (self-demotion guard)", async () => {
    const caller: Caller = appRouter.createCaller(makeContext(admin, db));
    await expect(
      caller.system.setUserRole({ userId: admin.id, role: "user" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
