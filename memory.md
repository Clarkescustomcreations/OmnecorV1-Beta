# Memory — two active workstreams (NPU pathway + Agentic Chat)

Last updated: 2026-07-07

> **OWNER DIRECTIVE — the single rebuild is now DUE.** APK rebuilds take ~25 min.
> The agentic-chat APK port (Phase 6, Session B) is now **COMPLETE**, so the one
> pending rebuild should happen next and verify **BOTH** features in the same
> on-device pass: the NPU manifest fix (Session A) **and** the agentic chat
> stream + HITL (Session B). Don't burn a rebuild on anything smaller first.

# Session A — NPU-First On-Device Models (APK)

Full durable detail: `npu-execution-pathway.md` in the auto-memory dir; CHANGELOG
2026-07-05 entry; corrected Progress-Tracker entry.

## What was built

- Deleted the entire llama.rn patch apparatus (subagent's `use_npu` C++ patch was dead
  code) — llama.rn 0.12.4 natively supports `initLlama({ devices: ["HTP*"] })` and
  reports truth via `context.devices`.
- `lib/_core/model-catalog.ts` (variants: quality Q4_K_M + NPU Q4_0/IQ4_NL/Q8_0, all
  URLs HEAD-verified; capabilities → chat attach-button gating; 11 vitest tests),
  `acceleration.ts` (app-wide auto|cpu|gpu|npu, Auto default, legacy-key migration),
  `phone-model.ts` (ONE resident model across both engines; **selection in the Chat
  picker is the only lifecycle verb**; Settings = download/delete/Unload/badges only;
  auto re-arm on start). Settings/Chat/AI Node/Status all rewired; mediapipe loads
  pass `validate:true` on GPU/NPU.

## Problems solved (do NOT re-solve)

- **`expo prebuild --clean` wipes `android/local.properties`** → recreate
  `sdk.dir=/home/linux/Android/Sdk` before `pnpm apk:debug`.
- **pnpm virtual store had a HALF-PATCHED llama.rn extract** (JSIParams.cpp patched,
  common.h pristine → NDK compile error `no member named 'use_npu'`). Fixed by full
  `rm -rf node_modules*` + reinstall → clean hoisted layout. Verify with
  `grep -c use_npu node_modules/llama.rn/cpp/jsi/JSIParams.cpp` == 0.
- **Metro ENOSPC on Linux** (inotify 60k, no sudo): moved 2.5 GB `node_modules_broken/`
  out of repo + added watcher blockList to `metro.config.js` (.git, appimage-build,
  electron-app, dist, docs, coverage, attached_assets, data, .cxx, android build dirs).
- **THE BIG ONE — why NPU (and GPU!) never engaged for GGUF:** Android 12+ refuses to
  link vendor libs unless the manifest declares them. Logcat:
  `dlopen failed: library "libcdsprpc.so" not found: needed by
  librnllama_v8_2_dotprod_i8mm_hexagon_opencl.so` → llama.rn fell back to the CPU-only
  JNI lib → zero HTP devices, zero OpenCL. **Every past GGUF "GPU" load was secretly
  CPU.** Fix: registered the `"llama.rn"` Expo plugin in `app.config.ts` (adds
  `<uses-native-library>` libcdsprpc.so + libOpenCL.so); prebuild re-run; both entries
  verified present in the generated AndroidManifest.xml.

## Current on-device state (S25 Ultra, verified live)

- New APK (build 1, WITHOUT the manifest fix) installed + driven over adb: Acceleration
  selector works; variant catalog with ⚡NPU-ready badges + "matches your setting"
  works; downloaded Llama-3.2-1B Q8_0; **Chat-picker selection loads/swaps correctly**
  (Gemma LiteRT → 1B GGUF swap verified, Unload freed native heap 1.84 GB → 0.38 GB);
  honest backend badge showed **CPU** — correctly, because of the libcdsprpc issue above.
- Owner observed both facts live (badge=CPU; "didn't seem to unload" was the identical
  CPU badge + Android page-cache, state was actually correct).

## Next session starts with

1. **Phase 6 agentic-chat APK port is DONE** (Session B) — go straight to the rebuild.
2. ONE rebuild: `pnpm prebuild:android` → recreate `local.properties` →
   `ANDROID_HOME=/home/linux/Android/Sdk pnpm apk:debug` (~25 min) → `adb install -r`.
