# Memory — Valet Router GGUF Integration + Prior Session Work

Last updated: 2026-06-16

---

## DO NOT REMOVE THIS NOTE **Important: Read AGENTS.md Before Beginning The Next Session**

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
