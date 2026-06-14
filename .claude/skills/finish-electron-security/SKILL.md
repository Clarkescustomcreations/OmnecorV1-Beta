---
name: finish-electron-security
description: Finish the Omnecor security hardening that requires a real build machine — upgrade the packaging/electron-app Electron toolchain (Electron 28→39+, electron-builder, electron-vite), rebuild native modules, build + smoke-test the desktop app, and drive `pnpm audit` to 0. Run this on a Windows (or any compiler-equipped) build PC. Triggered by /finish-electron-security.
---

# Finish Electron Security Upgrade (Tranche 2)

This is the **build-machine half** of the Omnecor security sweep. Tranche 1 (dependency
overrides + Electron source hardening + main-app MEDIUM fixes) was already applied and
type-verified on a Linux dev box that has **no C/C++ toolchain**, so the Electron
*version* upgrade and native rebuild were deferred to here.

**Goal:** `pnpm audit --prod` and `pnpm audit` (full) both report **0**, AND the desktop
app actually builds and launches. The remaining advisories are all `electron@28.3.3`
(17 in prod) plus one `esbuild` pulled by the old `electron-vite` — both clear when the
Electron toolchain is upgraded.

All paths are relative to the repo root. The Electron app lives in `packaging/electron-app/`.

## Why this needs a build machine
- `better-sqlite3`, `onnxruntime-node`, and `mysql2` must be **recompiled against
  Electron 39's ABI** (Electron 39 ships Node 22.x; NODE_MODULE_VERSION ≈ 140, vs 119 for
  Electron 28). `electron-builder install-app-deps` does this in `postinstall` and needs a
  compiler + Python.
- On the Linux dev box the prebuild 404s and there is no compiler, so the build cannot be
  validated there. Don't try to "fix" the audit number without a successful build — that
  number is only honest if the app builds and runs.

## Preconditions (verify first)
1. **Toolchain present.** On Windows: Visual Studio Build Tools (Desktop C++ workload) +
   Python 3.x on PATH. Check: `node -v` (expect Node 20+), `python --version`, and that
   `npm config get msvs_version` or VS Build Tools are installed. On macOS: Xcode CLT.
2. **pnpm ≥ 10.34.1.** Check `pnpm -v`. The repo's `packageManager` field pins `pnpm@10.34.1`;
   if a global pnpm shadows it, that's fine — just don't downgrade. Overrides live in
   `pnpm-workspace.yaml` under `overrides:` (NOT package.json — this is a workspace).
