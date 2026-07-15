/**
 * Standalone migration runner — use via `pnpm db:migrate`.
 *
 * Runs all pending drizzle-kit generated migrations against the configured
 * database (local file or remote libsql/Turso) and exits. Safe to run before
 * `pnpm start` in CI/CD pipelines or initial deployments.
 */
import path from "path";
import fs from "fs";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import * as schema from "../../drizzle/schema.js";
import { PATHS } from "../_core/paths.js";

const MIGRATIONS_DIR = path.join(process.cwd(), "drizzle", "migrations");

/**
 * Resolve the DB via the SAME precedence the running server uses
 * (`server/db.ts`): remote → `SQLITE_PATH` → `PATHS.sqlite`. Sharing the single
 * `PATHS.sqlite` source of truth is critical: the local dev file is
 * `<cwd>/data/omnecor.db` (via `resolveDataPath`), NOT `~/.omnecor/...`, so a
 * hardcoded home path here would migrate a *different* file than the server
 * opens — the exact drift that let a new table appear "missing" at runtime.
 */
function resolveUrl(): { url: string; authToken?: string } {
  const remote = process.env.LIBSQL_URL || process.env.TURSO_DATABASE_URL;
  if (remote) {
    return { url: remote, authToken: process.env.LIBSQL_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN };
  }
  const filePath = process.env.SQLITE_PATH ?? PATHS.sqlite;
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return { url: `file:${filePath}` };
}

async function main() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.error(`[migrate] No migrations folder at ${MIGRATIONS_DIR}`);
    console.error(`[migrate] Run: pnpm build:push`);
    process.exit(1);
  }

  const { url, authToken } = resolveUrl();
  console.log(`[migrate] Target: ${url.startsWith("file:") ? url : "<remote libsql>"}`);

  const client = createClient({ url, authToken });
  const db = drizzle(client, { schema });

  if (url.startsWith("file:")) {
    await client.execute("PRAGMA journal_mode = WAL");
    await client.execute("PRAGMA foreign_keys = ON");
  }

  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  console.log("[migrate] All migrations applied successfully.");
  await client.close();
}

main().catch((err) => {
  console.error("[migrate] Migration failed:", err);
  process.exit(1);
});
