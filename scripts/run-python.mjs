#!/usr/bin/env node
/**
 * Cross-platform Python launcher for package.json scripts.
 *
 * Windows ships Python as `python` (or the `py` launcher); Linux/macOS as
 * `python3`. Resolves the first working interpreter (PYTHON_BIN env var wins)
 * and forwards all arguments and the exit code.
 *
 * Usage: node scripts/run-python.mjs <script.py> [args...]
 */
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: node scripts/run-python.mjs <script.py> [args...]");
  process.exit(2);
}

const candidates = [
  process.env.PYTHON_BIN,
  process.platform === "win32" ? "python" : "python3",
  process.platform === "win32" ? "py" : "python",
].filter(Boolean);

for (const bin of candidates) {
  const probe = spawnSync(bin, ["--version"], { stdio: "ignore" });
  if (probe.error || probe.status !== 0) continue;
  const result = spawnSync(bin, args, { stdio: "inherit" });
  process.exit(result.status ?? 1);
}

console.error(
  `No Python interpreter found (tried: ${candidates.join(", ")}). ` +
    "Install Python 3 or set PYTHON_BIN to its path.",
);
process.exit(1);
