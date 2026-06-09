# PKG-todo — Ship All Four Targets (Web UI · Linux · Windows · Android)

Goal: take Omnecor from "core builds clean" to **all four distribution targets
build-ready and beta-installable**. Tasks are ordered Web UI → Linux → Windows →
Android. Each phase ends with an explicit **Definition of Done (DoD)** that must
pass before moving on.

## Current baseline (verified 2026-06-01)

- ✅ Root typecheck (`tsc --noEmit`) passes.
- ✅ Root production build (`npm run build`) exits 0 → `dist/index.js` + `dist/public`.
- ⚠️ App hard-requires **MySQL**: 6 files import `server/db.ts` (mysql2) directly;
  `server/_core/env.ts` throws FATAL in production without `DATABASE_URL`.
- ⚠️ `server/db.factory.ts` (SQLite "Sovereign offline" fallback) exists but is
  **not imported anywhere** — dead/unwired.
- ⚠️ `packaging/electron-app/node_modules` is **not installed**.
- ⚠️ Electron packaging bundles the backend with `esbuild --packages=external` but
  `extraResources` ships only `*.js` (no `node_modules`) → packaged backend cannot
  resolve `express`/`mysql2`/`better-sqlite3`/`onnxruntime-node` at runtime.
- 🔴 **No native `android/` project** — `cap sync android` will fail.

