import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { existsSync, unlinkSync, writeFileSync } from "fs";

// Hoist the test settings path override so modules loaded afterwards read it
const h = vi.hoisted(() => {
  (globalThis as any).__testSettingsPath = "/tmp/test-settings-sovereign-gating.json";
  return { db: null as unknown };
});

// Route the router's getDb() at the shared in-memory test DB
vi.mock("../db.factory.js", async importActual => {
  const actual = await importActual<typeof import("../db.factory.js")>();
  return { ...actual, getDb: async () => h.db };
});

// Stub AuditLogService
vi.mock("../phase2/services/AuditLogService.js", () => ({
  AuditLogService: {
    getInstance: () => ({ log: vi.fn().mockResolvedValue(undefined) }),
  },
}));

// Mock HonchoService
vi.mock("../phase2/services/HonchoService.js", () => ({
  honchoService: {
    addMessage: vi.fn().mockResolvedValue({ ok: true }),
    addFact: vi.fn().mockResolvedValue({ ok: true }),
    getFacts: vi.fn().mockResolvedValue([]),
  },
}));

// Mock VirtualCardService
vi.mock("../phase2/services/VirtualCardService.js", () => ({
  VirtualCardService: {
    getInstance: () => ({
      isConfigured: () => true,
      revealPan: vi.fn().mockResolvedValue("1234-5678-9012-3456"),
      listTransactions: vi.fn().mockResolvedValue([]),
      issueCard: vi.fn().mockResolvedValue({ token: "card-token" }),
    }),
  },
  CardOperationError: class extends Error {},
}));

// Mock HITLApprovalService
vi.mock("../phase2/services/HITLApprovalService.js", () => ({
  HITLApprovalService: {
    getInstance: () => ({
      requestApproval: vi.fn().mockResolvedValue(true),
    }),
  },
}));

// Mock oauthClients
vi.mock("../oauth/oauthClients.js", () => ({
  isPlatformConfigured: () => true,
  getOAuthAuthorizationUrl: vi.fn().mockResolvedValue("https://oauth.url"),
  exchangeCodeForToken: vi.fn().mockResolvedValue({ access_token: "token" }),
  fetchUserProfile: vi.fn().mockResolvedValue({ name: "Test User" }),
  listOAuthPlatforms: () => ["gmail"],
  getRedirectUri: () => "https://redirect.url",
}));

// Mock global fetch for GmailRouter to prevent external hits
globalThis.fetch = vi.fn().mockImplementation(() =>
  Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ id: "msg-id", threadId: "thread-id" }),
    text: () => Promise.resolve(""),
  } as Response)
);

import { appRouter } from "../routers.js";
import {
  createTestDb,
  seedUser,
  makeContext,
} from "./_helpers/trpcHarness.js";
import type { Db } from "../db.js";

