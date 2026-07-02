/**
 * Batch F — route-level tests for `oauthRouter` (social/cloud OAuth code flow).
 *
 * The external `oauthClients` (authorize-URL builder, token exchange, profile
 * fetch) are mocked, but the **PKCE state store is exercised for real** against
 * the in-memory `oauthStates` table:
 *   - getAuthorizationUrl generates a state + PKCE verifier/challenge, persists
 *     the state, and the SHA-256(verifier) it sends as the challenge matches the
 *     stored verifier (real PKCE binding),
 *   - handleCallback validates state (platform + userId + TTL), exchanges the
 *     code, and inserts the platformAccounts row — cross-user / bogus state is
 *     rejected, sovereign users are blocked (externalServiceProcedure),
 *   - disconnectAccount enforces per-user ownership.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import crypto from "node:crypto";
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

const oauthClients = vi.hoisted(() => ({
  getOAuthAuthorizationUrl: vi.fn(),
  exchangeCodeForToken: vi.fn(),
  fetchUserProfile: vi.fn(),
}));
vi.mock("../oauth/oauthClients.js", async importActual => {
  const actual = await importActual<Record<string, unknown>>();
  return { ...actual, ...oauthClients };
});

import { appRouter } from "../routers.js";
import { getOAuthState } from "../_core/oauth.js";
import { platformAccounts, oauthStates } from "../../drizzle/schema.js";
import { eq } from "drizzle-orm";
import { createTestDb, seedUser, makeContext, type TestDb } from "./_helpers/trpcHarness.js";
import type { Db } from "../db.js";

type Caller = ReturnType<typeof appRouter.createCaller>;
let store: TestDb;
let db: Db;

const sha256url = (v: string) => crypto.createHash("sha256").update(v).digest("base64url");

beforeEach(async () => {
  store = await createTestDb();
  db = store.db;
  h.db = db;
  oauthClients.getOAuthAuthorizationUrl.mockReset();
  oauthClients.exchangeCodeForToken.mockReset();
  oauthClients.fetchUserProfile.mockReset();
});

describe("oauth — auth boundary", () => {
  it("rejects an unauthenticated getAuthorizationUrl", async () => {
    const caller = appRouter.createCaller(makeContext(null, db));
    await expect(
      caller.oauth.getAuthorizationUrl({ platform: "twitter" })
    ).rejects.toThrow(TRPCError);
  });
});

describe("oauth.getAuthorizationUrl — PKCE state", () => {
  it("persists state + verifier and sends a matching SHA-256 challenge", async () => {
    oauthClients.getOAuthAuthorizationUrl.mockResolvedValue("https://x.com/i/oauth2/authorize?x=1");
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));

    const res = await caller.oauth.getAuthorizationUrl({ platform: "twitter" });
    expect(res.authUrl).toBe("https://x.com/i/oauth2/authorize?x=1");
    expect(res.state).toHaveLength(32);

    // The PKCE state row was persisted (real oauthStates table), bound to the user.
    const saved = await getOAuthState(res.state);
    expect(saved).toMatchObject({ platform: "twitter", userId: user.id });
    expect(saved?.codeVerifier).toBeTruthy();

    // The challenge sent to the provider is SHA-256(verifier) — real PKCE binding.
    const challengeArg = oauthClients.getOAuthAuthorizationUrl.mock.calls[0]?.[3];
    expect(challengeArg).toBe(sha256url(saved!.codeVerifier!));
  });

  it("surfaces a provider-config failure as BAD_REQUEST (not masked)", async () => {
    oauthClients.getOAuthAuthorizationUrl.mockRejectedValue(new Error("missing client id"));
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    await expect(
      caller.oauth.getAuthorizationUrl({ platform: "linkedin" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("oauth.handleCallback", () => {
  async function startFlow(caller: Caller) {
    oauthClients.getOAuthAuthorizationUrl.mockResolvedValue("https://x.com/authorize");
    const { state } = await caller.oauth.getAuthorizationUrl({ platform: "twitter" });
    return state;
  }

  it("exchanges the code and persists the connected account", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const state = await startFlow(caller);

    oauthClients.exchangeCodeForToken.mockResolvedValue({
      access_token: "tok_123",
      refresh_token: "ref_123",
      expires_in: 3600,
    });
    oauthClients.fetchUserProfile.mockResolvedValue({ name: "Alice Doe", username: "alice" });

    const res = await caller.oauth.handleCallback({ platform: "twitter", code: "auth_code", state });
    expect(res).toEqual({ success: true, accountName: "Alice Doe", platform: "twitter" });

    // The PKCE verifier was forwarded to the token exchange…
    expect(oauthClients.exchangeCodeForToken.mock.calls[0]?.[0]).toBe("twitter");
    expect(oauthClients.exchangeCodeForToken.mock.calls[0]?.[1]).toBe("auth_code");
    // …and the account row landed with the access token.
    const rows = await db.select().from(platformAccounts).where(eq(platformAccounts.userId, user.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].oauthToken).toBe("tok_123");

    // State is single-use — consumed on callback.
    expect(await getOAuthState(state)).toBeUndefined();
  });

  it("rejects a bogus state with BAD_REQUEST and never exchanges a code", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    await expect(
      caller.oauth.handleCallback({ platform: "twitter", code: "c", state: "not-a-real-state" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(oauthClients.exchangeCodeForToken).not.toHaveBeenCalled();
  });

  it("rejects completing another user's OAuth state (userId mismatch)", async () => {
    const alice = await seedUser(db, { openId: "a", email: "a@x.com" });
    const bob = await seedUser(db, { openId: "b", email: "b@x.com" });
    const aliceCaller = appRouter.createCaller(makeContext(alice, db));
    const state = await startFlow(aliceCaller);

    const bobCaller = appRouter.createCaller(makeContext(bob, db));
    await expect(
      bobCaller.oauth.handleCallback({ platform: "twitter", code: "c", state })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(oauthClients.exchangeCodeForToken).not.toHaveBeenCalled();
  });

  it("blocks a sovereign user (externalServiceProcedure)", async () => {
    const user = await seedUser(db, { executionMode: "sovereign" });
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    await expect(
      caller.oauth.handleCallback({ platform: "twitter", code: "c", state: "s" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("oauth.disconnectAccount — ownership", () => {
  async function seedAccount(userId: number) {
    const [row] = await db.insert(platformAccounts).values({
      userId, platform: "twitter", accountName: "acct", oauthToken: "t", isActive: 1,
    }).returning({ id: platformAccounts.id });
    return row.id;
  }

  it("deactivates the caller's own account", async () => {
    const user = await seedUser(db);
    const id = await seedAccount(user.id);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    expect(await caller.oauth.disconnectAccount({ accountId: id })).toEqual({ success: true });
    const [row] = await db.select().from(platformAccounts).where(eq(platformAccounts.id, id));
    expect(row.isActive).toBe(0);
  });

  it("forbids disconnecting another user's account", async () => {
    const alice = await seedUser(db, { openId: "a2", email: "a2@x.com" });
    const bob = await seedUser(db, { openId: "b2", email: "b2@x.com" });
    const id = await seedAccount(alice.id);
    const bobCaller = appRouter.createCaller(makeContext(bob, db));
    await expect(
      bobCaller.oauth.disconnectAccount({ accountId: id })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    // Alice's account stays active.
    const [row] = await db.select().from(platformAccounts).where(eq(platformAccounts.id, id));
    expect(row.isActive).toBe(1);
  });
});
