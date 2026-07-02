# Memory — Session-29: Batch F/G tails, Batch H (live UI), Batch I (real voice bridges) + 2 bug fixes

Last updated: 2026-07-01

## What was built
Continuation of the Verification-Pass roadmap, now driving **live** infra (not just harness tests).

- **Batch F tail** — `server/__tests__/gmailRouter.test.ts` (17): `gmail.status` + `gmail.sendEmail` via real router + stubbed `fetch`/`oauthClients` (config/connection guards, Bearer token + `/messages/send` endpoint + decoded RFC-2822 body, refresh-on-401 rotation persisted to DB, ownership isolation, Sovereign gate).
- **Batch G tail** — a `routers.ts`-vs-test-file audit found the last **6 registered routers with no route-level test**; all added: `discoveryRouter`(8), `jobRouter`(14), `workflowRouter`(8), `penpotRouter`(6), `ommeshRouter`(13), `systemRouter`(16). **Every registered router now has route-level coverage.**
- **Batch H (live web UI)** — scratchpad Playwright drivers (`batch-h-driver.mjs`, `chat-ai-driver.mjs`, `abort-driver.mjs`). Drove 13 authenticated feature pages (prod build + seeded owner cookie); each renders real content + fires its distinct backend tRPC queries (all 200, 0 console errors). Chat loop end-to-end incl. a **live Ollama token stream** from the LAN server.
- **Batch I (real voice bridges)** — `server/__tests__/voiceBridges.test.ts` (3, ComfyUI auto-skip): `voice.transcribe` via real `whisper_server.py` (faster-whisper) → espeak clip "testing one two three four five" → "Testing 1,2,3,4,5"; `voice.synthesize` via real `tts_server.py` (XTTS-v2, CPU ~65s) → audio. Both through the real router.
- **Bug fix TD-047** — `server/_core/streamEmit.ts` (`guardedEmit`) + `server/__tests__/streamEmit.test.ts` (6); wired into all 3 `chatStream` subscriptions (`aiProviderRouter.ts`, `aiRouter.ts` ommesh+main).
- **Bug fix valet timeout** — `ValetRouterService.ts` (`VALET_ROUTE_TIMEOUT_MS`, default 60s) + `valet_router_inference.py` (`VALET_OLLAMA_TIMEOUT`, default 120s).
- **requirements.txt** — added 4 missing deps: `python-multipart`, `torchaudio`, `transformers>=4.57,<5`, `torchcodec`.
- Docs: `Context/Tracker-Docs/Verification-Pass.md` fully reconciled (Batch H/I sections + counts); `Context/Tracker-Docs/Tech-Debt.md` TD-047 added.