describe("Sovereign Gating Protections & Active Map Sync", () => {
  beforeEach(async () => {
    // Ensure the temp settings file is absent/fresh
    const path = (globalThis as any).__testSettingsPath;
    if (existsSync(path)) {
      try {
        unlinkSync(path);
      } catch {}
    }

    const testDb = await createTestDb();
    h.db = testDb.db;
  });

  afterEach(() => {
    const path = (globalThis as any).__testSettingsPath;
    if (existsSync(path)) {
      try {
        unlinkSync(path);
      } catch {}
    }
  });

  it("blocks Honcho API operations for users in Sovereign Mode", async () => {
    const user = await seedUser(h.db as Db, { executionMode: "sovereign" });
    const ctx = makeContext(user, h.db as Db);
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.honcho.getFacts({ openId: user.openId })
    ).rejects.toThrowError(/Sovereign mode: external service calls are disabled/);

    await expect(
      caller.honcho.addMessage({
        openId: user.openId,
        sessionId: "session-id",
        role: "user",
        content: "test",
      })
    ).rejects.toThrowError(/Sovereign mode: external service calls are disabled/);

    await expect(
      caller.honcho.addFact({
        openId: user.openId,
        content: "test fact",
      })
    ).rejects.toThrowError(/Sovereign mode: external service calls are disabled/);
  });

  it("allows Honcho API operations for users in non-Sovereign Mode", async () => {
    const user = await seedUser(h.db as Db, { executionMode: "scrapper" });
    const ctx = makeContext(user, h.db as Db);
    const caller = appRouter.createCaller(ctx);

    const facts = await caller.honcho.getFacts({ openId: user.openId });
    expect(facts).toEqual([]);

    const msgRes = await caller.honcho.addMessage({
      openId: user.openId,
      sessionId: "session-id",
      role: "user",
      content: "test",
    });
    expect(msgRes).toEqual({ ok: true });
  });

  it("blocks Gmail outbound emails for users in Sovereign Mode", async () => {
    const user = await seedUser(h.db as Db, { executionMode: "sovereign" });
    const ctx = makeContext(user, h.db as Db);
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.gmail.sendEmail({
        to: "test@example.com",
        subject: "Alert",
        body: "Hello",
      })
    ).rejects.toThrowError(/Sovereign mode: external service calls are disabled/);
  });

  it("blocks Lithic virtual card operations for users in Sovereign Mode", async () => {
    const user = await seedUser(h.db as Db, { executionMode: "sovereign" });
    const ctx = makeContext(user, h.db as Db);
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.virtualCard.issueCard({
        spendLimitDollars: 50,
        memo: "Test Limit",
      })
    ).rejects.toThrowError(/Sovereign mode: external service calls are disabled/);

    await expect(
      caller.virtualCard.revealCardPan({
        cardToken: "token",
      })
    ).rejects.toThrowError(/Sovereign mode: external service calls are disabled/);

    await expect(
      caller.virtualCard.listTransactions({
        cardToken: "token",
      })
    ).rejects.toThrowError(/Sovereign mode: external service calls are disabled/);
  });

  it("blocks OAuth token exchanges for users in Sovereign Mode", async () => {
    const user = await seedUser(h.db as Db, { executionMode: "sovereign" });
    const ctx = makeContext(user, h.db as Db);
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.oauth.handleCallback({
        platform: "gmail",
        code: "oauth-auth-code",
        state: "oauth-state-token",
      })
    ).rejects.toThrowError(/Sovereign mode: external service calls are disabled/);
  });

  it("allows local queries like getCard in Sovereign Mode", async () => {
    const user = await seedUser(h.db as Db, { executionMode: "sovereign" });
    
    const { virtualCards } = await import("../../drizzle/schema.js");
    await (h.db as Db).insert(virtualCards).values({
      userId: user.id,
      token: "card-token-123",
      lastFour: "4321",
      expMonth: 12,
      expYear: 2030,
      status: "active",
      spendLimitCents: 5000,
      memo: "Local Card",
      encryptedCredentials: "blob",
      ivHex: "iv",
      authTagHex: "auth",
    });

    const ctx = makeContext(user, h.db as Db);
    const caller = appRouter.createCaller(ctx);

    const card = await caller.virtualCard.getCard({ cardToken: "card-token-123" });
    expect(card.lastFour).toBe("4321");
    expect(card.memo).toBe("Local Card");
  });

  it("allows setting and getting activeMapId in settings with a valid UUID", async () => {
    const user = await seedUser(h.db as Db, { executionMode: "scrapper" });
    const ctx = makeContext(user, h.db as Db);
    const caller = appRouter.createCaller(ctx);

    // Initial value is null
    const getRes1 = await caller.neuralMaps.getActiveMapId();
    expect(getRes1.activeMapId).toBeNull();

    // Set valid UUID
    const validUuid = "12345678-1234-4234-8234-1234567890ab";
    const setRes = await caller.neuralMaps.setActiveMapId({ activeMapId: validUuid });
    expect(setRes.success).toBe(true);

    // Retrieve value
    const getRes2 = await caller.neuralMaps.getActiveMapId();
    expect(getRes2.activeMapId).toBe(validUuid);

    // Set value to null
    const setNullRes = await caller.neuralMaps.setActiveMapId({ activeMapId: null });
    expect(setNullRes.success).toBe(true);

    const getRes3 = await caller.neuralMaps.getActiveMapId();
    expect(getRes3.activeMapId).toBe(null);
  });

  it("fails to set activeMapId if it is not a valid UUID format", async () => {
    const user = await seedUser(h.db as Db, { executionMode: "scrapper" });
    const ctx = makeContext(user, h.db as Db);
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.neuralMaps.setActiveMapId({ activeMapId: "not-a-uuid" })
    ).rejects.toThrow();
  });

  it("throws INTERNAL_SERVER_ERROR if settings file has invalid JSON", async () => {
    const user = await seedUser(h.db as Db, { executionMode: "scrapper" });
    const ctx = makeContext(user, h.db as Db);
    const caller = appRouter.createCaller(ctx);

    // Set the settings file to invalid JSON
    const path = (globalThis as any).__testSettingsPath;
    writeFileSync(path, "{invalid-json}", "utf-8");

    try {
      await caller.neuralMaps.setActiveMapId({ activeMapId: "12345678-1234-4234-8234-1234567890ab" });
      expect.fail("Expected setActiveMapId to throw");
    } catch (e: any) {
      expect(e).toBeInstanceOf(TRPCError);
      expect(e.code).toBe("INTERNAL_SERVER_ERROR");
      expect(e.message).toContain("Failed to read or parse settings file");
    }
  });
});
