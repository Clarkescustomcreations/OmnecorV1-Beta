# Memory — Valet Router GGUF Integration + Prior Session Work

Last updated: 2026-06-18

---

## DO NOT REMOVE THIS NOTE **Important: Read AGENTS.md Before Beginning The Next Session**

---

## Session — Setup Wizard Logo & Windows Installer Wordmark (2026-06-18, Linux)

### What was built
- Imported `logo_mark_256.png` directly via Vite ESM from the root `assets/` directory in `client/src/pages/SetupWizard.tsx`.
- Replaced unbundled string-interpolated base path `src={`${import.meta.env.BASE_URL}assets/logo_mark_256.png`}` with the imported `logoMark` variable in both the welcome step and the sidebar branding logo images in `SetupWizard.tsx`.
- Generated a clean, white-background, 150x57 BMP header image from `assets/wordmark.png` and placed it at `packaging/electron-app/build/installer_header.bmp` to replace the old dark and misaligned installer header.

### Decisions made
- Used Vite ESM import rather than relying on manual file copies or hardcoded/unbundled URL paths. This guarantees Vite tracks the logo as a compilation dependency, compiles/hashes it automatically, and places it into the output folder on every build.
- Placed the resized "OMNECOR" text logo from `assets/wordmark.png` onto the right side of a solid white `150x57` pixel canvas. This aligns with NSIS Modern UI's header layout rules where native page text is printed on the left, preventing collisions/overlaps and ensuring the logo is correctly right-aligned.

### Problems solved
- Solved a `404 Not Found` (broken image) error in the onboarding setup wizard that occurred when the demo or production directories were wiped by the `emptyOutDir: true` setting in Vite build configurations.
- Solved a rendering collision/unreadability issue in the Windows custom NSIS installer window where the header logo was dark, positioned on the left, and overlapped with the installer's native title text.

### Current state
- Validation Gates: `pnpm check` passes with **0 TypeScript errors** and all **350/350 vitest tests passed** (including all 39 `packaging/windows/installer.smoke.test.ts` tests).
- Changes are verified and ready on disk.

### Next session starts with
- Verify logo rendering inside the setup wizard page across the desktop, mobile, and web versions.
- Test the generated installer executable on a Windows test box to ensure the header logo displays correctly in the top-right of the installer window.

---

## Session — Chat Action Buttons Responsive Stacking (2026-06-17, Linux)

### What was built
Configured a responsive layout for the ChatInput component to stack action toolbar buttons and hide helper texts on smaller screens/mobile viewports to prevent collisions:
- Modified the parent flex container of the buttons to support vertical stacking on smaller viewports (`flex-col sm:flex-row gap-2.5 sm:gap-0`).
- Rearranged vertical order using flexbox `order-2 sm:order-1` for Terminal/CLI + Sandboxed group and `order-1 sm:order-2` for Attachments + Voice + Send group.
- Adjusted widths (`w-full sm:w-auto`) and side alignment (`justify-start` and `justify-end`) so stacked toolbar elements fill the mobile card cleanly.
- Added `hidden sm:block` to the composition hint text (`<p>`) underneath to hide the long instruction lines on smaller screens.
- Aligned token count `span` to float to the right using `sm:ml-2 ml-auto` when the instruction paragraph is hidden.

### Decisions made
- Handled mobile stacking order via standard Tailwind layout utilities (`order-[n]`) to keep JS layout engines clean.
- Gated the long instruction lines on small screen viewports to prioritize screen estate and clarity on mobile.

### Problems solved
- Solved text wrapping, collisions, and overflow issues in the main Chat window action toolbar.

### Current state
- Gates: `pnpm check` **0 errors**; `pnpm test` **350/350 passed**.
- Staged layout adjustments are ready on disk.

### Next session starts with
- Verify the stacked responsive layout on physical mobile viewports.

---

## Session — System B OAuth (service connections) made real (2026-06-17, Linux)

> Prior sessions' pending handoffs (Valet GGUF commit on Windows, OMMESH 3-way live test) are **still open** — see sections below; this session is independent.

