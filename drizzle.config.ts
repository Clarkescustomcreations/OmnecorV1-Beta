import { defineConfig } from "drizzle-kit";
import * as dotenv from "dotenv";
import { PATHS } from "./server/_core/paths.js";

dotenv.config();

// Unified libSQL/SQLite. Local file by default (zero-infra Sovereign mode);
// point at a libsql/Turso URL for networked/multi-node deployments.
//
// The local file is resolved via `PATHS.sqlite` — the SAME source of truth the
// server (`server/db.ts`) uses — so drizzle-kit generate/migrate/push always
// target the exact file the running app opens (dev: `<cwd>/data/omnecor.db`),
// never a divergent `~/.omnecor` copy.
const url =
  process.env.LIBSQL_URL ||
  process.env.TURSO_DATABASE_URL ||
  `file:${process.env.SQLITE_PATH ?? PATHS.sqlite}`;

export default defineConfig({
  schema: "./drizzle/schema.ts",
  out: "./drizzle/migrations",
  dialect: "turso",
  dbCredentials: {
    url,
    authToken: process.env.LIBSQL_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN,
  },
});
