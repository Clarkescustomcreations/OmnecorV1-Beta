# Memory — Omnecor Phase 3 Complete / Issues Resolved

Last updated: 2026-06-14

---

## What was built

### Phase 3: Core AI Services & Pipeline Repairs (F11–F15 — all complete)

- **F11 BPE tokenizer** (`server/phase2/services/ONNXEmbeddingService.ts`): replaced whitespace
  pseudo-tokenizer with `@anthropic-ai/tokenizer` BPE encoder. `getTokenizer()` cached as class
  member; `.encode(text, 'all')` → `Uint32Array`; capped at 512 tokens; fed to ONNX session as
  `int64` tensor.

- **F12 warm model cache** (`server/python_bridges/llamacpp_bridge.py`): module-level `_gen_cache`
  / `_emb_cache` dicts + per-model `threading.Lock`; double-checked locking; `/load`, `/unload`,
  `/loaded` endpoints added.

- **F13 agent bridges** (both new files):
  - `server/python_bridges/crewai_bridge.py` — CrewAI crew runner; falls back to Ollama httpx if
    crewai not installed; `step_callback` guarded with `TypeError` catch for older crewai versions.
  - `server/python_bridges/liteagent_bridge.py` — LiteAgent ReAct loop via Ollama; 8-iteration cap;
    "Final Answer:" early-exit detection; each step emitted as JSON line to stdout.

- **F14 LLM-driven pipeline phases** (`server/phase2/services/PipelineEngineService.ts`): replaced
  static `phaseOutput()` with `async generatePhaseOutput()` backed by `AiProviderService.chat()`.
  Five phase-specific system prompts (DEFINE/PLAN/EXECUTE/REVIEW/SHIP); falls back to static text
  when Ollama offline.

- **F15 real TTS podcast**:
  - `server/python_bridges/podcast_engine.py`: async httpx calls to TTS server (port 8002);
    soundfile + numpy WAV stitching with 0.25s gaps; nearest-neighbour resample to 44100 Hz.
  - `server/phase2/services/LocalPodcastService.ts`: replaced stub with `callPodcastEngine()`
    spawner; `streamDialogue()` calls TTS server directly via `fetch` (no VoiceService dependency).

### Issue resolution (open issues from prior sessions)

- **nanoid / Hermes crypto fix** (`packaging/android/omnecor-hq/metro.config.js`): intercepts
  `moduleName === "nanoid"` → returns `index.browser.js` (Web Crypto path). Root cause: nanoid's
  `"react-native": "index.js"` Metro field loads Node.js `crypto.randomFillSync` not present in
  Hermes; `react-native-get-random-values` patches `global.crypto.getRandomValues` (different API).
  Sub-paths fall through to default resolution.

- **Release keystore** (`packaging/android/omnecor-hq/android/app/`): 4096-bit RSA keystore
  generated (alias `omnecor-release`, 10,000-day validity). `build.gradle` configured with
  `signingConfigs.release`; passwords via env vars `OMNECOR_KEYSTORE_PASSWORD` /
  `OMNECOR_KEY_PASSWORD` (defaults redacted — stored in build.gradle dev defaults only).
  `*.keystore` gitignored; `!debug.keystore` allowed.

- **MySQL migration**: confirmed not needed. User never ran Omnecor on an external server.
  `~/.omnecor/data/omnecor.db` is the libSQL embedded file created fresh by current code.

- **Settings 5 controls** (telemetry, apiServerEnabled/Port, offloadLatency/poolVram, autoRestart,
  scanOnUpload): deferred to Phase 4 F26 per user decision. No server code consumes them yet.

- **Build-Plan.md updated**: added "Release Signing" section, "nanoid/Hermes crypto fix" section;
  removed "release signing keystore" from Remaining list.

---

## Decisions made

- **Single libSQL/SQLite engine** — no MySQL tier; `~/.omnecor/data/omnecor.db` is canonical local
  DB; `LIBSQL_URL` + `LIBSQL_AUTH_TOKEN` for networked/Turso mode.
- **No MySQL migration** — user never hosted on a server; database starts fresh.
- **Mobile buttons**: always import `Pressable` from `@/components/pressable` (cssInterop'd
  gesture-handler), never from `react-native`. NativeWind v4 + new-arch swallows onPress otherwise.
