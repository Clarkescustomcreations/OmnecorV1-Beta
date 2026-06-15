# Memory — Omnecor Phase 4 Complete

Last updated: 2026-06-14

---

## DO NOT REMOVE THIS NOTE **Important Read AGENTS.md Before Beginning The Next Session**

---

## What was built

### Phase 4: Desktop Shell & Theme Modernization (F16–F22 — all complete)

- **F16 React 19 Electron** (`packaging/electron-app/package.json`): bumped `react`/`react-dom` from
  `^18.2.0` → `^19.2.1` and `@types/react`/`@types/react-dom` to `^19.1.0`. Eliminates
  `useContext of null` duplicate-module crash in Electron builds.

- **F17 tRPC alignment** (`packaging/android/omnecor-hq/package.json`): changed `@trpc/client`,
  `@trpc/react-query`, `@trpc/server` from exact pin `11.17.0` → range `^11.8.0` to match server.
  pnpm resolves all three to the same version.

- **F18 Tailwind tokens** (`packaging/android/omnecor-hq/theme.config.js`): aligned all dark-mode
  HEX values to UI-Tokens.md §5.1 (`background: #0e0f14`, `card: #151620`, `foreground: #f8f9fa`,
  `primary: #1d4ed8`, `border: #2a2b36`). Added missing `accentCyan: #06b6d4` and
  `destructive: #dc2626`.

- **F19 Brain map external sync** (`brainMapStore.ts`, `ExternalBrainMapWindow.tsx`):
  - Added `collapsedFolderIds` to BroadcastChannel broadcasts in `toggleFolderCollapse`.
  - Added `requestInitialState` / `initialState` handshake — external window sends request on mount
    via `omnecor_brain_map_store` channel; main window responds with full graph state.
  - External window opens with correct state immediately (no stale empty-canvas flash).

- **F20 Real-time telemetry** (`WebSocketServer.ts`, `Dashboard.tsx`):
  - `startTelemetryPush()` added to WS server — 2 s interval broadcasts CPU % (os.cpus() delta),
    RAM (os.freemem/totalmem), GPU VRAM (nvidia-smi, 5 s cache) to `system:metrics` channel.
  - `"systemMetrics"` added to `ServerMessage` type union.
  - Dashboard subscribes via `useOmnecorSocket` + `subscribe("system:metrics")`. Renders a System
    Monitor card with live progress bars (CPU / RAM / VRAM) above the features grid.
  - `startTelemetryPush()` called in `server/_core/index.ts` after WS init.

- **F21 mDNS discovery** (`MeshDiscoveryService.ts`):
  - Replaced stub constructor with real `bonjour` implementation.
  - Advertises this node as `omnecor-<local-ip>` type `omnecor` on `$PORT`.
  - Browses for peers; emits `nodeDiscovered` / `nodeLost` events; maintains live `nodes` map.
  - `destroy()` method for clean shutdown. Graceful fallback if bonjour unavailable.
  - Import: uses static `import bonjour from "bonjour"` (moduleResolution: bundler allows synthetic default).

- **F22 RVC stub fix** (`rvc_server.py`):
  - `_stub_synthesise` now returns original 16 kHz audio (identity pass-through) instead of fake
    220 Hz sine wave. Falls back to zero-filled silence only when audio is unavailable.
  - `convert()` passes `audio_16k` down to `_synthesise` → `_stub_synthesise` via keyword arg.
  - Real HuBERT + SynthesizerTrnMs768NSFsid path is unchanged.

---

## Decisions made

- **Single libSQL/SQLite engine** — no MySQL tier; canonical local DB is `~/.omnecor/data/omnecor.db`.
- **No MySQL migration** — user never hosted on external server; DB starts fresh.
- **Mobile buttons**: always import `Pressable` from `@/components/pressable` (cssInterop'd gesture-handler).
- **APK must be RELEASE build** — debug APK doesn't bundle JS (needs Metro dev server).
- **Release APK signing**: env-var override pattern for CI; dev defaults in build.gradle only.
- **nanoid Metro fix is permanent** — intercepts `moduleName === "nanoid"` → `index.browser.js`.
- **Settings deferred controls**: build when subsystems exist (Phase 5 F26).
- **LLM procedure tiers**: `cloudProcedure` for any external-network call.
- **APK CSPRNG**: real `react-native-get-random-values` (Web Crypto).
- **bonjour import**: static `import bonjour from "bonjour"` (not dynamic) — moduleResolution: bundler enables synthetic default for CJS `export =` modules.
- **APK rebuild + device test**: deferred to end of Phase 5 (F27 End-to-End Smoke Tests).

---

## Problems solved

- **`crypto.randomFillSync is not a function`**: Metro intercepts nanoid → `index.browser.js`.
- **`libcdsprpc.so not found`**: `patches/llama.rn.patch` forces `hasHexagon=false`.
- **Duplicate-React crash**: Metro resolver pins `react`/`react-dom` to app's single copy.
- **`VoiceService` speaker wav path throws**: `streamDialogue()` bypasses VoiceService.
- **crewai `step_callback` TypeError**: guarded with try/except.
- **`"systemMetrics"` not in ServerMessage union**: added to type — was causing TS2322 errors.
- **bonjour CJS dynamic import type error**: use static import, not `import()`.
- **`ENV.port` doesn't exist**: use `parseInt(process.env.PORT ?? "3000", 10)` in MeshDiscoveryService.

---

## Current state

- Desktop: `pnpm check` (tsc --noEmit) clean. `pnpm test` → 18 files / **323/323 passing**.
- `Context/Progress-Tracker.md`: F16–F22 marked [x]; Phase 4 ✅ COMPLETE.
- `Context/Build-Plan.md`: status 22/27 features done.
- **APK**: nanoid Metro fix in `metro.config.js` but APK NOT rebuilt yet — deferred to Phase 5 F27.

---

## What was completed across ALL prior sessions (consolidated)

**Phase 1 (Security hardening)** — F1–F5 complete.
**Phase 2 (DB layer)** — F6–F10 complete.
**Phase 3 (AI services)** — F11–F15 complete.
**Phase 4 (Desktop/Theme)** — F16–F22 complete.
**Mobile APK overhaul** — complete (screens wired, APK built, not yet retested post-nanoid-fix).
**Desktop social pipeline** — complete (discovery, curation, publish, schedule).
**DB unification** — complete (single libSQL/SQLite, mysql2 removed).

---

## Next session starts with

1. **Always read `/home/linux/Documents/OmnecorV1-Beta/AGENTS.md` first.**
2. **Phase 5, Feature 23**: Secure KeyStore Encryption — replace unencrypted `AsyncStorage` with
   `expo-secure-store` in `packaging/android/omnecor-hq/lib/_core/server-config.ts` for
   `omnecor_ommesh_secret` and chat histories.
3. Continue F24 → F25 → F26 → F27 per Build-Plan order.
4. **F27 includes**: rebuild APK (`pnpm prebuild:android && pnpm apk:release`), test on Samsung
   S25 Ultra (nanoid crypto fix, local-account register, tabs load).

---

## Open questions

- APK crypto fix not yet validated on device — must rebuild and test in F27.
- On-device CPU inference speed (NPU/Hexagon disabled) — acceptable for target use cases?
- Live end-to-end publishing test against real X/LinkedIn/FB/IG APIs (needs connected OAuth tokens).
- Phase 5 F26 Settings controls (telemetry, apiServerEnabled/Port, etc.) — need subsystems first.