3. On-device NPU verify: Metro via `npx expo start --port 8081` + `adb reverse
   tcp:8081 tcp:8081`; select Llama-3.2-1B Q8_0 (already downloaded) with AUTO;
   logcat must show the hexagon_opencl lib loading (no libcdsprpc error) + HTP devices;
   badge must flip to ⚡NPU; then tok/s CPU vs GPU vs NPU; test agentic chat stream in
   the same pass. Update tracker gates + UI-Registry with results.

## Open questions

- Does `librnllama_jni_v8_2_dotprod_i8mm_hexagon_opencl.so` now link with the manifest
  fix, and do HTP0..N devices register? (Expected yes — SM8750 is in llama.rn's known
  list; libcdsprpc.so exists on Samsung vendor partition.)
- LiteRT NPU remains experimental (needs NPU-built .litertlm via Edge Gallery).

---

# Session B — Agentic Chat: Phase 6 (APK port) COMPLETE

Last updated: 2026-07-07

Multi-session upgrade turning the **main Omnecor chat (web + APK)** from symmetric
bubbles into an agentic, Claude-Code-style stream. Phased checklist + progress log live
in `Chats-Agentic-Upgrade.md` (repo root); fullest persistent detail in
`chats-agentic-upgrade.md` (auto-memory). **Phases 0–5 (web) + Phase 6 (APK) are DONE.**
This session ported the whole feature to the APK. Gates: APK `tsc`/`eslint` clean · root
`pnpm check` clean · root `pnpm test` **1315 passed | 4 skipped**. Owner framing: mobile =
the **Claude-Code-APK experience** — you remote-control the PC-side agent from the phone;
on-device *phone* models are text(+reasoning) only (no tool loop).

## What was built (Phase 6 — this session)

All under `packaging/android/omnecor-hq/` unless noted:
- **Transport (the spine):** `lib/trpc.ts` → `getAgentTrpc()` — lazily-built, base-URL-cached
  `createTRPCProxyClient` with `splitLink` → `wsLink`(subscriptions, to the token-authed
  `/ws`, `lazy` socket) + `httpBatchLink`. Extended the self-contained stub
  `lib/_core/app-router.ts` with `aiProvider.{agentChatStream,resolveToolApproval,runCodeSnippet}`
  (agentChatStream typed via an **async-generator stub** returning `AgentStreamEvent` so
  `.subscribe()` infers it — deliberately NOT importing the real server `AppRouter`, which
  would drag the whole server type-graph into the mobile tsc).
- **Shared contract:** `lib/_core/agent-blocks.ts` re-exports the pure `shared/chatBlocks.ts` +
  `shared/chatAgentEvents.ts` via **relative path** (`../../../../../shared/…`; Metro already
  watches the workspace root, so runtime helpers bundle). `lib/_core/agent-stream.ts` vendors
  the pure `applyAgentEvent`/`applyJobCompletion` reducer. `ChatMessage` gained `blocks?`/`error?`.
- **Server fix (found on sight, real prod gap):** the tRPC WS path
  (`applyWSSHandler`→`createContext`→`sdk.authenticateRequest`, cookie/Bearer ONLY) never read
  the mobile `?token=` query param → subscription authenticated under zero-login but would 403 in
  prod. New `server/core_services/websocket/wsAuthBridge.ts` promotes `?token=`→`Authorization:
  Bearer` in the WS `createContext` wrapper (guarded; cookie/Bearer callers untouched). 7 unit
  tests (`server/__tests__/wsAuthBridge.test.ts`).
- **Renderers:** `components/agentic/assistant-stream.tsx` (flush-left guide-line stream via
  `react-native-markdown-display`, one **shared** `Modal` overlay, typewriter `LoadingQuote`
  tail, fenced-code ▶Run/⚡Preview) + `components/agentic/agentic-blocks.tsx` (`StatusDot` via
  shared `blockDotIntent`, command/edit/job/mcp `ToolChip`, inline `ApprovalRow`→
  `resolveToolApproval`, dependency-free LCS `computeLineDiff`, `ThinkingSection`).
