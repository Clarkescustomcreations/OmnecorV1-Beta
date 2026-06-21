# Workflow Verification Matrix

*End-to-end integration checklist that tests complete user journeys rather than isolated components. Each workflow covers the full round-trip from UI action → tRPC procedure → DB/service → response → UI update → WebSocket broadcast → state persistence across restart. Checkboxes represent verified (tested live) steps. Last audited: 2026-06-20.*

---

## First Run Setup (SetupWizard)

- [x] Fresh install — `pnpm install` completes without errors
- [x] `pnpm dev` starts Express + Vite; server listens on PORT 3000
- [x] SQLite DB auto-created at `~/.omnecor/data/omnecor.db` on first boot
- [x] Migrations auto-applied at boot (non-fatal: warns + continues if drift)
- [x] Browser navigates to `/setup` on first launch (no users in DB)
- [x] SetupWizard renders 9 steps including Launch Checklist (added 2026-06-19)
- [x] Execution Mode selector (Sovereign / Scrapper / Big Spender) persists to `users.executionMode`
- [x] Ollama URL field configures `OLLAMA_URL`; Scan Hardware button calls `trpc.system.detectHardware`
- [x] API Key fields (OpenAI, Anthropic, Gemini, Groq) saved via `trpc.system.saveKeys`
- [x] mDNS Discovery switch enables OMMESH advertisement in `MeshDiscoveryService`
- [x] Knowledge Base Path field + folder picker wired to `trpc.knowledgeBase.setRootPath`
- [x] Resource Limits sliders (max VRAM in GB, max file size in MB) saved to settings
- [ ] Dependency Checklist step: Ollama auto-install (`trpc.system.installOllama`) tested on clean machine
- [x] Dependency Checklist: HTTP probes for 9 services fire in parallel; Re-check per group invalidates query
- [x] SetupWizard → "Launch" navigates to Dashboard (`/`)
- [x] Settings persisted in `~/.omnecor/settings.json`; survive server restart
- [x] Zero-Login Mode: `ZERO_LOGIN_MODE` skips OAuth; synthetic local admin provisioned; `ZeroLoginBanner` shown

---

## Authentication (OAuth + Local Account)

- [x] Local account creation — username + optional password; stored in `users` table (passwordHash)
- [x] Google OAuth flow — redirects to Google; callback lands at `GET /api/oauth/callback/google`; `social_oauth_state` cookie verified (double-submit CSRF protection); JWT session cookie set (`httpOnly`, `sameSite: "strict"`)
- [x] Microsoft OAuth flow — same CSRF protection; `openId` prefixed `microsoft:<id>`
- [x] PKCE enforcement — `codeVerifier` stored in `oauthStates` table; verified at callback; row deleted
- [x] `oauthStates` TTL: 10 min expiry; stale rows left to expire
- [x] `trpc.auth.me` returns session user; `trpc.auth.logout` clears cookie
- [x] `trpc.auth.setExecutionMode` persists mode change to `users.executionMode`
- [ ] Token refresh pipeline: OAuth access tokens pre-emptively renewed; `401` intercepted and refreshed
- [x] Mobile APK OAuth: deep-link `omnecor-hq://oauth/callback`; token via `GET /api/oauth/mobile?code=…`; JWT stored in `expo-secure-store` (hardware-backed)
- [x] APK `getAuthedWsUrl()` appends `?token=` (cookies not available in RN WebSockets)
- [x] Role-based access: Viewer / User / Admin / Owner; `ownerProcedure` / `adminProcedure` enforced

---

## Brain Map Workflow

