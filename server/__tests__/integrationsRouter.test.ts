/**
 * Route-level tests for `integrationsRouter`.
 *
 * The router persists encrypted integration tokens to ~/.omnecor/integrations.json
 * and validates them against live external APIs. To keep the suite hermetic and
 * to never touch the developer's real store, `fs` is mocked with a delegating
 * wrapper that intercepts ONLY the integrations.json path (everything else —
 * notably the Drizzle migration files the harness reads — falls through to real
 * fs). `fetch` is stubbed per-test. The OAuth-backed paths (dropbox/onedrive)
 * read `platformAccounts` from a real in-memory libSQL DB.
 *
 * Focus: the auth boundary, the Sovereign-mode service gate (externalServiceProcedure),
 * the OAuth-vs-paste-token branch on connect, tokens-encrypted-at-rest, per-user
 * store isolation, and the URI dispatch / ownership on fetchSourceTree +
 * map-index procedures.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";

// In-memory backing for the integrations.json store. `null` = file absent.
const fsStore = vi.hoisted(() => ({ data: null as string | null }));

vi.mock("fs", async importActual => {
  const actual = await importActual<typeof import("fs")>();
  const isStore = (p: unknown) => typeof p === "string" && p.includes("integrations.json");
  const isOmnecorDir = (p: unknown) => typeof p === "string" && p.includes(".omnecor");
  return {
    ...actual,
    default: actual,
    existsSync: (p: string) =>
      isStore(p) ? fsStore.data !== null : (actual.existsSync as (x: string) => boolean)(p),
    readFileSync: ((p: string, ...rest: unknown[]) =>
      isStore(p) ? (fsStore.data ?? "{}") : (actual.readFileSync as (...a: unknown[]) => unknown)(p, ...rest)) as typeof actual.readFileSync,
    writeFileSync: ((p: string, content: unknown, ...rest: unknown[]) => {
      if (isStore(p)) { fsStore.data = String(content); return; }
      return (actual.writeFileSync as (...a: unknown[]) => unknown)(p, content, ...rest);
    }) as typeof actual.writeFileSync,
    mkdirSync: ((p: string, ...rest: unknown[]) =>
      isOmnecorDir(p) ? undefined : (actual.mkdirSync as (...a: unknown[]) => unknown)(p, ...rest)) as typeof actual.mkdirSync,
  };
});

const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("../db.factory.js", async importActual => {
  const actual = await importActual<typeof import("../db.factory.js")>();
  return { ...actual, getDb: async () => h.db };
});

vi.mock("../core_services/services/AuditLogService.js", () => ({
  AuditLogService: {
    getInstance: () => ({ log: vi.fn().mockResolvedValue(undefined) }),
  },
}));

import { appRouter } from "../routers.js";
import { neuralMaps } from "../../drizzle/schema.js";
import { createTestDb, seedUser, makeContext, type TestDb } from "./_helpers/trpcHarness.js";
import type { Db } from "../db.js";

type Caller = ReturnType<typeof appRouter.createCaller>;
let store: TestDb;
let db: Db;

beforeEach(async () => {
  store = await createTestDb();
  db = store.db;
  h.db = db;
  fsStore.data = null;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("integrations — auth boundary", () => {
  it("rejects unauthenticated getIntegrations", async () => {
    const caller = appRouter.createCaller(makeContext(null, db));
    await expect(caller.integrations.getIntegrations()).rejects.toThrow(TRPCError);
  });
});

describe("integrations.getIntegrations", () => {
  it("reports every integration type as disconnected on an empty store", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const res = await caller.integrations.getIntegrations();
    expect(res.length).toBeGreaterThanOrEqual(8);
    expect(res.every(r => r.isConnected === false)).toBe(true);
    expect(res.find(r => r.type === "github")).toBeDefined();
  });
});

describe("integrations.connect — Sovereign-mode service gate", () => {
  it("blocks a sovereign user (externalServiceProcedure) before any network call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const user = await seedUser(db, { executionMode: "sovereign" });
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    await expect(
      caller.integrations.connect({ type: "github", token: "ghp_x" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("integrations.connect — branch + encryption at rest", () => {
  it("rejects an OAuth-only type with a pasted token (BAD_REQUEST)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    await expect(
      caller.integrations.connect({ type: "dropbox", token: "tok" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("validates a GitHub token, stores it ENCRYPTED, and surfaces it as connected", async () => {
    const RAW_TOKEN = "ghp_supersecret_value_123";
    vi.stubGlobal("fetch", vi.fn(async (url: unknown) => {
      if (String(url).includes("api.github.com/user")) {
        return { ok: true, status: 200, json: async () => ({ login: "octocat", name: "Octo Cat", email: "octo@x.com" }) } as unknown as Response;
      }
      throw new Error(`unexpected fetch: ${String(url)}`);
    }));

    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const res = await caller.integrations.connect({ type: "github", token: RAW_TOKEN });
    expect(res).toMatchObject({ success: true, metadata: { username: "octocat" } });

    // The raw token must never sit in the store in plaintext.
    expect(fsStore.data).toBeTruthy();
    expect(fsStore.data).not.toContain(RAW_TOKEN);
    expect(fsStore.data).toContain("ciphertext");

    const list = await caller.integrations.getIntegrations();
    const gh = list.find(r => r.type === "github");
    expect(gh?.isConnected).toBe(true);
    expect((gh?.metadata as { username?: string })?.username).toBe("octocat");
  });

  it("disconnect removes a connected paste-token integration", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      ({ ok: true, status: 200, json: async () => ({ login: "octocat" }) } as unknown as Response)));
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    await caller.integrations.connect({ type: "github", token: "ghp_x" });
    await caller.integrations.disconnect({ type: "github" });
    const list = await caller.integrations.getIntegrations();
    expect(list.find(r => r.type === "github")?.isConnected).toBe(false);
  });

  it("isolates the token store per user", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      ({ ok: true, status: 200, json: async () => ({ login: "alice-gh" }) } as unknown as Response)));
    const alice = await seedUser(db, { openId: "a", email: "a@x.com" });
    const bob = await seedUser(db, { openId: "b", email: "b@x.com" });
    await appRouter.createCaller(makeContext(alice, db)).integrations.connect({ type: "github", token: "tok" });

    const bobList = await appRouter.createCaller(makeContext(bob, db)).integrations.getIntegrations();
    expect(bobList.find(r => r.type === "github")?.isConnected).toBe(false);
  });
});

describe("integrations.fetchSourceTree — dispatch + gating", () => {
  it("blocks a sovereign user (externalServiceProcedure)", async () => {
    const user = await seedUser(db, { executionMode: "sovereign" });
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    await expect(
      caller.integrations.fetchSourceTree({ uri: "github://owner/repo" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects an unsupported URI scheme (BAD_REQUEST)", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    await expect(
      caller.integrations.fetchSourceTree({ uri: "ftp://example.com/x" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects a malformed github:// URI (no repo)", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    await expect(
      caller.integrations.fetchSourceTree({ uri: "github://onlyowner" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("reports NOT_FOUND when the requested integration is not connected", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    await expect(
      caller.integrations.fetchSourceTree({ uri: "integration://notion" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("integrations — map index procedures", () => {
  it("getMapIndexStatus returns NOT_FOUND for a map the caller does not own", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    await expect(
      caller.integrations.getMapIndexStatus({ mapId: randomUUID() })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("indexMapSources blocks a sovereign user (externalServiceProcedure)", async () => {
    const user = await seedUser(db, { executionMode: "sovereign" });
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    await expect(
      caller.integrations.indexMapSources({ mapId: randomUUID() })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("indexMapSources skips a map that has no remote sources", async () => {
    const user = await seedUser(db);
    const mapId = randomUUID();
    await db.insert(neuralMaps).values({
      id: mapId,
      userId: user.id,
      name: "Local map",
      rootDirectories: ["/home/me/project"], // local only, no github:// / integration://
      settings: {},
    });
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const res = await caller.integrations.indexMapSources({ mapId });
    expect(res).toMatchObject({ started: false, skipped: true });
  });
});

describe("integrations.updateSettings", () => {
  it("blocks a sovereign user (externalServiceProcedure)", async () => {
    const user = await seedUser(db, { executionMode: "sovereign" });
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    await expect(
      caller.integrations.updateSettings({ type: "github", settings: { syncInterval: 30 } })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("returns NOT_FOUND when the integration is not connected", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    await expect(
      caller.integrations.updateSettings({ type: "github", settings: { syncInterval: 30 } })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("persists settings onto a connected integration and surfaces them in metadata", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      ({ ok: true, status: 200, json: async () => ({ login: "octocat" }) } as unknown as Response)));
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    await caller.integrations.connect({ type: "github", token: "ghp_x" });

    const res = await caller.integrations.updateSettings({
      type: "github",
      settings: { syncInterval: 30, includeIssues: true },
    });
    expect(res).toEqual({ success: true });

    const list = await caller.integrations.getIntegrations();
    const gh = list.find(r => r.type === "github");
    expect((gh?.metadata as { settings?: Record<string, unknown> })?.settings).toEqual({
      syncInterval: 30,
      includeIssues: true,
    });
    // Existing metadata (the validated username) must survive the settings merge.
    expect((gh?.metadata as { username?: string })?.username).toBe("octocat");
  });
});
