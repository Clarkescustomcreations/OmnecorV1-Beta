/**
 * Batch C — Item 8: TokenRefreshService — expiry checking + provider refresh logic
 *
 * The crypto portion (encryptToken / decryptToken AES-256-GCM) is already
 * exhaustively tested in tokenCrypto.test.ts. This file covers the DB-driven
 * refresh logic:
 *
 *   checkExpiring(): only processes integrations expiring within 30 min that
 *     have a refreshToken; ignores rows without refreshToken or with future expiry
 *   refreshProvider('notion'): on 2xx updates accessToken + expiresAt in DB
 *   refreshProvider('notion'): on 4xx (invalid_grant) deletes the integration row
 *   refreshProvider('notion'): on 5xx leaves integration intact (transient error)
 *   refreshProvider('notion'): on network error leaves integration intact
 *   refreshProvider('slack'): auth.test {ok:false} → deletes integration
 *   refreshProvider('unknown'): no-op (returns without touching DB)
 *
 * Uses a real in-memory libSQL test DB (createTestDb) so Drizzle's query
 * builder runs against the real schema, giving confidence that the column
 * references and update/delete operations match the actual table.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { randomUUID } from "crypto";

// ── Mocks ────────────────────────────────────────────────────────────────────

const h = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("../db.factory.js", async (importActual) => {
  const actual = await importActual<typeof import("../db.factory.js")>();
  return { ...actual, getDb: async () => h.db };
});

const mockResilientFetch = vi.fn();
vi.mock("../_core/resilientFetch.js", () => ({
  resilientFetch: (...args: unknown[]) => mockResilientFetch(...args),
}));

import { TokenRefreshService, encryptToken } from "../phase2/services/TokenRefreshService.js";
import { createTestDb, type TestDb } from "./_helpers/trpcHarness.js";
import { integrations } from "../../drizzle/schema.js";
import { eq } from "drizzle-orm";
import type { Db } from "../db.js";

// ── Setup ─────────────────────────────────────────────────────────────────────

let store: TestDb;
let db: Db;

beforeEach(async () => {
  process.env.JWT_SECRET = "test-jwt-secret-at-least-32-chars!";
  process.env.COOKIE_SECRET = process.env.JWT_SECRET;
  store = await createTestDb();
  db = store.db;
  h.db = db;
  mockResilientFetch.mockReset();
  (TokenRefreshService as any).instance = undefined;
});

afterEach(() => {
  const svc = TokenRefreshService.getInstance();
  svc.stop();
  delete process.env.JWT_SECRET;
  delete process.env.COOKIE_SECRET;
});

// ── Helpers ───────────────────────────────────────────────name──────────────────

function makeIntegration(overrides: {
  provider: string;
  expiresAt?: Date | null;
  refreshToken?: string | null;
}) {
  return {
    id: randomUUID(),
    provider: overrides.provider,
    accessToken: encryptToken("current-access-token"),
    refreshToken: overrides.refreshToken !== undefined
      ? (overrides.refreshToken ? encryptToken(overrides.refreshToken) : null)
      : encryptToken("old-refresh-token"),
    expiresAt: overrides.expiresAt !== undefined
      ? overrides.expiresAt
      : new Date(Date.now() + 5 * 60 * 1000), // default: expires in 5 min (within 30-min window)
    createdAt: new Date(),
    updatedAt: new Date(),
    tokenIv: null,
    tokenTag: null,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  };
}

// ── checkExpiring ─────────────────────────────────────────────────────────────

describe("TokenRefreshService.checkExpiring", () => {
  it("refreshes an integration expiring in < 30 min with a refresh token", async () => {
    await db.insert(integrations).values(makeIntegration({
      provider: "notion",
      expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 min from now
    }));

    mockResilientFetch.mockResolvedValueOnce(
      jsonResponse({ access_token: "new-notion-token", expires_in: 3600 })
    );

    await (TokenRefreshService.getInstance() as any).checkExpiring();

    const [row] = await db.select().from(integrations).where(eq(integrations.provider, "notion"));
    expect(row).toBeDefined();
    // Access token must have been updated to the encrypted form of "new-notion-token".
    // We compare encrypted forms so the test is format-agnostic (works whether
    // JWT_SECRET is set at module-load time or not).
    const freshEncrypted = encryptToken("new-notion-token");
    expect(row!.accessToken).toBe(freshEncrypted);
    // expiresAt should be set to roughly now + 1 hour
    expect(row!.expiresAt).not.toBeNull();
    const diff = row!.expiresAt!.getTime() - Date.now();
    expect(diff).toBeGreaterThan(3000 * 1000); // > 50 min
    expect(diff).toBeLessThan(3700 * 1000);    // < ~61 min
  });

  it("ignores integrations with no refresh token (can't refresh)", async () => {
    await db.insert(integrations).values(makeIntegration({
      provider: "notion",
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      refreshToken: null,
    }));

    await (TokenRefreshService.getInstance() as any).checkExpiring();

    // resilientFetch should not have been called
    expect(mockResilientFetch).not.toHaveBeenCalled();
  });

  it("ignores integrations with future expiry beyond the 30-min window", async () => {
    await db.insert(integrations).values(makeIntegration({
      provider: "notion",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 60 min from now
    }));

    await (TokenRefreshService.getInstance() as any).checkExpiring();

    expect(mockResilientFetch).not.toHaveBeenCalled();
  });
});

// ── refreshProvider — Notion ──────────────────────────────────────────────────

describe("TokenRefreshService — Notion provider refresh", () => {
  it("on 2xx: updates accessToken and expiresAt in DB", async () => {
    await db.insert(integrations).values(makeIntegration({ provider: "notion" }));

    mockResilientFetch.mockResolvedValueOnce(
      jsonResponse({ access_token: "fresh-token", expires_in: 3600 })
    );

    await TokenRefreshService.getInstance().forceRefresh("notion");

    const [row] = await db.select().from(integrations).where(eq(integrations.provider, "notion"));
    expect(row).toBeDefined();
    expect(row!.expiresAt).not.toBeNull();
    // The new expiresAt should be roughly now + 1 hour
    const diff = row!.expiresAt!.getTime() - Date.now();
    expect(diff).toBeGreaterThan(3000 * 1000); // > 50 min
    expect(diff).toBeLessThan(3700 * 1000);    // < ~61 min
  });

  it("on 4xx (invalid_grant): deletes the integration row", async () => {
    await db.insert(integrations).values(makeIntegration({ provider: "notion" }));

    mockResilientFetch.mockResolvedValueOnce(jsonResponse({ error: "invalid_grant" }, 401));

    await TokenRefreshService.getInstance().forceRefresh("notion");

    const rows = await db.select().from(integrations).where(eq(integrations.provider, "notion"));
    expect(rows).toHaveLength(0);
  });

  it("on 5xx: leaves integration intact (transient error, retry next cycle)", async () => {
    await db.insert(integrations).values(makeIntegration({ provider: "notion" }));

    mockResilientFetch.mockResolvedValueOnce(jsonResponse({ error: "server_error" }, 503));

    await TokenRefreshService.getInstance().forceRefresh("notion");

    const rows = await db.select().from(integrations).where(eq(integrations.provider, "notion"));
    expect(rows).toHaveLength(1); // still present
  });

  it("on network error: leaves integration intact", async () => {
    await db.insert(integrations).values(makeIntegration({ provider: "notion" }));

    mockResilientFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    await TokenRefreshService.getInstance().forceRefresh("notion");

    const rows = await db.select().from(integrations).where(eq(integrations.provider, "notion"));
    expect(rows).toHaveLength(1);
  });

  it("no-op when there is no integration row for the provider", async () => {
    await TokenRefreshService.getInstance().forceRefresh("notion");
    expect(mockResilientFetch).not.toHaveBeenCalled();
  });
});

// ── refreshProvider — Slack ───────────────────────────────────────────────────

describe("TokenRefreshService — Slack provider refresh", () => {
  it("deletes integration when auth.test returns {ok: false}", async () => {
    await db.insert(integrations).values(makeIntegration({ provider: "slack" }));

    mockResilientFetch.mockResolvedValueOnce(jsonResponse({ ok: false }, 200));

    await TokenRefreshService.getInstance().forceRefresh("slack");

    const rows = await db.select().from(integrations).where(eq(integrations.provider, "slack"));
    expect(rows).toHaveLength(0);
  });

  it("leaves integration intact when auth.test returns {ok: true}", async () => {
    await db.insert(integrations).values(makeIntegration({ provider: "slack" }));

    mockResilientFetch.mockResolvedValueOnce(jsonResponse({ ok: true }, 200));

    await TokenRefreshService.getInstance().forceRefresh("slack");

    const rows = await db.select().from(integrations).where(eq(integrations.provider, "slack"));
    expect(rows).toHaveLength(1);
  });
});

// ── refreshProvider — unknown provider ───────────────────────────────────────

describe("TokenRefreshService — unknown provider", () => {
  it("is a no-op for providers not explicitly handled (e.g. 'github')", async () => {
    await db.insert(integrations).values(makeIntegration({ provider: "github" }));

    await TokenRefreshService.getInstance().forceRefresh("github");

    expect(mockResilientFetch).not.toHaveBeenCalled();
    const rows = await db.select().from(integrations).where(eq(integrations.provider, "github"));
    expect(rows).toHaveLength(1); // unchanged
  });
});