3. **Clean git state** on a feature branch (don't work on `main`). Confirm Tranche 1 is
   present: `pnpm-workspace.yaml` should already contain `picomatch`/`postcss`/`pnpm`
   overrides and `packaging/electron-app/src/main/index.ts` should already have
   `isSafeExternalUrl`, `sandbox: true`, and a `will-navigate` handler. If those are
   missing, STOP — Tranche 1 wasn't merged.

## Step 1 — Apply the Electron toolchain version matrix
Edit `packaging/electron-app/package.json`:

| Package | From | To | Notes |
|---|---|---|---|
| `electron` (devDeps) | `^28.2.0` | `^39.8.5` (or latest 39.x ≥ 39.8.5) | Run `npm view electron@39 version` for the exact latest patch. Clears all 17 prod advisories. |
| `electron-builder` (devDeps) | `^24.9.1` | latest 26.x | `npm view electron-builder version`. v24 is EOL and won't rebuild for Electron 39 cleanly. |
| `electron-vite` (devDeps) | `^2.0.0` | latest 5.x | `npm view electron-vite version`. v5 supports Vite 7 (the repo's root Vite). This also drops the vulnerable bundled `esbuild` — fixing the last non-electron advisory. |
| `onnxruntime-node` (deps) | `^1.20.0` | match repo root (`^1.26.x`) | Newer ABI prebuilds; verify `npm view onnxruntime-node version`. |

> Do **not** blindly bump versions in the table without checking the registry first — pin to
> the actual latest published patch.

## Step 2 — Resolve the better-sqlite3 ABI question (decision, not a guess)
`better-sqlite3@12.10.0` is the known risk for Electron 39 (V8 `Context::GetIsolate()`
removal — WiseLibs/better-sqlite3#1416). Decide explicitly:
1. Run `npm view better-sqlite3 versions --json` and find the newest version whose release
   notes / issues confirm **Electron 39 / Node 22 support** (likely ≥ 12.4.x or 13.x — verify).
2. If a supported version exists, bump it in **both** `packaging/electron-app/package.json`
   and the repo root `package.json` (keep them in lockstep — the backend that the Electron app
   spawns uses the same module under Electron's `ELECTRON_RUN_AS_NODE`).
3. If none cleanly supports Electron 39 yet, keep the current version and let
   `electron-builder install-app-deps` **compile it from source** (this is why the toolchain
   is required). Confirm the compile succeeds in Step 4.

Report which path you took and why.

## Step 3 — Install
```
pnpm install
```
This runs the `packaging/electron-app` `postinstall` (`electron-builder install-app-deps`),
which rebuilds the native modules for Electron 39's ABI. It MUST exit 0. If it fails:
- Read the actual compiler error (don't mask it with `|| true`).
- Missing toolchain → install VS Build Tools / Python and retry.
- `better-sqlite3` source-compile failure → revisit Step 2 (pick a version with prebuilts).

## Step 4 — Type-check, build, smoke-test
```
# main app (web/server)
pnpm exec tsc --noEmit                      # expect 0 errors

# electron app
cd packaging/electron-app
pnpm run typecheck                          # both typecheck:node + typecheck:web → 0
pnpm run build                              # electron-vite build → out/ produced
```
Then **launch and watch it actually run** (this is the gate Tranche 1 could not close):
- `pnpm run dev` (or build a local installer: `pnpm run build:win` / `build:linux` / `build:mac`).
- Confirm the Setup Wizard window opens, `get-system-info` populates CPU/RAM/GPU, and after
  "setup complete" the window loads `http://localhost:3000` (the backend boots via the spawned
  Node process) and the main Omnecor UI renders.
- **Specifically re-test the Tranche 1 hardening at runtime** (these were applied but never
  runtime-verified): with `sandbox: true` + `contextIsolation: true`, confirm the preload
  bridge (`window.api.getSystemInfo`, `setupComplete`, `openExternal`) still works, external
  links open in the OS browser, and the backend web app (websockets, styling) renders normally
  under the hardened `webSecurity: true`. If `sandbox: true` breaks the preload, investigate
  (the preload only uses `contextBridge`/`ipcRenderer`/`@electron-toolkit/preload`, all
  sandbox-safe — a break usually means a stray Node API leaked into the renderer).

## Step 5 — Final security gate
```
pnpm audit --prod        # expect: 0 vulnerabilities
pnpm audit               # full tree — expect 0, or document any residual dev-only item
```
- If a stray `electron` advisory remains, you didn't land ≥ the required patch (some advisories
  need `>=39.8.5`). Re-check `npm view electron@39 version` and bump.
- If `esbuild` still shows, `electron-vite` didn't actually upgrade (check the lockfile path
  `packaging/electron-app > electron-vite > esbuild`).

## Step 6 — Optional extra hardening (test carefully — can break the web app)
A renderer **CSP via `session.defaultSession.webRequest.onHeadersReceived`** was intentionally
**NOT** applied in Tranche 1, because the window later loads the full Omnecor web app from
`http://localhost:3000`, which already sends its own Helmet CSP (allowing `ws:`, `data:`,
`'unsafe-inline'` for shadcn/Recharts). A second strict Electron-session CSP would intersect
with Helmet's and can break websockets/styles. If you add one, it must mirror the server's
Helmet policy in `server/_core/index.ts` — and you must smoke-test the live app after.

## Step 7 — Record results
Append a "TRANCHE 2 (build machine)" section to `Beta-Code-Sweep.md` with: the final version
matrix actually installed, the better-sqlite3 decision, `pnpm audit` output (target: 0), and
the smoke-test result. Update the `_Last updated_` line. Commit on a feature branch; do not
push or merge unless asked.

## Done means
- [ ] `pnpm audit --prod` = 0 AND `pnpm audit` (full) = 0
- [ ] `pnpm exec tsc --noEmit` = 0 (main app)
- [ ] `packaging/electron-app` typecheck = 0 and `build` succeeds
- [ ] Desktop app launches; Setup Wizard → backend handoff works; preload bridge works under
      `sandbox: true`; external links open safely
- [ ] `Beta-Code-Sweep.md` updated with the real, build-verified numbers