- **On-device streaming:** `runInference`(GGUF, delta `onToken`) + `generateTask`(LiteRT,
  cumulative `onToken`) already streamed — wired into a text/thinking block fold with `<think>`
  parsing. `ommesh`/non-agent providers fall back to the non-streaming `ai.chat` one-shot.
- **Rewrote `app/(tabs)/index.tsx`:** agentic renderItem, message queue (component-state FIFO,
  tap-a-chip to recall — no hardware ↑ on touch), drain-on-idle (held on error, drains on Stop),
  Run(→PC `runCodeSnippet`, JobBlock)/Preview(WebView), `asyncjob:all`→`applyJobCompletion`,
  debounced+flush-on-unmount persistence. Preserved all prior session/model/map/persona/
  attachment/voice behavior.
- **Quote parity + settings:** `LoadingQuote` rebuilt on `lib/_core/quote-bag.ts` (module-scoped
  no-repeat shuffle bag) + typewriter; 3 quote styles + show/hide + `autoApproveTools` shield
  surfaced in the chat UI (`hooks/use-chat-display-settings.ts` gained `autoApproveTools`).
- **Docs:** `Chats-Agentic-Upgrade.md` Phase 6 ✅ + 2 progress rows; UI-Registry **Session 32**
  (`/imprint`); Progress-Tracker Current-Status entry.

## Decisions made

- **Transport = real tRPC WS client**, not a custom WS-frame bridge (APK already ships
  `@trpc/client` + `superjson`; reuses the exact reducer + `resolveToolApproval` mutation).
- **Vendor the pure reducer + quote-bag** (not cross-import from `client/src/`) — matches the
  APK's self-contained `app-router.ts` philosophy; contract TYPES come from shared so they can't
  drift. Relative shared import chosen over adding a `@shared` Metro/tsconfig alias (lower risk).
- **On-device replies stream** (owner chose parity); Run/Preview **included** (owner). Diffs/
  cmd-output **collapsed/simplified on mobile** (Claude-APK style) — LCS line-diff, no full patch.
- **HITL via HTTP** `resolveToolApproval` mutation (only the event stream needs the WS).

## Problems solved (do NOT re-solve)

- Async-generator subscription stub is enough to type `.subscribe()` as `AgentStreamEvent` —
  no `@trpc/server/observable` import, no server type-graph. Verified: APK `tsc` exit 0.
- **`/review` found + fixed 5:** (important) assistant markdown `image` rule was rendering a
  text link → restored real `<Image>`; (important) Stop+queue on a *phone* turn could fire a 2nd
  native completion on the single engine (Hermes SIGSEGV) → `startPhoneStream` now waits for both
  engines idle before touching the model; (minor) `RUN_LANGS` trimmed to the server's real
  `resolveInterpreter` set (dropped `tsx`/`zsh`); (minor) persistence flush-on-unmount; (minor)
  removed dead `blockSubtitle`.

## Current state

Web agentic chat: fully functional + live-verified (prior sessions). APK agentic chat:
**code-complete, all static gates green, NOT yet run on device.** Nothing partial in code.

## Next session starts with

1. **The single APK rebuild** (see Session A steps) — it now tests BOTH the NPU manifest fix
   AND the agentic chat. On-device verify: pair against a dev server (adb reverse + ZERO_LOGIN),
   drive a PC chat → confirm the WS stream types out, a command/edit box appears and **Approve/
   Deny from the phone** works, ▶Run returns a JobBlock, ⚡Preview opens the WebView, the queue
   type-ahead + chip-recall work, and reasoning/quotes render.
2. **Phase 7 close-out:** `pnpm build` + `pnpm audit --prod` (don't need the device), then finish
   the Progress-Tracker + `/remember save`.

## Open questions

- **`wsAuthBridge` isn't exercised by the zero-login on-device test** (zero-login bypasses
  `authenticateRequest`) — covered by the 7 unit tests instead; a real-token prod session would
  be the true end-to-end check.
- On-device Stop→queue concurrency is now guarded (wait-for-idle), but the abandoned native
  generation still runs to completion in the background (wasted compute, not a crash).
- Carried: `runCodeSnippet` run-path is live-verified (web) not route-tested; no RN DOM test
  harness in the APK — mobile verified by typecheck + lint + on-device driving.