## Decisions made
- **AGENTS.md tier note corrected**: `externalServiceProcedure` is the CURRENT correct tier for non-AI external services (email/sync/OAuth/payments); do NOT downgrade to `cloudProcedure` (would wrongly block non-AI in "block AI only" sovereign sub-mode).
- **Batch H auth = seeded owner cookie + PROD server** (Option B via `server/scripts/dev-seed-user.ts`), because zero-login is (correctly) forbidden in production and the httpOnly cookie needs Playwright `addCookies` (chrome-devtools MCP can't set it). Bypass the wizard by pre-setting `localStorage["omnecor:setup_complete"]="true"` (client-side gate, not DB).
- **TD-047 fix approach = guard + cancel**: `guardedEmit` drops emits after teardown/complete and swallows the closed-controller throw; loop breaks on `g.closed`.
- **Valet timeouts generous + configurable** (user: local models are expected to be slow; lag is acceptable). True LLM valet routing needs the **fine-tuned** router model — general ollama models don't emit the routing JSON, so it falls back to (correct) rule-based classification.
- Voice ML deps live in a dedicated venv at `/home/linux/omnecor-bridges/venv` (NOT system python / NOT the esptool venv). Run bridges with that venv's python.

## Problems solved
- **`pkill -f "<pattern>"` self-matches its own shell argv** → kills the shell (exit 144). Use `fuser -k <port>/tcp` or a bracket trick that isn't ALSO in the launch line.
- **Standalone `node dist/index.js` can't resolve `@libsql/linux-x64-gnu`** (pnpm doesn't hoist the transitive optional native dep). Workaround: `NODE_PATH=…/.pnpm/@libsql+linux-x64-gnu@0.5.29/node_modules`.
- **Ollama URL read from TWO settings sources**: `systemRouter` reads `PATHS.base/settings.json`; `AiProviderService.getOllamaUrl` reads the canonical **SettingsService** at `homedir()/.omnecor/settings.json` (NOT affected by `OMNECOR_DATA`). They can disagree — status showed LAN, inference hit localhost. To point inference at a server without touching real config: isolate `HOME` to a temp dir with a `settings.json` containing `OLLAMA_BASE_URL`.
- **Real STT/TTS servers are in `server/phase2/python_scripts/`** (`whisper_server.py`:8001, `tts_server.py`:8002) — NOT `server/python_bridges/` (that `voicebox_bridge.py` is a silence STUB; `rvc_server.py` has stubbed tensor math).
- **TTS dep chain**: coqui-tts needs `transformers>=4.57,<5` (5.x removed `isin_mps_friendly`; 4.49 lacked `is_torchcodec_available`), plus `torchaudio` + `torchcodec` (torch≥2.9 audio IO) + `python-multipart` (whisper file uploads).
- **TTS path allow-list mismatch**: `tts_server.py` validates the speaker WAV against `SPEAKER_WAV_ROOT` (default `assets/speakers`); Node `validatePath` requires it under `PATHS.data`. Start TTS with `SPEAKER_WAV_ROOT=$(pwd)/data/data` so both agree.
- **XTTS runs CPU** here (nvidia driver 12020 too old for this torch/CUDA build); ~65s synth for a short sentence, within the 120s test timeout.

## Current state
- **Suite: 1128 passing + 1 skipped (comfyRouter) = 1129 across 103 files** (voice + valet bridges live). `pnpm check` 0 errors; prod build clean.
- **Live processes still running** (kept up for the tests): prod server :3000, valet inference :8010 (ollama backend), whisper :8001, tts :8002. Tear down with `fuser -k <port>/tcp`.
- Voice servers launched from the venv, e.g. `WHISPER_MODEL_SIZE=base WHISPER_DEVICE=cpu WHISPER_COMPUTE_TYPE=int8 <venv>/bin/python server/phase2/python_scripts/whisper_server.py`; TTS with `COQUI_TOS_AGREED=1 SPEAKER_WAV_ROOT=$(pwd)/data/data <venv>/bin/python .../tts_server.py`.
- **NOTHING COMMITTED** — user is "keep holding". Uncommitted: this session's 2 bug fixes + streamEmit/voiceBridges tests + requirements.txt + doc updates, ON TOP of the earlier 8 router test files (gmail/discovery/job/workflow/penpot/ommesh/system + Batch F/G work). All green.

## Next session starts with
1. **`agent.runCrew`** (last open Batch I item) — needs `crewai` installed in the bridges venv + `recursive_mas_bridge.py` (:8011) running; then an auto-skip integration test.
2. Optionally deeper **Batch H per-widget interactions** (scope filters, sliders, toggles, Wallet HITL dialog, Settings persistence writes) — render + read wiring already proven for all 13 pages.
3. Decide on **committing** the accumulated work (user gate).

## Open questions
- Commit strategy: user said "keep holding" — when to commit, and as one branch or split (bug fixes vs test files)?
- Whether to fix the two surfaced findings: the libSQL standalone-bundle resolution gap, and unifying the two Ollama settings sources (status vs inference).
- Whether to build the real valet fine-tuned-router flow (vs. rule-based) for true LLM routing.
