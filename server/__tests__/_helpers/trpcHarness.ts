/**
 * Shared test harness for route-level (tRPC) integration tests.
 *
 * Backs the route layer with a **real** in-memory libSQL database (the actual
 * `drizzle/schema.ts` + generated migrations), so ownership filters, upserts,
 * cascades and JSON round-trips genuinely execute — these are not shallow
 * chained mocks. A router test wires `getDb()` to a DB created here via
 * `vi.mock("../db.factory.js", …)` (see chatRouter.test.ts for the pattern).
 *
 * This file deliberately does NOT match `*.test.ts`, so vitest never collects it
 * as a suite.
 */
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import * as schema from "../../../drizzle/schema.js";
import { users, type User } from "../../../drizzle/schema.js";
import type { Db } from "../../db.js";
import type { TrpcContext } from "../../_core/context.js";
import { ProcessManagerService } from "../../phase2/services/ProcessManagerService.js";

const MIGRATIONS_DIR = path.resolve(
  import.meta.dirname,
  "../../../drizzle/migrations"
);

export type TestDb = { db: Db; client: Client };

/**
 * Spin up a fresh, isolated in-memory database with the full schema applied.
 * Foreign keys are enabled so `onDelete: "cascade"` (e.g. session → messages)
 * behaves exactly as it does in production SQLite.
 */
export async function createTestDb(): Promise<TestDb> {
  const client = createClient({ url: ":memory:" });
  await client.execute("PRAGMA foreign_keys = ON");
  const db = drizzle(client, { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS_DIR });
  return { db, client };
}

/** Insert a user row and return the persisted record (with its assigned id). */
export async function seedUser(
  db: Db,
  overrides: Partial<typeof users.$inferInsert> = {}
): Promise<User> {
  const [row] = await db
    .insert(users)
    .values({
      openId: overrides.openId ?? `user-${randomUUID()}`,
      email: overrides.email ?? "user@example.com",
      name: overrides.name ?? "Test User",
      role: overrides.role ?? "user",
      executionMode: overrides.executionMode ?? "scrapper",
      ...overrides,
    })
    .returning();
  if (!row) throw new Error("seedUser: insert returned no row");
  return row;
}

/**
 * Build a minimal `TrpcContext` for `appRouter.createCaller(ctx)`. Only the
 * fields the route layer actually reads are populated faithfully (`user`, `db`,
 * a stub `req`/`res`, and any `services` the test supplies). Routers that reach
 * into `ctx.services.*` should pass mocked services in via `services`.
 */
/**
 * Poll ProcessManagerService until a job reaches a terminal state or the
 * timeout expires. Use this in bridge tests that spawn background jobs via
 * ProcessManagerService (Blender, ESP flash/erase, etc.).
 */
export async function waitForJob(
  jobId: string,
  timeoutMs: number
): Promise<ReturnType<ProcessManagerService["getJobStatus"]>> {
  const pm = ProcessManagerService.getInstance();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = pm.getJobStatus(jobId);
    if (status && ["completed", "failed", "cancelled"].includes(status.state)) {
      return status;
    }
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error(`Job ${jobId} did not finish within ${timeoutMs}ms`);
}

export function makeContext(
  user: User | null,
  db: Db,
  services: Record<string, unknown> = {}
): TrpcContext {
  return {
    user,
    db,
    req: {
      protocol: "https",
      headers: {},
      ip: "127.0.0.1",
      socket: { remoteAddress: "127.0.0.1" },
    },
    res: {
      clearCookie() {},
      cookie() {},
      setHeader() {},
    },
    services,
  } as unknown as TrpcContext;
}
