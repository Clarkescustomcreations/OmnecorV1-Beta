/**
 * Batch F (tail) — route-level tests for `gmailRouter` (gmail.status + gmail.sendEmail).
 *
 * Drives the real `appRouter.createCaller(ctx)` against the in-memory libSQL DB so
 * the active-account lookup (per-user, active-only, most-recent-first) genuinely
 * executes. The external surface is stubbed:
 *   - `isPlatformConfigured` / `refreshOAuthToken` from oauthClients are mocked,
 *   - global `fetch` is stubbed per-test so no request ever reaches Google.
 *
 * `buildRawMessage` header encoding is covered separately in gmailMessage.test.ts;
 * here we verify the router's transport wiring: config/connection guards, the
 * Bearer token + endpoint + RFC-2822 payload actually sent, refresh-on-401 token
 * rotation persisted to the DB, API-error mapping, ownership isolation, and the
 * Sovereign-mode gate (externalServiceProcedure).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TRPCError } from "@trpc/server";

// Isolate settings to a non-existent file so getSetting() falls back to defaults
// (sovereignBlockAiOnly = false) — a Sovereign user's outbound email stays blocked.
const h = vi.hoisted(() => {
  (globalThis as any).__testSettingsPath = "/tmp/test-settings-gmail-router.json";
  return { db: null as unknown };
});

vi.mock("../db.factory.js", async importActual => {
  const actual = await importActual<typeof import("../db.factory.js")>();
  return { ...actual, getDb: async () => h.db };
});

vi.mock("../core_services/services/AuditLogService.js", () => ({
  AuditLogService: {
    getInstance: () => ({ log: vi.fn().mockResolvedValue(undefined) }),
  },
}));

const oauth = vi.hoisted(() => ({
  isPlatformConfigured: vi.fn(() => true),
  refreshOAuthToken: vi.fn(),
}));
vi.mock("../oauth/oauthClients.js", async importActual => {
  const actual = await importActual<Record<string, unknown>>();
  return { ...actual, ...oauth };
});

import { appRouter } from "../routers.js";
import { platformAccounts } from "../../drizzle/schema.js";
import { eq } from "drizzle-orm";
import { createTestDb, seedUser, makeContext, type TestDb } from "./_helpers/trpcHarness.js";
import type { Db } from "../db.js";
import type { User } from "../../drizzle/schema.js";

type Caller = ReturnType<typeof appRouter.createCaller>;
let store: TestDb;
let db: Db;
let fetchMock: ReturnType<typeof vi.fn>;

/** Build a minimal Response-like object for the fetch stub. */
function mkRes(status: number, jsonBody: unknown = {}, textBody = ""): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => jsonBody,
    text: async () => textBody,
  } as unknown as Response;
}

/** Insert an active gmail account for a user, returning its id. */
async function seedGmail(
  userId: number,
  over: Partial<typeof platformAccounts.$inferInsert> = {},
): Promise<number> {
  const [row] = await db
    .insert(platformAccounts)
    .values({
      userId,
      platform: "gmail",
      accountName: "me@gmail.com",
      oauthToken: "tok",
      isActive: 1,
      ...over,
    })
    .returning({ id: platformAccounts.id });
  return row.id;
}

/** Decode the base64url `raw` field of the JSON body sent in a fetch call. */
function decodeSentMessage(callIndex = 0): string {
  const init = fetchMock.mock.calls[callIndex]?.[1] as RequestInit;
  const body = JSON.parse(init.body as string) as { raw: string };
  return Buffer.from(body.raw, "base64url").toString("utf-8");
}

function authHeader(callIndex = 0): string {
  const init = fetchMock.mock.calls[callIndex]?.[1] as RequestInit;
  return (init.headers as Record<string, string>).Authorization;
}

const GOOD_INPUT = { to: "dest@example.com", subject: "Hello", body: "Body text" };

