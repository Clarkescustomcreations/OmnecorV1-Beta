import { defineConfig } from "drizzle-kit";
import * as dotenv from "dotenv";
import { homedir } from "os";
import { join } from "path";

dotenv.config();

// Unified libSQL/SQLite. Local file by default (zero-infra Sovereign mode);
// point at a libsql/Turso URL for networked/multi-node deployments.
const url =
  process.env.LIBSQL_URL ||
  process.env.TURSO_DATABASE_URL ||
  `file:${process.env.SQLITE_PATH ?? join(homedir(), ".omnecor", "data", "omnecor.db")}`;

export default defineConfig({
  schema: "./drizzle/schema.ts",
  out: "./drizzle/migrations",
  dialect: "turso",
  dbCredentials: {
    url,
    authToken: process.env.LIBSQL_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN,
  },
});
