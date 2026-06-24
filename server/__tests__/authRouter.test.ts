/**
 * Route-level integration tests for the inline `auth` router.
 *
 * Covers two security/correctness-sensitive behaviours at the API boundary:
 *  - `auth.me` must NEVER ship `passwordHash` to the client (regression guard
 *    for the leak fixed alongside the ToS feature), while still returning the
 *    caller's own non-sensitive profile/state (email, role, tosAcceptedAt).
 *  - `auth.acceptTos` records an acceptance timestamp on the caller's row and
 *    is idempotent (re-accepting overwrites with a fresh timestamp).
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({ db: null as unknown }));

// `acceptTosForUser` (in db.factory) resolves getDb() from db.js's own binding,
// so the redirect must target db.js — overriding the db.factory re-export alone
// would not reach the internal call.
vi.mock("../db.js", async importActual => {
  const actual = await importActual<typeof import("../db.js")>();
  return { ...actual, getDb: async () => h.db };
});

// Stub the audit middleware so protectedProcedure stays hermetic.
vi.mock("../phase2/services/AuditLogService.js", () => ({
  AuditLogService: {
    getInstance: () => ({ log: vi.fn().mockResolvedValue(undefined) }),
  },
}));

import { appRouter } from "../routers.js";
import { users } from "../../drizzle/schema.js";
import { TOS_VERSION } from "../../shared/tos.js";
import { eq } from "drizzle-orm";
import {
  createTestDb,
  seedUser,
  makeContext,
  type TestDb,
} from "./_helpers/trpcHarness.js";
import type { Db } from "../db.js";

type Caller = ReturnType<typeof appRouter.createCaller>;

let store: TestDb;
let db: Db;

beforeAll(async () => {
  store = await createTestDb();
  db = store.db;
  h.db = db;
});

beforeEach(async () => {
  await db.delete(users);
});

describe("auth.me", () => {
  it("strips passwordHash but keeps the caller's own profile/state", async () => {
    const user = await seedUser(db, {
      email: "secret@example.com",
      passwordHash: "$argon2-super-secret-hash",
    });
    const caller: Caller = appRouter.createCaller(makeContext(user, db));

    const me = await caller.auth.me();

    expect(me).not.toBeNull();
    expect(me).not.toHaveProperty("passwordHash");
    expect(me?.email).toBe("secret@example.com");
    expect(me?.role).toBe("user");
    expect(me).toHaveProperty("tosAcceptedAt");
    expect(me).toHaveProperty("tosAcceptedVersion");
  });

  it("returns null when unauthenticated", async () => {
    const caller: Caller = appRouter.createCaller(makeContext(null, db));
    expect(await caller.auth.me()).toBeNull();
  });
});

describe("auth.acceptTos", () => {
  it("records an acceptance timestamp and the current version on the caller's row", async () => {
    const user = await seedUser(db);
    expect(user.tosAcceptedAt).toBeNull();
    expect(user.tosAcceptedVersion).toBeNull();

    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const res = await caller.auth.acceptTos();
    expect(res.success).toBe(true);
    expect(res.acceptedVersion).toBe(TOS_VERSION);

    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row?.tosAcceptedAt).toBeInstanceOf(Date);
    expect(row?.tosAcceptedVersion).toBe(TOS_VERSION);
  });

  it("is idempotent — re-accepting overwrites with a newer timestamp", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));

    await caller.auth.acceptTos();
    const [first] = await db.select().from(users).where(eq(users.id, user.id));
    const firstAt = first!.tosAcceptedAt!.getTime();

    // Advance the clock so the second write is strictly newer.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 1000));
    await caller.auth.acceptTos();
    vi.useRealTimers();

    const [second] = await db.select().from(users).where(eq(users.id, user.id));
    expect(second!.tosAcceptedAt!.getTime()).toBeGreaterThan(firstAt);
  });
});