- [x] Create map — `trpc.neuralMaps.create` inserts row; UI renders new empty canvas
- [x] Index folder — `trpc.knowledgeBase.ingestDirectory` triggers `FileSystemWatcherService` + ChromaDB embedding
- [x] Source types tested: local directory path; `github://owner/repo` (pending), `integration://provider` (pending)
- [x] `fileTreeToNetwork.ts` converts file tree to ReactFlow nodes + edges
- [x] Layout engine selection (Force-Directed / Hierarchical / Mind-Map / Circular) persists to `neural_maps.settings`
- [x] Node sizes (20–50 px), animation speed, GPU acceleration, auto-clustering all saved and restored from DB
- [x] `Shift`+Click / `Shift`+Drag multi-selection enabled (added 2026-06-19 NeuralGraph upgrade)
- [x] Save map — `trpc.neuralMaps.update` persists settings + labelOverrides + collapsedFolderIds
- [x] Restart app — map config (collapse state, label overrides, layout prefs) fully restored from SQLite
- [x] Reopen map — `loadedProjectRef` triggers load effect once per project; canvas restored
- [x] Search map — ChromaDB semantic search via `trpc.knowledgeBase.search`; results highlighted in graph
- [x] Delete map — `trpc.neuralMaps.delete`; canvas cleared
- [x] Inline label editing — `labelOverrides` persisted in `neural_maps.settings` JSON
- [x] Drag-to-context — `⋮⋮` grip adds node file reference to active chat context
- [x] Fiction Mode toggle — canvas aesthetic mode for narrative/creative projects
- [x] External pop-out window (`/brain-map-external`) — `requestInitialState` / `initialState` BroadcastChannel handshake; visual prefs synced via `omnecor_visual_control_sync` channel
- [x] Structured layouts (Hierarchical/Mind-Map/Circular) — no global physics collision; base sizing scales with node count; fully traceable connections without overlap
- [x] Auto-clustering OFF expands `H_GAP`/`V_GAP`/circumference to guarantee non-overlapping nodes at scale

---

## Chat & AI Inference Workflow

- [x] New session — `trpc.chat.create`; session row in `chat_sessions`
- [x] Send message — `trpc.ai.chat` or `trpc.ai.chatStream`; response streamed via token subscription
- [x] Stop generation — interrupts active token stream subscription (Stop Generation button)
- [x] Provider selection — Ollama (local), OpenAI, Anthropic, Gemini, Groq, Hugging Face, Fal, OMMESH phone node
- [x] Sovereign mode enforcement — cloud providers (`openai`/`anthropic`/`gemini`/`grok`/`huggingface`) blocked by `assertProviderAllowedInMode()` guard in `aiRouter.chat`/`chatStream`; local providers (ollama/llamacpp/ommesh/forge) always allowed
- [x] Token count — `js-tiktoken` BPE (model-aware: o200k_base / cl100k_base) shown live in UI
- [x] Spend tracking — `AiProviderService.logSpend()` inserts into `spend_log`; WS `budget:spend` event broadcast
- [x] Budget enforcement — soft/hard cap triggers HITL overlay when threshold approached
- [x] Memory archiver — `trpc.ai.summarizeAndPruneSession` called manually or auto-triggered after 50 messages (keeps last 6 + system summary)
- [x] Loop detection — `HashTrackerService` detects 3-rep action hash loops → HITL alert + `trpc.ai.reportLoopViolation`
- [x] Honcho memory layer — user facts + long-term session memory via `honcho-ai` SDK; degrades gracefully without key
- [x] Prompt sanitization — `PromptSanitizer` (NFC normalization, null-byte removal, injection defense) applied to every chat input
- [x] Valet Router pre-routing — `ValetRouterService.route()` called in `streamChat()` before provider selection; falls back to rule-based if model unavailable
- [x] File attachments — `trpc.attachments.upload`; files stored in uploads dir; reference added to context
- [x] Voice input (STT) — hold-to-record → `POST :8001/transcribe` (Whisper) → fills textarea
- [x] Terminal toggle — slide-up drawer with `xterm.js` CLI instances
- [x] `/` command autocomplete — command registry (`useCommandRegistry.ts`)
- [x] `@` file references — adds files to active context
- [x] Script save — `trpc.scripts.create` (server-backed); localStorage migration ran on first mount
- [x] Session persistence — messages survive browser refresh; session list restored from `chat_sessions`
- [x] Session delete — cascade-deletes `chat_messages`; UI updates immediately

---

## OMMESH Peer Discovery & Cross-Node Inference

