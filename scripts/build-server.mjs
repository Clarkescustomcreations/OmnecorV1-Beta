// Bundles the Omnecor backend (server/_core/index.ts) into dist/index.js.
//
// Why this exists instead of an inline `esbuild` CLI call:
// the Expo / React Native mobile workspace pulls in Express 5 + path-to-regexp@8,
// which pnpm hoists to the repo-root node_modules/path-to-regexp. The server uses
// Express 4, whose Layer calls path-to-regexp as a *function* (the 0.1.x API).
// v8 exports named members and is NOT callable, so a default bundle wires Express 4
// to the hoisted v8 and the server dies on boot with "pathRegexp is not a function".
// Express 4's correct 0.1.x copy lives under .pnpm; we resolve it and alias the
// server bundle's single path-to-regexp consumer (Express 4) to it.
import { build } from "esbuild";
import { readdirSync, writeFileSync } from "fs";
import { join } from "path";

// Locate the 0.1.x path-to-regexp that Express 4 needs (callable default export).
function resolveClassicPathToRegexp() {
  const pnpmDir = join(process.cwd(), "node_modules", ".pnpm");
  const match = readdirSync(pnpmDir).find((d) => /^path-to-regexp@0\.1\./.test(d));
  if (!match) {
    throw new Error(
      "Could not find path-to-regexp@0.1.x under node_modules/.pnpm — Express 4 needs the callable 0.1.x API. Run `pnpm install`.",
    );
  }
  return join(pnpmDir, match, "node_modules", "path-to-regexp");
}

// OMNECOR_BUNDLE_DEV=1 produces a local-only bundle that does NOT hard-code
// NODE_ENV, so the runtime env controls dev/prod behavior (e.g. running with
// ZERO_LOGIN_MODE=true under a non-production NODE_ENV for headless UI smoke
// tests). The shipped bundle always bakes NODE_ENV=production.
const devBundle = process.env.OMNECOR_BUNDLE_DEV === "1";

await build({
  entryPoints: ["server/_core/index.ts"],
  platform: "node",
  bundle: true,
  format: "esm",
  outfile: devBundle ? "dist/index.dev.js" : "dist/index.js",
  banner: {
    js: "import { createRequire as __createRequire } from 'module'; const require = __createRequire(import.meta.url);",
  },
  ...(devBundle ? {} : { define: { "process.env.NODE_ENV": '"production"' } }),
  external: [
    "better-sqlite3",
    "onnxruntime-node",
    "fsevents",
    "vite",
    "cohere-ai",
    "ollama",
    "lightningcss",
    "@babel/core",
    "@tailwindcss/oxide",
  ],
  alias: { "path-to-regexp": resolveClassicPathToRegexp() },
});

writeFileSync("dist/package.json", JSON.stringify({ type: "module" }));
console.log("server bundle written → dist/index.js");