### What was built
Fixed the "service connections / integrations" OAuth (System B — Drive/OneDrive/Dropbox, YouTube, social publishing) so it can actually be configured and used, and added Gmail send. **Login OAuth (System A) was already separate and not touched.**

- **`server/oauth/oauthClients.ts`** — was the core bug: `OAUTH_CONFIGS` read `process.env.*` **once at module load**, so the in-app Settings wizard was ignored and only pre-boot env vars worked. Refactored to:
  - Split static endpoints (`OAUTH_ENDPOINTS`) from credentials. New `PROVIDER_CREDENTIALS` map (platform → settings-key + env-var) and `resolveCredentials()` resolve **per-call** via `SettingsService.getInstance().getSecret(key, process.env[env])` — same env→settings-file precedence `AiProviderService` uses for AI keys; mtime-cached so edits are live.
  - New exports: `isPlatformConfigured()`, `listOAuthPlatforms()`, and **`getRedirectUri(platform)`** — single source of truth: `PUBLIC_URL` when set, else `http://localhost:${OMNECOR_PORT||PORT||3000}`. This fixes the **desktop redirect bug** (was hardcoded `localhost:5173`; packaged backend listens on 37291, spawned with `PORT=37291`, so it now lines up with no Electron change).
  - Added `gmail` provider (Google endpoints, `gmail.send`+userinfo scopes, offline/consent extra params, userinfo profile endpoint).
- **`server/routers/gmailRouter.ts`** (NEW, registered as `gmail`) — `status` (protected) + `sendEmail` (**cloudProcedure** → Sovereign-blocked). Looks up the user's active `gmail` `platformAccounts` row, refresh-on-401-and-persist, real Gmail API call. `buildRawMessage()` (exported for tests) hardened: `encodeHeaderValue()` strips CR/LF (header-injection guard, like `auditRouter.ts:44`) and RFC-2047-encodes non-ASCII subjects.
- **`server/_core/systemRouter.ts`** — new `integrationsStatus` (**protectedProcedure**) returns per-platform configured booleans + server-computed `callbackBase` (because in desktop `window.location.origin` is `app://omnecor`, unusable as a redirect base).
- **`server/phase2/services/SettingsService.ts`** — `OmnecorSettings` typed with the 10 integration client-id/secret keys.
- **`server/routers/oauthRouter.ts`** — `gmail` added to `SUPPORTED_OAUTH_PROVIDERS` enum.
- **`client/src/pages/Settings.tsx`** — new `ServiceConnectionsCard` in Settings → Accounts tab (after `SocialLoginCard`): 10 providers × (client id + secret), copyable redirect URI, configured badges, `isAdmin`-gated (non-admins see read-only note), saves via admin `system.saveKeys`.
- **`.env.example`** — Gmail vars + corrected redirect-URI guidance (one `/api/oauth/callback/<provider>` path, base = PUBLIC_URL or localhost:PORT).
- **Tests:** `server/__tests__/oauthClients.test.ts` (8) + `server/__tests__/gmailMessage.test.ts` (4).

### Decisions made
- Credential precedence is **env var first, then Settings file** via `getSecret(settingsKey, envVar)` — matches AI-key handling; do not revert to module-load env capture.
- Settings keys are camelCase per provider: `twitterClientId`, `googleDriveClientId`, `oneDriveClientId`, `gmailClientId`, etc. **Client `INTEGRATION_PROVIDERS` (Settings.tsx) and server `PROVIDER_CREDENTIALS` are a source-of-truth pair — keep in sync** (a comment marks this).
- `saveKeys` is `adminProcedure` (credential write); it passes unknown keys straight through (`keyMap[k] || k`), so new keys need no keyMap entry.
- Gmail reuses Google OAuth endpoints — one Google Cloud OAuth client can serve Drive+YouTube+Gmail (just add `gmail.send` scope + the callback URI).
- `/review` was run and **all 4 findings fixed** (header injection = the important one; + non-ASCII subject, provider-list dup comment, admin gate + `integrationsStatus` made protected).

### Current state
- Gates: `pnpm check` **0 errors**; `pnpm test` **350/350** (24 files; +12 this session). `pnpm build` NOT run (WSL native-module fragility per notes below; tsc is the real correctness gate).
- All changes are on disk, **not committed**.
- Integrations remain dark until an operator registers an OAuth app per provider and enters client id/secret (Settings → Accounts → Service Connections, or env) **and** registers the exact callback URI shown there. Kaggle stays `kaggle.json`-based (separate, unchanged).