- **APK must be RELEASE build** — debug APK doesn't bundle JS (needs Metro dev server).
- **Release APK signing**: env-var override pattern for CI; dev defaults in build.gradle only.
- **nanoid Metro fix is permanent** — root cause in nanoid package.json field, not a polyfill issue.
- **Settings deferred controls**: build when subsystems exist (Phase 4 F26).
- **LLM procedure tiers**: `cloudProcedure` for any external-network call (Sovereign mode enforced).
- **APK CSPRNG**: real `react-native-get-random-values` (Web Crypto), not nanoid/non-secure.

---

## Problems solved

- **`crypto.randomFillSync is not a function`** on device register: Metro routes nanoid to Node.js
  entry; fix is `index.browser.js` intercept in metro.config.js (not a polyfill import issue).
- **`libcdsprpc.so not found` model crash**: `patches/llama.rn.patch` forces `hasHexagon=false` →
  CPU `dotprod_i8mm` variant.
- **Duplicate-React crash** (`useContext of null`): Metro resolver pins `react`/`react-dom` (not
  react-native) to app's single copy.
- **`VoiceService` speaker wav path throws**: `streamDialogue()` bypasses VoiceService, calls TTS
  server directly via `fetch`.
- **crewai `step_callback` TypeError**: guarded with try/except for older crewai versions.

---

## Current state

- Desktop: `pnpm check` (tsc --noEmit) clean. `pnpm test` → 18 files / **323/323 passing**.
- Mobile: `tsc --noEmit` clean.
- `Context/Progress-Tracker.md`: F11–F15 marked [x]; Phase 3 ✅ COMPLETE.
- `Context/Build-Plan.md`: Phase 3 header updated ✅ COMPLETE (5/5); status 15/27 features done.
- **APK**: nanoid Metro fix is in `metro.config.js` but APK has NOT been rebuilt yet. Current APK
  on device still has the old nanoid resolution. Must rebuild before on-device crypto fix is live.

---

## What was completed across ALL prior sessions (consolidated)

**Phase 1 (Security hardening)** — F1–F5 complete: JWT_SECRET enforcement, session hardening,
  adminProcedure/ownerProcedure tiers, audit logging, `cloudProcedure` Sovereign enforcement.

**Phase 2 (DB layer)** — F6–F10 complete: Drizzle relations, out-of-band migrations, safe
  transactions, SQLite `.returning()` for insert IDs, sovereign audit logging.

**Phase 3 (AI services)** — F11–F15 complete: see above.

**Mobile APK overhaul** — complete: interactive 3D viewer, offline-first load, local account auth,
  chat with file attach + PC sync, integrations, on-device GGUF + MediaPipe inference, Terminal PTY,
  Podcast AI script generation, desktop OAuth social login card.

**Desktop social pipeline** — complete: `ArticleDiscoveryService`, `curatorRouter` AI drafts,
  `PublishingService`/`publishExecutor`/`publishWorker` for X/LinkedIn/FB/IG.

**DB unification** — complete: single libSQL/SQLite engine, `drizzle/schema.ts` sqlite-core,
  `server/db.ts` on `@libsql/client`, auto-applied migrations, mysql2 removed.

---

## Next session starts with

1. **Always read `/home/linux/Documents/OmnecorV1-Beta/AGENTS.md` first.**
2. **Rebuild APK** with the nanoid Metro fix:
   ```
   cd packaging/android/omnecor-hq
   pnpm prebuild:android && pnpm apk:release
   ```
3. **Test on Samsung S25 Ultra**: install new APK, verify local-account register succeeds (no
   "crypto" error), verify tabs load.
4. **Phase 4, Feature 16**: React 19 Version Alignment — upgrade
   `packaging/electron-app/package.json` from React `^18.2.0` to `^19.2.1`. Then continue F17–F20
   per Build-Plan.md order.

---

## Open questions

- APK crypto fix not yet validated on device — must rebuild and test first.
- On-device CPU inference speed (NPU/Hexagon disabled) — acceptable for target use cases?
- Live end-to-end publishing test against real X/LinkedIn/FB/IG APIs (needs connected OAuth tokens).
- Phase 4 F26 (Settings 5 controls) — build the subsystems or remove the controls?
