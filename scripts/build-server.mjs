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
import { readdirSync, writeFileSync, existsSync, readFileSync, cpSync, mkdirSync } from "fs";
import { join } from "path";

// Locate the 0.1.x path-to-regexp that Express 4 needs (callable default export).
// Works under both pnpm linker modes:
//   - node-linker=hoisted (.npmrc): the top-level path-to-regexp is the v8 copy
//     (Express 5 / RN) which is NOT callable; Express 4 keeps its own 0.1.x nested
//     at node_modules/express/node_modules/path-to-regexp.
//   - isolated/.pnpm: the 0.1.x copy lives in its own virtual-store dir.
function resolveClassicPathToRegexp() {
  // 1. Hoisted mode: Express 4's incompatible 0.1.x is nested under express itself.
  const nested = join(process.cwd(), "node_modules", "express", "node_modules", "path-to-regexp");
  if (existsSync(join(nested, "package.json"))) {
    try {
      const v = JSON.parse(readFileSync(join(nested, "package.json"), "utf8")).version ?? "";
      if (/^0\.1\./.test(v)) return nested;
    } catch { /* fall through to .pnpm scan */ }
  }
  // 2. Isolated/.pnpm mode: scan the virtual store for the 0.1.x dir.
  const pnpmDir = join(process.cwd(), "node_modules", ".pnpm");
  if (existsSync(pnpmDir)) {
    const match = readdirSync(pnpmDir).find((d) => /^path-to-regexp@0\.1\./.test(d));
    if (match) return join(pnpmDir, match, "node_modules", "path-to-regexp");
  }
  throw new Error(
    "Could not find path-to-regexp@0.1.x (Express 4 needs the callable 0.1.x API). " +
      "Checked node_modules/express/node_modules and node_modules/.pnpm. Run `pnpm install`.",
  );
}

// The libSQL driver loads its prebuilt native addon through a DYNAMIC
// `require(`@libsql/${target}`)` (libsql/index.js → requireNative()). esbuild
// bundles all the surrounding JS but cannot bundle a `.node` addon, so it leaves
// that require to run at runtime — resolved relative to `dist/index.js`. A
// standalone bundle (installer payload / Electron / any `dist/` without the repo's
// hoisted node_modules as a parent) therefore dies on first DB connect with
// `Cannot find module '@libsql/linux-x64-gnu'`. Copy every installed native
// binding package next to the bundle so `dist/` is self-sufficient.
function copyNativeLibsqlBindings(outDir) {
  const srcRoot = join(process.cwd(), "node_modules", "@libsql");
  if (!existsSync(srcRoot)) {
    throw new Error("node_modules/@libsql is missing — run `pnpm install`.");
  }
  // A native binding package is any @libsql/<platform> dir shipping an index.node.
  const nativeDirs = readdirSync(srcRoot).filter((name) =>
    existsSync(join(srcRoot, name, "index.node")),
  );
  if (nativeDirs.length === 0) {
    throw new Error(
      "No @libsql/<platform> prebuilt binding (index.node) found under " +
        "node_modules/@libsql — the libSQL database driver cannot load at runtime. " +
        "Run `pnpm install` on the target platform.",
    );
  }
  const destRoot = join(outDir, "node_modules", "@libsql");
  mkdirSync(destRoot, { recursive: true });
  for (const name of nativeDirs) {
    // dereference: true — pnpm/hoisted layouts may hardlink/symlink into the store;
    // copy the real files so the bundle carries the addon, not a dangling link.
    cpSync(join(srcRoot, name), join(destRoot, name), { recursive: true, dereference: true });
  }
  return nativeDirs;
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
    // pdfkit/fontkit load their font-metric data files via `__dirname`
    // relative paths at runtime — inlining them into the ESM bundle breaks
    // that ("__dirname is not defined"). Loaded from node_modules instead.
    "pdfkit",
    "svg-to-pdfkit",
  ],
  alias: { "path-to-regexp": resolveClassicPathToRegexp() },
});

writeFileSync("dist/package.json", JSON.stringify({ type: "module" }));

// Make dist/ self-sufficient for the libSQL native addon (see comment above).
const copiedBindings = copyNativeLibsqlBindings("dist");
console.log(`copied libSQL native binding(s) → dist/node_modules/@libsql/: ${copiedBindings.join(", ")}`);

console.log(`server bundle written → ${devBundle ? "dist/index.dev.js" : "dist/index.js"}`);
