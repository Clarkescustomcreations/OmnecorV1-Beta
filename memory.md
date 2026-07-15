# Memory — MASTER TODO (remaining tasks & tests)

Compiled 2026-07-15 from a full sweep of the trackers: `Task-Brains-Upgrade.md`
(Phase 9), `Chats-Agentic-Upgrade.md` (Phase 7 + on-device bugs),
`Context/Tracker-Docs/Verification-Pass.md` (Sections 8/10/11/12), and
`Context/Tracker-Docs/Workflow-Matrix.md` (unchecked `[ ]` journeys).

**All completed feature work is recorded** — Brains Upgrade Phases 0–8, Chats
Agentic Phases 0–6, Model-Fabric Phases 0–8, and Mesh-Delegation Phases 1–9 are
all SHIPPED with green static gates (last measured baseline **1590 passing / 4
skipped, 140 files**). What remains below is **verification + a few deferred
gaps**, not core building. Record every result into
`Context/Tracker-Docs/Verification-Pass.md` as items land.

> **The big unlock:** one **live multi-peer / on-device session** (Group B) closes
> the most at once — it's the shared gate behind Chats Phase 7, Brains Phase 9
> end-to-end, Model-Fabric Phase 7, Mesh-Delegation Phase 10, and the whole APK +
> OMMESH manual checklist. Group A needs no hardware and can be done at the desk
> first. See the `ommesh-mesh-test` + `run-omnecor` skills.

---

## GROUP A — Harness-drivable NOW (no hardware, no paid creds) — do first

These are verifiable at the desk via `appRouter.createCaller`, the dev server under
`ZERO_LOGIN_MODE`, a local Ollama, Playwright, or the OAuth emulator skills.

### A1 — Close-out gates on the two shipped workstreams
- [ ] **Brains Phase 9** — end-to-end drive: attach the Coding brain → real local-model
      chat (Ollama/own runtime) → confirm grounded, **cited** output. Then coverage
      ratchet + `pnpm check`/`pnpm test`. (`Task-Brains-Upgrade.md` Phase 9 = the only 🔄.)
- [ ] **Chats Phase 7 static close-out** — `/review` the full feature · `pnpm check` ·
      `pnpm test` · `pnpm build` · `pnpm audit --prod` all green · then `/remember save`.
      (On-device tool-loop part of Phase 7 is in Group B.)

### A2 — Verification-Pass §8 Priority 1 (core server, ZERO_LOGIN dev server)
- [ ] Health endpoint 200 · tRPC `auth.me` · zero-login banner
- [ ] Execution-mode selector persists (reload check)
- [ ] Chat session create/rename/delete + two-tab per-user isolation
- [ ] Script save/load reloads from server (not localStorage)
- [ ] Neural Map create/delete + local-dir root renders tree
- [ ] Notifications WS badge increment + clear→0
- [ ] Settings JSON write hits `.omnecor/settings.json`
- [ ] HITL queue: trigger (crew > 3) → appears → approve/reject

### A3 — Verification-Pass §8 Priority 2 (AI inference via local Ollama/stub)
- [ ] Chat → streaming AI response · Stop mid-stream aborts cleanly
- [ ] Memory Archiver auto-compress at 50+ messages
- [ ] RAG injection references an indexed file
- [ ] Sovereign blocks cloud AI (FORBIDDEN) · Sovereign allows Ollama
- [ ] Valet Router classifies a coding prompt as `code_generation`
- [ ] MoE Chain: 2-step local chain runs two sequential local invocations

### A4 — Remaining honest 🧪 residue (unit/route tests, no deps) — Verification-Pass §12 Batch J tail
- [ ] `system.detectHardware` / `checkDependencies` / `saveKeys`
- [ ] `chat.filterScope` localStorage round-trip · scripts localStorage-migration helper
- [ ] `comfy` live `getQueue` · SecurityService service-level (YARA / AES / ZIP)
- [ ] Token-refresh pipeline (OAuth pre-emptive renew + 401 intercept) — Workflow-Matrix Auth

### A5 — Batch H remaining per-widget interactions (Playwright, prod build + seeded cookie)
- [ ] Write/interaction assertions: scope filters + localStorage round-trips, BrainMap
      sliders/lazy-expand, ModelHub toggles, Pipelines tabs, Wallet HITL dialog,
      Settings persistence writes, Notifications badge clear. (Page render + read-side
      already ✅; these are the write-side.)

---

## GROUP B — The one live multi-peer / on-device session (unblocks the most)