### Next session / follow-ups
- Optional: tighten desktop UX so the OAuth success page returns focus to the app window instead of landing in the system browser (token already persists to shared SQLite, so the connect works regardless).
- Live-test one provider end-to-end once real creds exist (YouTube via Google is lowest-friction).
- Commit when ready.

---

## Windows Installer Build — 2026-06-16

### Build artifacts (gitignored — not in repo)
Located in `packaging/electron-app/dist/`:
- `Omnecor-Setup-2.3.0-beta.1.exe` — 1.69 GB NSIS installer
- `Omnecor-2.3.0-beta.1-portable.exe` — 1.69 GB portable
- `Omnecor-Setup-2.3.0-beta.1.exe.blockmap` + `latest.yml`

All four generated 2026-06-16 ~06:48. Both exe files are excluded by `packaging/electron-app/.gitignore` (`dist` rule).

### Tests
`pnpm test` → **338/338 passing** (22 test files). The installer smoke suite is at `packaging/windows/installer.smoke.test.ts` — 39 tests covering NSIS script content, electron-builder.yml config, bash syntax of bundled scripts, and version consistency.

**IMPORTANT:** These are static analysis tests. They validate config files and script content. Nobody has actually run the installer on a Windows machine yet. That step is still pending.

### NSIS bugs fixed
1. **`${GetDriveSpace}` → `${DriveSpace}`** — electron-builder bundles NSIS 3.0.4.1 which does not include `GetDriveSpace`. The correct macro from `FileFunc.nsh` is: `${DriveSpace} "$INSTDIR" "/D=F /S=M" $R0`. Fixed in `packaging/windows/omnecor.nsh` (lines 5–10 header, line 66 call). Also added `!include FileFunc.nsh` and `!insertmacro DriveSpace`.
2. **CRLF line endings** — Windows-style CRLF in shell scripts caused `bash -n` syntax check failures. Stripped from: `packaging/scripts/install.sh`, `packaging/build-deb.sh`, `packaging/deb/debian/postinst`, `packaging/build-appimage.sh`. Use `tr -d '\r' < file > /tmp/f && cp /tmp/f file` on NTFS (sed -i doesn't work on NTFS mounts).

### Files modified (uncommitted as of 2026-06-16, need to commit before next Windows build)
- `.npmrc` — added `node-linker=hoisted`
- `package.json` — test script: `vitest run` → `node node_modules/vitest/vitest.mjs run`
- `packaging/windows/omnecor.nsh` — NSIS macro fix + FileFunc includes
- `packaging/scripts/install.sh`, `packaging/build-deb.sh`, `packaging/deb/debian/postinst`, `packaging/build-appimage.sh` — CRLF stripped

### WSL2 / NTFS workarounds (important for next build)
pnpm running on NTFS (`/mnt/c/`) does not create real `.bin` symlinks, so symlink-based binary resolution fails. Two permanent workarounds are in place:
- `node-linker=hoisted` in `.npmrc` — tells pnpm to create real directories instead of virtual store only (makes `node_modules` more like npm)
- Test invocation uses `node node_modules/vitest/vitest.mjs run` not `vitest run` — bypasses `.bin` symlink entirely

**Native module crash recovery pattern** — if a PC crash or WSL2 restart wipes the hoisted copies of Linux native modules, restore them from the pnpm store:
```bash
# Pattern: find in .pnpm store, copy to hoisted node_modules
find node_modules/.pnpm -path "*/@esbuild/linux-x64" -type d | head -1
# Then: cp -r <found-path> node_modules/@esbuild/linux-x64

# Modules that have been needed (copy this list for next crash):
# @esbuild/linux-x64       (esbuild native for WSL2)
# @rollup/rollup-linux-x64-gnu   (rollup native for WSL2)
# @libsql/linux-x64-gnu    (libsql/turso native for WSL2)
# axios                    (was not hoisted by pnpm on NTFS — copy from .pnpm store)
```

### How the build was done (steps for next Windows build)
The build used existing compiled artifacts rather than rebuilding from scratch (WSL2 cross-compile limitations):
1. `dist/` — web build from June 2 (backend esbuild output), already present — not rebuilt
2. `packaging/electron-app/out/` — electron-vite output from June 2, already present — not rebuilt
3. **New step:** `npm install --ignore-scripts --legacy-peer-deps` inside `packaging/electron-app/` from **Windows PowerShell** (not WSL2) — needed because electron-builder can't read electron version from symlinked node_modules
4. **New step (validation):** Tested NSIS macro with a minimal script via `makensis.exe /V4 test.nsi` before triggering the full build, to catch syntax errors early
5. electron-builder run from Windows PowerShell: `cd C:\OmnecorV1-Beta\packaging\electron-app && npx electron-builder --win`

### Beta readiness assessment (2026-06-16)
- ✅ Build artifacts exist and are correctly sized
- ✅ 338/338 static tests passing
- ✅ NSIS installer script is syntactically valid (makensis compiled it)
- ❌ Installer has NOT been run on a real Windows machine
- ❌ No `.gitattributes` CRLF guard — CRLF will return if files are edited on Windows
- ❌ Modified files (fixes above) are NOT yet committed — commit them before next build or release tag

---

## What was built

### This session — Valet Router GGUF Windows prep (NOT YET COMMITTED)

All code changes are complete and reviewed (5 review issues fixed). Changes are staged but **not yet committed** — the user was not ready to commit at session end.

**Files modified:**
- `models/valet-router/current.json` — `format` changed from `"ollama"` → `"gguf"`, `artifact_path` changed from hardcoded `C:\OmnecorV1-Beta\...` to portable `"./kaggle-2026-06-11"` (resolved to absolute at seed time), `base_model` updated to HuggingFace ID
- `server/phase2/services/ValetArtifactRegistry.ts` — `seedFromRepoIfMissing()` now resolves relative `artifact_path` to absolute at seed time using the source `modelBase` dir; handles dev, packaged Electron, and fallback candidates
- `server/phase2/services/ValetServerService.ts` — added `restart()` method (stop → reset flags → start); used for hot-swapping models
- `server/python_bridges/valet_router_inference.py` — path detection for `_TRAINING_DIR` now checks packaged Electron location (`resources/docs/...`) before falling back to dev repo path
- `server/routers/valetRouter.ts` — added `getModelInfo` (protectedProcedure, reads current.json) and `setModelPath` (adminProcedure, calls `validatePath`, fire-and-forget restart); also added `validatePath` import and `ValetServerService` import
- `client/src/components/SettingsPanel.tsx` — added Valet Router model swap card in Advanced tab; fetches `trpc.auth.me` for `isAdmin` gate; non-admins see read-only message; admins get path input + save button
- `packaging/electron-app/electron-builder.yml` — added `server/python_bridges/valet_router_inference.py` → `resources/python_bridges/` and `docs/ai-agents/valet-training/` → `resources/docs/ai-agents/valet-training/` to `extraResources`
- `.gitattributes` — `*.gguf` changed from `binary` to `filter=lfs diff=lfs merge=lfs -text` (Git LFS)
- `.gitignore` — removed blanket `*.gguf` and `models/valet-router/*/` ignore; replaced with specific ignores for adapter/merged/outputs/ckpts dirs only (GGUF now tracked via LFS)

**Files created:**
- `docs/ai-agents/valet-training/Modelfile` — moved from `tmp-valet-train/Modelfile.valet-router`, `FROM` path fixed to `./kaggle-2026-06-11/valet-router-q8_0.gguf`

---

### Prior session — Async Long-Job Continuation + 5 Skill Commands — ✅ COMPLETE

**Async long-job tool:**
- `server/phase2/services/ProcessManagerService.ts` — opt-in `captureMode: "raw"` (bounded stdout ring buffer, `maxCaptureLines` 100) + `getCapturedOutput(jobId)`
- `server/phase2/services/JobResultCondenser.ts` — NEW. `condenseJobResult` (exit code + tail + regex-extracted errors, deduped/capped) and `formatCondensedResultForAgent`
- `server/phase2/services/AsyncJobService.ts` — NEW. Singleton; tracks jobs, condenses on terminal state, emits `result` event
- `server/routers/jobRouter.ts` — `startAsync` (protectedProcedure): HITL-gated, arg-array spawn, `cwd` via `validatePath`, returns `{jobId, status: "started"}` immediately
- `server/phase2/websocket/WebSocketServer.ts` — `"asyncJobResult"` added to ServerMessage union; broadcasts to `asyncjob:{userId}`
- `client/src/pages/Chat.tsx` — subscribes to `asyncjob:{me.id}`, injects condensed result as system message, auto-re-prompts Valet when idle
- HITL deny-with-reason: `requestApprovalDetailed()` in HITLApprovalService, `denyReason?` on CriticalAction, deny textarea in CriticalActionChecklist
- Tests: `processManagerCapture.test.ts`, `jobResultCondenser.test.ts`, `asyncJobService.test.ts` (13 new tests)

**5 AGENTS.md skills as runtime commands (architect/remember/review/recover/imprint):**
- `server/routers/workflowRouter.ts` — NEW, registered as `workflow`
- `client/src/lib/skillWorkflows.ts` — NEW. Workflow preambles + metadata
- `client/src/components/chat/ChatInput.tsx` + `ChatInterface.tsx` — extended slash command union
- `client/src/pages/Chat.tsx` — 5 new `handleCommand` cases + `omnecor:run_workflow` event listener
- `client/src/hooks/useCommandRegistry.ts` + `CommandPalette.tsx` — "Workflows" group in palette

---

## Decisions made

**Valet Router (this session):**
- **Option A chosen** — self-contained GGUF via `llama-cpp-python`, no Ollama dependency required on target machine
- `artifact_path` in `current.json` is a relative dir path (`"./kaggle-2026-06-11"`); `gguf_file` field holds the filename separately — this is the correct split for the Python `_load_gguf()` function
- `setModelPath` is `adminProcedure` — only admin/owner can swap the model; non-admins see a read-only card
- `restart()` is fire-and-forget in the mutation (returns immediately; server reloads in background)
- GGUF tracked via Git LFS — the 1.6 GB weight file ships with the repo, pulled on build machines via `git lfs pull`
- Model files must be within `PATHS.models` (`~/.omnecor/models/`) for the `validatePath` security check to pass — users must copy their GGUF there before pointing to it

**Prior session:**
- Condenser LLM-summary is a pluggable off-by-default hook (Sovereign-safe); tail+regex is the always-on path
- Skill artifacts live under `PATHS.projects/<projectId>/` (validatePath allow-list is `~/.omnecor`, not repo root)
- Auto-re-prompt on async job completion is skipped while a stream is active to avoid racing

---

## Problems solved

**Valet Router (this session):**
- `current.json` had hardcoded `C:\OmnecorV1-Beta\...` path → made relative, resolved at seed time
- `valet_router_inference.py` `_TRAINING_DIR` pointed to repo-relative path only → now checks packaged Electron location first, falls back to dev path
- `setModelPath` originally used raw `stat()` without `validatePath` — security rule violation, now fixed
- Non-admin users saw the model swap UI but hit FORBIDDEN on save — gated behind `isAdmin` check using `trpc.auth.me`
- `gguf_file: undefined` would silently overwrite existing value — now uses conditional spread `...(resolvedGgufFile ? { gguf_file: resolvedGgufFile } : {})`

**Prior session:**
- HITLApprovalService signature kept backward-compatible: `requestApprovalDetailed` added, `requestApproval` (boolean) kept as wrapper
- Condenser error regex switched from `\berror\b` to `error\b` so `...Error:` matches while "0 errors" stays excluded
- `imprint` found raw-color violation `text-rose-500` in CriticalActionChecklist → fixed to `text-destructive`

---

## Current state

**Valet Router work:**
- All 10 changed files have clean TypeScript (zero new errors beyond pre-existing WSL env `TS2688`)
- `/review` run — 5 issues found and all fixed in the same session
- Changes are **NOT YET COMMITTED** — user stopped before committing
- The GGUF file `models/valet-router/kaggle-2026-06-11/valet-router-q8_0.gguf` (1.6 GB, Q8_0) exists on this Windows machine and is verified present
- Git LFS is **not installed** in WSL — must be installed and run from Windows PowerShell

**Gates (from prior session — unchanged this session):**
- `pnpm check` 0 errors
- `pnpm test` 338 passed (22 files)
- `pnpm build` clean
- `pnpm audit --prod`: 2 LOW pre-existing (dompurify via streamdown→mermaid) — fix is `dompurify >=3.4.8` pin in `pnpm-workspace.yaml`, deferred

---

## Next session starts with

1. **Read AGENTS.md first** (mandatory)
2. **Commit the Valet Router changes from Windows PowerShell** (Git LFS required):
   ```powershell
   # In Windows PowerShell as Administrator:
   winget install GitHub.GitLFS       # skip if already installed
   cd C:\OmnecorV1-Beta
   git lfs install
   git add .gitattributes .gitignore models/valet-router/current.json
   git add models/valet-router/kaggle-2026-06-11/valet-router-q8_0.gguf
   git add docs/ai-agents/valet-training/Modelfile
   git add server/phase2/services/ValetArtifactRegistry.ts
   git add server/phase2/services/ValetServerService.ts
   git add server/python_bridges/valet_router_inference.py
   git add server/routers/valetRouter.ts
   git add client/src/components/SettingsPanel.tsx
   git add packaging/electron-app/electron-builder.yml
   git lfs status   # verify GGUF shows as LFS object
   git commit -m "Valet Router: GGUF packaging, portable paths, model-swap UI"
   git push
   ```
3. **On Linux after pull:**
   - `git lfs pull` to fetch the GGUF binary
   - Verify `llama-cpp-python` is available in the build environment (needs AVX2 CPU — verify before assuming it will work)
   - Run the Electron build and test `/health` returns `model_loaded: true` with `backend: "gguf"`
4. **Optional polish:** Pin `dompurify >=3.4.8` in `pnpm-workspace.yaml` to clear the 2 low audit findings
5. **Feature 27:** End-to-End Build Smoke Tests (web, Electron, Android)

---

## Open questions

- Does the Linux build machine have an AVX2 CPU? `llama-cpp-python` prebuilt wheels require AVX2 — if it's Sandy Bridge (AVX1-only) like the Windows box, direct GGUF loading will crash and a different approach is needed (Ollama, or compile llama-cpp-python from source with AVX1 flags)
- Python runtime bundling for the packaged Electron installer is not yet resolved — the inference server script is bundled but `llama-cpp-python` must be installed on the build machine and the packaged app needs Python available at runtime
- Whether to enable the condenser LLM-summary by default (currently off for Sovereign safety)
- Whether auto-re-prompt-on-job-completion is the desired UX vs. inject-only

---

# Session — Phase 5 close-out (F24–F27) + OMMESH 3-way build readiness (2026-06-16, Linux)

## What was built
- **F26** Unwired elements: APK dark-mode toggle wired to the real `ThemeProvider` (`setColorScheme`) in `app/(tabs)/settings.tsx`; removed a stray `console.log` in `lib/theme-provider.tsx`. Desktop `client/src/components/SettingsPanel.tsx`: bound 16 previously write-only controls (13 switches + per-folder enable + Log Level + Theme/Language/Startup/CloudProvider selects) via the real `system.saveSettings` mutation. Real podcast **episode history** dialog (localStorage, play/download/remove) in `client/src/pages/PodcastStudio.tsx`, replacing a toast that pointed at a non-existent route — also fixed a latent bug where the desktop master-mix `<audio>` was never wired to the generated audio.
- **F25** Mobile podcast: server now returns `audioUrl` + a range-capable `/media/podcast/:jobId` route (`server/_core/static.ts`, `LocalPodcastService.ts`); APK `app/(tabs)/podcast.tsx` got a real `expo-audio` player + `expo-file-system` device download. **Add Sources** panel (text / website-URL fetched+stripped / file via `expo-document-picker`) feeding the AI script generator as context.
- **F24** Mobile 3D real meshes: `server/routers/blenderRouter.ts` gained `listModels` + `export` `toLibrary`; new `/media/model/:file` serve route (basename-only + `.glb/.gltf` allowlist + `model/gltf-binary`) from `PATHS.models`. APK `app/(tabs)/viewer.tsx`: added `GLTFLoader` to the WebView three.js importmap + `window.loadModel/clearModel`, a Model picker, raycast rebuilt on loaded meshes, camera framing; demo primitives are the no-model fallback.
- **F23b** Native mic Foreground Service: new local Expo module `packaging/android/omnecor-hq/modules/mic-foreground-service/` (Kotlin `MicForegroundService` with `FOREGROUND_SERVICE_TYPE_MICROPHONE` + persistent notification + `START_STICKY`; `MicForegroundServiceModule` bridge; `<service foregroundServiceType="microphone">` in its own manifest). Autolinked (under `modules/`, survives `prebuild --clean`). Wired into `always-listen.ts` start/stop via `requireOptionalNativeModule`.
- **OMMESH 3-way artifacts (all built on Linux):** Linux `Omnecor-2.3.0-beta.1-x86_64.AppImage` + `.deb` (`packaging/electron-app/dist/`); Android `app-release.apk` 118 MB standalone (`…/apk/release/`). Windows installer already built on the Windows box.

## Decisions made
- APK `release` is signed with the **debug keystore** (`signingConfig signingConfigs.debug`) — fine for LAN sideload/testing; a real keystore is only needed for Play Store.
- OMMESH uses one **shared `OMMESH_SECRET`** across all 3 nodes; written to this Linux node's gitignored `.env`. (Secret value lives in `.env` only — never commit it / never put it in memory.)
- Native FGS delivered as a **local Expo module** (not raw `android/` edits or a config-plugin dangerous-mod) so `prebuild --clean` can't wipe it. The "background capture provider" is satisfied by the FGS keeping the app-wide `useAlwaysListenCapture` (mounted in `app/_layout.tsx`) alive.

## Problems solved
- **`apk:release`/`apk:debug` build failure:** the scripts hardcoded `gradlew clean`, whose `externalNativeBuildClean` re-runs CMake against autolinking codegen JNI dirs (react-native-voice-processor etc.) that aren't generated yet → `build.ninja` regenerate failure. Fixed: scripts now `rm -rf app/.cxx app/build/generated/autolinking && gradlew …` (no `clean`). Run `prebuild:android` (`--clean`) before release builds to keep app icons fresh (sharp is the real icon fix).
- **Expo Kotlin `Function {}` gotcha:** `val x = appContext.reactContext ?: return@Function` fails to compile ("expected Any?, actual Unit") — use a plain `if (x != null) {}` null-check.
- **Android SDK location:** `prebuild --clean` wipes `android/local.properties`; recreate with `sdk.dir=/home/linux/Android/Sdk` (or set `ANDROID_HOME`) before gradle.

## Current state
- Gates green: root `tsc` 0 · APK `tsc` 0 · `vitest` 338/338 · web build ✓ · Linux AppImage/.deb ✓ · release APK ✓ · Android debug build ✓ (FGS service confirmed merged into the manifest).
- Commits on `main` (local, may need push): `62a1875` (F24–F27 + prior workflow/Valet/demo work), `ea992f2` (apk scripts + tracker). Repo was synced to `origin/main` with the Windows work stacked on top.

## Next session starts with
1. **3-way OMMESH on-device test:** set the same `OMMESH_SECRET` (in `.env`) on the Windows node + APK Settings; install Windows `.exe`, sideload `app-release.apk`, run the Linux AppImage; same LAN → verify mDNS discovery + authenticated mesh routing across all 3.
2. **F23b on-device:** train "Hey Omnecor" `.ppn` (Picovoice console) + `setKeywordPath` (fallback `BuiltInKeywords.COMPUTER`); confirm wake word fires with the app backgrounded.
3. **Optional:** social pipeline live-test (needs real OAuth creds + go-ahead; YouTube via Google login is lowest-friction). `git push` when ready so other machines pull.

## Open questions
- Same as the Valet section above (AVX2 / Python bundling), plus: does the 3-way mesh route inference correctly once all nodes share the secret on one LAN? (code-verified, not yet runtime-verified across 3 physical nodes).