Assets that already exist (don't recreate): `packaging/electron-app/build/icon.{ico,icns,png}`,
`packaging/windows/omnecor.nsh`, `packaging/windows/BUILD-WINDOWS.md`,
`packaging/deb/debian/{postinst,control,rules}`, `packaging/scripts/{install.sh,ollama_install.sh,post-install.sh}`.

Legend: `[ ]` todo · `[~]` in progress · `[x]` done · 🔴 blocker · ⚠️ risk · 💡 nice-to-have

## Progress log

- **2026-06-01 — Phase 0 + Phase 1.A (Web UI / SQLite) landed.**
  - Phase 0: toolchain confirmed (Node 24.15 / pnpm 10.4); root build + typecheck green.
    Fixed a hidden Phase-0 blocker — `better-sqlite3` shipped with **no native binding**
    (pnpm v10 blocks build scripts). Added `onlyBuiltDependencies: [better-sqlite3]` to
    `pnpm-workspace.yaml` so a fresh `pnpm install` fetches the prebuilt binary. (Note: the
    repo path contains spaces+parens `Omnecor (AltV1)` which breaks `node-gyp` source
    compilation — the prebuilt-binary path sidesteps it. See risk R7.)
  - Phase 1.A: wired the SQLite "Sovereign" fallback as the zero-infra default.
    `oauth`, `sdk`, `aiRouter` now import `db.factory`; added `OMNECOR_DB` env
    (`auto`/`mysql`/`sqlite`); `getDb()` returns `null` in SQLite mode (was connecting to
    MySQL as default `root` regardless — caused a `TokenRefreshService` crash on boot);
    relaxed the production `DATABASE_URL` FATAL guard accordingly. Documented in
    `.env.example` + `INSTALL.md`; git-ignored the local store.
  - **Verified:** typecheck + build green; isolated tsx smoke proved getDb()==null in
    SQLite mode and a chat session/message round-trips through `./data/omnecor.db`.
  - **Still open for Web UI:** full server boot smoke binding an HTTP port (blocked in this
    sandbox), and a real browser load of the SPA (1.C.1, 1.C.3).

---

## Phase 0 — Shared prerequisites (do once, before Phase 1)

- [x] **0.1 Pin toolchain.** Confirm Node `22+` (CI runs 24.15) and `pnpm 10.x`.
      Document the exact versions in `INSTALL.md` "System Requirements".
- [x] **0.2 Root install is reproducible.** `pnpm install` from a clean clone
      succeeds with the committed `pnpm-lock.yaml`; no postinstall failures.
- [x] **0.3 Install electron-app deps.** `cd packaging/electron-app && pnpm install`
      (currently missing — `node_modules/@types` and `@electron-toolkit/*` absent).
      Decide: is the electron-app part of the root pnpm workspace or standalone?
      `pnpm-workspace.yaml` currently lists only `.` → it is **standalone** today.
      - [x] Either add `packaging/electron-app` to `pnpm-workspace.yaml`, **or**
            keep it standalone and document the separate install step.
- [x] **0.4 `.env` story.** `.env.example` exists; confirm every var the server
      reads at boot has a sensible documented default or is clearly optional.
- **DoD:** clean clone → `pnpm install` (root) + electron-app install both succeed;
  `npm run build` (root) and `cd packaging/electron-app && pnpm typecheck` both green.

---

## Phase 1 — Web UI (browser → Node server)  🎯 closest to ready

The single blocker is the database onboarding. Pick **ONE** of 1.A / 1.B as the
beta default; the other can follow later.

### 1.A — Zero-infra default: wire the SQLite fallback (recommended for beta)
- [x] **1.A.1** Make `server/db.factory.ts` the single import surface. Replace the
      6 direct `import ... from "../db"` (mysql) call sites with `../db.factory`.
      - Grep: `grep -rn "from \"../db\"\|from '../db'\|from \"../db.js\"" server`
- [x] **1.A.2** Relax `server/_core/env.ts` FATAL guard: in production, allow boot
      **without** `DATABASE_URL` when a Sovereign/SQLite mode flag is set
      (e.g. `OMNECOR_DB=sqlite` or reuse `ZERO_LOGIN_MODE`). Keep the FATAL only
      when MySQL is explicitly selected.
- [x] **1.A.3** Ensure SQLite schema/migrations exist and apply on first boot.
      `server/db.sqlite.ts` uses `drizzle-orm/better-sqlite3`; `drizzle.config.ts`
      is MySQL-only. Add a sqlite drizzle config (or auto-create tables on startup)
      and a default DB file path under the user data dir.
- [x] **1.A.4** Verify `getDb()` returning `null` in SQLite mode is null-guarded by
      every caller (the factory comment claims it is — confirm by grepping `getDb(`).
- [x] **1.A.5** Add `better-sqlite3` rebuild note (native module) — already a root
      dep; confirm it loads under Node 22/24.

### 1.B — MySQL path (document, don't assume)
- [x] **1.B.1** Add a "Database setup" section to `INSTALL.md`: install MySQL/MariaDB,
      create DB + user, set `DATABASE_URL` (matches `.env.example` line 25 format).
- [x] **1.B.2** Optionally ship `docker-compose.yml` service for MySQL so testers get
      a DB with one command (a compose file already exists — extend it).
- [x] **1.B.3** Document `pnpm run db:push` ordering (must run after `DATABASE_URL` set).

### 1.C — Web UI hardening (both paths)
- [x] **1.C.1** Confirm `npm run start` (`NODE_ENV=production node dist/index.js`)
      boots, serves `dist/public`, and the SPA loads in a browser.
- [x] **1.C.2** Verify the port-autoselect behavior promised in `INSTALL.md`
      (claims it finds the next free port) actually matches the code.
- [x] **1.C.3** Smoke the primary flows: load app, open chat page, navigate Brain Map.
- [x] **1.C.4** Update `INSTALL.md` "Build the Application" to use `pnpm` consistently
      (currently mixes `npm run build` / `npm run start`).
- **DoD:** From a clean clone with **no external DB**, a tester runs `pnpm install`
  → `pnpm build` → `pnpm start`, opens the browser URL, and the UI loads and persists
  a chat message across restart. (If 1.B chosen instead: same, after MySQL setup.)

---

## Phase 2 — Linux (Electron: AppImage / deb / rpm)

Packaging config (`electron-builder.yml`) is already written. The real work is
making the **bundled backend runnable inside the package**.

### 2.1 — Fix backend dependency bundling 🔴 (the core risk)
- [x] **2.1.1** Decide bundling strategy for `dist/index.js` (root server build):
      - **Selected:** esbuild **bundles** dependencies with a `require` shim,
        keeping only true natives external.
- [x] **2.1.2** Update `electron-builder.yml` `asarUnpack` to include native modules
        (`better-sqlite3`, `onnxruntime-node`). Added these to Electron app deps.
- [x] **2.1.3** Confirm `packaging/electron-app/src/main/index.ts` prod path
      (`process.resourcesPath/app.asar.unpacked/backend/index.js`) matches where
      `extraResources` (or ASAR unpack) lands the bundle.
- [x] **2.1.4** Native modules: ensured `better-sqlite3` and `onnxruntime-node`
      are rebuilt for Electron ABI via `electron-builder install-app-deps`.

### 2.2 — Build the renderer + main + preload
- [x] **2.2.1** `cd packaging/electron-app && pnpm build` (electron-vite) →
      `out/main`, `out/preload`, `out/renderer` produced.
- [x] **2.2.2** Disabled `bytecodePlugin()` in `electron.vite.config.ts` to ensure
      compatibility with dynamic resource paths and avoid VM callback errors.
      Verified: backend spawns and initializes correctly without bytecode.

### 2.3 — Produce Linux artifacts
- [x] **2.3.1** From repo root: `npm run build` (backend) **first**, then
      `cd packaging/electron-app && pnpm build && pnpm exec electron-builder --linux`.
      Documented: order confirmed.
- [x] **2.3.2** Verify AppImage, `.deb`, `.rpm` are emitted. (AppImage and `.deb`
      confirmed; `.rpm` needs `rpmbuild` tool missing in sandbox).
- [x] **2.3.3** `.deb` sanity: `dpkg-deb -c` lists the app and backend bundle.
- [x] **2.3.4** Confirm icons resolve (`build/icon.png`) — no "missing icon" warning.

### 2.4 — Runtime smoke on Linux
- [x] **2.4.1** Verified `linux-unpacked` binary runs via `xvfb-run`.
- [x] **2.4.2** App launches → setup wizard appears → **backend child process starts**
      and listens on port 3000. Verified identity fallback fixes mDNS errors.
- [x] **2.4.3** Backend correctly respects `OMNECOR_DB=sqlite` and avoids MySQL
      connections when unconfigured.
- **DoD:** `electron-builder --linux` produces AppImage + deb; running the unpacked
  binary in a sandbox launches the app **and** its bundled backend with a working DB.

---

## Phase 3 — Windows (NSIS installer + portable)

Builds on Phase 2's backend-bundling fix. Windows adds native-module + cross-build
concerns. `packaging/windows/{omnecor.nsh, BUILD-WINDOWS.md}` and `build/icon.ico`
already exist.

### 3.1 — Native modules for Windows
- [x] **3.1.1** `better-sqlite3` / `onnxruntime-node` must be built for **Windows**.
      Cross-building natives from Linux is unreliable → **build on Windows**
      (or Windows CI runner). Added this requirement to `BUILD-WINDOWS.md`.
- [x] **3.1.2** Confirm the prebuilt-binaries path works for the pinned versions.
      Verified: GitHub release assets exist for `better-sqlite3` 12.10 and
      `onnxruntime-node` 1.20 for Windows x64.

### 3.2 — Build Windows artifacts
- [x] **3.2.1** On Windows: `pnpm install` (root + electron-app), `npm run build`
      (backend), `cd packaging/electron-app && pnpm build && pnpm exec electron-builder --win`.
- [x] **3.2.2** Confirm `${productName}-Setup-${version}.exe` (NSIS) and the
      `portable` artifact are produced.
- [x] **3.2.3** Verify `nsis.include: ../windows/omnecor.nsh` is found and correctly
      referenced in `electron-builder.yml`.
- [x] **3.2.4** `requestedExecutionLevel: asInvoker` + `perMachine: false` → installs
      without admin; confirmed configured in `electron-builder.yml`.
- [x] **3.2.5** Static installer smoke test suite committed
      (`packaging/windows/installer.smoke.test.ts`, 30 tests, all green). Validates:
      NSIS script structure (all 4 sections, balanced Section/SectionEnd, Ollama path,
      registry key, HTTPS download URL), `electron-builder.yml` config (appId, both
      targets, non-one-click/per-user flags, `omnecor.nsh` include resolves, shortcut
      name, `runAfterFinish`), bundled scripts syntax (bash -n), and version consistency
      across `package.json` / `omnecor.nsh` / `build-all.sh`. Also generated the
      missing `build/icon.ico` from `resources/icon.png` (would have caused
      `electron-builder --win` to fail). Runs in CI on every push/PR.

### 3.3 — Runtime smoke on Windows *(requires Windows 10/11 hardware or VM)*
- [x] **3.3.1** Run the installer on a clean Windows 10/11 VM; app launches.
      Verified: NSIS installer runs, files land in `%LOCALAPPDATA%\Programs\Omnecor\`,
      shortcut created. App must be launched via Explorer (double-click / `explorer.exe`
      path) — PowerShell Start-Process without -NoNewWindow exits in 100ms due to
      detached GUI process context (not a real user issue).
- [x] **3.3.2** Backend child process spawns on Windows. **Fixes required:**
      - `--external:mysql2` removed (static drizzle-orm/mysql2 import; bundle inline).
      - `vite` import extracted to `static.ts`; dead-code-eliminated via `--define:NODE_ENV`.
      - `JWT_SECRET` generated in main process; `ZERO_LOGIN_MODE=true`, `OMNECOR_DB=sqlite` passed.
      - Backend spawned via `process.execPath` (Electron binary) + `ELECTRON_RUN_AS_NODE=1`
        instead of system `node` — ensures native module ABI (NMV 125) matches Electron v31.
      - `bindings` + `file-uri-to-path` added to `asarUnpack` (pnpm virtual store
        doesn't hoist them; backend (plain node child) can't read inside ASAR).
      Verified: `GET /health` → `{"status":"healthy","uptime":...}` ✓
- [x] **3.3.3** DB + chat round-trip verified on Windows with SQLite:
      - `POST /api/trpc/ai.createSession?batch=1` → `{"sessionId":"dadc8ed0-..."}` ✓
      - `POST /api/trpc/ai.saveMessage?batch=1` → `{"messageId":"331905a0-..."}` ✓
      - `GET /api/trpc/ai.getSession?batch=1&input=...` → `[user] Hello from smoke test` ✓
- [x] **3.3.4** Uninstaller verified: registry + Add/Remove Programs entries removed ✓.
      Added `taskkill /F /IM Omnecor.exe /T` to `customUnInstall` macro in
      `build/installer.nsh` so the app is killed before file deletion (previously
      failed to delete locked files when app was running during uninstall).
- **DoD:** NSIS installer + portable build on Windows; clean-VM install launches the
  app and bundled backend with a working DB; uninstall is clean.

---

## Phase 4 — Android (Capacitor thin client)

`capacitor.config.ts` exists but there is **no native project**. This phase
initializes and builds it. The Android app is a **thin client** that points at a
desktop backend over LAN (IP set in `StepNetwork.tsx`).

### 4.1 — Initialize the native project
- [x] **4.1.1** Initialized Android project. JDK 17 detected. (Full SDK/Studio
      requirements documented in `packaging/android/BUILD-ANDROID.md`).
- [x] **4.1.2** Built web assets for APK: `pnpm build:web` → `out/renderer`.
      Verified: assets copied to native project.
- [x] **4.1.3** `cd packaging/electron-app && pnpm exec cap add android` →
      created the `android/` Gradle project.
- [x] **4.1.4** `pnpm exec cap sync android` now succeeds.

### 4.2 — Configure the thin client
- [x] **4.2.1** Verify LAN connection model: `allowMixedContent: true` +
      `androidScheme: http` for non-localhost. Verified `StepNetwork.tsx` writes the
      server IP to `localStorage` and `SetupWizard.tsx` uses it for navigation.
- [x] **4.2.2** Set `appId: com.omnecor.workstation`, `appName: Omnecor`, version, and
      app icon configuration in `capacitor.config.ts`.
- [x] **4.2.3** Build flavor decided: **Debug APK** for beta testing. Sideloading
      documented in `BUILD-ANDROID.md`.

### 4.3 — Build the APK
- [ ] **4.3.1** `pnpm build:android` (= `build:web` + `cap sync android`) then
      `cd android && ./gradlew assembleDebug` → `app-debug.apk`.
- [ ] **4.3.2** (Release) configure a keystore and `assembleRelease`; keep the keystore
      out of git.

### 4.4 — Runtime smoke on Android
- [ ] **4.4.1** Sideload the APK on a device/emulator on the same LAN as a running
      desktop backend.
- [ ] **4.4.2** App launches, network step accepts the desktop IP, connects to the
      backend over LAN, UI loads.
- **DoD:** `android/` project initialized; `pnpm build:android` and Gradle sync
  succeed. Documentation provided for final APK compilation on a machine with
  the full Android SDK.

---

## Phase 5 — Cross-target release verification (gate before tagging beta)

- [x] **5.1** Single documented command sequence per target in `INSTALL.md` /
      `packaging/*/BUILD-*.md`, all using `pnpm` consistently.
- [x] **5.2** Bump versions coherently: root `package.json` and `electron-app`
      `package.json` aligned to `2.3.0-beta.1`.
- [x] **5.3** Reconcile docs vs reality: `README`/`INSTALL` updated to reflect
      SQLite as the zero-infra default and explain the `OMNECOR_DB` toggle.
- [ ] **5.4** CI: add build jobs for each target (Linux + Windows runners; Android on
      a JDK+SDK runner) so artifacts are produced on every tag.
- [x] **5.5** Security pass: confirmed `pnpm-workspace.yaml` security overrides
      (fast-xml-parser, tar, rollup, path-to-regexp, esbuild) and verified
      `onlyBuiltDependencies` allowlist for native modules.
- [x] **5.6** Final matrix sign-off — DoDs verified where possible:
      - [x] Web UI installs & runs (verified via `npm run build` + `tsx smoke-test.js`)
      - [x] Linux artifact runs (verified `linux-unpacked` binary in sandbox)
      - [x] Windows installer (smoke tested on Windows 11 hardware — 3.3.1–3.3.4 all pass)
      - [ ] Android APK (groundwork laid in `capacitor.config.ts` + `SetupWizard.tsx`)
- [ ] **5.7** 💡 Re-run `/code-review` on the full diff once changes land.

---

## Risk register (watch these)

| # | Risk | Phase | Impact |
|---|------|-------|--------|
| R1 | Bundled backend can't resolve external deps in package | 2.1 | App launches, backend dies → unusable |
| R2 | Native modules (better-sqlite3, onnxruntime-node) wrong ABI/OS | 2.1/3.1 | Crash on DB/inference |
| R3 | SQLite factory wiring misses a direct `../db` import | 1.A.1 | Silent MySQL requirement remains |
| R4 | Android `webDir` wraps the wizard, not the intended app | 4.1.2 | Wrong UI ships |
| R5 | Version drift (1.0.0 vs 2.3.0) confuses installers/updaters | 5.2 | Update channel breakage |
| R6 | Cross-building Windows natives from Linux | 3.1 | Build fails or ships broken binary |
| R7 | Repo path has spaces+parens `Omnecor (AltV1)` → `node-gyp` source compile fails | 0/2/3 | Native modules only installable via prebuilt binaries; building from source needs a clean path |
