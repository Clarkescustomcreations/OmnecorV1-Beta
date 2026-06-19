# Memory — Voice Pipeline Experience & Phase 5 Integration

Last updated: 2026-06-18T18:57:00-03:00

## What was built

- **PC-Side WebSocket Voice Orchestration:** Wired client handlers for `voice:audio_input` and `voice:interrupt` inside [WebSocketServer.ts](file:///home/linux/Documents/OmnecorV1-Beta/server/phase2/websocket/WebSocketServer.ts).
- **Workstation Busy Verification:** Implemented `isBusy()` to scan running jobs (LoRA training, Blender renders, ESP flashing) to determine node utilization.
- **OMMESH Failover and Queueing:** Deployed failover checks inside `voice:audio_input` to route LLM inference to idle OMMESH nodes when the local server is busy, or queue request slots locally for up to 60s when no peers exist.
- **Sentence-Segmented Synthesis Stream:** Deployed a regex sentence chunking loop that feeds punctuation-segmented sentences sequentially to `VoiceService.getInstance().synthesize` (and optional RVC post-processing), broadcasting base64 chunks directly back to the client.
- **Default Audio Seeding:** Added startup copying/generation for a fallback `data/default.wav` speaker profile in [index.ts](file:///home/linux/Documents/OmnecorV1-Beta/server/_core/index.ts) to prevent synthesis engine path failures.
- **Mobile Voice Fallback Timeout:** Tuned the client fallback timeout in [always-listen.ts](file:///home/linux/Documents/OmnecorV1-Beta/packaging/android/omnecor-hq/lib/_core/always-listen.ts) from 4s to 8s.

## Decisions made

- **Dynamic Voice Service Routing:** Routed voice synthesis through the singleton `VoiceService` abstraction to delegate engine-specific payloads (Kokoro vs XTTS-v2), avoiding raw HTTP `fetch` logic inside the websocket socket controller.
- **Fail-Safe Active Status Verification:** Configured `voice:interrupt` client signals to abort active async loops mid-execution, preventing wasted server inference.

## Problems solved

- **High-Latency Native TTS Triggers:** Solved premature triggering of mobile offline TTS during slow Tailscale route resolution by increasing the fallback timeout to 8 seconds.
- **Speaker Profile Path Failures:** Handled synthesizer crashes on fresh workspaces when no custom WAV speaker profile exists by auto-seeding `default.wav` at boot.

## Current state

- **Verification Status:** `pnpm check` and `pnpm test` both pass successfully (350/350 tests green).
- **Production Readiness:** `pnpm build` successfully compiled the production client and backend bundles in 53.95s.

## Next session starts with

- Physical device sideloading and always-listening wake word testing (F27 Android leg).
- Network-level OMMESH testing with mobile nodes.

## Open questions

- None.
