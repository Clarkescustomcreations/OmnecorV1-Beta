/**
 * TokenRefreshService — pre-emptive background renewal of platformAccounts tokens.
 *
 * The service sweeps the `platformAccounts` store (the real, populated OAuth
 * token store) and renews any active account with a refresh token that is within
 * the 30-min renewal window. The per-account refresh/re-encrypt/revoke logic
 * lives in server/oauth/platformTokens.ts (refreshAndPersistAccount), which
 * calls oauthClients.refreshOAuthToken — mocked here.
 *
 *   checkExpiring(): renews active accounts expiring < 30 min that have a
 *     refresh token; ignores rows without a refresh token, with far-future
 *     expiry, or that are inactive.
 *   refresh success: persists a fresh (re-encrypted) access token + new expiry.
 *   invalid_grant: deactivates the account (isActive → 0) so the UI reconnects.
 *   transient failure: leaves the account intact for the next sweep.
 *   forceRefresh(platform, userId): renews only that user's account(s).
 *
 * Uses a real in-memory libSQL test DB (createTestDb) so Drizzle runs against
 * the real schema and the encryption round-trips through the actual columns.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

// Set the encryption secret BEFORE the statically-imported modules load —
// ENV.cookieSecret is resolved once at module-load time (process.env.JWT_SECRET),
// so it must be present before `import` runs (hoisted callbacks run first).
const h = vi.hoisted(() => {
  process.env.JWT_SECRET = "test-jwt-secret-at-least-32-chars!";
  process.env.COOKIE_SECRET = process.env.JWT_SECRET;
  return { db: null as unknown };
});

vi.mock("../db.factory.js", async (importActual) => {
  const actual = await importActual<typeof import("../db.factory.js")>();
  return { ...actual, getDb: async () => h.db };
});

const mockRefreshOAuthToken = vi.fn();
vi.mock("../oauth/oauthClients.js", () => ({
  refreshOAuthToken: (...args: unknown[]) => mockRefreshOAuthToken(...args),
}));

import { TokenRefreshService } from "../core_services/services/TokenRefreshService.js";
import { encryptPlatformToken, decryptPlatformToken } from "../oauth/platformTokens.js";
import { createTestDb, type TestDb } from "./_helpers/trpcHarness.js";
import { platformAccounts } from "../../drizzle/schema.js";
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
  mockRefreshOAuthToken.mockReset();
  (TokenRefreshService as any).instance = undefined;
});

afterEach(() => {
  TokenRefreshService.getInstance().stop();
  delete process.env.JWT_SECRET;
  delete process.env.COOKIE_SECRET;
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function seedAccount(overrides: {
  userId?: number;
  platform?: string;
  expiresAt?: Date | null;
  refreshToken?: string | null;
  isActive?: number;
}): Promise<number> {
  const [row] = await db
    .insert(platformAccounts)
    .values({
      userId: overrides.userId ?? 1,
      platform: overrides.platform ?? "gmail",
      accountName: "Test Account",
      oauthToken: encryptPlatformToken("current-access-token"),
      oauthRefreshToken:
        overrides.refreshToken !== undefined
          ? overrides.refreshToken
            ? encryptPlatformToken(overrides.refreshToken)
            : null
          : encryptPlatformToken("old-refresh-token"),
      tokenExpiresAt:
        overrides.expiresAt !== undefined
          ? overrides.expiresAt
          : new Date(Date.now() + 5 * 60 * 1000), // default: 5 min out (within window)
      isActive: overrides.isActive ?? 1,
    })
    .returning({ id: platformAccounts.id });
  return row.id;
}

function accountById(id: number) {
  return db.select().from(platformAccounts).where(eq(platformAccounts.id, id)).then(r => r[0]);
}

// ── checkExpiring ─────────────────────────────────────────────────────────────

describe("TokenRefreshService.checkExpiring", () => {
  it("renews an active account expiring < 30 min with a refresh token", async () => {
    const id = await seedAccount({ expiresAt: new Date(Date.now() + 10 * 60 * 1000) });
    mockRefreshOAuthToken.mockResolvedValueOnce({
      access_token: "new-access-token",
      refresh_token: "rotated-refresh-token",
      token_type: "Bearer",
      expires_in: 3600,
    });

    await (TokenRefreshService.getInstance() as any).checkExpiring();

    expect(mockRefreshOAuthToken).toHaveBeenCalledWith("gmail", "old-refresh-token");
    const row = await accountById(id);
    expect(decryptPlatformToken(row.oauthToken)).toBe("new-access-token");
    expect(decryptPlatformToken(row.oauthRefreshToken)).toBe("rotated-refresh-token");
    const diff = row.tokenExpiresAt!.getTime() - Date.now();
    expect(diff).toBeGreaterThan(3000 * 1000);
    expect(diff).toBeLessThan(3700 * 1000);
  });

  it("stored access token is encrypted at rest (not plaintext)", async () => {
    const id = await seedAccount({ expiresAt: new Date(Date.now() + 10 * 60 * 1000) });
    mockRefreshOAuthToken.mockResolvedValueOnce({
      access_token: "brand-new-token",
      token_type: "Bearer",
      expires_in: 3600,
    });

    await (TokenRefreshService.getInstance() as any).checkExpiring();

    const row = await accountById(id);
    expect(row.oauthToken).toMatch(/^v1:/);
    expect(row.oauthToken).not.toContain("brand-new-token");
  });

  it("ignores accounts with no refresh token", async () => {
    await seedAccount({ refreshToken: null });
    await (TokenRefreshService.getInstance() as any).checkExpiring();
    expect(mockRefreshOAuthToken).not.toHaveBeenCalled();
  });

  it("ignores accounts whose expiry is beyond the 30-min window", async () => {
    await seedAccount({ expiresAt: new Date(Date.now() + 60 * 60 * 1000) });
    await (TokenRefreshService.getInstance() as any).checkExpiring();
    expect(mockRefreshOAuthToken).not.toHaveBeenCalled();
  });

  it("ignores inactive accounts", async () => {
    await seedAccount({ isActive: 0, expiresAt: new Date(Date.now() + 5 * 60 * 1000) });
    await (TokenRefreshService.getInstance() as any).checkExpiring();
    expect(mockRefreshOAuthToken).not.toHaveBeenCalled();
  });

  it("ignores accounts with no known expiry (null tokenExpiresAt)", async () => {
    await seedAccount({ expiresAt: null });
    await (TokenRefreshService.getInstance() as any).checkExpiring();
    expect(mockRefreshOAuthToken).not.toHaveBeenCalled();
  });
});

// ── Refresh failure handling ──────────────────────────────────────────────────

describe("TokenRefreshService — refresh failure handling", () => {
  it("invalid_grant deactivates the account (isActive → 0)", async () => {
    const id = await seedAccount({});
    mockRefreshOAuthToken.mockRejectedValueOnce(
      Object.assign(new Error("Bad Request"), { data: { payload: { error: "invalid_grant" } } })
    );

    await (TokenRefreshService.getInstance() as any).checkExpiring();

    const row = await accountById(id);
    expect(row.isActive).toBe(0);
  });

  it("transient failure leaves the account active and unchanged", async () => {
    const id = await seedAccount({});
    mockRefreshOAuthToken.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    await (TokenRefreshService.getInstance() as any).checkExpiring();

    const row = await accountById(id);
    expect(row.isActive).toBe(1);
    expect(decryptPlatformToken(row.oauthToken)).toBe("current-access-token");
  });
});

// ── forceRefresh ──────────────────────────────────────────────────────────────

describe("TokenRefreshService.forceRefresh", () => {
  it("renews only the given user's account(s) for a platform", async () => {
    const mine = await seedAccount({ userId: 7, platform: "dropbox", expiresAt: new Date(Date.now() + 90 * 60 * 1000) });
    const other = await seedAccount({ userId: 8, platform: "dropbox", expiresAt: new Date(Date.now() + 90 * 60 * 1000) });
    mockRefreshOAuthToken.mockResolvedValue({
      access_token: "forced-token",
      token_type: "Bearer",
      expires_in: 3600,
    });

    await TokenRefreshService.getInstance().forceRefresh("dropbox", 7);

    expect(mockRefreshOAuthToken).toHaveBeenCalledTimes(1);
    expect(decryptPlatformToken((await accountById(mine)).oauthToken)).toBe("forced-token");
    // The other user's account is untouched even though it shares the platform.
    expect(decryptPlatformToken((await accountById(other)).oauthToken)).toBe("current-access-token");
  });

  it("skips accounts without a refresh token", async () => {
    await seedAccount({ platform: "dropbox", refreshToken: null });
    await TokenRefreshService.getInstance().forceRefresh("dropbox");
    expect(mockRefreshOAuthToken).not.toHaveBeenCalled();
  });
});