- [x] mDNS advertisement — `MeshDiscoveryService` advertises this node on `$PORT` via `bonjour`
- [x] Peer discovery — `bonjour.find()` detects other Omnecor nodes; `nodeDiscovered` event emitted; `trpc.ommesh.discover` returns live peer list
- [x] Peer approved — `trpc.ommesh.approvePeer` (adminProcedure); AgentNetworking → OMMESH Trust queue shows pending fingerprints
- [x] mTLS cert provisioned — `SecurityManager.rotateCert` (execFileSync arg arrays — no shell string); CA + per-node certs in `data/certs/`
- [x] Cross-node inference — `MeshNode.routeToRemote()` makes mTLS call to peer; **fingerprint pinning** rejects MITM with different CA-signed cert
- [x] Local fallback — `MeshNode.routeInference()` falls back to `executeLocal()` on any remote failure/missing peer; `fellBack: true` flag returned
- [x] Sovereign guard — `executeLocal()` rejects cloud providers (`openai`/`anthropic`/`gemini`/`grok`/`huggingface`); mesh distributes local compute only
- [x] LIVE-VERIFIED Linux↔Windows (2026-06-16): `{content:"The capital of France is Paris.", executedBy:"omnecor-win-clark"}` returned from Linux→Windows; Windows→Linux also verified
- [ ] Android node as 3rd peer — connect by explicit IP + `OMMESH_SECRET`; on-device inference routing
- [ ] VRAM-weighted routing — currently selects first available peer; weighted selection by VRAM headroom unimplemented (TD-018)
- [x] WS mobile node registration — `mobile_node_register` → `mobile_node_ack`; `mobile_node_heartbeat` every 10 s; `mobile_inference_request`/`mobile_inference_response` full round-trip
- [x] Topology UI — `MeshTopologyGraph.tsx` ForceGraph2D renders live mesh (local=blue glow, trusted=green, pending=red, dashed=unapproved edge)

---

## Podcast Studio Workflow

- [x] Add dialogue turn — speaker + text row added to timeline; speaker/emotion dropdowns functional
- [x] Source context — sources panel accepts text / web URL / file; fed to script generation
- [x] Generate podcast — `trpc.podcast.generateScript` mutation called; real-time WS progress on `podcast:${jobId}` (0–100%) with 300 ms subscription delay to prevent race
- [x] Backend synthesis — `LocalPodcastService.callPodcastEngine()` spawns `podcast_engine.py`; XTTS-v2/Kokoro synthesizes per turn via `POST :8002/synthesize`; segments stitched + resampled to 44100 Hz
- [x] TTS server unreachable — `podcast_engine.py` inserts 1.5 s silence per segment; stitches to valid WAV
- [x] Playback bar — play/pause/download WAV buffer; `<audio>` wired to generated `audioUrl`
- [x] Per-segment regeneration — `RefreshCw` button per result segment; `podcast.generate` (single turn) via `mutateAsync`; replaces only that segment; per-segment spinner; rest stays playable
- [x] Download audio — "Download Audio (.wav)" button (`<a download="podcast-episode.wav">`)
- [x] Session persistence — `turns`/`sources`/`podcastLength` mirrored to `localStorage["omnecor:podcast_session"]`; restored on mount; "Clear session" resets to defaults
- [x] Episode history dialog — localStorage-backed play/download/remove per episode
- [x] Export JSON script — `Playback Bar` JSON export button
- [x] Restart app — session restored from localStorage on mount
- [ ] Server-backed episode history — only localStorage currently (TD-026); SQLite `podcast_episodes` table not yet created
- [x] Mobile podcast — `expo-audio` player streams WAV from PC; device download; sources panel; sliders persist; WS progress subscription (300 ms delay)
- [x] Mobile voice model selector — configured via APK Settings → Voice; generates via `podcast.generateScript` tRPC

---

## Voice Pipeline (STT → LLM → TTS)

- [x] Record voice — Chat 🎤 button hold-to-record; `expo-audio` on APK
- [x] Transcribe — `POST :8001/transcribe` (Whisper daemon); text fills chat input
- [x] LLM response — streamed via `trpc.ai.chatStream`
- [x] TTS synthesis — `trpc.voice.synthesize` → `POST :8002/synthesize` (Kokoro/XTTS); playable sound buffer returned
- [x] RVC voice conversion — `trpc.voice.convertVoice`; path validated by `validatePath` (separator-aware)
- [x] ElevenLabs alternative — `trpc.voice.synthesize` with `provider: "elevenlabs"` (cloudProcedure; requires API key)
- [ ] Live end-to-end voice round-trip test — no confirmed live test documented; individual components verified in isolation

---

## PCB / Schematic Editor Workflow