beforeEach(async () => {
  store = await createTestDb();
  db = store.db;
  h.db = db;
  oauth.isPlatformConfigured.mockReset().mockReturnValue(true);
  oauth.refreshOAuthToken.mockReset();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("gmail — auth boundary", () => {
  it("rejects an unauthenticated sendEmail", async () => {
    const caller = appRouter.createCaller(makeContext(null, db));
    await expect(caller.gmail.sendEmail(GOOD_INPUT)).rejects.toThrow(TRPCError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated status query", async () => {
    const caller = appRouter.createCaller(makeContext(null, db));
    await expect(caller.gmail.status()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("gmail.status", () => {
  it("reports configured + connected with the account name", async () => {
    const user = await seedUser(db);
    await seedGmail(user.id, { accountName: "alice@gmail.com" });
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    expect(await caller.gmail.status()).toEqual({
      configured: true,
      connected: true,
      accountName: "alice@gmail.com",
    });
  });

  it("reports connected=false when no active account exists", async () => {
    const user = await seedUser(db);
    await seedGmail(user.id, { isActive: 0 }); // inactive row must not count
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    expect(await caller.gmail.status()).toEqual({
      configured: true,
      connected: false,
      accountName: null,
    });
  });

  it("reports configured=false when the OAuth client is not set up", async () => {
    oauth.isPlatformConfigured.mockReturnValue(false);
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    expect(await caller.gmail.status()).toMatchObject({ configured: false, connected: false });
  });
});

describe("gmail.sendEmail — guards", () => {
  it("throws PRECONDITION_FAILED and never fetches when Gmail is not configured", async () => {
    oauth.isPlatformConfigured.mockReturnValue(false);
    const user = await seedUser(db);
    await seedGmail(user.id); // even with an account, unconfigured client blocks first
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    await expect(caller.gmail.sendEmail(GOOD_INPUT)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws PRECONDITION_FAILED when no Gmail account is connected", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    await expect(caller.gmail.sendEmail(GOOD_INPUT)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ignores an inactive account (isActive=0) and reports no connection", async () => {
    const user = await seedUser(db);
    await seedGmail(user.id, { isActive: 0 });
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    await expect(caller.gmail.sendEmail(GOOD_INPUT)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed recipient before any network call (input validation)", async () => {
    const user = await seedUser(db);
    await seedGmail(user.id);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    await expect(
      caller.gmail.sendEmail({ ...GOOD_INPUT, to: "not-an-email" }),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("gmail.sendEmail — send path", () => {
  it("sends with the account's Bearer token and returns the message ids", async () => {
    const user = await seedUser(db);
    await seedGmail(user.id, { oauthToken: "tok-abc" });
    fetchMock.mockResolvedValue(mkRes(200, { id: "m-1", threadId: "t-1" }));
    const caller: Caller = appRouter.createCaller(makeContext(user, db));

    const res = await caller.gmail.sendEmail(GOOD_INPUT);
    expect(res).toEqual({ success: true, messageId: "m-1", threadId: "t-1" });

    // One POST to the Gmail send endpoint with the account's token.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain(
      "gmail.googleapis.com/gmail/v1/users/me/messages/send",
    );
    expect(authHeader()).toBe("Bearer tok-abc");

    // The RFC-2822 payload carries the caller's To/Subject/body.
    const sent = decodeSentMessage();
    expect(sent).toContain("To: dest@example.com");
    expect(sent).toContain("Subject: Hello");
    expect(sent).toContain("\r\n\r\nBody text");
  });

  it("returns null ids when the Gmail response omits them", async () => {
    const user = await seedUser(db);
    await seedGmail(user.id);
    fetchMock.mockResolvedValue(mkRes(200, {}));
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    expect(await caller.gmail.sendEmail(GOOD_INPUT)).toEqual({
      success: true,
      messageId: null,
      threadId: null,
    });
  });

  it("uses the most-recently-connected active account", async () => {
    const user = await seedUser(db);
    await seedGmail(user.id, { oauthToken: "old-token" });
    await seedGmail(user.id, { oauthToken: "new-token" }); // higher id = newest
    fetchMock.mockResolvedValue(mkRes(200, { id: "m", threadId: "t" }));
    const caller: Caller = appRouter.createCaller(makeContext(user, db));

    await caller.gmail.sendEmail(GOOD_INPUT);
    expect(authHeader()).toBe("Bearer new-token");
  });
});

describe("gmail.sendEmail — ownership isolation", () => {
  it("never sends through another user's connected account", async () => {
    const alice = await seedUser(db, { openId: "a", email: "a@x.com" });
    const bob = await seedUser(db, { openId: "b", email: "b@x.com" });
    await seedGmail(bob.id); // only Bob is connected
    const aliceCaller: Caller = appRouter.createCaller(makeContext(alice, db));

    await expect(aliceCaller.gmail.sendEmail(GOOD_INPUT)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("gmail.sendEmail — token refresh on 401", () => {
  it("refreshes on 401, retries, and persists the rotated token", async () => {
    const user = await seedUser(db);
    const id = await seedGmail(user.id, {
      oauthToken: "stale",
      oauthRefreshToken: "refresh-1",
    });
    fetchMock
      .mockResolvedValueOnce(mkRes(401, {}, "invalid_token"))
      .mockResolvedValueOnce(mkRes(200, { id: "m-2", threadId: "t-2" }));
    oauth.refreshOAuthToken.mockResolvedValue({
      access_token: "fresh",
      refresh_token: "refresh-2",
      expires_in: 3600,
    });
    const caller: Caller = appRouter.createCaller(makeContext(user, db));

    const res = await caller.gmail.sendEmail(GOOD_INPUT);
    expect(res).toMatchObject({ success: true, messageId: "m-2" });

    // Refresh was invoked with the stored refresh token; retry used the new one.
    expect(oauth.refreshOAuthToken).toHaveBeenCalledWith("gmail", "refresh-1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(authHeader(0)).toBe("Bearer stale");
    expect(authHeader(1)).toBe("Bearer fresh");

    // The rotated tokens are persisted back to the account row.
    const [row] = await db.select().from(platformAccounts).where(eq(platformAccounts.id, id));
    expect(row.oauthToken).toBe("fresh");
    expect(row.oauthRefreshToken).toBe("refresh-2");
    expect(row.tokenExpiresAt).toBeInstanceOf(Date);
  });

  it("surfaces a 401 as INTERNAL_SERVER_ERROR when there is no refresh token", async () => {
    const user = await seedUser(db);
    await seedGmail(user.id, { oauthRefreshToken: null });
    fetchMock.mockResolvedValue(mkRes(401, {}, "invalid_token"));
    const caller: Caller = appRouter.createCaller(makeContext(user, db));

    await expect(caller.gmail.sendEmail(GOOD_INPUT)).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
    expect(oauth.refreshOAuthToken).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("gmail.sendEmail — API error mapping", () => {
  it("maps a non-OK Gmail response to INTERNAL_SERVER_ERROR with the status", async () => {
    const user = await seedUser(db);
    await seedGmail(user.id);
    fetchMock.mockResolvedValue(mkRes(500, {}, "quota exceeded"));
    const caller: Caller = appRouter.createCaller(makeContext(user, db));

    await expect(caller.gmail.sendEmail(GOOD_INPUT)).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: expect.stringContaining("Gmail API 500"),
    });
  });
});

describe("gmail.sendEmail — sovereign gate", () => {
  it("blocks a Sovereign-mode user (externalServiceProcedure) before any send", async () => {
    const user: User = await seedUser(db, { executionMode: "sovereign" });
    await seedGmail(user.id); // connected, but the gate fires first
    const caller: Caller = appRouter.createCaller(makeContext(user, db));

    await expect(caller.gmail.sendEmail(GOOD_INPUT)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
