/**
 * Route-level integration tests for `platformsRouter`.
 *
 * Security-critical: OAuth access/refresh tokens must NEVER be returned to the
 * client. These tests assert listAccounts/getAccount expose only the safe
 * column set, that addAccount persists tokens + returns the new id, and that
 * updateAccount/disconnectAccount enforce per-user ownership (FORBIDDEN on a
 * cross-user id). Real in-memory libSQL DB.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { TRPCError } from "@trpc/server";

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

import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { appRouter } from "../routers.js";
import { platformAccounts } from "../../drizzle/schema.js";
import { ENV } from "../_core/env.js";
import { DEFAULT_SOCIAL_WEBHOOK_PATH } from "../core_services/services/WebhookPublisher.js";
import { createTestDb, seedUser, makeContext, type TestDb } from "./_helpers/trpcHarness.js";
import type { Db } from "../db.js";

type Caller = ReturnType<typeof appRouter.createCaller>;
let store: TestDb;
let db: Db;

// Isolate SettingsService reads/writes (setWebhookPath persists to the
// canonical settings store) to a per-run temp file — never ~/.omnecor.
const testSettingsPath = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "omnecor-platforms-test-")),
  "settings.json"
);
(globalThis as { __testSettingsPath?: string }).__testSettingsPath = testSettingsPath;
afterAll(() => {
  delete (globalThis as { __testSettingsPath?: string }).__testSettingsPath;
  fs.rmSync(path.dirname(testSettingsPath), { recursive: true, force: true });
});

beforeEach(async () => {
  store = await createTestDb();
  db = store.db;
  h.db = db;
  fs.rmSync(testSettingsPath, { force: true });
});

describe("auth boundary", () => {
  it("rejects unauthenticated listAccounts", async () => {
    const caller = appRouter.createCaller(makeContext(null, db));
    await expect(caller.platforms.listAccounts()).rejects.toThrow(TRPCError);
  });
});

describe("platforms.addAccount", () => {
  it("persists the account and returns the new numeric id", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));

    const res = await caller.platforms.addAccount({
      platform: "twitter",
      accountName: "@me",
      oauthToken: "secret-access-token",
      oauthRefreshToken: "secret-refresh-token",
    });
    expect(res.success).toBe(true);
    expect(typeof res.accountId).toBe("number");

    // The token IS persisted in the DB...
    const rows = await db.select().from(platformAccounts);
    expect(rows).toHaveLength(1);
    expect(rows[0].oauthToken).toBe("secret-access-token");
  });

  it("re-connecting the same platform reuses the row (reactivates after disconnect, no duplicate)", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));

    const first = await caller.platforms.addAccount({ platform: "mastodon", accountName: "a", oauthToken: "tok-1" });
    await caller.platforms.disconnectAccount({ accountId: first.accountId });

    // Re-connect with a fresh token — should update the SAME row, not insert a new one.
    const second = await caller.platforms.addAccount({ platform: "mastodon", accountName: "a2", oauthToken: "tok-2" });
    expect(second.accountId).toBe(first.accountId);

    const rows = await db.select().from(platformAccounts);
    expect(rows).toHaveLength(1);
    expect(rows[0].oauthToken).toBe("tok-2");
    expect(rows[0].isActive).toBe(1); // reactivated
  });
});

describe("platforms.listAccounts / getAccount — token never exposed", () => {
  it("returns only safe columns (no oauthToken / oauthRefreshToken)", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    await caller.platforms.addAccount({
      platform: "linkedin",
      accountName: "acct",
      oauthToken: "tok",
      oauthRefreshToken: "ref",
    });

    const list = await caller.platforms.listAccounts();
    expect(list).toHaveLength(1);
    expect(list[0]).not.toHaveProperty("oauthToken");
    expect(list[0]).not.toHaveProperty("oauthRefreshToken");
    expect(list[0].platform).toBe("linkedin");

    const single = await caller.platforms.getAccount({ accountId: list[0].id });
    expect(single).not.toBeNull();
    expect(single).not.toHaveProperty("oauthToken");
  });

  it("lists only the caller's own active accounts", async () => {
    const alice = await seedUser(db, { openId: "a", email: "a@x.com" });
    const bob = await seedUser(db, { openId: "b", email: "b@x.com" });
    const aliceCaller = appRouter.createCaller(makeContext(alice, db));
    const bobCaller = appRouter.createCaller(makeContext(bob, db));

    await aliceCaller.platforms.addAccount({ platform: "x", accountName: "a", oauthToken: "t" });
    await bobCaller.platforms.addAccount({ platform: "x", accountName: "b", oauthToken: "t" });

    const aliceList = await aliceCaller.platforms.listAccounts();
    expect(aliceList).toHaveLength(1);
    expect(aliceList[0].accountName).toBe("a");
  });

  it("getAccount returns null for another user's account", async () => {
    const alice = await seedUser(db, { openId: "a2", email: "a2@x.com" });
    const bob = await seedUser(db, { openId: "b2", email: "b2@x.com" });
    const aliceCaller = appRouter.createCaller(makeContext(alice, db));

    const { accountId } = await aliceCaller.platforms.addAccount({
      platform: "x", accountName: "a", oauthToken: "t",
    });

    const bobCaller = appRouter.createCaller(makeContext(bob, db));
    const seen = await bobCaller.platforms.getAccount({ accountId });
    expect(seen).toBeNull();
  });
});

describe("platforms.updateAccount / disconnectAccount — ownership", () => {
  it("forbids updating another user's account", async () => {
    const alice = await seedUser(db, { openId: "a3", email: "a3@x.com" });
    const bob = await seedUser(db, { openId: "b3", email: "b3@x.com" });
    const { accountId } = await appRouter
      .createCaller(makeContext(alice, db))
      .platforms.addAccount({ platform: "x", accountName: "a", oauthToken: "t" });

    const bobCaller = appRouter.createCaller(makeContext(bob, db));
    await expect(
      bobCaller.platforms.updateAccount({ accountId, oauthToken: "hijacked" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("disconnect sets isActive=0 so the account drops out of listAccounts", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const { accountId } = await caller.platforms.addAccount({
      platform: "youtube", accountName: "yt", oauthToken: "t",
    });

    await caller.platforms.disconnectAccount({ accountId });
    const list = await caller.platforms.listAccounts();
    expect(list).toHaveLength(0);
  });

  it("forbids disconnecting another user's account", async () => {
    const alice = await seedUser(db, { openId: "a4", email: "a4@x.com" });
    const bob = await seedUser(db, { openId: "b4", email: "b4@x.com" });
    const { accountId } = await appRouter
      .createCaller(makeContext(alice, db))
      .platforms.addAccount({ platform: "x", accountName: "a", oauthToken: "t" });

    await expect(
      appRouter.createCaller(makeContext(bob, db)).platforms.disconnectAccount({ accountId })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("platforms.getPublishingRouting", () => {
  it("returns the webhook config built from ENV.n8nUrl + the default path", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const res = await caller.platforms.getPublishingRouting();
    const base = ENV.n8nUrl.replace(/\/$/, "");
    expect(res.webhook).toMatchObject({
      n8nUrl: base,
      webhookPath: DEFAULT_SOCIAL_WEBHOOK_PATH,
      webhookUrl: `${base}/webhook/${DEFAULT_SOCIAL_WEBHOOK_PATH}`,
    });
    // Non-sovereign users are never webhook-blocked regardless of n8n host.
    expect(res.webhook.sovereignBlocked).toBe(false);
  });

  it("sovereign + loopback n8n is allowed; sovereign + remote n8n is flagged blocked", async () => {
    const sovereign = await seedUser(db, { executionMode: "sovereign" });
    const caller: Caller = appRouter.createCaller(makeContext(sovereign, db));

    const prev = ENV.n8nUrl;
    try {
      ENV.n8nUrl = "http://127.0.0.1:5678";
      const local = await caller.platforms.getPublishingRouting();
      expect(local.webhook.isLoopback).toBe(true);
      expect(local.webhook.sovereignBlocked).toBe(false);

      ENV.n8nUrl = "https://n8n.example.com";
      const remote = await caller.platforms.getPublishingRouting();
      expect(remote.webhook.isLoopback).toBe(false);
      expect(remote.webhook.sovereignBlocked).toBe(true);
    } finally {
      ENV.n8nUrl = prev;
    }
  });
});

describe("platforms.setWebhookPath", () => {
  it("is admin-only (regular user → FORBIDDEN)", async () => {
    const user = await seedUser(db, { role: "user" });
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    await expect(
      caller.platforms.setWebhookPath({ webhookPath: "custom" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("persists a slash-trimmed path that getPublishingRouting then reflects", async () => {
    const admin = await seedUser(db, { role: "admin" });
    const caller: Caller = appRouter.createCaller(makeContext(admin, db));

    const res = await caller.platforms.setWebhookPath({ webhookPath: "/my-hook/" });
    expect(res).toEqual({ success: true, webhookPath: "my-hook" });

    const routing = await caller.platforms.getPublishingRouting();
    expect(routing.webhook.webhookPath).toBe("my-hook");
    expect(routing.webhook.webhookUrl.endsWith("/webhook/my-hook")).toBe(true);
  });

  it("an empty path restores the shipped-blueprint default", async () => {
    const admin = await seedUser(db, { role: "admin" });
    const caller: Caller = appRouter.createCaller(makeContext(admin, db));
    await caller.platforms.setWebhookPath({ webhookPath: "custom" });

    const res = await caller.platforms.setWebhookPath({ webhookPath: "" });
    expect(res.webhookPath).toBe(DEFAULT_SOCIAL_WEBHOOK_PATH);

    const routing = await caller.platforms.getPublishingRouting();
    expect(routing.webhook.webhookPath).toBe(DEFAULT_SOCIAL_WEBHOOK_PATH);
  });
});