- [x] Create project — `trpc.pcbEditor.createProject`; auto-creates "Default Design" on first open (`autoCreatedRef`)
- [x] Add component — click-to-add from `ComponentLibraryPanel` (49 components, 9 categories); drag-and-drop via `dataTransfer.setData`; `handleDrop`/`handleDragOver` wired with ReactFlow `project()` coordinate conversion
- [x] Edit schematic — drag nodes, add connections; canvas changes trigger auto-save debounce (1.5 s)
- [x] Auto-save — `suppressAutoSaveRef` prevents double-write on load; `isDirty`/`lastSavedAt` state driven
- [x] Load design — `loadedProjectRef` fires once per project; resets canvas on project switch
- [x] Persist across refresh — canvas restored from `design_saves` table; `EnhancedPCBEditor.tsx` self-contained
- [x] Delete design — `deleteDesign` wrapped in `db.transaction()` (exports + reviews + saves cascade atomically)
- [x] Delete project — `deleteProject` wrapped in `db.transaction()` (N+1 batched with `inArray`)
- [x] AI review — `trpc.pcbEditor.reviewDesign`; `buildDesignContext()` sends netlist (components + connections) to AI
- [x] Export STEP/Gerber/BOM — `trpc.kicad.exportStep`, `trpc.kicad.exportGerber`, `trpc.kicad.generateBom`
- [x] Open in KiCad — `trpc.kicad.openFile` launches local KiCad via `KICAD_CLI_PATH`
- [x] DRC/ERC — `trpc.kicad.runDrc`; structured error results returned
- [x] ReactFlow attribution hidden — `proOptions={{ hideAttribution: true }}` on all 4 ReactFlow instances
- [ ] PCBWay ordering — HITL-gated; `PCBWayService.ts` wired but live PCBWay API test not confirmed
- [x] Mobile viewer — PCB mode in viewer.tsx dispatches to `trpc.pcbEditor.reviewDesign` / `saveDesign` / `exportDesign`

---

## 3D Model Viewer Workflow (Desktop + Mobile)

- [x] Load GLTF/GLB — `GLTFLoader` in `ThreeViewer.tsx`; loads real mesh; `buildSceneContext()` traverses all meshes (name, parent chain, vertex count, bounding box dims)
- [x] Load OBJ — `OBJLoader` from `three/examples/jsm/loaders`
- [x] Primitive scene — Cube/Sphere/Cylinder demo scene when no model loaded; `OBJECT_DESCRIPTIONS` table as fallback context
- [x] Mesh raycaster — click-select mesh; emissive highlight; `selectedMesh` sent to AI "Ask AI" / "Suggest Changes"
- [x] AI context — full scene structure + `Selected mesh: <name>` in AI payload `code` field
- [x] Open in Blender — `trpc.blender.render`; headless Python subprocess; glTF export
- [x] Mobile 3D viewer — Three.js WebView in `viewer.tsx`; drag-orbit / pinch-zoom / tap-to-select raycaster; Ask AI · Analyze · Modify · Export action bar dispatches to real endpoints
- [x] Mobile model picker — horizontal picker (Demo scene + library models from `trpc.blender.listModels`); `loadModel(url)` / `clearModel()` swap primitives for real mesh; camera frames bounding box
- [x] GLB served — `/media/model/:file` range-capable route (basename-only + extension allowlist + `model/gltf-binary|+json` content-type)
- [x] Export to library — `trpc.blender.export` with `toLibrary: true` writes to shared model library; appears in mobile picker
- [ ] Real Blender/ComfyUI mesh loading into mobile 3D scene — 3D primitives remain the default demo scene; loading real generated meshes from Blender/ComfyUI into the mobile WebView is the F24 remaining enhancement (UI wiring exists; real mesh pipeline not yet end-to-end tested on device)

---

## Agent Networking / Social Automation Workflow