Shared gate for: Chats Phase 7 on-device, Brains OMMESH sync live, Model-Fabric
Phase 7, Mesh-Delegation Phase 10, Verification-Pass §8 Priority 5 (OMMESH) + 6 (APK).
Use the `ommesh-mesh-test` skill (4-way: Linux + DadsPC + StudioOnePC + S25 APK).

### B1 — APK on-device agentic tool-loop (⛔ the last unverified agentic piece)
- [ ] Rebuild APK (~25 min: `pnpm prebuild:android` → recreate `local.properties` →
      `ANDROID_HOME=… pnpm apk:debug` → `adb install -r`).
- [ ] Drive PC chat from phone: WS stream types out · command/edit box appears ·
      **Approve/Deny from the phone** works · ▶Run returns a JobBlock · ⚡Preview opens
      WebView · queue type-ahead + chip-recall · reasoning/quotes render.
- [ ] **Re-check bug #3 (mesh-model discovery in picker)** — Model-Fabric shipped the
      unified catalog since this was logged; confirm PC/mesh models are now selectable.

### B2 — 4 on-device APK bugs (from Chats-Agentic-Upgrade "Bugs found on-device")
- [ ] **#1 crypto chat-persistence** — `Native crypto module could not be used to get
      secure random number`; encrypted chat persist broken (data-loss, recurring).
- [ ] **#2 prompt-bubble contrast** — user text black on blue; mirror the web-app fix.
- [ ] **#3 model picker omits OMMESH/PC models** — see B1 re-check.
- [ ] **#4 "Test" button false-negative** — sticky "Cannot reach server" while WS
      actually connects (separate broken preflight code path).

### B3 — OMMESH multi-node (§8 Priority 5) + Workflow-Matrix
- [ ] mDNS discovery bidirectional · cross-node mTLS inference both directions
- [ ] Cert pinning rejects non-pinned peer · Sovereign mesh guard blocks cloud
- [ ] Android as 3rd/4th peer (`OMMESH_SECRET`, `mobile_node_register`, trust queue)

### B4 — APK full device verify (§8 Priority 6 + Workflow-Matrix Mobile/TD-006/008)
- [ ] Sideload + launch (no `libcdsprpc.so` error) · WS `?token=` auth in logs
- [ ] Chat round-trip · audio recorder · dark-mode · Desktop-IP ping · SecureStore no plaintext
- [ ] `react-native-gesture-handler` Pressable no crash on RN 0.83
- [ ] Always-Listen wake-word with app backgrounded/closed (TD-008)
- [ ] GGUF download + on-device inference full path (TD-006)

### B5 — Voice live round-trip (needs mic/speaker; data-path already ✅)
- [ ] Full STT → LLM → TTS live round-trip (Workflow-Matrix Voice Pipeline last item)

---

## GROUP C — GPU / training (RTX 4060 8GB / DadsPC / Win box 192.168.1.78)

- [ ] **Valet production sign-off** — `pnpm valet:build` clean GPU box; 0.85 accuracy
      gate (currently 0.7385 — TD-010)
- [ ] Small-model (0.5B–3B) 4-bit **QLoRA pipeline smoke test** (dataset→Unsloth→LoRA→GGUF)
- [ ] Local GGUF inference via llama.cpp / Valet / MoE-local on the 4060 or CPU

---

## GROUP D — External paid creds (deliberate manual smoke — do when ready)

Logic is ✅/mockable; only the real side-effecting call is manual. (Verification-Pass §11.)
- [ ] Social publish — webhook (X/LinkedIn/FB/IG via live n8n blueprint) + native
      (Bluesky/Mastodon/Discord/Telegram real account) — TD-020
- [ ] Lithic VCC live sandbox · PCBWay live order · Gmail live delivery
- [ ] Google/Microsoft OAuth live (or emulator exchange) · Drive/Dropbox/OneDrive sources
- [ ] Honcho memory layer (real key) · ElevenLabs · Fal

---

## GROUP E — Build / packaging clean-machine (§8 Priority 7 + F27)

- [ ] Windows installer on clean Windows (PORT 37291, OAuth redirect, SQLite round-trip — TD-005)
- [ ] Linux AppImage + `.deb` launch · Desktop OAuth (port 37291)
- [ ] Web smoke on isolated clean machine · Ollama auto-install on clean machine

---

## GROUP F — Deferred feature gaps (real TODO, not just tests)

> **Re-scoped 2026-07-15 after reading the code** (the Workflow-Matrix `[ ]`s I first
> pulled from were audited 2026-06-20, before the 2026-06-23 code-sweep fixes). This
> group turned out to be the **smallest** problem area, not the biggest — two entries
> were already shipped. Ranked by real production impact:

- [x] ~~**[HIGH — real production-run blocker] Standalone prod-bundle libSQL native
      binding**~~ — **DONE 2026-07-15.** `scripts/build-server.mjs` now copies every
      installed `@libsql/<platform>` native binding (any dir with an `index.node`) into
      `dist/node_modules/@libsql/` after the esbuild step, so the bundle is
      self-sufficient (libsql's dynamic `require(`@libsql/${target}`)` resolves next to
      `dist/index.js`). **Verified:** built bundle → binding present, `require.resolve`
      lands in `dist/node_modules` (not repo hoisting), and `node dist/index.js`
      (NODE_ENV=production, isolated temp data dir) boots to `/health`
      `{db:true, migrationOk:true}` and writes `omnecor.db` — previously threw
      `Cannot find module '@libsql/linux-x64-gnu'`.
- [x] ~~**[MEDIUM — correctness/UX] Two Ollama settings readers disagree**~~ — **DONE
      2026-07-15.** New `server/core_services/services/ollamaUrl.ts` `resolveOllamaUrl()`
      is the single source of truth (reads via `SettingsService`, chain
      `input → OLLAMA_BASE_URL → legacy ollamaUrl → ENV`). Wired into
      `AiProviderService.getOllamaUrl` (inference) **and** all three systemRouter reads
      (`aiProviders` status, `detectHardware` probe, `checkDependencies` probe — the
      last two previously ignored settings entirely / read the raw file). +4 regression
      tests (`ollamaUrl.test.ts`, incl. the legacy-key case). ([[settings-architecture]].)
- [ ] **[LOW-MED — enhancement] Real Blender/ComfyUI mesh into mobile 3D scene** — UI
      wired, but real generated meshes not yet loaded end-to-end into the mobile WebView
      (primitives demo + desktop mesh both work) — F24.
- [ ] **[LOW — polish] APK model-picker loaded-indicator UI** — type mirrored only
      (Model-Fabric Phase 8 leftover).
- [ ] **[LOW — test infra] WS+PTY integration test seam** — `OmnecorWebSocketServer`
      needs an isolated/DB-injectable construction mode before the full round-trip test
      is safe (it currently touches the real DB + 7 singletons) — §12 Session-30 addendum.

**Already RESOLVED (do NOT re-do — verify only):**
- ~~Server-backed podcast episode history (TD-026)~~ — **DONE 2026-06-23**: `podcastEpisodes`
  table + `podcast.listEpisodes`/`deleteEpisode` + frontend rewired off localStorage.
- ~~VRAM-weighted mesh routing (TD-018)~~ — **DONE 2026-06-23**: `HostTelemetry` producer +
  `RoutingEngine` scoring fix built; only **live 2-GPU-node proof** remains → that's a
  Group B (hardware) verify item, not a build gap.

---
---

# APPENDIX — Prior handoff (2026-07-07, largely SUPERSEDED)

> The NPU manifest fix and the agentic-chat APK port referenced below **shipped**;
> the NPU on-device badge was **verified 2026-07-07** (HTP0–HTP3, no libcdsprpc
> error). Model-Fabric + Brains have landed since. The one live item that survives
> from here is the **agentic tool-loop on-device verify** — now tracked as Group B1.
> Full durable detail lives in the auto-memory dir (`npu-execution-pathway.md`,
> `chats-agentic-upgrade.md`, `model-fabric-workstream.md`, `brain-packs-workstream.md`).

Key non-obvious gotchas retained for the next rebuild:
- `expo prebuild --clean` wipes `android/local.properties` → recreate
  `sdk.dir=/home/linux/Android/Sdk` before `pnpm apk:debug`.
- NPU/GPU for GGUF only engages because the `"llama.rn"` Expo plugin is registered in
  `app.config.ts` (adds `<uses-native-library>` libcdsprpc.so + libOpenCL.so). Verify
  both are in the generated AndroidManifest.xml after a prebuild.
- Verify no half-patched llama.rn: `grep -c use_npu
  node_modules/llama.rn/cpp/jsi/JSIParams.cpp` must be `0`.
- Metro ENOSPC on Linux: watcher blockList in `metro.config.js`; keep big dirs out of repo.
- Pair APK to a localhost dev server via `adb reverse tcp:3000` + ZERO_LOGIN loopback;
  Metro on `:8081` via `adb reverse tcp:8081 tcp:8081`.
</content>
</invoke>
