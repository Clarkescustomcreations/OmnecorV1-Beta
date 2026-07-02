# Omnecor — Verification Pass
**Source of Truth: What Is Known Working vs. What Is Untested**

> Last updated: 2026-07-02 (Session-31) | Test suite baseline: **1193 tests passing, 1 skipped** (= 1194 total) across 106 test files (re-measured 2026-07-02 via `pnpm test`, after the Session-31 second verification pass). **Session-31 (2026-07-02) — second pass + doc-accuracy audit:** re-ran all gates (`pnpm check` 0 errors; suite re-measured green at the 1134 baseline before changes), then (a) **audited every doc row against the actual routers** and removed/corrected **6 phantom procedures that do not exist in the code** (`security.getThreatReport`, `security.getAuditSummary`, `job.getResult` (it's `getStatus`), `discovery.refreshFeed`, `ommesh.revokePeer`, `ommesh.getTopology`) plus stale 🧪/🔬 statuses left behind after Batch G landed (job/discovery/ommesh/workflow/penpot/system sections now reflect their real test files); and (b) **converted the remaining no-dependency 🧪/🤖 rows to ✅ with +60 new tests across 8 files** (2 new files): `comfyRouterMock.test.ts` (11 — ComfyService-mocked delegation + bridge-offline INTERNAL_SERVER_ERROR mapping for queuePrompt/getQueue/getSystemStats/interrupt/clearQueue), `pairingRouter.test.ts` (8 — route-level createCode QR payload + device-role FORBIDDEN, listDevices per-user ordering, revokeDevice ownership + in-memory revocation), `securityRouter.test.ts` 12→29 (scanFile/scanDirectory/encryptFile/decryptFile/generateProjectKey/createBackup/restoreBackup/listBackups/runVulnerabilityScan — real `validatePath` gate + delegation + threat-aggregation math), `platformsRouter.test.ts` 9→14 (getPublishingRouting webhook config incl. sovereign+remote-n8n blocked flag; setWebhookPath admin gate + slash-trim + default-restore, settings isolated via `__testSettingsPath`), `virtualCardRouter.test.ts` 11→14 (revealCardPan sovereign gate / delegation / null→NOT_FOUND), `integrationsRouter.test.ts` 14→17 (updateSettings sovereign gate, not-connected NOT_FOUND, settings persisted + metadata merge), `projectRouter.test.ts` 10→16 (**real-fs happy paths** under `PATHS.projects`: writeFile→readFile round-trip, missing-file BAD_REQUEST, getFileTree children/non-dir/traversal, registerProject resolved-path handoff), `ollamaRouter.test.ts` 6→13 (listModels/runningModels/modelInfo/createModelfile against a mocked daemon: payload mapping, `Ollama error: <status>` mapping, empty-safe). **Session-30 (2026-07-02):** the user reported the Chats page "Terminal/CLI" (EmbeddedTerminal.tsx — the live xterm.js + node-pty shell, distinct from the Docker "Sandboxed" terminal) couldn't run commands at all. Root cause: the client (`EmbeddedTerminal.tsx`) and server (`WebSocketServer.ts`) had **independently duplicated, silently-drifted** `pty:*` WS message shapes — every keystroke was sent as a bare string where the server expected `{input: string}`, so `message.data.input` was always `undefined` and **no input ever reached the shell**. Fixed by extracting the shared contract into `shared/types/terminal.types.ts`, imported by both sides (drift is now a compile error, not a silent runtime bug), plus fixing `pty:output`/`pty:exit` parsing and adding a previously-unhandled `error` message case. Also found and fixed, in passing: `server/phase2/services/MeshDiscoveryService.ts` (a legacy duplicate mDNS advertiser) had no `error` listener on its bonjour service, so any node-name collision on the LAN (trivially reproduced by running two Omnecor instances) threw an unhandled `error` event and **crashed the entire server process** — mirrored the existing fix already present in `server/ommesh/core/DiscoveryService.ts` for the identical bonjour quirk. Then built the previously-unwired **"AI can push a command into your terminal"** feature end-to-end: system prompt discloses a `<terminal_command>` directive only when the terminal is open (non-fiction-mode only); `client/src/lib/terminalDirective.ts` extracts it from a completed assistant message and strips it from the displayed/persisted text; `omnecor:cli_command` CustomEvent dispatch; `EmbeddedTerminal.tsx` gates it through the **same** `requestApproval()` HITL flow as manual typing (AI-initiated commands are never trusted more than typed ones) before writing to the PTY, auto-opening the terminal via a new `onRequestOpen` prop if it wasn't already visible. The insecure, dead `chat:toTerminal` WS message type (bypassed HITL entirely, never sent by any code path) was removed. All of this was **live-verified via chrome-devtools MCP** against the real dev server: manual typing (`echo` round-trip through a real bash PTY with the user's actual shell MOTD), HITL approval/denial, and the AI-initiated bridge (dispatched with the terminal closed → HITL dialog fired → approved → terminal auto-opened → command executed with real output) all confirmed working. Added `client/src/lib/terminalDirective.test.ts` (5 tests) for the new parser; a full WS+PTY integration test was assessed but not added — `OmnecorWebSocketServer`'s constructor calls the real `createContext()`/`getDb()` (not the isolated in-memory `createTestDb()` harness other router tests use) plus 7 singleton services, so it would touch the real `~/.omnecor/data/omnecor.db` — unsafe without harness work first (see Section 12 backlog). **ESP32 hardware fully closed 2026-06-30:** `esp.compile` (arduino-cli) + `esp.flash` were driven through the real tRPC router against a physical ESP32-D0WD-V3 — merged image flashed at `0x0`, board rebooted and BLE-advertised `OMNECOR_TEST_OK` (confirmed over serial). Fixed a real flash bug in passing: `esptool_bridge.py` hardcoded offset `0x1000` (bootloader slot) which left any app image unbootable — offset + chip are now plumbed params (default `0x0`). This includes the **Batch G** harness-driven router tests — **complete** (the final 4 routers `pcbEditor`/`podcast`/`aiProvider`/`integrations` landed this pass) — and **Batch D** DB-schema tests (`dbSchema.test.ts`), which surfaced and fixed a **real cascade bug**: 6 child tables of `neural_maps` had NO-ACTION FKs in the actual DB (added via `ALTER … ADD COLUMN … REFERENCES`, which silently drops the action) despite `schema.ts` declaring `onDelete: cascade`, so deleting a non-empty project/map threw a FK error and orphaned its rows. Fixed by migration **0014** (rebuilds the 6 tables with real `ON DELETE cascade`) **plus** an atomic app-level `db.batch` cascade in `neuralMaps.delete` (belt + suspenders). Also the social-publishing changes: `PublishingService` rewritten to a hybrid (n8n webhook for X/LinkedIn/Facebook/Instagram + native Bluesky/Mastodon/Discord/Telegram), new `WebhookPublisher`, a `publishNow` IDOR fix and `addAccount` idempotency. Then **Batch E** (AI harness paths) landed `valetRouter.test.ts` (route/getMoeChain/saveMoeChain/initMoeChain/scanLocalModels against a stubbed classifier + mocked GGUF scan) and the `ai.chat` **map-RAG-injection** path (augmented messages forwarded to the provider). **Batch F (Agentic Wallet / Lithic)** landed `virtualCardRouter.test.ts` (ownership + **PAN-safety** on getCard/listCards, issueCard sovereign gate + not-configured + HITL approve/deny + 1/60s rate limit) and an **in-suite Lithic mock** for `VirtualCardService.listTransactions` (env-switched `LITHIC_API_BASE` → fake host, response mapping, ownership/error paths — no money). Batch F also landed `oauthRouter.test.ts` — the OAuth code flow against the **real DB + real PKCE state store**: getAuthorizationUrl persists state+verifier and sends a matching SHA-256 **PKCE challenge**, handleCallback validates state (bogus/cross-user/TTL → BAD_REQUEST) and persists the account, disconnectAccount enforces ownership; in passing, fixed a catch-all that masked inner `TRPCError` codes (UNAUTHORIZED/BAD_REQUEST) in both procedures. **Batch I (Python-bridge routers)** landed `voiceRouter.test.ts` (Whisper/TTS/RVC health aggregation + **bridge-offline degradation**: unreachable→PRECONDITION_FAILED, missing→NOT_FOUND, bad-wav→BAD_REQUEST; ElevenLabs cloud sovereign gate) and `agentRouter.test.ts` (crew/liteAgent/n8n delegation + **RecursiveMAS HITL gate** for >3-agent crews + stop-via-processManager). The 4 bridge-gated suites — `comfyRouter` (1), `blenderRouter` (3), `kicadRouter` (3), `espRouter` (6) — auto-skip individually when their tool is absent (only `comfyRouter` skipped on this run; 1120 passing / 0 skipped with ComfyUI up). **Batch F tail closed 2026-06-30:** `gmailRouter.test.ts` (17) drives `gmail.status` + `gmail.sendEmail` end-to-end against the real DB + a stubbed `fetch`/`oauthClients` — config/connection guards, the Bearer token + endpoint + RFC-2822 payload actually sent, **refresh-on-401 token rotation persisted to the DB**, API-error mapping, per-user ownership isolation, and the Sovereign gate. **Batch G tail closed 2026-07-01:** a router-coverage audit (every namespace in `routers.ts` vs. its test file) found **6 registered routers with no dedicated route-level test** — now added: `discoveryRouter` (8, article-feed filters + ingest), `jobRouter` (14, HITL command gate + cwd validatePath + admin gates), `workflowRouter` (8, the review/remember/imprint skill-commands — real git diff, secret-redacted memory.md write, `validatePath` traversal reject), `penpotRouter` (6, identifier-regex filename guard), `ommeshRouter` (13, mesh control + admin gates + crossNodeSync/agentDiscourse persist→read-back) and `systemRouter` (16, health/config-status booleans-not-secrets + settings round-trip incl. the admin-only `sovereignBlockAiOnly` guard + RBAC + DB user-admin). Every registered router now has route-level coverage — bringing the suite to 1119 passing across 101 files. **Session-29 (2026-07-01) — live-driven Batch H/I + 2 real bug fixes:** drove the authenticated web UI headless (13 feature pages render + fire their real backend tRPC queries; chat loop end-to-end incl. a **live Ollama token stream** on the LAN server) and stood up the **real voice bridges** — `voiceBridges.test.ts` transcribes an espeak clip via `whisper_server.py` (faster-whisper) and synthesizes speech via `tts_server.py` (XTTS-v2), both through the real router (auto-skip pattern), which required fixing 4 missing `requirements.txt` deps (python-multipart, torchaudio, transformers `>=4.57,<5`, torchcodec). Fixed **two real bugs found live**: **TD-047** — any AI stream timeout/disconnect crashed the whole server (`ERR_INVALID_STATE: Controller is already closed`), now guarded via `guardedEmit` across all 3 `chatStream` subscriptions (+6 unit tests); and the Valet **5s route timeout** (too short for local/thinking models → constant fallback), now `VALET_ROUTE_TIMEOUT_MS` (60s) + bridge `VALET_OLLAMA_TIMEOUT` (120s). Suite now **1128 passing + 1 skipped = 1129 across 103 files** (voice + valet bridges live; comfyRouter skipped without ComfyUI).
>
> **Goal:** Every row in this document eventually reaches ✅ VERIFIED. Work from top (auto) to bottom (manual).
> Anyone reading this document should know in 30 seconds what is verified, what is automatable, and what needs a human or hardware to test.

---

## Status Legend

| Symbol | Meaning |
|---|---|
| ✅ VERIFIED | Automated tests exist and pass; behavior is confirmed correct |
| 🔬 PARTIAL | Some tests exist but critical paths are untested |
| 🧪 AUTOMATABLE | No tests yet — can be unit/integration tested without external services or browsers |
| 🤖 HARNESS-DRIVABLE | No test yet, but verifiable by **driving the live Omnecor harness as the agent/model** — tRPC `createCaller`, the dev server under `ZERO_LOGIN_MODE`, AI-model injection (a stub provider or local Ollama), a local Python bridge used file-in/file-out, the available `chrome-devtools` MCP for real page render/interaction, or an OAuth **emulator skill** (`google`/`microsoft`). No human, no hardware, no paid credentials. This is the primary convert-to-✅ target (see Section 12). |
| 🌐 MANUAL REQUIRED | Requires real **paid** credentials with side effects (live OAuth provider, real Gmail/Twitter/Lithic/PCBWay) or a one-off human visual judgement that resists scripting |
| 🤝 HARDWARE (collaborative) | A real device / multi-machine setup that **exists but needs a live joint session**: ESP32 over USB, audio I/O, arm64 phone (LiteRT-LM), 2-node OMMESH mTLS, or local GPU training on the RTX 4060 (8 GB). **Not hard-blocked** — scheduled last, done together. |
| ⛔ BLOCKED | Truly unavailable resource — training beyond the local GPU's reach (70B-class / multi-GPU full fine-tune) or a paid service with no emulator. After the 2026-06-30 reclassification this bucket is nearly empty. |
| ❌ BROKEN/UNKNOWN | Known to be broken or state is unknown |

---

## Section 1 — Current Automated Test Suite (1193 passing, 1 skipped, 106 files)

All tests run with `pnpm test`. This section is the ground truth for what is actually automated today. Per-section totals: **1.1 = 785, 1.2 = 128, 1.3 = 196, 1.4 = 85 → 1194.** Authoritative live `pnpm test` (2026-07-02, after **Session-31** added +60 tests: `comfyRouterMock.test.ts` (11) + `pairingRouter.test.ts` (8) new, and securityRouter/platformsRouter/virtualCardRouter/integrationsRouter/projectRouter/ollamaRouter extended) = **1193 passing + 1 skipped (comfyRouter, ComfyUI absent this run) = 1194**; with ComfyUI also running it is 1194 passing / 0 skipped.

### 1.1 Server — Router & Core Tests (79 files, 785 tests)

| Test File | Tests | What Is Covered |
|---|---|---|
| `server/__tests__/aiRouter.test.ts` | 21 | SSRF `baseUrl` guard, invalid provider/empty-message rejection, session ownership (getSession/getSessions/saveMessage/summarizeAndPruneSession IDOR), loop-violation audit event, **map-RAG injection** (augmented messages/systemPrompt forwarded to provider) |
| `server/__tests__/authRouter.test.ts` | 4 | `auth.me` — strips passwordHash, returns null when unauthed; `auth.acceptTos` — records acceptance, idempotent re-acceptance |
| `server/auth.logout.test.ts` | 1 | `auth.logout` — clears session cookie |
| `server/__tests__/chatRouter.test.ts` | 15 | Auth boundary (UNAUTHORIZED), session CRUD (create/read/update/delete), per-user isolation (listSessions), FK cascade on deleteSession, message CRUD + ownership, role validation, bulkImport upsert |
| `server/__tests__/datasetRouter.test.ts` | 11 | Auth boundary, discoverSources (local + online_search), sovereign block on online search, listUnprocessedSources, curateSourceItem, listCuratedExamples, updateCuratedExample (found + NOT_FOUND), compileDataset |
| `server/__tests__/discoveryService.test.ts` | 2 | OMMESH peer lookup by name, self-exclusion |
| `server/__tests__/gmailMessage.test.ts` | 4 | `buildRawMessage` — well-formed headers/body, CR/LF header injection strip, RFC-2047 non-ASCII subject encoding |
| `server/__tests__/gmailRouter.test.ts` | 17 | **Batch F (tail).** `gmail` (oauthClients + `fetch` stubbed, real DB): auth boundary; `status` configured/connected/accountName (inactive row excluded); `sendEmail` guards (not-configured→PRECONDITION_FAILED + no-fetch, no-account, inactive-only, malformed recipient rejected pre-network); **send path** (Bearer token + `/messages/send` endpoint + decoded RFC-2822 To/Subject/body, null-id passthrough, most-recent active account); per-user **ownership isolation** (never sends via another user's account); **refresh-on-401** retry with rotated token **persisted to the DB** + no-refresh-token→INTERNAL_SERVER_ERROR; non-OK Gmail response→INTERNAL_SERVER_ERROR (`Gmail API <status>`); Sovereign gate (externalServiceProcedure)→FORBIDDEN before any send |
| `server/__tests__/discoveryRouter.test.ts` | 8 | **Batch G (tail).** `discovery` (ArticleDiscoveryService mocked, real DB): auth boundary; listUnprocessed (isProcessed=0 only, newest-first, limit, projectId scope); getArticle by id + null; markAsProcessed flips + drops from feed; fetchArticles ingest-then-return + **surfaces ingest failure** (no masking) |
| `server/__tests__/jobRouter.test.ts` | 14 | **Batch G (tail).** `jobs` (ctx.services processManager/hitl/docker + AsyncJobService stubbed): auth boundary; getStatus found/NOT_FOUND/non-UUID; startAsync **HITL "command" gate** (approve→raw-capture spawn w/ arg-array + track; deny→FORBIDDEN carrying reviewer reason, no spawn) + **cwd validatePath traversal reject**; list type/state filters; cancel BAD_REQUEST on unknown; **admin gate** on runSandboxCommand (arg-split) + prune |
| `server/__tests__/workflowRouter.test.ts` | 8 | **Batch G (tail).** `workflow` (skill-commands; AiProviderService mocked, FS isolated to temp `OMNECOR_DATA`): auth boundary; reviewContext (real `git diff` + plan excerpts); rememberSave (Valet compression + **secret-redaction** of memory.md + on-disk write + model-failure→INTERNAL_SERVER_ERROR); rememberRestore (absent→null, round-trip read-back); imprint (className extraction into ui-registry.md + **`validatePath` traversal reject**) |
| `server/__tests__/penpotRouter.test.ts` | 6 | **Batch G (tail).** `penpot` (PenpotService mocked): auth boundary; configure forwards url+token + rejects non-URL; generateComponent forwards ids/name + returns filePath + **identifier-regex componentName guard** (blocks `../evil`, `foo/bar`, spaces, leading-digit — the name is used as an output filename) + service-failure propagation |
| `server/__tests__/ommeshRouter.test.ts` | 13 | **Batch G (tail).** `ommesh` (meshNode mocked, `~/.omnecor/settings.json` isolated to temp `HOME`): auth boundary; discover/getIdentity/routeInference (options default `{}`); **admin gate** on approvePeer (fingerprint pin) + rotateCert (force forwarded); sendPeerDiscourse forwarding + >8000-char reject; crossNodeSync/agentDiscourse **persist→read-back** round-trip incl. toggle-one-preserves-other |
| `server/__tests__/systemRouter.test.ts` | 16 | **Batch G (tail).** `system` (`../db.js` getDb + AuditLogService mocked, settings isolated to temp `HOME`/`OMNECOR_DATA`): health bounded cpu%; settings round-trip (getSettings null→persist; **saveSettings strips admin-guarded `sovereignBlockAiOnly`**); setSovereignBlockAiOnly admin gate + persist; config-status **booleans/urls never leak secrets** (aiProviders/loginProviders/oauthStatus flip on saved creds; integrationsStatus platforms+configured+callbackBase); getMyPermissions RBAC; setExecutionMode DB write; listUsers admin-gate + safe-columns; setUserRole admin-gate + role write + **self-demotion guard** |
| `server/__tests__/streamEmit.test.ts` | 6 | **TD-047 regression.** `guardedEmit` — the crash-safe wrapper for tRPC subscription emits: forwards next/complete while open then reports `closed`; drops emits after complete()/teardown close(); **swallows a closed-controller throw from emit.error without rethrowing** (the exact crash); stops forwarding once emit.next throws; only the first terminal signal wins. Guards `aiProvider.chatStream` + `aiRouter.chatStream` (ommesh+main) against the emit-after-disconnect server crash |
| `server/__tests__/voiceBridges.test.ts` | 3 ✅ (skips w/o servers) | **Batch I (real STT/TTS).** ComfyUI-style auto-skip integration: `voice.transcribe` through the real router against `whisper_server.py` (faster-whisper base/int8/cpu) — an espeak-ng clip "testing one two three four five" → "Testing 1, 2, 3, 4, 5" (lang=en) + NOT_FOUND mapping; `voice.synthesize` against `tts_server.py` (XTTS-v2, CPU) → audio produced from text w/ the clip as voice-clone reference (~65s). Auto-skips when the servers/espeak-ng are absent. Needs `SPEAKER_WAV_ROOT=$(pwd)/data/data` so the TTS server's allow-list overlaps the Node `validatePath` dir |
| `server/__tests__/oauthClients.test.ts` | 8 | OAuth client configuration (per-call resolution via SettingsService, env→settings precedence) |
| `server/__tests__/pairing.test.ts` | 9 | PairingService: 6-digit code issue, unknown-code rejection, single-active-code-per-user, redeem-once, QR path, stable deviceId derivation, fresh-code re-pair clears revocation, OMMESH auto-pair sticky revocation |
| `server/__tests__/pcbFabrication.test.ts` | 6 | `zipArchive.createZip` round-trip, `kicadBoardSpecs`: bounding box, copper layer count, board specs, layer-count snap, fallback to prototype defaults |
| `server/__tests__/processManagerCapture.test.ts` | 3 | ProcessManagerService: raw capture mode (stdout tail + JSON progress), default json mode (no tail), ring-buffer cap |
| `server/__tests__/ragContext.test.ts` | 2 | `injectMapRagContext` passthrough guards (no mapId, no authenticated user) |
| `server/__tests__/redaction.test.ts` | 11 | `redactSensitive`: Visa PAN (Luhn), hyphen/space PAN, non-Luhn false positive, JSON pan/cvv fields, JWT, Bearer header, PEM private key, opaque OAuth token, Lithic error body, empty input |
| `server/__tests__/remoteSourceIngest.test.ts` | 18 | `sanitizeCollectionName`, `hasTextExtension`, `htmlToText` (tag strip + entity decode), `extractGmailBody` (text/plain, multipart, html-only, empty), `extractNotionText`, `encodeGithubPath`, `mapWithConcurrency` (order + concurrency cap) |
| `server/__tests__/resilientFetch.test.ts` | 5 | `resilientFetch`: 2xx pass-through, 429 retry-then-succeed, 5xx up-to-maxRetries, no retry on 400, circuit-breaker open after 5 failures |
| `server/__tests__/sovereignGating.test.ts` | 9 | Sovereign blocks Honcho API, allows non-sovereign; blocks Gmail send; blocks Lithic VCC; blocks OAuth exchanges; allows getCard (local query); allows/validates activeMapId set/get; invalid UUID rejected; bad JSON settings file |
| `server/__tests__/virtualCardService.test.ts` | 7 | `VirtualCardService.issueCard`: card creation, Lithic API mock, circuit breaker, PAN-leak safety, orphaned-card close-on-persist-fail. **`listTransactions` in-suite Lithic mock** (env-switched `LITHIC_API_BASE` → fake host, response mapping, not-owned→[], non-OK→[]) |
| `server/__tests__/asyncJobService.test.ts` | 2 | `AsyncJobService`: condenses tracked job + emits result on completion, ignores untracked job lifecycle events |
| `server/__tests__/buildBoundedTree.test.ts` | 5 | `buildBoundedTree`: budget limit, depth limit, truncation markers, overflow last-resort slice, `.gitignore`/`.omnecorrules` ignore, breadth-first traversal |
| `server/__tests__/device-role.test.ts` | 3 | Paired-phone role: can use chat/dashboard/settings; cannot do admin/owner actions; is a known but non-elevated role |
| `server/__tests__/jobResultCondenser.test.ts` | 8 | JobResultCondenser logic |
| `server/__tests__/scriptsRouter.test.ts` | 16 | Auth boundary, list (per-user isolation, mapId filter, ordering), listProjects (distinct sorted, mapId scoped), create (fields, project default), update (ownership → NOT_FOUND cross-user), delete (ownership → NOT_FOUND cross-user) |
| `server/__tests__/neuralMapsRouter.test.ts` | 17 | Auth boundary, list (per-user isolation), create (upsert idempotent, labelOverrides JSON), update (MemoryArchitectService.deleteRemoteSource called on github:// removal, silent no-op cross-user), delete (deleteCollection mock, cross-user isolation, **child-row cascade to scripts/designProjects/curatedPosts**, **IDOR guard: non-owned id never triggers a collection wipe**), migrate (batch insert, name preserved on id collision) |
| `server/__tests__/walletRouter.test.ts` | 14 | Auth boundary, getBudget (null for __global__, DB read), setBudget (upsert), getSpendLog (__global__ = no filter, per-projectId), getSpendSummary (GROUP BY provider aggregate math), resetSpend (delete + confirm gate) |
| `server/__tests__/personaRouter.test.ts` | 13 | Auth boundary, list (shaped records, per-user isolation), upsert (create + update paths, PK collision throws on cross-user id hijack), delete (ownership silent no-op), migrate (batch insert, skips existing ids) |
| `server/__tests__/notificationRouter.test.ts` | 16 | Auth boundary, list (newest-first, unread flag), unreadCount, markRead (single + unknown id + already-read idempotency), markAllRead (flip count), clear (reset), create (fields, Zod max-length rejection, exact-limit acceptance) |
| `server/__tests__/agentMessengerRouter.test.ts` | 14 | Auth boundary, listConversations (per-user isolation, lastMessage + unread counts), getMessages (chronological order, cross-user isolation), markRead (unread drops to 0), send (unknown persona fallback, AI mock + message storage, sovereign FORBIDDEN on cloud provider, local ollama allowed in sovereign, graceful offline message on non-TRPC error) |
| `server/__tests__/securityRouter.test.ts` | 29 | Auth boundary, getPendingHitlActions (adminProcedure gate: user/viewer → FORBIDDEN, admin/owner → allowed + queue returned), resolveHitlAction (FORBIDDEN for user, resolves pending, rejects, NOT_FOUND for missing id), forceRefresh, getIoCFeed. **Session-31 (real `validatePath` + SecurityService stub):** scanFile traversal→BAD_REQUEST + resolved-path delegation; scanDirectory threat-aggregation math (totalFiles/safeFiles/threatsFound) + `/etc` reject; encryptFile Zod min-8 passphrase + traversal→INTERNAL_SERVER_ERROR; decryptFile traversal→BAD_REQUEST + delegation; generateProjectKey safe metadata; createBackup/restoreBackup (BOTH paths validated) /listBackups; runVulnerabilityScan traversal reject + resolved-path delegation — service never called on any rejected path |
| `server/__tests__/hitlRouter.test.ts` | 9 | Auth boundary, getPending (protectedProcedure — any auth user, returns queue), resolve (approveAction called with correct args, reason passed, success:true in both directions, non-admin allowed) |
| `server/__tests__/accessControl.test.ts` | 30 | adminProcedure gate: auditRouter all 5 procedures (unauthenticated/viewer/user/device → FORBIDDEN, admin/owner → allowed); ownerProcedure gate: inline test router (unauthenticated/viewer/user/admin → FORBIDDEN, owner → allowed); RBAC matrix: hasPermission for all 5 roles (viewer/user/admin/owner/device) across chat, settings, audit_log, users, system, execution_mode resources |
| `server/__tests__/pathTraversal.test.ts` | 16 | validatePath: traversal sequences (../../etc/passwd, deep, mixed), absolute sensitive paths (/etc, /root, /var/log, /proc), isWithin separator-bypass (data-evil sibling rejected), valid paths within PATHS.data/models/exports/projects, baseDir parameter enforcement |
| `server/__tests__/virtualCardAes.test.ts` | 6 | VirtualCardService AES-256-GCM round-trip: issueCard captures encrypted row (encryptedCredentials + ivHex + authTagHex), revealPan decrypts back to original PAN; fresh IV per call; null row handling; tampered authTag throws GCM authentication error |
| `server/__tests__/tokenCrypto.test.ts` | 18 | TokenRefreshService: encryptToken→decryptToken round-trip (v1: prefix, non-deterministic, no plaintext leak), GCM auth tag tamper throws, legacy base64 path (no JWT_SECRET), raw base64 legacy decode; OMMESH secretsMatch: correct/wrong/empty/different-length; verifyHmacSig: correct HMAC, wrong secret, tampered body, non-hex sig guard, fail-closed (no secret), sig field excluded from canonical |
| `server/__tests__/comfyRouter.test.ts` | 1 ✅ (skips without ComfyUI) | `comfy.queuePrompt` end-to-end: submits minimal 64×64 / 1-step txt2img workflow, polls `/history` (up to 240 s) until ComfyUI reports completion, asserts `omnecor_test_*` image filename. Auto-discovers first installed checkpoint. CPU-verified 56 s standalone. |
| `server/__tests__/comfyRouterMock.test.ts` | 11 | **Session-31.** `comfy` with `ctx.services.comfy` mocked (always runs — no ComfyUI needed): auth boundary; queuePrompt workflow delegation + failure→INTERNAL_SERVER_ERROR w/ message; getQueue live-queue shape + **bridge-offline surfaces as INTERNAL_SERVER_ERROR (never a masked empty)**; getSystemStats delegation + failure mapping; interrupt/clearQueue `{success:true}` + failure mapping |
| `server/__tests__/pairingRouter.test.ts` | 8 | **Session-31.** `pairing` route-level (real DB; service lifecycle covered in pairing.test.ts): auth boundary; createCode 6-digit code + QR secret + future expiry + port, **FORBIDDEN for the paired-device role** (nonDeviceProcedure); listDevices per-user only + lastSeenAt-desc order + device role may read; revokeDevice sets revokedAt + marks the in-memory revocation set, cross-user revoke → `revoked:false` untouched, device role FORBIDDEN |
| `server/__tests__/blenderRouter.test.ts` | 3 ✅ | `BlenderBridge.checkInstallation()` → version; `blender.status` via tRPC; `BlenderBridge.exportScene()` → headless GLB export of default cube scene, verifies glTF magic bytes. Requires numpy in Blender's Python. Auto-skips if Blender not on PATH. |
| `server/__tests__/kicadRouter.test.ts` | 3 ✅ | `KiCadBridge.checkInstallation()` → version; `kicad.status` via router; `KiCadBridge.runDRC(fixture)` → `CheckResult` shape verified. Fixture: 30mm×20mm board with GND trace → via → B.Cu segment + VCC stub (real copper; DRC analyses layers, not just outline). Auto-skips if kicad-cli not on PATH. |
| `server/__tests__/espRouter.test.ts` | 6 ✅ | `ESPToolBridge.checkInstallation()` → version; `esp.status` via router; `esp.detectPorts` → valid array; `esp.getChipInfo` → chip data when USB ESP32 detected (ttyUSB*/ttyACM* only — ttyS* excluded); **`esp.compile` + `esp.flash`** end-to-end (gated `OMNECOR_TEST_ESP_FLASH=1`). esptool 5.3.1 installed ✅. **Live hardware pass 2026-06-30**: ran against a physical ESP32-D0WD-V3 on `/dev/ttyUSB0` — `getChipInfo` = 2.1 s real round-trip (MAC `3c:8a:1f:ae:b5:7c`, 4 MB flash); **compile+flash** built a BLE sketch via arduino-cli (`*.merged.bin`) and flashed it at `0x0` through the real router, board rebooted and advertised `OMNECOR_TEST_OK` (serial-confirmed). Destructive erase/flash soft-skip behind their env gates. esptool is in `/home/linux/esptool/venv` (login-shell `python3` resolves there; set `PYTHON_BIN` to that venv for non-login/systemd contexts). Auto-skips only when esptool is absent. |
| `server/_core/__tests__/security.ssrf.test.ts` | 7 | `assertOutboundUrlAllowed` SSRF guard: rejects cloud-metadata IP (169.254.169.254), other link-local + IPv4-mapped IPv6 link-local, metadata hostname before any DNS lookup, non-http(s) schemes, malformed URLs; allows loopback + private-LAN literals (self-hosted services) |
| `server/__tests__/agentSettingsRouter.test.ts` | 8 | **Batch G.** `settings` namespace (`agentSettingsRouter`): auth boundary, updateScheduleConfig create (defaults) + in-place update + optimalPostingTimes JSON round-trip, getScheduleConfig all/platform-filter, per-user isolation (own row inserted, never leaks another user's) |
| `server/__tests__/analyticsRouter.test.ts` | 8 | **Batch G.** `analytics`: auth boundary; getPlatformSummary per-account reduce() math (impressions/likes/shares/comments/reach/clicks), active-account filter, zeroed totals; getPostAnalytics found/null; updateAnalytics update-existing + no-op-when-absent |
| `server/__tests__/modelManagementRouter.test.ts` | 13 | **Batch G.** `modelManagement` (ModelManagementService mocked): auth, list/listByProvider/get forwarding, service-failure→INTERNAL_SERVER_ERROR, register (no filePath path), unregister/setActive NOT_FOUND mapping + success, syncFromOllama count, stats, getRunningModels offline→`{models:[]}` |
| `server/__tests__/mobileSyncRouter.test.ts` | 7 | **Batch G.** `mobileSync` (chat helpers + NotificationService mocked): auth, push new + idempotent re-push by mobileSessionId + notification emit, needsProject flag, fileWatcher auto-link by folder name, addToProject NOT_FOUND + materialize session/messages |
| `server/__tests__/platformsRouter.test.ts` | 14 | **Batch G + Session-31.** `platforms` (security): addAccount persists token + returns id **+ idempotent per (user,platform)** (reconnect reactivates the row, no duplicate); listAccounts/getAccount expose **only safe columns** (no oauthToken/refresh); per-user active-only listing; getAccount null cross-user; updateAccount/disconnectAccount FORBIDDEN cross-user; disconnect → isActive 0 drops from list. **Session-31:** getPublishingRouting (webhook config from ENV.n8nUrl + settings path; non-sovereign never blocked; sovereign+loopback allowed vs sovereign+remote-n8n `sovereignBlocked:true`); setWebhookPath admin gate + slash-trim + empty→default restore, persisted via the real SettingsService (isolated `__testSettingsPath`) and reflected by getPublishingRouting |
| `server/__tests__/projectRouter.test.ts` | 16 | **Batch G + Session-31.** `project` (services stubbed): list maps WatcherStatus→UI (basename fallback), getWatcherStatus, unregisterWatcher delegate; loop detector checkAgentLoop/resetLoopDetector/getLoopDetectorState delegate to HashTracker; readFile + registerProject reject traversal/outside-root via validatePath. **Session-31 (real fs under `PATHS.projects`):** writeFile→readFile round-trip, missing-file→BAD_REQUEST (not masked), getFileTree children + nested dir shape, non-directory→NOT_FOUND, traversal→NOT_FOUND, registerProject happy path hands the **resolved** path to the watcher |
| `server/__tests__/schedulingRouter.test.ts` | 13 | **Batch G.** `scheduling` (publishExecutor mocked): schedule/list (projectId filter + desc order + limit), reschedule, cancel→cancelled, createDirectPost (curated+scheduled rows), publishNow outcome aggregation (published/rescheduled/failed) **+ ownership gate (FORBIDDEN on another user's postId, no publish attempted)**, retryPost NOT_FOUND/FORBIDDEN/owner-republish |
| `server/__tests__/trainingRouter.test.ts` | 11 | **Batch G.** `training` (ValetArtifactRegistry + processManager mocked): validateDataset valid/invalid-lines/empty/traversal; startTraining jobId + error mapping (NOT_FOUND/TOO_MANY_REQUESTS/INTERNAL_SERVER_ERROR); getArtifact shape; registerArtifact NOT_FOUND + ready-record write |
| `server/__tests__/cloudComputeRouter.test.ts` | 13 | **Batch G.** `cloudCompute` (local-only path, no creds): listProviders configured=false, estimateCost math + unknown-plan BAD_REQUEST, startSession local-track + idempotent replay, stopSession NOT_FOUND/already-stopped/cost→spendLog/ownership, subscription CRUD + per-user history |
| `server/__tests__/imageGenRouter.test.ts` | 6 | **Batch G.** `imageGen`: providers status; sovereign gate blocks fal/openart + allows local ComfyUI; generate delegates to ctx.services.comfy/fal with dimensions |
| `server/__tests__/falRouter.test.ts` | 6 | **Batch G.** `fal` (cloudProcedure): sovereign blocks generateImage/Character/Video; non-sovereign delegates to ctx.services.fal (+loraPath); in-process gallery; service failure→INTERNAL_SERVER_ERROR |
| `server/__tests__/mcpRouter.test.ts` | 10 | **Batch G.** `mcp` (MCPClientService mocked): list/listTools/agenticOsStatus delegate; connectServer admin gate + sovereign remote-ws block (local allowed); callTool sovereign remote block + HITL on `dangerous` tool (deny→FORBIDDEN, approve→proceed) + sanitize + agent delegate |
| `server/__tests__/attachmentsRouter.test.ts` | 9 | **Batch G.** `attachments` (security): extension allowlist stores .exe/.sh/.svg/.html/.bat/extensionless as **.bin**, keeps .png; data-URL prefix stripped + base64 decoded to disk; auth gate |
| `server/__tests__/knowledgeBaseRouter.test.ts` | 10 | **Batch G.** `knowledgeBase` (MemoryArchitect stubbed): graceful **ChromaDB-offline** degradation for every procedure (status fallback, deleteCollection/ingest*/search/retrieveContext/consolidate/ensureProject return safe empties); online delegation + tokenEstimate math |
| `server/__tests__/modelMarketplaceRouter.test.ts` | 5 | **Batch G.** `modelMarketplace` (ModelMarketplaceService mocked): search routes by source (ollama/huggingface/all) with default limit; featured → curated hot list; auth gate |
| `server/__tests__/ollamaRouter.test.ts` | 13 | **Batch G + Session-31.** `ollama` (fetch + HITL mocked): searchModels offline fallback to curated catalog + query filter + limit; pullModel fire-and-forget; deleteModel admin gate + HITL deny→FORBIDDEN / approve→delete. **Session-31 (daemon reads):** listModels `/api/tags` mapping + non-ok→`Ollama error: <status>` INTERNAL_SERVER_ERROR + missing-`models`-field empty-safe; runningModels `/api/ps`; modelInfo POSTs name to `/api/show`; createModelfile POSTs name+modelfile to `/api/create` + daemon-reject error mapping |
| `server/__tests__/curatorRouter.test.ts` | 10 | **Batch G.** `curator`: listByStatus status+per-user+projectId filter; getPost ownership; curateArticle sovereign block + NOT_FOUND + AI-draft via ctx.services.aiProvider + pending_review insert + mark article processed; approve/reject/update bulk ownership; regenerateDraft sovereign block + draft |
| `server/__tests__/integrationManagementRouter.test.ts` | 8 | **Batch G.** `integrationManagement` (service mocked): listAll/checkHealth forward (id,userId,db) + INTERNAL_SERVER_ERROR wrap; refreshToken/disconnect success + `{success:false}`→INTERNAL_SERVER_ERROR |
| `server/__tests__/honchoRouter.test.ts` | 6 | **Batch G.** `honcho` (honchoService mocked): per-user openId ownership guard (FORBIDDEN on mismatch); addMessage/addFact/getFacts delegation (+default limit 20); sovereign block (externalServiceProcedure) |
| `server/__tests__/pipelineRouter.test.ts` | 7 | **Batch G.** `pipeline` (services stubbed): create/list/get delegation + NOT_FOUND; approvePhase HITL gate (deny→FORBIDDEN no-approve, approve→delegate); abortPipeline |
| `server/__tests__/pcbEditorRouter.test.ts` | 17 | **Batch G (final 4).** `pcbEditor` (db-pcb helpers mocked): createProject return + null→INTERNAL_SERVER_ERROR; per-user ownership NOT_FOUND on getProject/update/delete/saveDesign/loadDesign/export (+no-write assertions); saveDesign inherits parent `mapId`; loadDesign string-canvasData JSON round-trip; reviewDesign sovereign block (no DB read/model call) + non-owner NOT_FOUND + owner openai review→createAIReview |
| `server/__tests__/podcastRouter.test.ts` | 9 | **Batch G (final 4).** `podcast` (LocalPodcastService mocked, real DB): generate persists episode history on master mix + **idempotent upsert by jobId** (no duplicate) + skips when no audioUrl; deleteEpisode per-user IDOR (NOT_FOUND on another user's id, row intact) + owner delete; generateScript sovereign gate (default openai blocked, local ollama allowed, scrapper cloud allowed) |
| `server/__tests__/aiProviderRouter.test.ts` | 6 | **Batch G (final 4).** `aiProvider`: getProviders/discoverOllamaModels (public) delegate to ctx.services.aiProvider; checkHealth delegates to AiProviderService singleton; discoverProviderModels (cloudProcedure) sovereign block + non-sovereign delegate + Zod enum reject |
| `server/__tests__/integrationsRouter.test.ts` | 17 | **Batch G (final 4) + Session-31.** `integrations` (fs store path-intercepted, real DB, fetch stubbed): getIntegrations empty-store + auth gate; connect sovereign service-gate (no network) + OAuth-type paste-token BAD_REQUEST + GitHub validate→**token encrypted at rest** (raw never in store)→connected + disconnect + per-user store isolation; fetchSourceTree sovereign gate + bad-scheme/malformed-github/not-connected dispatch; getMapIndexStatus ownership NOT_FOUND; indexMapSources sovereign gate + no-remote-source skip. **Session-31:** updateSettings sovereign gate + not-connected→NOT_FOUND + settings persisted into the store and surfaced in metadata **without clobbering existing metadata** (username survives the merge) |
| `server/__tests__/dbSchema.test.ts` | 4 | **Batch D (DB schema).** Item 24 — `moeChainConfigs` one-row-per-(userId,chainType) invariant via real `valet.saveMoeChain`/`getMoeChain` (re-save updates not duplicates; separate row per chainType; per-user isolation). Item 27 — **FK cascade**: deleting a `neural_maps` row cascades to savedScripts/designProjects/curatedPosts and is **scoped** (a second map's children survive). This file's cascade case is what exposed the migration-0014 NO-ACTION-FK bug. (Items 25/26 already covered by scriptsRouter/neuralMapsRouter tests.) |
| `server/__tests__/valetRouter.test.ts` | 12 | **Batch E (AI harness).** `valet` (ValetRouterService + `fs/promises.readdir` mocked, real DB): testRoute (`valet.route`) delegates to the stubbed classifier with taskType `chat`; getMoeChain null + per-user; saveMoeChain persist→readback; initMoeChain seeds 7 default cloud steps (no scan) + GGUF-scan local steps + `preserveExisting` no-clobber + DB-row persistence; scanLocalModels GGUF mapping (label strips `.gguf`, enabled=false, non-GGUF ignored) + graceful-empty on readdir reject |
| `server/__tests__/virtualCardRouter.test.ts` | 14 | **Batch F (Agentic Wallet) + Session-31.** `virtualCard` (VirtualCardService + HITLApprovalService mocked, real DB): isConfigured reflects service; getCard/listCards per-user ownership + **PAN-safety** (never returns encryptedCredentials/ivHex/authTagHex); issueCard sovereign gate (externalServiceProcedure) + not-configured short-circuit + HITL deny→FORBIDDEN + HITL approve→issue (cents conversion) + 1/60s rate limit (TOO_MANY_REQUESTS); listTransactions sovereign gate + service delegation. **Session-31:** revealCardPan sovereign gate (no decrypt attempted), delegation with (token, caller userId) → `{pan}`, null service result → NOT_FOUND |
| `server/__tests__/oauthRouter.test.ts` | 9 | **Batch F (OAuth code flow).** `oauth` (oauthClients mocked, **real DB + real PKCE state store**): getAuthorizationUrl persists state+verifier and sends a matching SHA-256(verifier) **PKCE challenge** + provider-config failure→BAD_REQUEST (un-masked, after an error-rewrap fix); handleCallback exchanges code→persists platformAccounts + single-use state, rejects bogus/cross-user state (BAD_REQUEST) + sovereign block; disconnectAccount per-user ownership (FORBIDDEN cross-user) |
| `server/__tests__/voiceRouter.test.ts` | 14 | **Batch I (Python bridges).** `voice` (ctx.services.voice + ElevenLabsService mocked, validatePath pass-through): healthCheck aggregation + allHealthy; per-bridge health; listRvcModels; **bridge-offline degradation** — transcribe/synthesize map unreachable→PRECONDITION_FAILED, missing/Security-Violation→NOT_FOUND, non-.wav→BAD_REQUEST; success paths (no raw audioBuffer leaked); ElevenLabs cloudProcedure sovereign gate + not-configured→PRECONDITION_FAILED |
| `server/__tests__/agentRouter.test.ts` | 8 | **Batch I (agent bridges).** `agent` (ctx.services.agent/hitl/processManager mocked): runCrew/runLiteAgent/triggerN8n/getRecursiveMASStatus delegation; **runRecursiveMAS HITL gate** — ≤3 agents runs directly + audits, >3 agents requires approval (deny→FORBIDDEN no-spawn, approve→jobId); stopRecursiveMAS → processManager.cancelJob |

### 1.2 Server — Service Tests (11 files, 128 tests)

| Test File | Tests | What Is Covered |
|---|---|---|
| `server/phase2/services/__tests__/AiProviderService.streamChat.test.ts` | 3 | `AiProviderService.streamChat`: provider-routing, sovereign mode block on cloud providers, stream output shape |
| `server/phase2/services/__tests__/PenpotService.test.ts` | 3 | `PenpotService` token-fetch and design-token extraction |
| `server/__tests__/promptSanitizer.test.ts` | 10 | `PromptSanitizer`: adversarial injection patterns, NFC normalization, null input, unicode control characters |
| `server/__tests__/hashTrackerService.test.ts` | 15 | `HashTrackerService` (server): generateActionHash determinism + key-order normalization, loop detection at threshold=3, broken-sequence reset, event emission, session isolation, resetSession, removeSession, getSessionSnapshot |
| `server/__tests__/hitlApprovalService.test.ts` | 11 | `HITLApprovalService`: empty queue, approve→{approved:true}, reject→{approved:false,reason}, multi-action isolation, actionPending event, unknown-id no-op, auto-approve when gate disabled, isHitlGateEnabled |
| `server/__tests__/moeChainService.test.ts` | 12 | `MoeChainService` cloud: step order, disabled-step skip, taskCategory filter, rolling-context accumulation, onChunk status+content, empty-steps throw, sovereign block; local: LlamaCppService.generate call, unload between steps, missing modelPath throw |
| `server/__tests__/publishingService.test.ts` | 26 | **Hybrid publishing** (`PublishingService` + `WebhookPublisher`): platform routing sets (webhook vs native), `isLoopbackUrl`; webhook contract POST + synchronous `{ok,platformPostId,url}` mapping, ok:false→Error, ok:false+retryAfterSec→RateLimitError, 404→descriptive, missing id/url→Respond-node hint, **sovereign + non-loopback n8n fails closed (no fetch)**, sovereign + loopback allowed; native **Bluesky** (createSession→createRecord), **Mastodon** (statuses + 429→RateLimitError), **Discord** (webhook ?wait=true; rejects non-webhook URL), **Telegram** (sendMessage/sendPhoto, ok:false→Error, retry_after→RateLimitError); unsupported-platform throw; YouTube not webhook-routed; RateLimitError class props |
| `server/__tests__/tokenRefreshService.test.ts` | 11 | `TokenRefreshService.checkExpiring`: refreshes expiring, ignores no-refreshToken/far-future; Notion 2xx→update, 4xx→delete, 5xx/network→intact, no-row no-op; Slack ok=false→delete, ok=true→intact; unknown provider no-op |
| `server/__tests__/updateCheckerService.test.ts` | 9 | `UpdateCheckerService`: getCurrentVersion, updateAvailable true/false, tag without 'v', non-ok 404/403, network ECONNREFUSED, AbortError timeout, currentVersion always populated |
| `server/__tests__/valetArtifactRegistry.test.ts` | 18 | `ValetArtifactRegistry`: versionedPath (under REGISTRY_ROOT, 8-char hash, slugify, YYYYMMDD suffix); read ENOENT→pending, valid JSON parsed; seedFromRepoIfMissing (already-ready, no candidates, pending candidate, relative→absolute path resolution) |
| `server/__tests__/valetRouterService.test.ts` | 10 | `ValetRouterService`: isAvailable false when bridge offline, fallback respects preferredMode, defaults to main_api when no preferred, uses first provider, ollama fallback default, getModes static list |

### 1.3 Client — Library Tests (13 files, 196 tests)

| Test File | Tests | What Is Covered |
|---|---|---|
| `client/src/__tests__/accessibility.test.ts` | 3 | ARIA attribute presence, keyboard nav on key components |
| `client/src/lib/terminalDirective.test.ts` | 5 | **Session-30.** `extractTerminalCommand` — the AI→terminal `<terminal_command>` directive parser: no-directive passthrough, single directive extracted + stripped to a "_Ran in terminal:_" annotation, whitespace/newline trimming inside the tag, only the first of multiple directives is honored (others stripped, not mislabeled), empty directive ignored |
| `client/src/components/pcb/editor.integration.test.ts` | 21 | PCB editor: component library search, node placement, canvas CRUD cycle |
| `client/src/lib/actionHashDetector.test.ts` | 20 | Hash generation (consistent/distinct), action record creation, loop detection (< threshold = no loop, ≥ 3 identical = loop, broken sequence = no loop) |
| `client/src/lib/aiModels.test.ts` | 22 | AI model registry: model lookup, provider grouping, context-window caps |
| `client/src/lib/chatContext.test.ts` | 24 | Token counting, ID generation, message creation, conversation management, context file management |
| `client/src/lib/contextManager.test.ts` | 21 | Context trimming, rolling buffer, goal/plan buffer persistence |
| `client/src/lib/fileTreeToNetwork.test.ts` | 3 | `fileTreeToNetwork`: truncation propagation, subtree merge, edge generation |
| `client/src/lib/integrations.test.ts` | 5 | `getIntegrationInfo`, `INTEGRATION_FEATURES`, `IntegrationType` enum |
| `client/src/lib/neuralLayout.test.ts` | 5 | `computeLayoutPositions`: empty input, all layout modes, force-layout node separation, autoClustering, large-graph Barnes-Hut (no blowup) |
| `client/src/lib/neuralNodeTree.test.ts` | 12 | Neural node tree: node creation, parent/child relationships, traversal |
| `client/src/lib/settings.test.ts` | 33 | Settings read/write, key resolution, per-setting defaults, type coercion |
| `client/src/lib/specializedModules.test.ts` | 22 | Specialized module registry, status detection, launch-command construction |

### 1.4 Packaging — Installer Smoke Tests (3 files, 85 tests)

These run under `pnpm test` and statically assert the build/installer manifests are correct (no device or build toolchain required).

| Test File | Tests | What Is Covered |
|---|---|---|
| `packaging/android/installer.smoke.test.ts` | 10 | Omnecor HQ Expo config (`app.config.ts` exists, android package `com.omnecor.mobilehq`, app name, declared permissions, New Architecture on SDK 55+); `package.json` (apk:debug/release/install scripts, `llama.rn` dependency); `build.gradle` applicationId + namespace `com.omnecor.mobilehq`; AndroidManifest INTERNET/RECORD_AUDIO + mic foreground service; MainActivity exported=true + LAUNCHER intent filter |
| `packaging/linux/installer.smoke.test.ts` | 36 | `build-appimage.sh` (exists, bash syntax, VERSION not stale `2.0.0`, no copy from non-existent `src/`, copies backend from `dist/`, canonical AppRun, `set -euo pipefail`); canonical AppRun (entry `index.js`, no removed `--experimental-specifier-resolution`, `NODE_ENV=production`); `omnecor.service` (no experimental flag, ExecStart `dist/index.js`, runs as omnecor user, restart on failure); `build-deb.sh` (ships libSQL native binding + Drizzle migrations, excludes dead onnxruntime/better-sqlite3/mysql2 natives) |
| `packaging/windows/installer.smoke.test.ts` | 39 | NSIS `omnecor.nsh` (4 required sections, balanced Section/SectionEnd, 64-bit Ollama path, HTTPS `.exe` download URL, registry key writes + uninstaller cleanup, Node 22+ message); `electron-builder.yml` (appId `com.omnecor.workstation`, nsis + portable targets, non-one-click per-user installer, change install dir, includes `omnecor.nsh`, shortcut "Omnecor HMCI", desktop shortcut + launch-after-install, `win.icon` → `build/icon.ico`, icon assets exist) |

---

## Section 2 — Backend Routers (50 routers in `server/routers/`)

For each router: the namespace key, coverage status, what is tested, and what is missing.

### Auth / Session (in `server/routers.ts` top-level)

| Procedure | Status | Tested By | Missing |
|---|---|---|---|
| `auth.me` | ✅ VERIFIED | authRouter.test.ts | — |
| `auth.logout` | ✅ VERIFIED | auth.logout.test.ts | — |
| `auth.acceptTos` | ✅ VERIFIED | authRouter.test.ts | — |
| `auth.login` (OAuth callback path) | 🤖 HARNESS-DRIVABLE | — | Drivable via the `google`/`microsoft` OAuth **emulator skills** (codebase already honors `GOOGLE_EMULATOR_URL`) — full code-exchange + JWT cookie without a real provider |

### `ai` router (`aiRouter.ts`)

| Procedure | Status | Tested By | Missing |
|---|---|---|---|
| `ai.chat` (sync) | ✅ VERIFIED | aiRouter.test.ts (input contract + sovereign gate + ommesh routing + **map-RAG injection** → provider) | Live cloud inference (billable → 🌐); streaming is the separate `chatStream` subscription |
| `ai.getSession` | ✅ VERIFIED | aiRouter.test.ts (IDOR guard) | — |
| `ai.getSessions` | ✅ VERIFIED | aiRouter.test.ts (IDOR guard) | — |
| `ai.saveMessage` | ✅ VERIFIED | aiRouter.test.ts (IDOR + input contract) | — |
| `ai.summarizeAndPruneSession` | ✅ VERIFIED | aiRouter.test.ts (IDOR guard) | Live model call |
| `ai.reportLoopViolation` | ✅ VERIFIED | aiRouter.test.ts (audit event) | — |

### `aiProvider` router (`aiProviderRouter.ts`)

| Procedure | Status | Tested By | Missing |
|---|---|---|---|
| `aiProvider.getProviders` (public) | ✅ VERIFIED | aiProviderRouter.test.ts | — |
| `aiProvider.discoverOllamaModels` (public) | ✅ VERIFIED | aiProviderRouter.test.ts | live Ollama daemon |
| `aiProvider.checkHealth` (public) | ✅ VERIFIED | aiProviderRouter.test.ts (delegates to AiProviderService singleton) | live provider ping |
| `aiProvider.discoverProviderModels` (cloudProcedure) | ✅ VERIFIED | aiProviderRouter.test.ts (sovereign block + non-sovereign delegate + Zod enum reject) | live provider model list |
| `aiProvider.chatStream` (subscription) | 🔬 PARTIAL | AiProviderService.streamChat.test.ts (service layer) | createCaller can't drive a tRPC subscription; the per-provider Sovereign guard shares `assertProviderAllowedInMode` (covered in aiRouter/sovereignGating); live stream |

### `agentMessenger` router (`agentMessengerRouter.ts`)

| Procedure | Status | Tested By | Missing |
|---|---|---|---|
| `agentMessenger.listConversations` | ✅ VERIFIED | agentMessengerRouter.test.ts | WS broadcast |
| `agentMessenger.getMessages` | ✅ VERIFIED | agentMessengerRouter.test.ts | — |
| `agentMessenger.send` | ✅ VERIFIED | agentMessengerRouter.test.ts | WS broadcast |
| `agentMessenger.markRead` | ✅ VERIFIED | agentMessengerRouter.test.ts | — |

### `settings` router (`agentSettingsRouter.ts` — mounted as `settings`)

| Procedure | Status | Tested By | Missing |
|---|---|---|---|
| `settings.getScheduleConfig` | ✅ VERIFIED | agentSettingsRouter.test.ts (all/platform-filter, per-user isolation) | — |
| `settings.updateScheduleConfig` | ✅ VERIFIED | agentSettingsRouter.test.ts (create defaults, in-place update, JSON round-trip) | — |

### `agentRouter` (`agentRouter.ts` — RecursiveMAS)

| Procedure | Status | Tested By | Missing |
|---|---|---|---|
| `agent.runCrew` / `runLiteAgent` / `triggerN8n` | ✅ VERIFIED | agentRouter.test.ts (delegation to ctx.services.agent) | Real crew execution needs `recursive_mas_bridge.py` on :8011 → 🤝 |
| `agent.runRecursiveMAS` | ✅ VERIFIED | agentRouter.test.ts (**HITL gate** for >3-agent crews: deny→FORBIDDEN no-spawn, approve→jobId; audited) | Real spawn on the bridge → 🤝 |
| `agent.getRecursiveMASStatus` / `stopRecursiveMAS` | ✅ VERIFIED | agentRouter.test.ts (status delegation; stop → processManager.cancelJob) | — |

### `analytics` router (`analyticsRouter.ts`)

| Procedure | Status | Tested By | Missing |
|---|---|---|---|
| `analytics.getPlatformSummary` | ✅ VERIFIED | analyticsRouter.test.ts (per-account reduce() math, active-account filter, zeroed totals) | — |
| `analytics.getPostAnalytics` | ✅ VERIFIED | analyticsRouter.test.ts (found / null) | — |
| `analytics.updateAnalytics` | ✅ VERIFIED | analyticsRouter.test.ts (update-existing, no-op when absent) | — |

### `attachments` router (`attachmentsRouter.ts`)

| Procedure | Status | Tested By | Missing |
|---|---|---|---|
| `attachments.uploadFile` | ✅ VERIFIED | attachmentsRouter.test.ts (extension allowlist → .bin for dangerous/active-content; data-URL decode to disk; auth) | — |

### `audit` router (`auditRouter.ts`)

| Procedure | Status | Tested By | Missing |
|---|---|---|---|
| `audit.getAuditLog` | ✅ VERIFIED | accessControl.test.ts (adminProcedure gate: all 5 roles; admin/owner allowed) | Date range filter, PII redaction on output |
| `audit.getAuditLogByActor` | ✅ VERIFIED | accessControl.test.ts (adminProcedure gate) | — |
| `audit.exportAuditLog` | ✅ VERIFIED | accessControl.test.ts (CSV header present, admin allowed) | — |
| `audit.getRetention` | ✅ VERIFIED | accessControl.test.ts (stats returned, admin gate) | — |
| `audit.setRetention` | ✅ VERIFIED | accessControl.test.ts (admin can change; user → FORBIDDEN) | — |

### `blender` router (`blenderRouter.ts`)

| Procedure | Status | Tested By | Missing |
|---|---|---|---|
| `blender.status` | ✅ VERIFIED | blenderRouter.test.ts (isInstalled:true, version string) | — |
| `blender.export` (GLB) | ✅ VERIFIED | blenderRouter.test.ts (`exportScene()` → glTF magic bytes ✓; numpy installed in Blender's Python) | tRPC `export` route still needs UI path |
| `blender.render` | 🌐 MANUAL REQUIRED | — | Headless render via ProcessManagerService; bridge installed ✅ |
| `blender.executeScript` | 🌐 MANUAL REQUIRED | — | Requires script in allowed dir |

### `chat` router (`chatRouter.ts`)

| Procedure | Status | Tested By | Missing |
|---|---|---|---|
| `chat.createSession` | ✅ VERIFIED | chatRouter.test.ts | — |
| `chat.listSessions` | ✅ VERIFIED | chatRouter.test.ts (per-user isolation, order) | filterScope (project vs global) DB-level scoping |
| `chat.getSession` | ✅ VERIFIED | chatRouter.test.ts (NOT_FOUND cross-user) | — |
| `chat.updateSession` | ✅ VERIFIED | chatRouter.test.ts | — |
| `chat.deleteSession` (cascade) | ✅ VERIFIED | chatRouter.test.ts | — |
| `chat.addMessage` | ✅ VERIFIED | chatRouter.test.ts (upsert, ownership) | — |
| `chat.deleteMessage` | ✅ VERIFIED | chatRouter.test.ts (ownership) | — |
| `chat.getMessages` | ✅ VERIFIED | chatRouter.test.ts | — |
| `chat.bulkImport` | ✅ VERIFIED | chatRouter.test.ts | — |
| `chat.filterScope` state persistence | 🧪 AUTOMATABLE | — | localStorage scope toggle round-trip |

### `cloudCompute` router (`cloudComputeRouter.ts`)

| Procedure | Status | Tested By | Missing |
|---|---|---|---|
| `cloudCompute.listProviders` / `estimateCost` | ✅ VERIFIED | cloudComputeRouter.test.ts (configured flag, cost math, unknown-plan BAD_REQUEST) | — |
| `cloudCompute.startSession` | ✅ VERIFIED | cloudComputeRouter.test.ts (local-only track + idempotent replay + unknown-plan) | real provider provisioning → 🤝 (needs Vast.ai/RunPod/Lambda key) |
| `cloudCompute.stopSession` | ✅ VERIFIED | cloudComputeRouter.test.ts (NOT_FOUND/already-stopped/cost→spendLog/ownership) | real provider terminate → 🤝 |
| `cloudCompute.getActiveSessions` / `getSessionHistory` | ✅ VERIFIED | cloudComputeRouter.test.ts (per-user) | — |
| `cloudCompute.setSubscription` / `getSubscriptions` / `cancelSubscription` | ✅ VERIFIED | cloudComputeRouter.test.ts (CRUD, isActive filter) | — |

### `comfy` router (`comfyRouter.ts`)

| Procedure | Status | Tested By | Missing |
|---|---|---|---|
| `comfy.queuePrompt` | ✅ VERIFIED | comfyRouter.test.ts (full image round-trip: 64×64 / 1 step / CPU ✓, auto-skips offline) + comfyRouterMock.test.ts (delegation + error wrap, always runs) | — |
| `comfy.getQueue` | ✅ VERIFIED | comfyRouterMock.test.ts (queue shape + bridge-offline → INTERNAL_SERVER_ERROR, not a masked empty) | live queue against a running ComfyUI |
| `comfy.getSystemStats` | ✅ VERIFIED | comfyRouterMock.test.ts (delegation + failure mapping) | live stats |
| `comfy.interrupt` / `clearQueue` | ✅ VERIFIED | comfyRouterMock.test.ts (`{success:true}` + failure mapping) | live interrupt mid-render |

### `curator` router (`curatorRouter.ts`)

| Procedure | Status | Tested By | Missing |
|---|---|---|---|
| `curator.curateArticle` | ✅ VERIFIED | curatorRouter.test.ts (sovereign block, NOT_FOUND, AI-draft insert pending_review, mark processed) | live AI copy → 🌐 |
| `curator.regenerateDraft` | ✅ VERIFIED | curatorRouter.test.ts (sovereign block, NOT_FOUND, draft) | — |
| `curator.listByStatus` / `getPost` | ✅ VERIFIED | curatorRouter.test.ts (status+per-user+projectId filter, ownership null) | — |
| `curator.approvePosts` / `rejectPosts` / `updatePost` | ✅ VERIFIED | curatorRouter.test.ts (bulk ownership; reason recorded) | — |

### `dataset` router (`datasetRouter.ts`)

| Procedure | Status | Tested By | Missing |
|---|---|---|---|
| `dataset.discoverSources` (local) | ✅ VERIFIED | datasetRouter.test.ts | — |
| `dataset.discoverSources` (online) | ✅ VERIFIED | datasetRouter.test.ts (sovereign block) | Live web scrape |
| `dataset.listUnprocessedSources` | ✅ VERIFIED | datasetRouter.test.ts | — |
| `dataset.curateSourceItem` | ✅ VERIFIED | datasetRouter.test.ts | — |
| `dataset.listCuratedExamples` | ✅ VERIFIED | datasetRouter.test.ts | — |
| `dataset.updateCuratedExample` | ✅ VERIFIED | datasetRouter.test.ts (found + NOT_FOUND) | — |
| `dataset.compileDataset` | ✅ VERIFIED | datasetRouter.test.ts | JSONL file write to disk |

### `discovery` router (`discoveryRouter.ts`) — social content discovery

| Procedure | Status | Tested By | Missing |
|---|---|---|---|
| `discovery.fetchArticles` | ✅ VERIFIED | discoveryRouter.test.ts (ingest-then-return + **surfaces ingest failure**, ArticleDiscoveryService mocked) | live RSS feeds / BirdClaw Playwright ingest → 🌐 |
| `discovery.listUnprocessed` / `getArticle` / `markAsProcessed` | ✅ VERIFIED | discoveryRouter.test.ts (isProcessed filter, newest-first, limit, projectId scope; found/null; flip + drop from feed) | — |

*(Session-31 doc fix: the previously-listed `discovery.refreshFeed` does not exist in `discoveryRouter.ts` — the router's real surface is the 4 procedures above.)*

### `esp` router (`espRouter.ts`)

| Procedure | Status | Tested By | Missing |
|---|---|---|---|
| `esp.detectPorts` | ✅ VERIFIED (hardware) | espRouter.test.ts | **Live-verified 2026-06-30** against a physical **ESP32-D0WD-V3** on `/dev/ttyUSB0` (CP2102 bridge) — `esp.detectPorts` returned the real USB port. |
| `esp.getChipInfo` | ✅ VERIFIED (hardware) | espRouter.test.ts | **Live-verified 2026-06-30** — 2.1 s real round-trip read: chip ESP32-D0WD-V3 rev v3.1, MAC `3c:8a:1f:ae:b5:7c`, 40 MHz crystal, 4 MB flash. **Env note:** esptool 5.3.1 lives in `/home/linux/esptool/venv`; the dev login shell's `python3` already resolves there via profile PATH, so the bridge finds it. `/usr/bin/python3` does **not** have esptool — a systemd/non-login deploy must set `PYTHON_BIN=/home/linux/esptool/venv/bin/python`. |
| `esp.status` | ✅ VERIFIED | espRouter.test.ts | esptool 5.3.1 installed ✅ |
| `esp.flash` | ✅ VERIFIED (hardware) | espRouter.test.ts (gated `OMNECOR_TEST_ESP_FLASH=1`) | **Live-verified 2026-06-30** — flashed a compiled `*.merged.bin` at `0x0` to a physical ESP32 via the real router; board rebooted and BLE-advertised `OMNECOR_TEST_OK` (serial-confirmed). `flashOffset`/`chip` now plumbed through (default `0x0`); fixed the bridge's hardcoded `0x1000` bug. Destructive → gated by default. |
| `esp.compile` | ✅ VERIFIED (hardware) | espRouter.test.ts (gated `OMNECOR_TEST_ESP_FLASH=1`) | **Live-verified 2026-06-30** — `esp.compile` drove arduino-cli (esp32 core 3.3.10) on a BLE sketch under `PATHS.projects`, produced `OmnecorBleTest.ino.merged.bin` (validatePath-gated sketch + outputDir). |

### `fal` router (`falRouter.ts`)

| Procedure | Status | Tested By | Missing |
|---|---|---|---|
| `fal.generateImage` / `generateCharacter` / `generateVideo` | ✅ VERIFIED | falRouter.test.ts (sovereign block + ctx.services.fal delegation + error wrap) | live Fal.ai render → 🌐 |
| `fal.listImages` | ✅ VERIFIED | falRouter.test.ts (in-process gallery) | — |

### `gmail` router (`gmailRouter.ts`)

| Procedure | Status | Tested By | Missing |
|---|---|---|---|
| `gmail.sendEmail` | ✅ VERIFIED | gmailRouter.test.ts (config/connection guards, Bearer token + endpoint + decoded RFC-2822 payload, refresh-on-401 rotation persisted, API-error mapping, ownership isolation, Sovereign gate), gmailMessage.test.ts (message builder), sovereignGating.test.ts (block in sovereign) | Only a live-Gmail delivery smoke remains → 🌐 |
| `gmail.status` | ✅ VERIFIED | gmailRouter.test.ts (configured/connected/accountName; inactive row excluded; unconfigured client) | — |

### `hitl` router (`hitlRouter.ts`)

| Procedure | Status | Tested By | Missing |
|---|---|---|---|
| `hitl.getPending` | ✅ VERIFIED | hitlRouter.test.ts | — |
| `hitl.resolve` (approve+reject) | ✅ VERIFIED | hitlRouter.test.ts | Idempotency is service-layer concern (HITLApprovalService); router delegates fully |

### `honcho` router (`honchoRouter.ts`)

| Procedure | Status | Tested By | Missing |
|---|---|---|---|
| `honcho.addMessage` / `addFact` / `getFacts` | ✅ VERIFIED | honchoRouter.test.ts (openId ownership FORBIDDEN, delegation, sovereign block), sovereignGating.test.ts | live Honcho API round-trip → 🌐 |

### `imageGen` router (`imageGenRouter.ts`)

| Procedure | Status | Tested By | Missing |
|---|---|---|---|
| `imageGen.generate` | ✅ VERIFIED | imageGenRouter.test.ts (sovereign blocks fal/openart, allows local; delegates to comfy/fal) | live cloud generation → 🌐 |
| `imageGen.providers` | ✅ VERIFIED | imageGenRouter.test.ts (local true + boolean cloud flags) | — |

### `integrationManagement` router (`integrationManagementRouter.ts`)

| Procedure | Status | Tested By | Missing |
|---|---|---|---|
| `integrationManagement.listAll` / `checkHealth` | ✅ VERIFIED | integrationManagementRouter.test.ts (forward id+userId+db, INTERNAL_SERVER_ERROR wrap) | — |
| `integrationManagement.refreshToken` / `disconnect` | ✅ VERIFIED | integrationManagementRouter.test.ts (success + `{success:false}`→INTERNAL_SERVER_ERROR) | live provider token refresh → 🌐 |

### `integrations` router (`integrationsRouter.ts`)

| Procedure | Status | Tested By | Missing |
|---|---|---|---|
| `integrations.getIntegrations` | ✅ VERIFIED | integrationsRouter.test.ts (empty-store all-disconnected + per-user isolation + auth gate) | live OAuth `platformAccounts` connected-state for dropbox/onedrive → 🌐 |
| `integrations.connect` | ✅ VERIFIED | integrationsRouter.test.ts (sovereign service-gate w/ no network, OAuth-type paste-token BAD_REQUEST, GitHub validate → **token encrypted at rest** → connected) | live token validation for notion/slack/drive/outlook/gmail → 🌐 |
| `integrations.disconnect` | ✅ VERIFIED | integrationsRouter.test.ts (paste-token removal → disconnected) | OAuth-row deactivation path (dropbox/onedrive) → 🌐 |
| `integrations.sync` | 🌐 MANUAL REQUIRED | — | Requires live provider creds (re-fetch per service) |
| `integrations.fetchSourceTree` (dispatch + gating) | ✅ VERIFIED | integrationsRouter.test.ts (sovereign FORBIDDEN, unsupported-scheme + malformed-github BAD_REQUEST, not-connected NOT_FOUND) | live content fetch for github:// + integration:// (live-verified 2026-06-20 with real PAT) → 🌐 |
| `resolveSourceDocuments` (8 adapters, internal helper) | 🔬 PARTIAL | remoteSourceIngest.test.ts (helper functions) | per-adapter content fetch → 🌐 |
| `integrations.indexMapSources` | ✅ VERIFIED (partial) | integrationsRouter.test.ts (sovereign gate + map-ownership NOT_FOUND + no-remote-source skip) | live ChromaDB + tokens for the detached index job → 🌐 |
| `integrations.getMapIndexStatus` | ✅ VERIFIED | integrationsRouter.test.ts (map-ownership NOT_FOUND) | populated running-job status shape |
| `integrations.updateSettings` | ✅ VERIFIED | integrationsRouter.test.ts (sovereign gate; not-connected → NOT_FOUND; settings persisted + metadata merge preserves username) | — |

### `job` router (`jobRouter.ts`)

| Procedure | Status | Tested By | Missing |
|---|---|---|---|
| `jobs.getStatus` | ✅ VERIFIED | jobRouter.test.ts (found / NOT_FOUND / non-UUID reject) + asyncJobService.test.ts (service layer) | — |
| `jobs.startAsync` | ✅ VERIFIED | jobRouter.test.ts (**HITL "command" gate**: approve→raw-capture spawn w/ arg-array + track; deny→FORBIDDEN w/ reviewer reason, no spawn; **cwd validatePath traversal reject**) | — |
| `jobs.list` / `cancel` | ✅ VERIFIED | jobRouter.test.ts (type/state filters; cancel BAD_REQUEST on unknown id) | — |
| `jobs.runSandboxCommand` / `prune` | ✅ VERIFIED | jobRouter.test.ts (admin gates; arg-split spawn) | live Docker sandbox run → 🤖 |

*(Session-31 doc fix: the previously-listed `job.getResult` does not exist — the procedure is `jobs.getStatus`, and the whole namespace was already covered by Batch G's `jobRouter.test.ts`.)*

### `kicad` router (`kicadRouter.ts`)

| Procedure | Status | Tested By | Missing |
|---|---|---|---|
| `kicad.status` | ✅ VERIFIED | kicadRouter.test.ts (isInstalled:true, version string) | — |
| `kicad.runDrc` | ✅ VERIFIED | kicadRouter.test.ts (DRC on minimal fixture → CheckResult shape) | Live PCB with real violations |
| `kicad.exportGerbers` | 🌐 MANUAL REQUIRED | — | Requires real .kicad_pcb with copper layers |
| `kicad.exportBOM` | 🌐 MANUAL REQUIRED | — | Requires .kicad_sch schematic |
| KiCad board spec parsing | ✅ VERIFIED | pcbFabrication.test.ts | — |

### `knowledgeBase` router (`knowledgeBase.ts`)

| Procedure | Status | Tested By | Missing |
|---|---|---|---|
| `knowledgeBase.status` | ✅ VERIFIED | knowledgeBaseRouter.test.ts (online status + throw→offline fallback) | — |
| `knowledgeBase.ingestDirectory` / `ingestDocument` / `consolidate` / `ensureProject` | ✅ VERIFIED | knowledgeBaseRouter.test.ts (graceful offline + online delegation) | live ChromaDB ingest → 🌐 |
| `knowledgeBase.search` / `retrieveContext` / `deleteCollection` | ✅ VERIFIED | knowledgeBaseRouter.test.ts (offline empties; online delegation + tokenEstimate) | live ChromaDB query → 🌐 |

### `mcp` router (`mcpRouter.ts`)

| Procedure | Status | Tested By | Missing |
|---|---|---|---|
| `mcp.listConnectedServers` / `listTools` / `agenticOsStatus` | ✅ VERIFIED | mcpRouter.test.ts (service delegation) | — |
| `mcp.connectServer` | ✅ VERIFIED | mcpRouter.test.ts (admin gate; sovereign remote-ws block, local allowed) | live stdio spawn → 🌐 |
| `mcp.disconnectServer` | ✅ VERIFIED | mcpRouter.test.ts | — |
| `mcp.callTool` | ✅ VERIFIED | mcpRouter.test.ts (sovereign remote block; HITL on dangerous deny/approve; sanitize + agent delegate) | live MCP server process → 🌐 |

### `mobileSync` router (`mobileSyncRouter.ts`)

| Procedure | Status | Tested By | Missing |
|---|---|---|---|
| `mobileSync.push` | ✅ VERIFIED | mobileSyncRouter.test.ts (new + idempotent re-push, notification emit, auto-link, needsProject) | — |
| `mobileSync.list` | ✅ VERIFIED | mobileSyncRouter.test.ts | — |
| `mobileSync.addToProject` | ✅ VERIFIED | mobileSyncRouter.test.ts (NOT_FOUND, materializes session + messages) | — |

### `modelManagement` router (`modelManagementRouter.ts`)

| Procedure | Status | Tested By | Missing |
|---|---|---|---|
| `modelManagement.list` / `listByProvider` / `get` | ✅ VERIFIED | modelManagementRouter.test.ts (forwarding + INTERNAL_SERVER_ERROR wrap) | — |
| `modelManagement.register` | ✅ VERIFIED | modelManagementRouter.test.ts (no-filePath path) | filePath `validatePath` branch |
| `modelManagement.unregister` / `setActive` | ✅ VERIFIED | modelManagementRouter.test.ts (NOT_FOUND mapping + success) | — |
| `modelManagement.syncFromOllama` / `stats` / `getRunningModels` | ✅ VERIFIED | modelManagementRouter.test.ts (count, stats, offline→`{models:[]}`) | — |

### `modelMarketplace` router (`modelMarketplaceRouter.ts`)

| Procedure | Status | Tested By | Missing |
|---|---|---|---|
| `modelMarketplace.search` | ✅ VERIFIED | modelMarketplaceRouter.test.ts (routes ollama/huggingface/all to the service) | live registry fetch → 🌐 |
| `modelMarketplace.featured` | ✅ VERIFIED | modelMarketplaceRouter.test.ts (curated hot list, no network) | — |

### `neuralMaps` router (`neuralMapsRouter.ts`)

| Procedure | Status | Tested By | Missing |
|---|---|---|---|
| `neuralMaps.create` | ✅ VERIFIED | neuralMapsRouter.test.ts | — |
| `neuralMaps.list` | ✅ VERIFIED | neuralMapsRouter.test.ts | — |
| `neuralMaps.update` | ✅ VERIFIED | neuralMapsRouter.test.ts (remote root removal → deleteRemoteSource mock) | Live ChromaDB vector drop |
| `neuralMaps.delete` | ✅ VERIFIED | neuralMapsRouter.test.ts (deleteCollection mock; **child-row cascade**; **IDOR guard** — non-owned id triggers no collection wipe) + dbSchema.test.ts (DB-level cascade). Atomic `db.batch` cleanup + migration 0014 cascade fix. | Live ChromaDB collection drop |
| `neuralMaps.migrate` | ✅ VERIFIED | neuralMapsRouter.test.ts (batch upsert, name preserved on id collision) | — |
| `neuralMaps.getActiveMapId` | ✅ VERIFIED | sovereignGating.test.ts (get + invalid UUID rejected) | — |
| `neuralMaps.setActiveMapId` | ✅ VERIFIED | sovereignGating.test.ts (set + persists to settings JSON) | — |
| `neuralMaps.getFileTree` (via `project.getFileTree`) | ✅ VERIFIED | buildBoundedTree.test.ts (algorithm) + projectRouter.test.ts (Session-31: real-fs router invocation, rootDir `validatePath` traversal→NOT_FOUND, non-directory reject) | — |

### `notifications` router (`notificationRouter.ts`)

| Procedure | Status | Tested By | Missing |
|---|---|---|---|
| `notifications.list` | ✅ VERIFIED | notificationRouter.test.ts (newest-first, unread flag) | — |
| `notifications.unreadCount` | ✅ VERIFIED | notificationRouter.test.ts | — |
| `notifications.markRead` | ✅ VERIFIED | notificationRouter.test.ts (single, unknown id, already-read idempotency) | — |
| `notifications.markAllRead` | ✅ VERIFIED | notificationRouter.test.ts (flip count) | — |
| `notifications.clear` | ✅ VERIFIED | notificationRouter.test.ts | — |
| `notifications.create` | ✅ VERIFIED | notificationRouter.test.ts (fields, Zod max-length rejection, exact-limit acceptance) | — |

### `oauth` router (`oauthRouter.ts`)

| Procedure | Status | Tested By | Missing |
|---|---|---|---|
| `oauth.getAuthorizationUrl` | ✅ VERIFIED | oauthRouter.test.ts (persists PKCE state+verifier, sends matching SHA-256 challenge; provider-config failure→BAD_REQUEST), oauthClients.test.ts (config layer) | Live redirect URI against a real provider console → 🌐 |
| `oauth.handleCallback` | ✅ VERIFIED | oauthRouter.test.ts (state validation: bogus/cross-user/TTL→BAD_REQUEST; code exchange→platformAccounts insert; single-use state; sovereign block; oauthClients mocked) | Real code exchange against the `google`/`microsoft` emulator skill (live token) → 🤖/🌐 |
| `oauth.disconnectAccount` | ✅ VERIFIED | oauthRouter.test.ts (per-user ownership — FORBIDDEN cross-user; isActive→0) | — |
| Sovereign block on OAuth exchanges | ✅ VERIFIED | sovereignGating.test.ts | — |

### `ollama` router (`ollamaRouter.ts`)

| Procedure | Status | Tested By | Missing |
|---|---|---|---|
| `ollama.searchModels` | ✅ VERIFIED | ollamaRouter.test.ts (offline fallback catalog + query filter + limit) | live registry → 🌐 |
| `ollama.deleteModel` | ✅ VERIFIED | ollamaRouter.test.ts (admin gate + HITL deny/approve) | live Ollama delete → 🌐 |
| `ollama.pullModel` | ✅ VERIFIED | ollamaRouter.test.ts (fire-and-forget `started:true`) | live daemon pull → 🌐 |
| `ollama.listModels` / `modelInfo` / `createModelfile` / `runningModels` | ✅ VERIFIED | ollamaRouter.test.ts (Session-31: `/api/tags`/`/api/ps`/`/api/show`/`/api/create` payload mapping, non-ok→`Ollama error: <status>`, missing-field empty-safe; fetch mocked) | live daemon smoke (a real Ollama already streamed tokens in Batch H) |

### `ommesh` router (`ommesh.router.ts`)

| Procedure | Status | Tested By | Missing |
|---|---|---|---|
| `ommesh.discover` / `getIdentity` | ✅ VERIFIED | ommeshRouter.test.ts (meshNode delegation) + discoveryService.test.ts (peer lookup, self-exclusion) | Live LAN mDNS → 🤝 |
| `ommesh.approvePeer` (fingerprint pin) / `rotateCert` | ✅ VERIFIED | ommeshRouter.test.ts (**admin gates** + force flag forwarded) | Live cert rotation on a 2-node mesh → 🤝 |
| `ommesh.routeInference` | ✅ VERIFIED (router) | ommeshRouter.test.ts (options default `{}` + delegation) | Real cross-node mTLS inference needs 2+ LAN nodes with certs → 🤝 |
| `ommesh.setCrossNodeSync` / `setAgentDiscourse` / `getCrossNodeSyncStatus` | ✅ VERIFIED | ommeshRouter.test.ts (persist→read-back round-trip incl. toggle-one-preserves-other; settings isolated to temp HOME) | — |
| `ommesh.sendPeerDiscourse` | ✅ VERIFIED | ommeshRouter.test.ts (forwarding + >8000-char reject) | live peer delivery → 🤝 |

*(Session-31 doc fix: the previously-listed `ommesh.revokePeer` and `ommesh.getTopology` do not exist in `ommesh.router.ts` — the real surface is the 9 procedures above, all covered by Batch G's `ommeshRouter.test.ts`.)*

### `pairing` router (`pairingRouter.ts`)

| Procedure | Status | Tested By | Missing |
|---|---|---|---|
| `pairing.createCode` | ✅ VERIFIED | pairing.test.ts (code lifecycle) + pairingRouter.test.ts (QR payload shape; paired-device role FORBIDDEN) | — |
| `pairing.redeemCode` (public `POST /api/pair/redeem`) | ✅ VERIFIED | pairing.test.ts | — |
| `pairing.revokeDevice` | ✅ VERIFIED | pairing.test.ts (sticky revocation) + pairingRouter.test.ts (route-level: revokedAt + in-memory set; cross-user no-op; device role FORBIDDEN) | — |
| `pairing.listDevices` | ✅ VERIFIED | pairingRouter.test.ts (per-user only, lastSeenAt-desc order, device role may read) | — |

### `pcbEditor` router (`pcbEditorRouter.ts`)

| Procedure | Status | Tested By | Missing |
|---|---|---|---|
| `pcbEditor.createProject` | ✅ VERIFIED | pcbEditorRouter.test.ts (return shape + null helper → INTERNAL_SERVER_ERROR) | — |
| `pcbEditor.getProjects` / `getProject` | ✅ VERIFIED | pcbEditorRouter.test.ts (getProject ownership NOT_FOUND + owner read) | getProjects list per-user isolation (same db-pcb scoping) |
| `pcbEditor.updateProject` / `deleteProject` | ✅ VERIFIED | pcbEditorRouter.test.ts (ownership NOT_FOUND + no-write; owner delete) | — |
| `pcbEditor.saveDesign` | ✅ VERIFIED | pcbEditorRouter.test.ts (parent-project ownership + inherits parent `mapId`) | format validation |
| `pcbEditor.loadDesign` / `getLatestDesign` / `getDesignVersions` | ✅ VERIFIED | pcbEditorRouter.test.ts (loadDesign ownership + string-canvasData JSON round-trip) | getLatest/getVersions share the same ownership pattern |
| `pcbEditor.reviewDesign` | ✅ VERIFIED | pcbEditorRouter.test.ts (sovereign block before any DB read/model call; non-owner NOT_FOUND; owner openai review → createAIReview) | live OpenAI review → 🌐 |
| `pcbEditor.exportDesign` / `getExports` / `getAIReviews` | ✅ VERIFIED | pcbEditorRouter.test.ts (exportDesign ownership + record) | getExports/getAIReviews share the same ownership pattern |
| PCB canvas drop + drag | 🔬 PARTIAL | editor.integration.test.ts | Full React rendering (manual) |

### `penpot` router (`penpotRouter.ts`)

| Procedure | Status | Tested By | Missing |
|---|---|---|---|
| `penpot.configure` / `generateComponent` | ✅ VERIFIED | penpotRouter.test.ts (auth boundary; configure url+token forward + non-URL reject; generateComponent forwards ids/name + **identifier-regex componentName guard** (blocks `../evil`, `foo/bar`, spaces) + service-failure propagation) + PenpotService.test.ts (service layer) | live Penpot API round-trip → 🌐 |

*(Session-31 doc fix: this section previously said only the service layer was covered — Batch G's `penpotRouter.test.ts` (6) had already added the router level.)*

### `personas` router (`personaRouter.ts`)

| Procedure | Status | Tested By | Missing |
|---|---|---|---|
| `personas.list` | ✅ VERIFIED | personaRouter.test.ts (per-user isolation, shaped records) | — |
| `personas.upsert` | ✅ VERIFIED | personaRouter.test.ts (create + update paths, PK collision throws on cross-user id hijack, data JSON merge) | — |
| `personas.delete` | ✅ VERIFIED | personaRouter.test.ts (ownership silent no-op) | — |
| `personas.migrate` | ✅ VERIFIED | personaRouter.test.ts (batch insert, skips existing ids) | — |

### `pipeline` router (`pipelineRouter.ts`)

| Procedure | Status | Tested By | Missing |
|---|---|---|---|
| `pipeline.createPipeline` / `listPipelines` / `getPipeline` | ✅ VERIFIED | pipelineRouter.test.ts (delegation + NOT_FOUND) | — |
| `pipeline.approvePhase` | ✅ VERIFIED | pipelineRouter.test.ts (HITL gate deny→FORBIDDEN / approve→delegate) | — |
| `pipeline.abortPipeline` | ✅ VERIFIED | pipelineRouter.test.ts (delegation) | — |
| Live pipeline execution (PipelineEngineService) | 🤖 HARNESS-DRIVABLE | — | Graph run with stub AI; crew-size HITL gate |

### `platforms` router (`platformsRouter.ts`)

| Procedure | Status | Tested By | Missing |
|---|---|---|---|
| `platforms.addAccount` | ✅ VERIFIED | platformsRouter.test.ts (persists token, returns numeric id; **idempotent per (user,platform)** — reconnect reactivates, no duplicate) | — |
| `platforms.listAccounts` | ✅ VERIFIED | platformsRouter.test.ts (safe columns only — no oauthToken/refresh; per-user active-only) | — |
| `platforms.getAccount` | ✅ VERIFIED | platformsRouter.test.ts (safe columns; null cross-user) | — |
| `platforms.updateAccount` | ✅ VERIFIED | platformsRouter.test.ts (FORBIDDEN cross-user) | — |
| `platforms.disconnectAccount` | ✅ VERIFIED | platformsRouter.test.ts (isActive→0, FORBIDDEN cross-user) | — |
| `platforms.getPublishingRouting` | ✅ VERIFIED | platformsRouter.test.ts (webhook config from ENV.n8nUrl + settings; sovereign+remote-n8n → `sovereignBlocked:true`, loopback allowed; non-sovereign never blocked) | — |
| `platforms.setWebhookPath` | ✅ VERIFIED | platformsRouter.test.ts (admin gate; slash-trim; empty→default restore; persisted via real SettingsService w/ `__testSettingsPath` and reflected by getPublishingRouting) | — |

### `podcast` router (`podcastRouter.ts`)

| Procedure | Status | Tested By | Missing |
|---|---|---|---|
| `podcast.generate` | ✅ VERIFIED (persistence) | podcastRouter.test.ts (episode-history insert + **idempotent upsert by jobId** + no-audio skip; LocalPodcastService mocked) | actual multi-speaker TTS synthesis needs the TTS bridge on :8002 → 🤖 HARNESS-DRIVABLE / 🤝 |
| `podcast.listEpisodes` / `deleteEpisode` | ✅ VERIFIED | podcastRouter.test.ts (newest-first list; deleteEpisode per-user IDOR — NOT_FOUND on another user's id, row intact; owner delete) | — |
| `podcast.generateScript` | ✅ VERIFIED | podcastRouter.test.ts (sovereign default-openai block, local-ollama allowed, scrapper cloud allowed) | live LLM script generation → 🌐 |
| `podcast.streamTurn` (subscription) | 🌐 MANUAL REQUIRED | — | Calls TTS server directly (not VoiceService); createCaller can't drive a tRPC subscription; needs TTS bridge :8002 |

### `project` router (`projectRouter.ts`)

| Procedure | Status | Tested By | Missing |
|---|---|---|---|
| `project.getFileTree` (bounded) | ✅ VERIFIED | buildBoundedTree.test.ts (algorithm); projectRouter.test.ts (Session-31: real-fs happy path under `PATHS.projects` — children + nested dir shape; non-directory→NOT_FOUND; traversal→NOT_FOUND) | — |
| `project.list` | ✅ VERIFIED | projectRouter.test.ts (WatcherStatus→UI map, basename fallback) | — |
| `project.getWatcherStatus` / `unregisterWatcher` | ✅ VERIFIED | projectRouter.test.ts (delegate to fileWatcher) | — |
| `project.registerProject` / `registerWatcher` | ✅ VERIFIED | projectRouter.test.ts (validatePath rejects outside-root; Session-31: real-dir happy path hands the **resolved** path to the watcher) | live chokidar event flow (FileSystemWatcherService) |
| `project.checkAgentLoop` / `resetLoopDetector` / `getLoopDetectorState` | ✅ VERIFIED | projectRouter.test.ts (delegate to HashTracker) | — |
| `project.readFile` / `writeFile` | ✅ VERIFIED | projectRouter.test.ts (traversal reject; Session-31: write→read round-trip on real fs; missing-file→BAD_REQUEST surfaced, not masked) | — |
| `project.openPath` | 🤝 HARDWARE | — | Spawns the OS file manager (xdg-open/open/explorer) — needs a desktop session |

### `scheduling` router (`schedulingRouter.ts`)

| Procedure | Status | Tested By | Missing |
|---|---|---|---|
| `scheduling.schedulePost` / `listScheduledPosts` | ✅ VERIFIED | schedulingRouter.test.ts (projectId filter, desc order, limit) | — |
| `scheduling.reschedulePost` / `cancelPost` / `createDirectPost` | ✅ VERIFIED | schedulingRouter.test.ts | — |
| `scheduling.publishNow` | ✅ VERIFIED | schedulingRouter.test.ts (publishExecutor mocked → outcome aggregation; **ownership gate — FORBIDDEN on another user's postId, no publish attempted**). Live-verified 2026-06-20 (real 403 from Twitter w/ dummy token) | real-token success → 🌐 |
| `scheduling.retryPost` | ✅ VERIFIED | schedulingRouter.test.ts (NOT_FOUND / FORBIDDEN cross-user / owner republish) | — |
| Auto-publish worker (`publishWorker.ts`) | 🌐 MANUAL REQUIRED | — | Background job with real platform creds |

### `scripts` router (`scriptsRouter.ts`)

| Procedure | Status | Tested By | Missing |
|---|---|---|---|
| `scripts.list` | ✅ VERIFIED | scriptsRouter.test.ts (per-user isolation, mapId FK seeded, updatedAt ordering) | — |
| `scripts.listProjects` | ✅ VERIFIED | scriptsRouter.test.ts (distinct sorted, mapId scoped, cross-user isolation) | — |
| `scripts.create` | ✅ VERIFIED | scriptsRouter.test.ts (fields, project default, FK constraint on mapId) | — |
| `scripts.update` | ✅ VERIFIED | scriptsRouter.test.ts (ownership, NOT_FOUND cross-user, NOT_FOUND ghost id) | — |
| `scripts.delete` | ✅ VERIFIED | scriptsRouter.test.ts (ownership, NOT_FOUND cross-user) | — |
| localStorage migration (one-time) | 🧪 AUTOMATABLE | — | Migration helper unit test |

### `security` router (`securityRouter.ts`)

| Procedure | Status | Tested By | Missing |
|---|---|---|---|
| `security.getPendingHitlActions` | ✅ VERIFIED | securityRouter.test.ts (adminProcedure gate: user/viewer → FORBIDDEN, admin/owner → allowed) | Audit log write |
| `security.resolveHitlAction` | ✅ VERIFIED | securityRouter.test.ts (FORBIDDEN for user, resolves pending action, NOT_FOUND for missing id) | Audit log write |
| `security.forceRefresh` | ✅ VERIFIED | securityRouter.test.ts | — |
| `security.getIoCFeed` | ✅ VERIFIED | securityRouter.test.ts | Live threat feed |
| `security.scanFile` / `scanDirectory` | ✅ VERIFIED (router) | securityRouter.test.ts (Session-31: validatePath gate — traversal + `/etc` → BAD_REQUEST w/ no service call; resolved-path delegation; **threat-aggregation math** totalFiles/safeFiles/threatsFound) | real YARA scan output (SecurityService, 🧪 service-level) |
| `security.encryptFile` / `decryptFile` / `generateProjectKey` | ✅ VERIFIED (router) | securityRouter.test.ts (Session-31: Zod min-8 passphrase; traversal rejects mapped per-procedure (INTERNAL_SERVER_ERROR / BAD_REQUEST); delegation; safe key metadata only) | real AES file round-trip (SecurityService, 🧪 service-level) |
| `security.createBackup` / `restoreBackup` / `listBackups` | ✅ VERIFIED (router) | securityRouter.test.ts (Session-31: restoreBackup validates BOTH archive+target; traversal never reaches the service; delegation) | real encrypted-ZIP backup round-trip (🧪 service-level) |
| `security.runVulnerabilityScan` | ✅ VERIFIED (router) | securityRouter.test.ts (Session-31: traversal reject before the scanner; resolved-path delegation) | real scanner output (🧪 service-level) |

*(Session-31 doc fix: the previously-listed `security.getThreatReport` and `security.getAuditSummary` do not exist in `securityRouter.ts`; conversely the router's real scan/encryption/backup surface above was missing from this table entirely.)*

### `training` router (`trainingRouter.ts`)

| Procedure | Status | Tested By | Missing |
|---|---|---|---|
| `training.validateDataset` | ✅ VERIFIED | trainingRouter.test.ts (valid / invalid-lines / empty / traversal-reject) | — |
| `training.startTraining` | ✅ VERIFIED | trainingRouter.test.ts (jobId + error-code mapping; processManager mocked) | live LoRA run on the 4060 → 🤝 |
| `training.getArtifact` | ✅ VERIFIED | trainingRouter.test.ts (record + registryRoot) | — |
| `training.registerArtifact` | ✅ VERIFIED | trainingRouter.test.ts (NOT_FOUND missing path; ready-record write) | — |
| `training.generateValetDataset` | 🤖 HARNESS-DRIVABLE | — | processManager.spawn delegation (mockable) |
| `training.startKaggleTraining` / `kaggleStatus` / `kaggleJobStatus` / `pullKaggleArtifact` / `saveKaggleKey` | 🤝 HARDWARE | — | Real Kaggle CLI + credentials + `~/.kaggle` (collaborative) |
| Live LoRA fine-tune (Unsloth) | 🤝 HARDWARE | — | RTX 4060 (8 GB) small-model QLoRA smoke test verifies dataset→Unsloth→LoRA→GGUF; large/multi-GPU → cloud / Kaggle free dual-T4 |

### `valet` router (`valetRouter.ts`)

| Procedure | Status | Tested By | Missing |
|---|---|---|---|
| `valet.testRoute` (`valet.route`, classify prompt) | ✅ VERIFIED | valetRouter.test.ts (delegates to stubbed ValetRouterService, taskType `chat`) | Real classification needs `valet_router_inference.py` on :8010 + GGUF loaded → 🤝 |
| `valet.getMoeChain` | ✅ VERIFIED | valetRouter.test.ts (null when absent + per-user) + dbSchema.test.ts | — |
| `valet.saveMoeChain` | ✅ VERIFIED | valetRouter.test.ts (persist→readback) + dbSchema.test.ts (one-row-per-(user,chainType) upsert) | live `.md` write needs a real projectPath → 🌐 |
| `valet.initMoeChain` | ✅ VERIFIED | valetRouter.test.ts (default cloud steps, GGUF-scan local steps, `preserveExisting` no-clobber, DB persistence) | — |
| `valet.scanLocalModels` | ✅ VERIFIED | valetRouter.test.ts (GGUF mapping over mocked readdir + graceful empty) | real GGUF files on disk → 🤝 |
| MoE chain execution (local) | 🤝 HARDWARE | — | Runnable with a small GGUF on the 4060 (or CPU) via llama.cpp bridge; cloud path already ✅ in moeChainService.test.ts |
| MoE chain execution (cloud) | 🧪 AUTOMATABLE | — | Mock cloud provider, sovereign block |

### `virtualCard` router (`virtualCardRouter.ts`)

| Procedure | Status | Tested By | Missing |
|---|---|---|---|
| `virtualCard.isConfigured` | ✅ VERIFIED | virtualCardRouter.test.ts (reflects service state) | — |
| `virtualCard.issueCard` | ✅ VERIFIED | virtualCardRouter.test.ts (sovereign gate + not-configured + HITL approve/deny + 1/60s rate limit + cents conversion), virtualCardService.test.ts (Lithic issue path, PAN safety, orphan close) | Real card issuance against live Lithic sandbox → 🤝 (optional smoke) |
| `virtualCard.getCard` | ✅ VERIFIED | virtualCardRouter.test.ts (owner-only, safe fields, cross-user NOT_FOUND), sovereignGating.test.ts | — |
| `virtualCard.listCards` | ✅ VERIFIED | virtualCardRouter.test.ts (per-user scoping + **never returns the encrypted credential columns**) | — |
| `virtualCard.revealCardPan` | ✅ VERIFIED | virtualCardRouter.test.ts (Session-31: sovereign gate w/ no decrypt attempted; delegation w/ caller userId → `{pan}`; null→NOT_FOUND) + virtualCardAes.test.ts (AES-256-GCM round-trip at the crypto layer) | — |
| `virtualCard.listTransactions` | ✅ VERIFIED | virtualCardRouter.test.ts (sovereign gate + delegation), virtualCardService.test.ts (**in-suite Lithic mock** — env-switched base, response mapping, not-owned→[], non-OK→[]) | Live Lithic sandbox transaction-sim lifecycle → 🤝 (optional smoke) |

### `voice` router (`voiceRouter.ts`)

| Procedure | Status | Tested By | Missing |
|---|---|---|---|
| `voice.healthCheck` / `whisperHealth` / `ttsHealth` / `rvcHealth` | ✅ VERIFIED | voiceRouter.test.ts (health aggregation + allHealthy + per-bridge delegation) | — |
| `voice.transcribe` (Whisper STT) | ✅ VERIFIED (router) | voiceRouter.test.ts (**bridge-offline degradation**: unreachable→PRECONDITION_FAILED, missing→NOT_FOUND; success delegation) | Real STT needs `voicebox_bridge.py` + a sample WAV → 🤖 |
| `voice.synthesize` (Kokoro/XTTS) | ✅ VERIFIED (router) | voiceRouter.test.ts (unreachable→PRECONDITION_FAILED, non-.wav→BAD_REQUEST; success metadata, no raw buffer leaked) | Real WAV out needs the TTS bridge → 🤖 |
| `voice.listRvcModels` | ✅ VERIFIED | voiceRouter.test.ts (RVC model list via the bridge stub) | Real listing needs the RVC bridge → 🤝 |
| `voice.synthesizeElevenLabs` / `listElevenLabsVoices` / `elevenLabsStatus` | ✅ VERIFIED | voiceRouter.test.ts (cloudProcedure sovereign gate + not-configured→PRECONDITION_FAILED), sovereignGating.test.ts | Live ElevenLabs API key → 🌐 |
| `voice.convertVoice` (RVC) | 🤝 HARDWARE | — | Needs RVC server + a trained voice model; runnable locally once weights are present (collaborative — do last) |

### `wallet` router (`walletRouter.ts`)

| Procedure | Status | Tested By | Missing |
|---|---|---|---|
| `wallet.getSpendLog` | ✅ VERIFIED | walletRouter.test.ts (__global__ no-filter, per-projectId filter, limit) | — |
| `wallet.getSpendSummary` | ✅ VERIFIED | walletRouter.test.ts (GROUP BY provider aggregate math, __global__) | — |
| `wallet.getBudget` | ✅ VERIFIED | walletRouter.test.ts (null for __global__, DB read) | — |
| `wallet.setBudget` | ✅ VERIFIED | walletRouter.test.ts (upsert — insert then update) | — |
| `wallet.resetSpend` | ✅ VERIFIED | walletRouter.test.ts (confirm gate, deletes spend rows) | — |

### `workflow` router (`workflowRouter.ts`)

| Procedure | Status | Tested By | Missing |
|---|---|---|---|
| `workflow.reviewContext` | ✅ VERIFIED | workflowRouter.test.ts (real `git diff` + plan excerpts) | — |
| `workflow.rememberSave` / `rememberRestore` | ✅ VERIFIED | workflowRouter.test.ts (Valet compression + **secret-redacted** memory.md on-disk write; model-failure→INTERNAL_SERVER_ERROR; absent→null + round-trip read-back) | — |
| `workflow.imprint` | ✅ VERIFIED | workflowRouter.test.ts (className extraction into ui-registry.md + **validatePath traversal reject**) | — |

*(Session-31 doc fix: this section previously said `workflow.*` was 🧪 untested — Batch G's `workflowRouter.test.ts` (8) had already covered the skill-command surface.)*

### `system` router (`server/_core/systemRouter.ts`)

| Procedure | Status | Tested By | Missing |
|---|---|---|---|
| `system.health` | ✅ VERIFIED | systemRouter.test.ts (bounded cpu%) | — |
| `system.getSettings` / `saveSettings` | ✅ VERIFIED | systemRouter.test.ts (null→persist round-trip; **saveSettings strips the admin-guarded `sovereignBlockAiOnly`**) | — |
| `system.setSovereignBlockAiOnly` | ✅ VERIFIED | systemRouter.test.ts (admin gate + persist) | — |
| `system.aiProviders` / `loginProviders` / `oauthStatus` / `integrationsStatus` | ✅ VERIFIED | systemRouter.test.ts (config-status **booleans/urls never leak secrets**; flags flip on saved creds; platforms+configured+callbackBase) | — |
| `system.getMyPermissions` / `setExecutionMode` | ✅ VERIFIED | systemRouter.test.ts (RBAC matrix; DB write) | — |
| `system.listUsers` / `setUserRole` | ✅ VERIFIED | systemRouter.test.ts (admin gates; safe columns; role write + **self-demotion guard**) | — |
| `system.detectHardware` | 🧪 AUTOMATABLE | — | Mock GPU detection (`detect_gpu.py` probe) |
| `system.checkDependencies` | 🧪 AUTOMATABLE | — | All 9 tools individually try/catch'd; mock each probe |
| `system.saveKeys` | 🧪 AUTOMATABLE | — | Admin gate, settings file write (sibling of the covered saveSettings) |
| `system.checkForUpdates` | 🔬 PARTIAL | updateCheckerService.test.ts (service layer: tags, 404/403, network, timeout) | thin router wrapper |
| `system.installOllama` / `fetchValetModel` / `installCodebaseMemoryMCP` | 🌐 MANUAL REQUIRED | — | Platform-specific download + spawn (admin-gated) |
| `system.openTerminal` / `getPendingCliOutput` / `clearPendingCliOutput` | 🤖 HARNESS-DRIVABLE | — | Spawn-based CLI relay; drivable with a stub command |
| `system.applyOptimizations` / `notifyOwner` / `runInSandbox` / `listContainers` / `stopContainer` | 🤖 HARNESS-DRIVABLE | — | Admin-gated; Docker rows need a mock/live Docker socket |

*(Session-31 doc fix: this table previously listed only 6 rows, all 🧪/🌐, and a nonexistent `system.getHealth` — Batch G's `systemRouter.test.ts` (16) had already covered the settings/config-status/RBAC/user-admin surface; the remaining genuinely-untested procedures are now itemized honestly.)*

---

## Section 3 — Backend Services (key services in `server/phase2/services/`)

| Service | Status | Tested By | Notes |
|---|---|---|---|
| `AiProviderService` | 🔬 PARTIAL | AiProviderService.streamChat.test.ts | 8 providers; only streaming path partially covered; fallback chain, context overflow, spend tracking untested |
| `AgentService` (RecursiveMAS) | 🤖 HARNESS-DRIVABLE | — | `crewai` pip + `recursive_mas_bridge.py`; drivable locally with a stub/local model — no hardware |
| `ArticleDiscoveryService` | 🧪 AUTOMATABLE | — | RSS fetch mock + BirdClaw integration |
| `AsyncJobService` | ✅ VERIFIED | asyncJobService.test.ts | Job lifecycle, condenser, untracked-event ignore |
| `AuditLogService` | 🔬 PARTIAL | Mocked in all router tests; real behavior untested | File write, retention purge, PII scrub |
| `BirdClawService` | 🌐 MANUAL REQUIRED | — | Playwright-based; requires headless Chrome |
| `BlenderService` | ✅ VERIFIED | blenderRouter.test.ts (checkInstallation + exportScene GLB round-trip) | Requires numpy in Blender's Python (`/home/linux/esptool/venv`) |
| `ComfyService` | ✅ VERIFIED | comfyRouter.test.ts (full image round-trip verified CPU-only; auto-skips offline) + comfyRouterMock.test.ts (router delegation + offline error mapping, always runs) | — |
| `DatasetCurationService` | 🔬 PARTIAL | datasetRouter.test.ts (via router) | Service-level unit tests missing |
| `DatasetDiscoveryService` | 🔬 PARTIAL | datasetRouter.test.ts (via router) | Online scrape untested without external |
| `DockerService` | 🧪 AUTOMATABLE | — | Mock Docker socket; container list/start/stop |
| `ESPToolService` | ✅ VERIFIED (hardware) | espRouter.test.ts | Full path **live-verified 2026-06-30** on a physical ESP32-D0WD-V3: `checkInstallation`/`detectPorts`/`getChipInfo` **+ `compileFirmware` (arduino-cli) + `flashFirmware` (merged image @ `0x0`)** → board BLE-advertised `OMNECOR_TEST_OK`. `flashOffset`/`chip` plumbed through; esptool 5.3.1 ✅ |
| `ElevenLabsService` | 🔬 PARTIAL | sovereignGating.test.ts (blocked in sovereign) | Live API call untested |
| `FalApiService` | 🧪 AUTOMATABLE | — | Mock Fal endpoint; cloudProcedure sovereign block |
| `FileSystemWatcherService` | 🌐 MANUAL REQUIRED | — | Real filesystem events; WS broadcast |
| `HITLApprovalService` | ✅ VERIFIED | hitlApprovalService.test.ts (empty queue, approve→{approved:true}, reject→{approved:false,reason}, multi-action isolation, actionPending event, unknown-id no-op, auto-approve when gate disabled, isHitlGateEnabled) | — |
| `HashTrackerService` | ✅ VERIFIED | actionHashDetector.test.ts (client-side), hashTrackerService.test.ts (server: generateActionHash determinism/key-order, loop detection at threshold=3, broken sequence, event emit, session isolation, reset, remove, snapshot) | — |
| `HonchoService` | 🔬 PARTIAL | sovereignGating.test.ts (sovereign block) | Non-sovereign API round-trip untested |
| `IntegrationManagementService` | 🧪 AUTOMATABLE | — | Config CRUD |
| `JobResultCondenser` | ✅ VERIFIED | jobResultCondenser.test.ts | |
| `KiCadService` | ✅ VERIFIED | kicadRouter.test.ts (checkInstallation + runDRC on minimal fixture) | Gerber/STEP export, real PCB DRC: 🌐 MANUAL REQUIRED |
| `LlamaCppService` | 🤝 HARDWARE | — | Small GGUF on the 4060 (or CPU) via `llamacpp_bridge.py`; collaborative — do last |
| `LocalPodcastService` | 🌐 MANUAL REQUIRED | — | Audio stitching with real TTS output |
| `LocalSubAgentWorker` | 🧪 AUTOMATABLE | — | Try-Fail-Fix loop with mock local model |
| `MCPClientService` | 🌐 MANUAL REQUIRED | — | Requires running MCP server process |
| `MemoryArchitectService` | 🔬 PARTIAL | remoteSourceIngest.test.ts (helper functions), ragContext.test.ts (passthrough guards) | `reindexRemoteSource` with live ChromaDB untested |
| `MeshDiscoveryService` | ✅ VERIFIED | discoveryService.test.ts | Live LAN mDNS untested |
| `ModelManagementService` | 🧪 AUTOMATABLE | — | Registry scan, GGUF management |
| `ModelMarketplaceService` | 🧪 AUTOMATABLE | — | Offline catalog fallback path |
| `MoeChainService` | ✅ VERIFIED | moeChainService.test.ts (cloud: step order, disabled skip, taskCategory filter, rolling context accumulation, onChunk status+content, empty-steps throw, sovereign block; local: LlamaCppService.generate call, unload between steps, missing modelPath throw) | Real GGUF swap: 🤝 HARDWARE (small GGUF on 4060/CPU) |
| `ONNXEmbeddingService` | 🧪 AUTOMATABLE | — | Embedding vector shape |
| `OpenArtService` | 🧪 AUTOMATABLE | — | Mock OpenArt API; cloudProcedure gate |
| `PCBWayService` | 🔬 PARTIAL | pcbFabrication.test.ts (board specs) | Live PCBWay quote API untested |
| `PenpotService` | 🔬 PARTIAL | PenpotService.test.ts | Live Penpot API untested |
| `PipelineEngineService` | 🧪 AUTOMATABLE | — | Graph execution with mock AI; HITL gate, crew-size guard |
| `ProcessManagerService` | ✅ VERIFIED | processManagerCapture.test.ts | |
| `PromptSanitizer` | ✅ VERIFIED | promptSanitizer.test.ts | |
| `PublishingService` (hybrid) | ✅ VERIFIED | publishingService.test.ts (26: webhook routing + native Bluesky/Mastodon/Discord/Telegram, sovereign-gate fail-closed, rate-limit mapping, RateLimitError class — see §1.2 row) | Webhook X/LinkedIn/FB/IG: real post needs a live n8n with connected creds → 🌐. Native: real token per platform → 🌐 |
| `WebhookPublisher` (n8n) | ✅ VERIFIED | publishingService.test.ts (POST contract + synchronous `{ok,platformPostId,url}` mapping, 404/ok:false/rate-limit, **sovereign + non-loopback fails closed**, `isLoopbackUrl`) | A real round-trip through a live n8n workflow → 🌐 |
| `ScraperService` | 🧪 AUTOMATABLE | — | Cheerio/HTML parsing with fixture HTML |
| `SecurityService` (YARA) | 🔬 PARTIAL | securityRouter.test.ts (Session-31: full router surface — validatePath gates + delegation for scan/encrypt/backup/vuln-scan) | Service-level: real YARA rule matching, AES file round-trip, encrypted-ZIP backup (🧪 mockable) |
| `SettingsService` | ✅ VERIFIED | settings.test.ts (client lib); sovereignGating.test.ts (server, settings JSON) | |
| `ThreatIntelService` | 🧪 AUTOMATABLE | — | Mock threat feed parsing |
| `TokenRefreshService` | ✅ VERIFIED | tokenRefreshService.test.ts (checkExpiring: refreshes expiring, ignores no-refreshToken/far-future; Notion 2xx→updates, 4xx→deletes, 5xx/network→intact, no-row no-op; Slack ok=false→deletes, ok=true→intact; unknown provider no-op) | — |
| `UpdateCheckerService` | ✅ VERIFIED | updateCheckerService.test.ts (getCurrentVersion, updateAvailable=true/false, tag without 'v', non-ok 404/403, network ECONNREFUSED, AbortError timeout, currentVersion always populated) | — |
| `ValetArtifactRegistry` | ✅ VERIFIED | valetArtifactRegistry.test.ts (versionedPath: under REGISTRY_ROOT, 8-char hash, slugify, YYYYMMDD suffix; read: ENOENT→pending, valid JSON parsed; seedFromRepoIfMissing: already-ready→false, no candidates→false, pending candidate→false, relative path resolved to absolute→true) | Real GGUF swap: 🤝 HARDWARE (small GGUF on 4060/CPU) |
| `ValetRouterService` | ✅ VERIFIED | valetRouterService.test.ts (isAvailable false when bridge offline, fallback respects preferredMode, defaults to main_api when no preferred, uses first provider, defaults to ollama fallback, getModes static list) | Live bridge: 🌐 MANUAL |
| `ValetServerService` | 🌐 MANUAL REQUIRED | — | Requires GGUF loaded in Ollama |
| `VectorDBService` | 🌐 MANUAL REQUIRED | — | Requires ChromaDB on localhost:8000 |
| `VirtualCardService` | ✅ VERIFIED | virtualCardService.test.ts (issueCard), sovereignGating.test.ts (sovereign block + getCard), virtualCardAes.test.ts (AES-256-GCM round-trip, fresh IV, tamper detection) | — |
| `VoiceService` | 🤖 HARNESS-DRIVABLE | — | TTS/STT bridges driven file-in/file-out (no mic/speaker); live mic capture + playback are the only 🤝 parts |
| `zipArchive` | ✅ VERIFIED | pcbFabrication.test.ts (zipArchive.createZip) | |

---

## Section 4 — Python Bridges (`server/python_bridges/`)

All bridges are separate processes. Reclassified 2026-06-30: a bridge that runs on this box with only a pip install + model weights (no special hardware) is **🤖 HARNESS-DRIVABLE** — start the process, drive it file-in/file-out, auto-skip when absent (the ComfyUI-test pattern). Bridges needing the GPU, USB hardware, or trained voice weights are **🤝 HARDWARE** (collaborative, do last).

| Bridge | Port | Status | What Is Needed |
|---|---|---|---|
| `voicebox_bridge.py` (Whisper STT) | 8001 | 🤖 HARNESS-DRIVABLE | `faster-whisper` pip + model; drive with a sample WAV (no audio device for transcription) |
| `podcast_engine.py` (XTTS-v2/Kokoro TTS) | 8002 | 🤖 HARNESS-DRIVABLE | TTS model weights, CUDA optional; assert WAV output for given text |
| `rvc_server.py` (RVC voice conversion) | 8003 | 🤝 HARDWARE | RVC model + trained voice weights (collaborative) |
| `fal_bridge.py` | 8004 | 🌐 MANUAL REQUIRED | Fal.ai API key |
| `kicad_bridge.py` | (stdio) | 🌐 MANUAL REQUIRED | KiCad installed ✅; run bridge then use KiCad DRC/Gerber/BOM |
| `liteagent_bridge.py` (Valet Router inference) | 8010 | 🤝 HARDWARE | Small GGUF on 4060/CPU (collaborative) |
| `recursive_mas_bridge.py` (CrewAI) | 8011 | 🤖 HARNESS-DRIVABLE | `crewai` pip, Python 3.10+; stub/local model — no hardware |
| `llamacpp_bridge.py` | 8013 | 🤝 HARDWARE | llama.cpp binary + small GGUF on 4060/CPU (collaborative) |
| `blender_bridge.py` | (stdio) | 🌐 MANUAL REQUIRED | Blender installed ✅ + `bpy`; run bridge then test render/export |
| `esptool_bridge.py` | ✅ VERIFIED (hardware) | esptool 5.3.1 ✅; **live-verified 2026-06-30** with a physical ESP32-D0WD-V3 on `/dev/ttyUSB0` — detect, chip-info, **and full `write_flash` of a merged image at `0x0`** (board then advertised `OMNECOR_TEST_OK`). Fixed the hardcoded `0x1000` offset → now a `--flash_offset`/`--chip` param (default `0x0`). |
| `crewai_bridge.py` | (stdio) | 🤖 HARNESS-DRIVABLE | `crewai` pip; stub/local model — no hardware |
| `detect_gpu.py` | — | 🧪 AUTOMATABLE | Pure script; mock `nvidia-smi`/`rocm-smi` output |
| `threat_scanner.py` (YARA) | — | 🧪 AUTOMATABLE | Mock YARA rule file |
| `ollama_proxy.py` | — | 🌐 MANUAL REQUIRED | Running Ollama daemon |
| `valet_router_inference.py` | 8010 | 🌐 MANUAL REQUIRED | `omnecor-valet-router:v2-q8` model loaded in Ollama (Windows node `192.168.1.78`) |
| Valet training pipeline (`valet_pipeline.py` / `valet_dataset_builder.py` / etc.) | — | 🤝 HARDWARE | RTX 4060 small-model smoke test, or Kaggle free dual-T4; Unsloth (collaborative) |

---

## Section 5 — Frontend Web Pages (15 routes)

UI pages require browser rendering. Logic libraries are tested; visual/interactive behavior is manual.

### `/setup` — SetupWizard

| Feature | Status | Notes |
|---|---|---|
| 8-step wizard navigation | 🌐 MANUAL REQUIRED | Step rendering, back/next, glassmorphic overlay |
| Mode selector (Sovereign/Scrapper/Big Spender) | 🌐 MANUAL REQUIRED | Saves to DB; verify `executionMode` persists |
| Ollama URL field + scan hardware | 🌐 MANUAL REQUIRED | Requires running Ollama |
| API key fields (OpenAI, Anthropic, Gemini, Groq) | 🌐 MANUAL REQUIRED | Verify masked inputs save via `system.saveKeys` |
| mDNS discovery toggle | 🌐 MANUAL REQUIRED | Verify OMMESH toggle persists |
| Dependency checklist step | 🌐 MANUAL REQUIRED | 9 tool probes, Re-check button, auto-install Ollama |
| Kaggle.json file dropzone | 🌐 MANUAL REQUIRED | Verify secure file drop (not path input) |
| Zero-login mode defaults to `scrapper` | 🌐 MANUAL REQUIRED | One-time first-boot verification |

### `/` — Dashboard

| Feature | Status | Notes |
|---|---|---|
| Navigation cards render | 🌐 MANUAL REQUIRED | Scale-on-hover, routing to sub-pages |
| Hardware poller (CPU/GPU/VRAM rings) | 🌐 MANUAL REQUIRED | Real-time updates via `system.detectHardware` |
| OMMESH peer card in header | 🌐 MANUAL REQUIRED | Requires a LAN peer |

### `/chat` — Chat Workspace

| Feature | Status | Notes |
|---|---|---|
| Session create/list/select | 🌐 MANUAL REQUIRED | Three-pane layout |
| Project vs Global scope filter | 🌐 MANUAL REQUIRED | Tab row, `filterScope` localStorage persistence |
| Message send → AI response stream | 🌐 MANUAL REQUIRED | Requires working AI provider |
| `/` command autocomplete | 🌐 MANUAL REQUIRED | Commands: /MOE-Chain, /remember, /imprint, etc. |
| `@` file references | 🌐 MANUAL REQUIRED | Context injection from BrainMap |
| Voice input (hold-to-record) | 🌐 MANUAL REQUIRED | Requires Whisper STT bridge |
| Stop generation button | 🌐 MANUAL REQUIRED | Stream abort |
| Memory Archiver (50-message auto-compress) | 🌐 MANUAL REQUIRED | Requires chat history |
| Terminal/CLI (`EmbeddedTerminal.tsx`, live xterm.js + node-pty) | ✅ VERIFIED | **Session-30.** Was fully broken (WS envelope drift dropped every keystroke) — fixed + live-verified via chrome-devtools MCP: real bash PTY, HITL command approval, AI-initiated commands via `<terminal_command>` directive (see WebSocket Server section) |
| Sandboxed Terminal (`TerminalPanel.tsx`, Docker) | 🌐 MANUAL REQUIRED | Scoped to `activeMap.id`. Its AI-initiated bridge (`omnecor:sandbox_command`) remains unwired — nothing dispatches it yet, unlike the now-fixed Terminal/CLI bridge |
| Attachments upload | 🌐 MANUAL REQUIRED | File picker → attachmentsRouter |
| Script save/rename/delete | 🌐 MANUAL REQUIRED | Server-backed scripts, localStorage migration |
| Session title auto-name | 🌐 MANUAL REQUIRED | |
| LoadingQuote display | 🌐 MANUAL REQUIRED | Wired to `chatDisplaySettings` Zustand |
| Token count indicator | 🌐 MANUAL REQUIRED | BPE tokenizer, model-aware |
| Responsive stacking (mobile viewport) | 🌐 MANUAL REQUIRED | `flex-col sm:flex-row` button layout |
| Auto-switch model on session select | 🌐 MANUAL REQUIRED | TDZ fix verified by `pnpm check` |

### `/brain-map` — Neural BrainMap

| Feature | Status | Notes |
|---|---|---|
| Local directory rendering | 🌐 MANUAL REQUIRED | Requires real project path |
| GitHub source rendering | 🔬 PARTIAL | Live-verified 2026-06-20 with real PAT (41 top-level, 1500 nodes) |
| Dropbox/OneDrive sources | 🌐 MANUAL REQUIRED | Requires registered OAuth app + credentials |
| Integration sources (Notion, Slack, Gmail, etc.) | 🌐 MANUAL REQUIRED | Requires active OAuth per platform |
| Layout selector (Force/Hierarchical/Mind-Map/Circular) | 🌐 MANUAL REQUIRED | Barnes-Hut worker, compute overlay |
| Auto-Clustering toggle | 🌐 MANUAL REQUIRED | Layout algorithm verification |
| Node size / animation speed sliders | 🌐 MANUAL REQUIRED | Zustand + localStorage persist |
| Truncated folder lazy expansion (double-click) | 🌐 MANUAL REQUIRED | Fetch subtree + merge |
| Inline label editing | 🌐 MANUAL REQUIRED | `labelOverrides` in DB |
| Right-click → Add to Context | 🌐 MANUAL REQUIRED | Drag-to-context grip; appended to chat |
| Index button + live progress polling | 🌐 MANUAL REQUIRED | Requires ChromaDB |
| RAG context injection into chat | 🌐 MANUAL REQUIRED | Requires ChromaDB + active map |
| Fiction Mode toggle | 🌐 MANUAL REQUIRED | Verify Sovereign ≠ Fiction mode |
| Multi-selection (Shift+Click/Drag) | 🌐 MANUAL REQUIRED | |
| `/brain-map-external` detach/redock | 🌐 MANUAL REQUIRED | Multi-window |

### `/model-hub` — ModelHub

| Feature | Status | Notes |
|---|---|---|
| Live API model discovery (OpenAI/Anthropic/Gemini/Grok/HF) | 🌐 MANUAL REQUIRED | Requires API keys |
| Offline sovereign fallback catalog | 🔬 PARTIAL | Progress tracker notes DNS failure handled; needs real offline test |
| Activated models toggle → localStorage | 🌐 MANUAL REQUIRED | `omnecor:activeModels` key |
| Ollama local model list | 🌐 MANUAL REQUIRED | Requires Ollama |
| Pull model | 🌐 MANUAL REQUIRED | Requires Ollama |
| Delete model | 🌐 MANUAL REQUIRED | Requires Ollama |
| "Use Model" → redirect to chat | 🌐 MANUAL REQUIRED | |

### `/pipelines` — GodMode Pipelines

| Feature | Status | Notes |
|---|---|---|
| List pipelines (All/Project/Global tabs) | 🌐 MANUAL REQUIRED | `filterScope` with active project |
| Create pipeline with scope checkbox | 🌐 MANUAL REQUIRED | `projectId` in payload |
| Phase approvals (HITL checkpoints) | 🌐 MANUAL REQUIRED | Requires running pipeline |
| Abort running pipeline | 🌐 MANUAL REQUIRED | |
| LocalSubAgentWorker integration | 🌐 MANUAL REQUIRED | Requires local model |

### `/3d-designer` — 3D Designer

| Feature | Status | Notes |
|---|---|---|
| 3D Viewer (Three.js) — mesh rendering | 🌐 MANUAL REQUIRED | WebGL |
| PCB/Schematic Editor — drag-drop components | 🔬 PARTIAL | editor.integration.test.ts (component library + placement logic) |
| PCB Editor first-boot infinite loop fix | ✅ VERIFIED | `pnpm check` 0; TD-046 documented |
| PCB canvas drop crash fix | ✅ VERIFIED | `pnpm check` 0; backward-compat guard in SchematicNode/PCBNode |
| Auto-save debounce (1.5s) | 🌐 MANUAL REQUIRED | Network tab verification |
| 49-component library search | 🔬 PARTIAL | editor.integration.test.ts |
| Web Preview (sandboxed iframe) | 🌐 MANUAL REQUIRED | AI-generated UI injection |
| WYSIWYG Visual Editor | 🌐 MANUAL REQUIRED | Style inspector, element drag, inline text edit |
| Code Editor (tab-based virtual FS) | 🌐 MANUAL REQUIRED | Scroll-synced line numbers, Markdown preview |
| Visual Diff Checker (Accept/Reject/Suggest) | 🌐 MANUAL REQUIRED | |
| Blender Bridge (headless render) | 🌐 MANUAL REQUIRED | Blender installed ✅; start `blender_bridge.py`, then render |
| KiCad Bridge (DRC/ERC) | 🌐 MANUAL REQUIRED | KiCad installed ✅; start `kicad_bridge.py`, then run DRC |
| PCBWay quoting/ordering | 🌐 MANUAL REQUIRED | HITL-gated; requires PCBWay credentials |
| AIAssistantPanel LoadingQuote | 🌐 MANUAL REQUIRED | |

### `/integrations` — Integrations Manager

| Feature | Status | Notes |
|---|---|---|
| Connect OAuth service (Dropbox/OneDrive/Google Drive) | 🌐 MANUAL REQUIRED | Requires registered app + `PUBLIC_URL` redirect URI |
| Disconnect service | 🌐 MANUAL REQUIRED | Verifies `platformAccounts` deactivation |
| Sync / Health check button | 🌐 MANUAL REQUIRED | |
| Add MCP server (command path, ID, transport) | 🌐 MANUAL REQUIRED | Requires an MCP server |
| Service connection credentials card (Admin only) | 🌐 MANUAL REQUIRED | `isAdmin`-gated; copyable callback URI |

### `/agent-networking` — AgentNetworking

| Feature | Status | Notes |
|---|---|---|
| Discovery tab (RSS/API article feed) | 🌐 MANUAL REQUIRED | Live RSS or BirdClaw |
| Curator decisions (curate/schedule/regenerate) | 🌐 MANUAL REQUIRED | Requires AI provider |
| Content calendar | 🌐 MANUAL REQUIRED | |
| Auto-pilot switch | 🌐 MANUAL REQUIRED | Background worker interval |
| OMMESH trust queue | 🌐 MANUAL REQUIRED | Requires LAN peer |
| Social publish — webhook (X/LinkedIn/FB/IG) | 🔬 PARTIAL | Routing/contract/sovereign-gate ✅ in publishingService.test.ts; an actual post needs a live n8n with connected creds |
| Social publish — native (Bluesky/Mastodon/Discord/Telegram) | 🔬 PARTIAL | Request shape ✅ unit-tested; a real post needs a real account secret per platform |
| Engagement analytics | 🌐 MANUAL REQUIRED | Requires post history |
| Platform connect — "Enable via n8n" (X/LinkedIn/FB/IG) + native connect forms (Bluesky/Mastodon/Discord/Telegram) | 🤖 HARNESS-DRIVABLE | Connect = `platforms.addAccount`; n8n status = `getPublishingRouting`. Drivable via createCaller / chrome-devtools MCP. (Old OAuth brand-button grid removed; YouTube/TikTok no longer offered.) |

### `/podcast-studio` — PodcastStudio

| Feature | Status | Notes |
|---|---|---|
| Script timeline rows (add/delete/reorder) | 🌐 MANUAL REQUIRED | |
| Speaker + emotion dropdowns | 🌐 MANUAL REQUIRED | |
| Generate Podcast button | 🤖 HARNESS-DRIVABLE | Run `podcast_engine.py`; assert WAV segments returned |
| Waveform playback bar | 🌐 MANUAL REQUIRED | Render is drivable; *audible* playback is a 🤝 hardware check |
| Download WAV / export JSON | 🤖 HARNESS-DRIVABLE | Drive export, assert WAV/JSON written to disk |

### `/wallet` — AgenticWallet

| Feature | Status | Notes |
|---|---|---|
| Spend log chart (Global vs Project scope toggle) | 🌐 MANUAL REQUIRED | Requires spend history |
| Issue Virtual Card (HITL-gated) | 🔬 PARTIAL | sovereignGating.test.ts (blocked in sovereign); HITL dialog live-built |
| Unmask card details toggle | 🌐 MANUAL REQUIRED | AES-256-GCM PAN decrypt |
| Budget limit sliders | 🌐 MANUAL REQUIRED | |

### `/notifications` — Notifications Console

| Feature | Status | Notes |
|---|---|---|
| Notification list + unread badge | 🌐 MANUAL REQUIRED | Badge clear verified fixed (invalidateAll) |
| Agent Messenger conversations | 🌐 MANUAL REQUIRED | Per-persona conversations |
| Clear logs | 🌐 MANUAL REQUIRED | |
| LoadingQuote in Agent Messenger | 🌐 MANUAL REQUIRED | |

### `/settings` — System Settings

| Feature | Status | Notes |
|---|---|---|
| Execution mode toggle (Sovereign/Scrapper/Big Spender) | 🌐 MANUAL REQUIRED | Saved to DB, verified persists |
| Zero-login mode execution mode selector enabled | 🌐 MANUAL REQUIRED | Progress tracker: fixed 2026-06-25 |
| Settings search input (tab filter) | 🌐 MANUAL REQUIRED | |
| Knowledge base ingest path selector | 🌐 MANUAL REQUIRED | Requires ChromaDB |
| Audit retention panel | 🌐 MANUAL REQUIRED | 14/28/permanent; 6-hour purge |
| Valet Router panel + MoE Chain panel | 🌐 MANUAL REQUIRED | Valet requires GGUF; MoE chain requires local models |
| Persona Creation panel | 🌐 MANUAL REQUIRED | Bio/tone/schedule |
| Pair Device panel (QR code) | 🌐 MANUAL REQUIRED | Requires mobile device |
| Service Connections card (Admin) | 🌐 MANUAL REQUIRED | 10 providers, client id/secret, callback URI |
| Cloud Compute panel | 🌐 MANUAL REQUIRED | Vast.ai/RunPod/Lambda credentials |
| OMMESH settings (mDNS toggle, secret) | 🌐 MANUAL REQUIRED | |

### `/llm-builder` — LLM Builder

| Feature | Status | Notes |
|---|---|---|
| Dataset curation panel (BFS scan, web scrape) | 🔬 PARTIAL | datasetRouter.test.ts covers router; DatasetCurationPanel is UI-only |
| Unsloth fine-tuning form | 🤝 HARDWARE | Local RTX 4060 small-model QLoRA smoke test, or Kaggle free tier (collaborative) |
| Kaggle.json dropzone (secure) | 🌐 MANUAL REQUIRED | Verify file drop vs. path input |

---

## Section 6 — APK Screens (`packaging/android/omnecor-hq/app/(tabs)/`)

The APK requires a physical arm64 Android device or emulator (ARM64-only — LiteRT-LM constraint).

**Build status:** `assembleDebug` BUILD SUCCESSFUL (101 MB `app-debug.apk`) without the `rm -rf` workaround. `assembleRelease` (118 MB signed APK) built 2026-06-16. `pnpm check` (APK workspace) passes.

| Screen | Status | Automated Coverage | Manual Checklist |
|---|---|---|---|
| `(tabs)/index.tsx` — Chat | 🌐 MANUAL REQUIRED | — | Session picker, audio recorder, WS reconnect on nav |
| `(tabs)/viewer.tsx` — 3D Viewer | 🌐 MANUAL REQUIRED | — | WebGL WebView, pinch/drag gestures, mesh highlight |
| `(tabs)/podcast.tsx` — Podcast | 🤝 HARDWARE | — | arm64 device + TTS bridge (collaborative) |
| `(tabs)/settings.tsx` — Settings | 🌐 MANUAL REQUIRED | — | Desktop IP/port/SSH, ping test, dark mode toggle |
| `(tabs)/notifications.tsx` — Agent Messenger | 🌐 MANUAL REQUIRED | — | WS receive, read/unread, LoadingQuote |
| `(tabs)/terminal.tsx` — Terminal | 🌐 MANUAL REQUIRED | — | Command input, HITL approval |
| `(tabs)/status.tsx` — System Status | 🌐 MANUAL REQUIRED | — | Hardware metrics via WS |
| `(tabs)/ai-node.tsx` — AI Node (LiteRT-LM) | 🤝 HARDWARE | — | `.litertlm` model on a physical arm64 phone (collaborative) |
| `app/oauth/callback.tsx` | 🤝 HARDWARE | — | OAuth deep-link return on a physical device (collaborative) |
| `_layout.tsx` + `(tabs)/_layout.tsx` | 🌐 MANUAL REQUIRED | — | Tab navigation, theme, Pressable gesture handler |

### APK Specific Checklist (must be done on physical device)

- [ ] Sideload `app-debug.apk` via `adb install`
- [ ] App launches without crash (Metro bundle is standalone — no dev server)
- [ ] LiteRT-LM model download flow (`.litertlm` file)
- [ ] WS token auth (`?token=` query param, not cookie)
- [ ] OMMESH registration via `mobile_node_register` with correct `OMMESH_SECRET`
- [ ] Wake-word → STT → AI → response loop (requires Whisper bridge + AI provider)
- [ ] Audio recorder hold-to-record encoding
- [ ] SecureStore credential storage (not AsyncStorage for secrets)
- [ ] AsyncStorage encrypted audit ring buffer
- [ ] Dark mode toggle
- [ ] Gesture handler (Pressable from `@/components/pressable` wrapper)
- [ ] `nanoid` Metro shim: confirm no `crypto.randomFillSync` crash
- [ ] `llama.rn` 0.12.4 on Snapdragon: confirm no `libcdsprpc.so` crash (tryLoadLibrary fallback)

---

## Section 7 — Infrastructure & Cross-Cutting

### Database / Schema

| Item | Status | Notes |
|---|---|---|
| Migration generation (`pnpm build:push`) | ✅ VERIFIED | Gates confirm `tsc 0` and migration files exist |
| Migration apply (`pnpm db:migrate`) | ✅ VERIFIED | Used in CI harness; `createTestDb()` runs real migrations |
| Schema: all PKs are integers | ✅ VERIFIED | Confirmed in code review sweep |
| No `insertId` MySQL pattern | ✅ VERIFIED | Code-sweep 2026-06-22 confirmed clean |
| `getDb()` never null | ✅ VERIFIED | Null-guard sweep complete |
| FK cascade on deleteSession | ✅ VERIFIED | chatRouter.test.ts |
| All tables properly user-scoped | ✅ VERIFIED | chatRouter/aiRouter ✅; Batch A added walletRouter/personaRouter/scriptsRouter ownership tests; Batch G closed the rest (every registered router has route-level coverage incl. cross-user isolation) |
| `neuralMaps` table + CRUD | ✅ VERIFIED | neuralMapsRouter.test.ts (17: upsert, labelOverrides JSON, cascade, IDOR) + dbSchema.test.ts (DB-level cascade) |
| `moeChainConfigs` table + upsert | ✅ VERIFIED | dbSchema.test.ts + valetRouter.test.ts (one-row-per-(userId,chainType) app-level upsert) |
| `savedScripts` table + CRUD | ✅ VERIFIED | scriptsRouter.test.ts (16: CRUD + mapId scoping + ownership) |

### WebSocket Server

| Item | Status | Notes |
|---|---|---|
| Connection + session cookie auth | 🌐 MANUAL REQUIRED | |
| APK `?token=` auth | 🌐 MANUAL REQUIRED | Physical device |
| `mobile_node_register` with OMMESH_SECRET | 🌐 MANUAL REQUIRED | Requires correct secret |
| Notification broadcast | 🌐 MANUAL REQUIRED | |
| Incremental BrainMap node push | 🌐 MANUAL REQUIRED | |
| HMR WebSocket (dev, `clientPort` fix) | 🌐 MANUAL REQUIRED | Vite dev server |
| Socket churn freeze fix | ✅ VERIFIED | `onEvent` ref + `pnpm check` 0 |
| `pty:spawn`/`pty:input`/`pty:resize`/`pty:output`/`pty:exit` contract | ✅ VERIFIED | **Session-30.** Was broken end-to-end (client/server independently-typed envelopes had drifted — every keystroke was silently dropped). Fixed via shared `shared/types/terminal.types.ts` (imported by both `EmbeddedTerminal.tsx` and `WebSocketServer.ts` — drift is now a compile error) + corrected `pty:output`/`pty:exit` parsing + added `error` message handling. Live-verified via chrome-devtools MCP: real bash PTY spawn, keystroke round-trip (`echo` → real output), HITL deny/approve gate |
| AI-initiated terminal commands (`omnecor:cli_command` → `pty:input`) | ✅ VERIFIED | **Session-30 (new feature).** `<terminal_command>` directive (Chat.tsx, disclosed only when the terminal is open, non-fiction-mode) → `terminalDirective.ts` extraction → `EmbeddedTerminal.tsx` listener gates through the same `requestApproval()` HITL flow as manual typing, auto-opens the terminal via `onRequestOpen` if closed, queues the command until `pty:ready`. Live-verified via chrome-devtools MCP with the terminal closed: dispatch → HITL dialog fired → approved → terminal auto-opened → command executed with real output. The old `chat:toTerminal` WS type (bypassed HITL, never sent by any code path) was removed. No permanent automated test for the full WS+PTY round-trip — see Section 12 |

### Security / Auth

| Item | Status | Notes |
|---|---|---|
| JWT session cookie (httpOnly, sameSite:strict) | 🌐 MANUAL REQUIRED | Browser devtools inspect |
| PKCE enforcement | 🔬 PARTIAL | oauthClients.test.ts (config) | State DB-backed 10-min TTL untested |
| AES-256-GCM integrations.json encryption | ✅ VERIFIED | integrationsRouter.test.ts (connect stores ciphertext — raw token never present in the store file) |
| `validatePath` security on all file ops | ✅ VERIFIED | pathTraversal.test.ts (traversal rejection, sibling bypass, baseDir enforcement, valid paths) |
| RBAC (Viewer/User/Admin/Owner) | ✅ VERIFIED | accessControl.test.ts (all 5 roles × all resource types); device-role.test.ts (phone role) |
| Rate limiter (API only, skip Vite) | ✅ VERIFIED | `pnpm check` 0; dev-mode fix code-verified |
| CORS not `*` | ✅ VERIFIED | Code-sweep confirmed |
| `dangerouslySetInnerHTML` all sanitized | ✅ VERIFIED | Code-sweep confirmed (DOMPurify + static SVG) |
| No `exec`/`execSync` string interpolation in prod | ✅ VERIFIED | Code-sweep confirmed |
| No hardcoded secrets | ✅ VERIFIED | Code-sweep confirmed |
| Header injection guard (Gmail) | ✅ VERIFIED | gmailMessage.test.ts |
| Sovereign mode enforcement on cloud providers | ✅ VERIFIED | sovereignGating.test.ts, aiRouter.test.ts, AiProviderService.streamChat.test.ts |
| OMMESH mTLS + cert pinning | 🌐 MANUAL REQUIRED | Live-verified 2026-06-16 (Linux↔Windows) |
| OMMESH secret timing-safe comparison | ✅ VERIFIED | tokenCrypto.test.ts (secretsMatch + verifyHmacSig algorithm: correct/wrong/tampered/non-hex/fail-closed) |
| PII redaction on audit logs | ✅ VERIFIED | redaction.test.ts |
| Prompt sanitization (injection defense) | ✅ VERIFIED | promptSanitizer.test.ts |

### Electron Desktop App

| Item | Status | Notes |
|---|---|---|
| AppImage build (Linux) | ✅ VERIFIED | `Omnecor-2.3.0-beta.1-x86_64.AppImage` built 2026-06-16 |
| `.deb` build (Linux) | ✅ VERIFIED | `Omnecor_2.3.0-beta.1_amd64.deb` built 2026-06-16 |
| Windows installer | 🌐 MANUAL REQUIRED | Built on Windows box; install + test pending |
| OAuth redirect URI (PORT=37291) | ✅ VERIFIED | `getRedirectUri()` fix code-verified |
| Auth session cookie in desktop | 🌐 MANUAL REQUIRED | App runs on 37291; login flow |
| Electron React 19 version match | ✅ VERIFIED | Bump code-verified; `useContext null` crash resolved |
| `taskkill` execFileSync (Windows) | ✅ VERIFIED | Code-verified (no shell interpolation) |

### Build Gates

| Gate | Status | Last Confirmed |
|---|---|---|
| `pnpm check` (root TypeScript) | ✅ VERIFIED | 2026-06-29 (0 errors) |
| `pnpm test` (1194 passing, 0 skipped w/ all bridges incl. ComfyUI; 1193 + 1 skipped without ComfyUI) | ✅ VERIFIED | 2026-07-02 (Session-31) |
| `pnpm build` (Vite + esbuild) | ✅ VERIFIED | 2026-06-28 |
| `pnpm audit --prod` | ✅ VERIFIED | 2026-06-22 (0 vulns) |
| APK `pnpm check` (mobile workspace) | ✅ VERIFIED | 2026-06-29 (0 errors) |
| APK `assembleDebug` (without `rm -rf`) | ✅ VERIFIED | 2026-06-21 (root cause resolved) |

---

## Section 8 — Manual Test Checklist

These items **cannot** be automated without external services, real credentials, or a physical device. Execute in priority order.

### Priority 1 — Core Server (No Hardware, Needs Dev Server)

Run `pnpm dev` with `ZERO_LOGIN_MODE=true` in `.env`.

- [ ] **Health endpoint** — `GET /health` returns 200
- [ ] **tRPC panel** — `/api/trpc` responds to a `GET auth.me`
- [ ] **Zero-login banner** — Shows "Zero Login Mode" badge in UI
- [ ] **Execution mode selector** — Change Sovereign → Scrapper → Big Spender; verify DB-persisted (reload, confirm mode)
- [ ] **Chat session** — Create, rename, delete a chat session; verify per-user isolation with two browser tabs
- [ ] **Script save/load** — Write a script in chat, save it, reload page, verify it reloads from server (not localStorage)
- [ ] **Neural Map create/delete** — Create a map, add a local directory root, verify tree renders
- [ ] **Notifications** — Create a notification via WS, verify badge increments, verify clear resets to 0
- [ ] **Settings JSON write** — Change a setting in Settings page, verify `.omnecor/settings.json` updated on disk
- [ ] **HITL queue** — Trigger a HITL action (e.g., crew > 3), verify it appears in security queue, approve/reject

### Priority 2 — AI Inference (Needs API Keys or Local Model)

Set `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` in `.env`, or run Ollama locally.

- [ ] **Chat → AI response** — Send a message, verify streaming response renders
- [ ] **Stop generation** — Click stop mid-stream, verify stream aborts cleanly
- [ ] **Memory Archiver** — Build a 50+ message chat; verify auto-compress triggers
- [ ] **RAG injection** — Index a local directory, open a chat with that map active, ask about a file, verify it references the file
- [ ] **Sovereign mode blocks AI** — Switch to Sovereign, attempt an OpenAI/Anthropic chat, verify FORBIDDEN error shown
- [ ] **Sovereign mode allows Ollama** — In Sovereign mode, chat via a local Ollama model, verify success
- [ ] **Valet Router classify** — Send a coding prompt, verify Valet classifies it as `code_generation`
- [ ] **MoE Chain** — Enable a 2-step local MoE chain, run `/MOE-Chain L`, verify two sequential local model invocations

### Priority 3 — External Integrations (Needs Credentials)

For each integration, set the relevant env vars or configure via Settings → Service Connections.

- [ ] **GitHub source in BrainMap** — Connect GitHub PAT, add `github://owner/repo` root, verify tree renders (previously live-verified 2026-06-20; re-verify post-session)
- [ ] **Google OAuth login** — Sign in with Google (`GOOGLE_EMULATOR_URL` or real credentials), verify JWT session cookie set
- [ ] **Microsoft OAuth login** — Same with Microsoft
- [ ] **Gmail send** — Connect Google OAuth with `gmail.send` scope, send a test email, verify delivery
- [ ] **Google Drive source** — Connect Drive, add as Neural Map source, verify folder listing
- [ ] **Dropbox source** — Set `DROPBOX_CLIENT_ID/SECRET`, connect, add as source, verify paginated listing (up to 1000 items)
- [ ] **OneDrive source** — Set `ONEDRIVE_CLIENT_ID/SECRET`, connect, verify same
- [ ] **Social post — webhook (X/LinkedIn/FB/IG)** — Run local n8n, import `omnecor-social-publish.blueprint.json`, connect a platform node, Enable via n8n, `publishNow`, verify the post lands and `{ok,platformPostId,url}` comes back
- [ ] **Social post — native (Bluesky/Mastodon/Discord/Telegram)** — Connect with a real account secret, `publishNow`, verify the post is created
- [ ] **Honcho memory layer** — Set `HONCHO_API_KEY`, chat, verify facts are stored and retrieved

### Priority 4 — Python Bridges (Needs Local Tools)

- [ ] **Whisper STT** — Start `voicebox_bridge.py`, hold-record in chat, speak, verify transcription
- [ ] **TTS synthesis** — Start `podcast_engine.py`, generate a 1-line podcast, verify WAV playback
- [ ] **llama.cpp inference** — Start `llamacpp_bridge.py` with a GGUF, chat via llama.cpp provider, verify response
- [ ] **ComfyUI** — Start ComfyUI on port 8188 (installed ✅), load a workflow in Pipelines, run it, verify image output
- [x] **Blender GLB export** — `BlenderBridge.exportScene()` → headless GLB of default cube, glTF magic bytes verified ✅ (requires numpy in Blender's Python — installed ✅)
- [ ] **Blender render** — Headless PNG render via ProcessManagerService; bridge installed ✅, numpy installed ✅
- [x] **KiCad DRC** — `KiCadBridge.runDRC()` on 30mm×20mm fixture with copper trace+via → CheckResult shape verified ✅
- [ ] **KiCad Gerber export** — Requires real .kicad_pcb with net-connected footprints; KiCad installed ✅
- [x] **ESPTool detect + flash** — ✅ 2026-06-30: physical ESP32-D0WD-V3 on `/dev/ttyUSB0`. `esp.detectPorts` + `esp.getChipInfo` live-verified (MAC `3c:8a:1f:ae:b5:7c`, 4 MB flash); `esp.compile` (arduino-cli) + `esp.flash` (merged image @ `0x0`) flashed a BLE sketch → board advertised `OMNECOR_TEST_OK` (serial-confirmed). Full chain closed.
- [ ] **Valet Router inference** — Ensure `omnecor-valet-router:v2-q8` loaded in Ollama on `192.168.1.78`, verify route accuracy

### Priority 5 — OMMESH Multi-Node (Needs 2+ Machines)

Previously live-verified 2026-06-16 (Linux↔Windows). Re-verify after any OMMESH changes.

- [ ] **mDNS discovery** — Both nodes on same LAN, `ommesh.discover`, verify bidirectional peer list
- [ ] **Cross-node mTLS inference** — Provision shared CA + per-node certs; Linux→Windows inference, verify `executedBy: "omnecor-win-clark"`; Windows→Linux, verify reverse
- [ ] **Cert pinning** — Attempt connection from a non-pinned peer; verify rejection
- [ ] **Sovereign mesh guard** — In Sovereign mode, attempt cloud provider via mesh; verify blocked
- [ ] **Android as 3rd node** — Set `OMMESH_SECRET` in APK Settings, register via `mobile_node_register`, verify trust queue entry

### Priority 6 — Android APK (Needs Physical arm64 Device)

- [ ] **Sideload** — `adb install app-debug.apk` succeeds
- [ ] **Launch** — App opens without crash; no `libcdsprpc.so` error on Snapdragon
- [ ] **WS auth** — App connects to desktop server, `?token=` auth verified in server logs
- [ ] **Chat tab** — Send a message, receive AI response (requires desktop with AI provider)
- [ ] **Audio recorder** — Hold-to-record, verify audio captured (WAV/PCM)
- [ ] **Dark mode toggle** — Verify theme changes immediately
- [ ] **Settings → Desktop IP** — Enter server IP/port, ping test succeeds
- [ ] **SecureStore** — Verify no plaintext credentials in AsyncStorage (adb shell `run-as`)
- [ ] **LoadingQuote animation** — Verify Reanimated animation runs smoothly
- [ ] **LiteRT-LM model** — Download `.litertlm` model, run on-device inference, verify response
- [ ] **`react-native-gesture-handler` Pressable** — Tap/press interactions don't crash on RN 0.83

### Priority 7 — Electron Desktop

- [ ] **Linux AppImage** — Launch `Omnecor-2.3.0-beta.1-x86_64.AppImage`, verify login screen
- [ ] **Linux .deb** — Install `Omnecor_2.3.0-beta.1_amd64.deb`, launch from app menu
- [ ] **Windows installer** — Install on Windows PC; verify PORT=37291, OAuth redirect URI correct
- [ ] **Desktop OAuth** — Sign in with Google via desktop app; verify session on port 37291

---

## Section 9 — Summary Table

> ⚠️ These `~` category totals are a rough scale only (re-estimated Session-31, 2026-07-02). Treat Section 12 as the live bucketing. The true ⛔ count is **~0**.

| Category | Total Items | ✅ Verified | 🔬 Partial | 🧪 Automatable | 🌐 Manual / 🤖 / 🤝 | ⛔ Blocked |
|---|---|---|---|---|---|---|
| Router procedures | ~145 | ~105 | ~6 | ~5 | ~29 | ~0 |
| Services | 47 | 14 | 13 | 12 | 8 | 0 |
| Python bridges | 16 | 3 | 0 | 2 | 11 | 0 |
| Web pages / features | ~120 | ~28 | ~8 | 0 | ~84 | ~0 |
| APK screens | 12 | 3* | 0 | 0 | 9 | 0 |
| Infrastructure | 30 | 24 | 3 | 2 | 1 | 0 |
| Build gates | 6 | 6 | 0 | 0 | 0 | 0 |

\* APK: `pnpm check` 0, `assembleDebug` BUILD SUCCESSFUL, `rm -rf` workaround removed — build chain verified; runtime on-device is the gap.

---

## Section 10 — Automation Backlog (Priority Order)

These items are 🧪 AUTOMATABLE and should be written next to improve the verified floor. Work these in order before doing manual testing to maximize automation coverage.

### Batch A — High-Value Router Tests (no external deps) ✅ COMPLETE (2026-06-29)

1. ✅ `scriptsRouter` — CRUD + mapId scoping (FK seeded) + ordering — `server/__tests__/scriptsRouter.test.ts` (16 tests)
2. ✅ `neuralMapsRouter` — CRUD + remote-root removal (MemoryArchitectService mock) + migrate upsert + delete child-cascade + IDOR guard — `server/__tests__/neuralMapsRouter.test.ts` (17 tests)
3. ✅ `walletRouter` — getBudget/setBudget/getSpendLog/getSpendSummary/resetSpend — `server/__tests__/walletRouter.test.ts` (16 tests)
4. ✅ `personaRouter` — list/upsert/delete/migrate + PK collision cross-user protection — `server/__tests__/personaRouter.test.ts` (16 tests)
5. ✅ `notificationRouter` — list/unreadCount/markRead/markAllRead/clear/create + Zod max-length — `server/__tests__/notificationRouter.test.ts` (18 tests)
6. ✅ `agentMessengerRouter` — listConversations/getMessages/markRead/send (sovereign block, offline graceful) — `server/__tests__/agentMessengerRouter.test.ts` (15 tests)
7. ✅ `securityRouter` — adminProcedure gate, HITL queue, forceRefresh, getIoCFeed — `server/__tests__/securityRouter.test.ts` (12 tests)
8. ✅ `hitlRouter` — getPending/resolve (any-auth, args forwarded) — `server/__tests__/hitlRouter.test.ts` (10 tests)

### Batch B — Security / Access Control Tests ✅ COMPLETE (2026-06-29)

9. ✅ Admin-procedure gate — `auditRouter` (all 5 procedures) — `server/__tests__/accessControl.test.ts` (10 tests)
10. ✅ Owner-procedure gate — inline `ownerProcedure` test router — `server/__tests__/accessControl.test.ts` (5 tests)
11. ✅ RBAC matrix — `hasPermission` all 5 roles × all resource types — `server/__tests__/accessControl.test.ts` (14 tests)
12. ✅ `validatePath` guard — path traversal, sensitive dirs, separator-bypass, baseDir enforcement — `server/__tests__/pathTraversal.test.ts` (16 tests)
13. ✅ `VirtualCardService` AES-256-GCM PAN encrypt/decrypt round-trip — `server/__tests__/virtualCardAes.test.ts` (5 tests)
14. ✅ OMMESH `secretsMatch` + `verifyHmacSig` timing-safe comparison — `server/__tests__/tokenCrypto.test.ts` (11 tests)
15. ✅ `TokenRefreshService` AES-256-GCM at-rest encryption round-trip + legacy base64 path — `server/__tests__/tokenCrypto.test.ts` (7 tests)

### Batch C — Service Unit Tests ✅ ALL DONE (2026-06-29)

16. ✅ `HashTrackerService` (server-side) — `hashTrackerService.test.ts` (10 tests): generateActionHash determinism/key-order normalization, loop at threshold=3, broken sequence resets, session isolation, event emission, resetSession, removeSession, getSessionSnapshot
17. ✅ `MoeChainService` — `moeChainService.test.ts` (11 tests): cloud step order/skipping/taskCategory/rolling context/onChunk/empty-throws/sovereign-block; local LlamaCppService.generate/unload-between-steps/missing-modelPath-throw
18. ✅ `ValetRouterService` — `valetRouterService.test.ts` (9 tests): offline bridge, preferredMode fallback, main_api default, first provider used, ollama fallback, getModes list
19. ✅ `ValetArtifactRegistry` — `valetArtifactRegistry.test.ts` (12 tests): versionedPath shape, read ENOENT/valid-JSON, seedFromRepoIfMissing 4 cases including relative-path resolution
20. ✅ `HITLApprovalService` — `hitlApprovalService.test.ts` (14 tests): queue ops, approve/reject/multi-action/actionPending-event/unknown-id/auto-approve/isHitlGateEnabled
21. ✅ `PublishingService` + `WebhookPublisher` (hybrid) — `publishingService.test.ts` (26 tests): n8n webhook routing + synchronous result mapping, sovereign fail-closed on non-loopback n8n, native Bluesky/Mastodon/Discord/Telegram, rate-limit mapping, RateLimitError class
22. ✅ `UpdateCheckerService` — `updateCheckerService.test.ts` (8 tests): getCurrentVersion, updateAvailable true/false, tag formats, 404/403, network error, AbortError, currentVersion fallback
23. ✅ `TokenRefreshService` — `tokenRefreshService.test.ts` (11 tests): checkExpiring window, Notion 2xx/4xx/5xx/network/no-row, Slack ok=false/ok=true, unknown provider

### Batch D — DB Schema Tests ✅ COMPLETE (2026-06-30, `dbSchema.test.ts`)

24. ✅ `moeChainConfigs` one-row-per-(userId, chainType) — **not** a DB unique constraint (none exists); enforced in app code (`_upsertMoeChain` select-then-write). Verified through `valet.saveMoeChain`/`getMoeChain`.
25. ✅ `savedScripts` per-user CRUD + mapId scoping — **already covered** by `scriptsRouter.test.ts` (list/create/update/delete ownership + mapId filter).
26. ✅ `neuralMaps` CRUD + `labelOverrides` JSON — **already covered** by `neuralMapsRouter.test.ts` (idempotent upsert, labelOverrides JSON persistence, migrate).
27. ✅ Cross-table cascade — deleting a `neural_maps` row cascades to its children and is scoped to that map. **This test exposed a real bug:** 6 child tables (`saved_scripts`, `design_projects`, `design_saves`, `curatedPosts`, `discoveredArticles`, `scheduledPosts`) had **NO-ACTION FKs in the live DB** — their `mapId`/`projectId` columns were added via `ALTER TABLE … ADD COLUMN … REFERENCES neural_maps(id)`, and SQLite drops the referential action on ALTER-added columns. `schema.ts` + the drizzle snapshot both said `cascade`, so `drizzle-kit generate` saw no diff and never emitted a fix. Result: `neuralMaps.delete` (a bare `db.delete(neuralMaps)` relying on the cascade) **threw a FK error for any non-empty map** and orphaned child rows. **Fixed** by migration **`0014_fix_map_cascades.sql`** (SQLite table-rebuild → real `ON DELETE cascade` on all 9 neural_maps child FKs; verified via `PRAGMA foreign_key_list`) **plus** an atomic app-level `db.batch` cascade in `neuralMaps.delete` (belt + suspenders) + an IDOR fix (non-owned id no longer triggers a vector-collection wipe).

---

## Section 11 — Known Limitations (genuine residue)

This list shrank sharply after the 2026-06-30 harness reclassification (Section 12). What used to live here — the Python bridges, ComfyUI execution, the OAuth flow — is now **🤖 HARNESS-DRIVABLE** or **🤝 HARDWARE**. The rows below are the true residue: a human judgement, a billable side effect, or physical hardware that can't become a green CI assertion.

| Item | Why it stays manual / collaborative |
|---|---|
| WebGL / Three.js *visual quality* | Headless Chrome can mount the canvas (drivable), but judging a mesh "looks right" is a human call |
| Audible TTS playback / live mic capture | Needs a speaker/microphone; the synthesis + transcription **data path** is 🤖-drivable file-in/file-out |
| Physical APK on-device | LiteRT-LM is arm64-only — needs a real phone (🤝 collaborative) |
| Real social-platform publishing | Webhook (X/LinkedIn/FB/IG) needs a live n8n with connected creds; native (Bluesky/Mastodon/Discord/Telegram) needs a real account secret. The routing/contract/rate-limit/sovereign-gate chain is already ✅ in `publishingService.test.ts` — only an actual post is manual |
| Real paid-API smoke (Lithic, PCBWay, ElevenLabs, Honcho, Fal) | Billable side effects; logic is mockable/✅, a final real call is a deliberate manual smoke |
| OMMESH mTLS + LAN mDNS across 2 machines | Real TLS handshake + multicast network (🤝 collaborative, not CI) |
| Electron packaging build | Needs the electron-builder toolchain; installer **manifests** are already covered by the §1.4 packaging smoke tests |

---

## Section 12 — Harness-Driven Automation Roadmap (2026-06-30 reclassification)

**The lens.** Omnecor *is* an AI harness, and the suite already drives the real `appRouter.createCaller(ctx)`. So most rows previously tagged 🌐 MANUAL/⛔ BLOCKED were "manual" only because they assumed a *human at a browser*. They are actually verifiable by driving the harness as the agent/model. The genuinely-immovable set (Section 11) is small: **human visual judgement, billable side effects, and physical hardware.**

**Tooling available to drive these:**
- `appRouter.createCaller(ctx)` — already the test pattern; covers every router procedure headless.
- Dev server under `ZERO_LOGIN_MODE=true` — real HTTP + WS with auth bypassed (local admin).
- **AI-model injection** — point a provider at a stub or a local Ollama; assert tool calls / stream / RAG behaviour without paid inference.
- **`google` / `microsoft` OAuth emulator skills** — full code-exchange, Gmail, Drive locally; codebase already honors `GOOGLE_EMULATOR_URL`.
- **`chrome-devtools` MCP** — drive the real React UI (click/fill/snapshot/console) for the web-feature rows.
- **Local Python bridges** run file-in/file-out (STT WAV→text, TTS text→WAV) — the ComfyUI-test auto-skip pattern.

### Convert-to-✅ backlog (continues Section 10's A–D)

**Batch E — AI harness paths (inject as model / local Ollama / stub provider)** — *mostly ✅ (2026-06-30)*
- ✅ `ai.chat` RAG injection (aiRouter.test.ts) — live cloud inference + the `chatStream` subscription stream stay 🌐/manual (billable / subscription-not-driveable via createCaller).
- ✅ `agentMessenger.send` WS broadcast (agentMessengerRouter.test.ts); ✅ `podcast.generateScript` (podcastRouter.test.ts); ✅ `pcbEditor.reviewDesign` (pcbEditorRouter.test.ts); ✅ `curator.*` (curatorRouter.test.ts).
- ✅ MoE chain router invocation — `valet.getMoeChain`/`saveMoeChain`/`initMoeChain` (valetRouter.test.ts + dbSchema.test.ts); ✅ `valet.route` against a **stubbed** classifier (valetRouter.test.ts). Real GGUF classification → 🤝.
- ⏳ Chat-workspace UI flows: message→stream, stop-generation, memory archiver (50-msg compress), token counter — these are client-side UI flows → **Batch H** (chrome-devtools).

**Batch F — Emulator/sandbox-backed external services** — *Lithic ✅, OAuth ✅, gmail ✅ (2026-06-30)*
- ✅ **Lithic VCC — in-suite mock (chosen approach).** `virtualCardRouter.test.ts` (router orchestration: sovereign gate, HITL, rate limit, PAN-safety) + `virtualCardService.test.ts` `listTransactions` against an env-switched `LITHIC_API_BASE` fake host (issueCard's Lithic path was already covered). Hermetic, CI-safe, no money. An optional real sandbox-key smoke (`LITHIC_ENVIRONMENT=sandbox` + transaction-sim `simulateAuthorization`/`Clearing`/`Void`/`Return`) stays 🤝.
- ✅ OAuth code flow — `oauthRouter.test.ts` (mock oauthClients + **real DB + real PKCE state store**): `getAuthorizationUrl` (state+verifier persisted, SHA-256 challenge binding), `handleCallback` (state validation incl. cross-user/TTL, code exchange→account insert, single-use, sovereign block), `disconnectAccount` (ownership). Also fixed a catch-all masking inner TRPCError codes in both procedures. `integrations.connect`/`disconnect`/`getIntegrations` already ✅ (Batch G).
- ✅ `gmail.sendEmail` + `gmail.status` — `gmailRouter.test.ts` (17): mocked `fetch`/`oauthClients` + real DB. Config/connection guards, the Bearer token + `/messages/send` endpoint + decoded RFC-2822 payload actually sent, **refresh-on-401 token rotation persisted to the DB**, non-OK→INTERNAL_SERVER_ERROR mapping, per-user ownership isolation, and the Sovereign gate. Only a live-Gmail delivery smoke remains 🌐.
- ⏳ Remaining F: a live `handleCallback` code-exchange against the `google`/`microsoft` emulator servers (`GOOGLE_EMULATOR_URL` / `MICROSOFT_EMULATOR_URL`) — the mocked-client path is already ✅.

**Batch G — tRPC-drivable router procedures (no external deps, currently 🧪/🌐)** — *✅ COMPLETE (tail closed 2026-07-01)*
- `analytics.*`, `attachments.*` (incl. `validatePath`), `cloudCompute.listProviders` sovereign block, `comfy.getQueue/getSystemStats/interrupt`, `fal.*`/`imageGen.*` sovereign gate, `integrationManagement.*`, `job.list/cancel`, `knowledgeBase.list/delete` (mock VectorDB), `mcp.listServers/addServer/listTools`, `mobileSync.push/pull`, `modelManagement.*`, `ollama.getStatus`, `ommesh.approvePeer/revokePeer/getTopology`, `pairing.listDevices`, `pcbEditor.*`, `pipeline.*`, `platforms.*` (assert tokens never exposed), `project.*`, `scheduling.createPost/listPosts/deletePost`, `security.getThreatReport/getAuditSummary`, `system.*`, `training.validateDataset/getStatus`, `valet.getMoeChain/saveMoeChain/initMoeChain/scanLocalModels`, `virtualCard.listCards/setLimit`, `voice.listVoices`, `workflow.*`. Plus Batch D DB-schema tests (items 24–27).
- **✅ Tail closed 2026-07-01.** A `routers.ts`-vs-test-file audit found the last 6 registered routers with no dedicated route-level test and added them: `discoveryRouter` (8), `jobRouter` (14, incl. `job.list/cancel` + the HITL command gate), `workflowRouter` (8, the `workflow.*` skill-commands), `penpotRouter` (6), `ommeshRouter` (13, incl. `ommesh.approvePeer` + admin gates), `systemRouter` (16, all of `system.*`). **Every registered router in `routers.ts` now has route-level coverage** (`audit`/`pairing` were already covered by `accessControl.test.ts` / `pairing.test.ts`).

**Batch H — Web UI via headless Chromium (Playwright) against the prod build** — *page-level wiring ✅ (2026-07-01)*
- **Setup (2026-07-01):** the `chrome-devtools` MCP path was replaced with Playwright because the session cookie is **httpOnly** (must be injected via `context.addCookies`, which the MCP can't do). Auth is the sanctioned **Option B** seeded owner cookie (`server/scripts/dev-seed-user.ts`) against the **production** server (`serveStatic`, no rate-limit) — zero-login is (correctly) forbidden in production. The wizard gate is bypassed by pre-setting the `omnecor:setup_complete` localStorage flag (client-side gate, not a DB field). Driver: scratchpad `batch-h-driver.mjs`.
- **✅ 13 feature pages driven authenticated** — each rendered its **real per-page content** and fired its **distinct** set of backend tRPC queries, **all HTTP 200, zero real console errors**: `/`(dashboard: wallet.getBudget/getSpendSummary, project.getWatcherStatus, knowledgeBase.status, voice.healthCheck, blender.status, esp.status), `/chat`(chat.listSessions, scripts.list, aiProvider.discoverOllamaModels/getProviders, honcho.getFacts), `/brain-map`, `/model-hub`(system.aiProviders/getSettings, aiProvider.*), `/pipelines`(jobs.list, pipeline.listPipelines, training.kaggleStatus), `/agent-networking`(scheduling.listScheduledPosts, platforms.listAccounts, discovery.listUnprocessed, analytics.getPlatformSummary, curator.listByStatus), `/integrations`(integrations/integrationManagement/mcp.*), `/wallet`(wallet.*, virtualCard.isConfigured), `/podcast-studio`(podcast.listEpisodes, voice.listOfflineVoices), `/llm-builder`(dataset.*, training.getArtifact, ollama.listModels), `/3d-designer`, `/notifications`(notifications.list), `/settings`(system.aiProviders/getSettings). This proves each page is genuinely backend-wired (not a static shell).
- **✅ Chat loop wired end-to-end** — pre-selected an Ollama model, typed + sent a message; the `aiProvider.chatStream` **WS subscription** connected and streamed the provider's response back into the UI, **and a provider error surfaced correctly in the chat** (no silent failure — validates the error path too).
- **✅ Live token generation (2026-07-01).** After pointing the canonical `SettingsService` store (isolated temp HOME, real `~/.omnecor` untouched) at the LAN Ollama, a chat turn to `qwen2.5:3b` streamed a real assistant reply into the UI ("Nobody Codes Me Into a Corner") over the `chatStream` WS subscription. Full loop proven: UI → WS subscription → server → LAN Ollama → streamed tokens → rendered message. (Getting here first required diagnosing the two-settings-source split below: localhost's Ollama runner was also crashing, and the inference path read a different settings file than the status query.)
- **⏳ Remaining (per-widget interactions):** scope filters + localStorage round-trips, BrainMap sliders/lazy-expand, ModelHub toggles, Pipelines tabs, Wallet HITL dialog, Settings persistence writes, Notifications badge clear — page render + read-side wiring is proven; individual write/interaction assertions are the next pass. (Visual-quality calls stay manual per §11.)

**Findings surfaced during Batch H (2026-07-01):**
- **Standalone prod bundle can't resolve the native libSQL binding.** `node dist/index.js` throws `Cannot find module '@libsql/linux-x64-gnu'` — pnpm doesn't hoist this transitive **optional** native dep to top-level `node_modules/@libsql/`, so the esbuild-flattened `dist/index.js` can't resolve it. Worked around with `NODE_PATH=…/.pnpm/@libsql+linux-x64-gnu@…/node_modules`; a real fix should copy/relink the `.node` addon next to the bundle (affects any standalone `pnpm start`).
- **Ollama URL is read from two different settings sources.** `system.aiProviders` (status) resolves `PATHS.base/settings.json` → env, while `AiProviderService.getOllamaUrl` (inference) resolves the canonical **SettingsService** store. They can disagree — the status query reported the LAN server while inference still hit localhost. Ties to [[settings-architecture]] (two settings systems). Worth unifying so the reported endpoint == the endpoint actually used.

**Batch I — Local Python bridges, file-in/file-out (🤖)** — *router-level ✅ (2026-06-30); real STT ✅ (2026-07-01)*
- ✅ Router-level (harness-drivable, no bridge): `voiceRouter.test.ts` (health aggregation + bridge-offline error mapping for transcribe/synthesize + ElevenLabs sovereign gate) and `agentRouter.test.ts` (crew delegation + RecursiveMAS HITL gate + stop). The router proxies + degradation are proven without a Python process.
- **✅ Real STT round-trip (2026-07-01).** `voiceBridges.test.ts` — new ComfyUI-style auto-skip integration test. Drives `voice.transcribe` through the real router against a running `server/phase2/python_scripts/whisper_server.py` (faster-whisper `base`, CPU int8). An `espeak-ng` clip of "testing one two three four five" transcribed to **"Testing 1, 2, 3, 4, 5"** (lang=en). Also asserts the NOT_FOUND mapping for a missing file. Passing live (2 tests); auto-skips when the server/espeak are absent. **The real STT servers live in `server/phase2/python_scripts/` (whisper_server.py:8001, tts_server.py:8002) — NOT `server/python_bridges/`** (that dir's `voicebox_bridge.py` is a **silence stub**; `rvc_server.py` has stubbed tensor math). Corrected an initial mis-read.
- **Found + fixed 4 real `requirements.txt` gaps** while standing the servers up: `python-multipart` (whisper_server file uploads — server wouldn't start without it), `torchaudio` (coqui XTTS import), `transformers` pinned to `>=4.57,<5` (the old `>=4.40.0` resolved to 5.x which removed `isin_mps_friendly` that coqui-tts imports), and `torchcodec` (torch≥2.9 audio IO). With these, `tts_server.py` now imports and loads XTTS-v2 cleanly.
- **✅ Real TTS synthesis (2026-07-01).** After the dep fixes, `tts_server.py` loads XTTS-v2 (~1.8GB, CPU — GPU driver too old for this torch/CUDA build) and `voiceBridges.test.ts`'s synthesize test passes live: `voice.synthesize` produced audio from text using the espeak clip as the voice-clone reference (~65s CPU synth). One alignment note recorded for live runs: the TTS server's own `SPEAKER_WAV_ROOT` allow-list must include the dir the Node `validatePath` accepts (`PATHS.data`) — start it with `SPEAKER_WAV_ROOT=$(pwd)/data/data` (or put the reference under `~/.omnecor`). All 3 voice tests green (2 STT + 1 TTS); they auto-skip when the servers/espeak are absent, exactly like the ComfyUI/Blender/KiCad/ESP suites.
- ⏳ `agent.runCrew` on `recursive_mas_bridge.py` — still needs `crewai` (not in requirements.txt); stays 🤖.

**Session-30 addendum — WS+PTY integration test still not automated (🤖, needs harness work first)**
- The Terminal/CLI protocol fix (see WebSocket Server section) was verified live via chrome-devtools MCP but has no permanent automated regression test for the full WS+PTY round-trip. `OmnecorWebSocketServer`'s constructor calls the real `createContext()`/`getDb()` (not the isolated in-memory `createTestDb()` harness the router tests use) plus 7 singleton services (FileSystemWatcherService, ProcessManagerService, HashTrackerService, VoiceService, HITLApprovalService, AgentService, NotificationService) — instantiating it in a test today would touch the real `~/.omnecor/data/omnecor.db` and process-wide singletons shared with other tests. Convert-to-✅ path: add a DB-path-injectable/isolated construction mode for `OmnecorWebSocketServer` (or a lighter test seam around `handlePtySpawn`/the message switch) before writing the integration test. Not done this session to avoid an unsafe side effect.

**Batch J — Session-31 second pass (2026-07-02): no-dependency conversions + doc-accuracy audit** — *✅ COMPLETE*
- **Doc-accuracy audit:** every Section-2 row was checked against the real routers. Removed 6 phantom procedures that never existed (`security.getThreatReport`/`getAuditSummary`, `job.getResult`, `discovery.refreshFeed`, `ommesh.revokePeer`/`getTopology`) and corrected the job/discovery/ommesh/workflow/penpot/system sections that still showed 🧪/🔬 after Batch G's tests had already landed. Inline *"(Session-31 doc fix: …)"* notes mark each correction.
- **Conversions to ✅ (+60 tests, 8 files, 2 new):** `comfy.getQueue/getSystemStats/interrupt/clearQueue` (comfyRouterMock.test.ts — service-mocked, bridge-offline→INTERNAL_SERVER_ERROR); `pairing.listDevices/createCode/revokeDevice` route-level (pairingRouter.test.ts — device-role gates + per-user ordering + revocation set); the full `security.*` scan/encrypt/backup/vuln-scan surface (securityRouter.test.ts — real validatePath + aggregation math); `platforms.getPublishingRouting/setWebhookPath` (sovereign+remote-n8n blocked flag; admin gate + settings persistence); `virtualCard.revealCardPan` (sovereign gate / delegation / NOT_FOUND); `integrations.updateSettings` (metadata merge); `project.getFileTree/readFile/writeFile/registerProject` **real-fs happy paths** under `PATHS.projects`; `ollama.listModels/modelInfo/createModelfile/runningModels` (daemon-read mapping + error contract).
- Suite: **1134 → 1194** (1193 passing + 1 skipped without ComfyUI), 104 → 106 files. `pnpm check` 0 errors.
- **Remaining honest 🧪 residue after this pass:** `system.detectHardware`/`checkDependencies`/`saveKeys`, `chat.filterScope` localStorage round-trip, scripts localStorage migration helper, `comfy` live getQueue, SecurityService service-level (YARA/AES/ZIP), plus the 🤖 rows (system CLI relay, Docker rows, pipeline live run, OAuth emulator live exchange, recursive_mas crew) and the 🤝 hardware set.

### 🤝 Collaborative — do last, together (hardware exists, needs a joint session)
- ESP32 over USB: **fully done ✅ 2026-06-30** (real ESP32-D0WD-V3) — detect, chip-info, and compile→flash→BLE-advertise (`OMNECOR_TEST_OK`) all live-verified. Remaining collaborative items: RVC voice clone (trained weights), live mic/speaker audio.
- Local GGUF inference — llama.cpp / Valet Router / MoE local — small model on the **RTX 4060 (8 GB)** or CPU.
- **GPU training** — `training.startFinetune` + Valet pipeline: the 4060 is sufficient for a small-model (0.5B–3B) 4-bit QLoRA **pipeline smoke test** (dataset→Unsloth→LoRA→GGUF export); large/multi-GPU full fine-tunes → cloud or Kaggle free dual-T4.
- OMMESH mTLS + mDNS across 2 machines; physical arm64 APK (LiteRT-LM, audio, deep-link OAuth).

---

*Document created 2026-06-29; harness reclassification 2026-06-30. Update this file after each verification session: mark items verified, add new test files to Section 1, and move 🧪 AUTOMATABLE / 🤖 HARNESS-DRIVABLE items to ✅ VERIFIED as tests land.*