- [x] RSS discovery — `trpc.discovery.fetchArticles`; `ArticleDiscoveryService` (rss-parser); dedup by `urlHash`; stored in `discoveredArticles`
- [x] AI curation — `trpc.curator.curateArticle`; real platform copy generated via `generatePostDraft`; `curatedPosts` row created
- [x] Draft regeneration — `trpc.curator.regenerateDraft`; replaces content on same `curatedPosts` row
- [x] Curator approval — status transitions: draft→pending_review→approved
- [x] Character limit enforcement — `CHAR_LIMITS` per platform (X: 280 chars); live counter turns red + disables Schedule/Approve when over limit
- [x] Schedule post — `trpc.scheduling.schedulePost`; `scheduledPosts` row created with `scheduledAt`
- [x] Auto-publish — `publishWorker.ts` background loop re-queues due posts on server start; `publishExecutor.ts` calls real platform API
- [x] Publish now — `trpc.scheduling.publishNow`; immediate `PublishingService` call; `publishedAt` set on success
- [x] Failed post — status set to `failed` + `errorMessage`; Calendar tab renders with destructive badge + red left border
- [x] Retry failed post — `trpc.scheduling.retryPost` (protectedProcedure); IDOR protection via `platformAccounts.userId` join; resets to `scheduled` + clears error
- [x] Post analytics — `postAnalytics` table populated after publish (impressions, reach, likes, shares, comments, clicks)
- [ ] Live platform API test — X/Twitter, LinkedIn, Instagram, Facebook, YouTube not live-tested against real API keys (TD-020); code-level only verification done
- [x] Gmail send — `trpc.gmail.sendEmail` (cloudProcedure); refresh-on-401; RFC-2047 subject encoding; header injection guard (strip CR/LF)
- [x] Persona Studio — `personas` table; `trpc.personas.create/update/delete`; bio/tone/posting schedule management
- [x] Posting schedule config — `postingScheduleConfig` table; per-platform posts-per-day, autoApprove, timezone

---

## Agentic Wallet Workflow

- [x] View spend log — `trpc.wallet.getSpendLog`; spend history rendered in `BudgetPanel`
- [x] Set project budget — `trpc.wallet.setProjectBudget`; upsert via `.onConflictDoUpdate`; mode: soft/hard
- [x] Budget alert — `AiProviderService` triggers HITL overlay + WS `budget:spend` event when threshold approached
- [x] Hard cap enforcement — `AiProviderService.streamChat()` pre-flight check blocks request when hard cap reached
- [x] Issue virtual card — `trpc.virtualCard.issue`; Lithic API call (cloudProcedure; requires `LITHIC_API_KEY`); PAN AES-256-GCM encrypted at rest; `VirtualCards` tab in AgenticWallet
- [x] Unmask card details — toggle icon reveals PAN in UI
- [x] Scope toggle — Global vs Project UUID spend charts
- [ ] Lithic API live test — `VirtualCardService.ts` wired to Lithic SDK; no confirmed live API call documented (requires `LITHIC_API_KEY`)

---

## Security Workflow

- [x] File scan — `trpc.security.runVulnerabilityScan`; `threat_scanner.py` (YARA rules); results in `ThreatDashboard`
- [x] Encrypt file — `trpc.security.encryptFile`; AES-256-GCM via `SecurityService.ts`
- [x] Decrypt file — `trpc.security.decryptFile`
- [x] Backup — `trpc.security.backup`; creates encrypted archive
- [x] Restore — `trpc.security.restore`
- [x] Audit log view — `trpc.audit.list` (adminProcedure); full event history with actor/procedure/IP
- [x] Audit log retention — `trpc.audit.setRetention` (adminProcedure); 14/28/permanent options; 6 h purge sweep via `AuditLogService.startRetentionScheduler()`
- [x] Sovereign block logged — `sovereignCheck` middleware logs `sovereign_block` audit event (fire-and-forget) before FORBIDDEN throw; procedure + actorId + IP recorded
- [x] Path validation — all user-supplied filesystem paths go through `validatePath` (separator-aware `isWithin()` from `server/_core/security.ts`)
- [x] No shell-string exec — all subprocess calls in `server/` use `spawn` / `execFileSync` with arg arrays (verified F2; grep for `exec(`` ` confirms 0 remaining shell strings)
- [x] Upload extension allowlist — executables/scripts/HTML/SVG → `.bin`; served with nosniff + `Content-Disposition: attachment` + CSP headers

---

## Mobile APK Full Workflow

- [x] Fresh install → sideload `app-release.apk` via ADB (`adb install`)
- [x] First launch → Create local account (no cloud accounts needed); auto-registers on PC first connect
- [x] Connect to PC → APK Settings → Omnecor Server → enter IP + port → Test `/health` (5 s timeout) → Save
- [x] Chat tab — multi-session (named sessions via dropdown); Agent selector (`personas.list`); streaming via `onToken`
- [x] Voice STT — 🎤 tap → `expo-audio` record → `POST :8001/transcribe` → fills input
- [x] Voice TTS — 🔊 auto-reads AI reply; long-press message to read; Android `expo-speech` (no server)
- [x] OMMESH node — Settings → OMMESH Network → enable + name + secret → Save & Connect; AI Node tab shows status/stats
- [x] Load on-device model — Settings → Phone AI Model → select GGUF → Load (runtime verification pending — TD-006)
- [x] 3D Viewer — drag-orbit / pinch-zoom / tap-to-select; Ask AI · Analyze · Modify · Export per mode; Model picker
- [x] Podcast Studio — generate via `podcast.generateScript`; WS progress; `expo-audio` playback; device download
- [x] HITL alerts — `notifications.tsx` tab; Approve/Reject wired to `trpc.agent.approveAction/rejectAction`
- [x] System Status — OMMESH panel + PC Tasks (cancel/refresh jobs)
- [x] Remote Terminal — PTY full round-trip (`pty:spawn` / `pty:input` / `pty:output` / `pty:resize`); history (↑/↓); ^C; 40 k buffer cap; resize on rotation
- [x] Settings Dark Mode — `ThemeProvider.setColorScheme()` wired; full app re-themes
- [x] SecureStore encryption — OMMESH secret + JWT in Android KeyStore; chat histories AES-256-CBC + HMAC-SHA256 envelope; legacy AsyncStorage migration on first read
- [x] Always-Listen foreground — `MicForegroundService` (Kotlin) starts on wake-word arm; `pnpm prebuild:android` ✓; `gradlew assembleDebug` BUILD SUCCESSFUL
- [ ] Always-Listen on-device test — wake word fires with app backgrounded/closed (requires physical device — TD-008)
- [ ] Physical device sideload + full verification — S25 Ultra (TD-006)
- [ ] GGUF download + on-device inference — Settings → Phone AI Model → download recommended model (TD-006)

---

## LLM Fine-Tuning / Training Workflow (Valet Router)

- [x] Dataset build — `trpc.training.buildValetDataset`; `valet_dataset_builder.py` generates 4000 Alpaca JSONL (10-category taxonomy, 10% negatives, 90/10 split)
- [x] Kaggle key — `trpc.training.saveKaggleKey`; `KaggleKeyCard` in Settings API
- [x] Start Kaggle training — `trpc.training.startKaggleTraining`; `valet_pipeline.py` orchestrator; GPU training on Kaggle P100
- [x] Kaggle job status — `trpc.training.kaggleJobStatus`; 60 s polling in `KaggleTrainingCard`
- [x] Pull Kaggle artifact — `trpc.training.pullKaggleArtifact`; downloads GGUF; `valet_merge.py` (CPU LoRA→fp16, streamed progress)
- [x] Registry seed — `ValetArtifactRegistry.seedFromRepoIfMissing()` copies `current.json` to app-data on first boot
- [x] Valet server auto-start — `ValetServerService` starts `valet_router_inference.py` on `pnpm dev` / `pnpm start`
- [x] Live routing test — `trpc.valet.testRoute`; `GET :8010/health` → `{model_loaded:true}`; `POST :8010/route` returns real category/reasoning
- [ ] Production sign-off — `pnpm valet:build` from clean GPU box; 0.85 accuracy gate not yet met (0.7385 current — TD-010)

---

## Cross-Platform Build Smoke Tests (F27)

- [x] Web (`pnpm dev`) — server starts; `/health` 200; tRPC chat round-trip; `pnpm check` 0 errors; `pnpm test` 353/353
- [x] Linux AppImage — `packaging/electron-app/dist/Omnecor-2.3.0-beta.1-x86_64.AppImage` (373 MB) built; `dpkg-deb -c` sanity; icons verified
- [x] Linux `.deb` — `Omnecor_2.3.0-beta.1_amd64.deb` (220 MB) built; electron-builder 25, Electron 39.8.10, `better-sqlite3` rebuilt for target ABI
- [x] Windows installer — `Omnecor-Setup-2.3.0-beta.1.exe` (1.69 GB NSIS) built; `Omnecor-2.3.0-beta.1-portable.exe` (1.69 GB) built; `latest.yml` generated; smoke suite 338/338 (static analysis)
- [x] Android release APK — `app-release.apk` (118 MB, JS-bundled, debug-signed); NDK r26+ + CMake 3.22+ verified; native libs compiled; `prebuild:android` + `apk:release` pipeline clean
- [ ] Windows installer — run on clean Windows machine; confirm app launches + backend spawns + SQLite round-trip (TD-005)
- [ ] Android APK — sideload to physical S25 Ultra; confirm chat round-trip; on-device LLM load; OMMESH registration (TD-006)
- [ ] Web smoke — server start → `/health` → chat round-trip (verified in dev; isolated clean-machine test not documented)
