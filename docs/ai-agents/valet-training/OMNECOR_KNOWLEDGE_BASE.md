# Omnecor Knowledge Base (Valet expert corpus)

Authoritative, distilled facts about Omnecor. This file has **two jobs**:

1. **Training source** — expert Q&A seed pairs are generated from these facts
   (see [DATASET_GENERATION.md](DATASET_GENERATION.md)).
2. **Runtime RAG source** — the live router retrieves from this file (and the Neural
   Brain Map) so answers stay current without retraining ("pull and update").

> Keep this file **true and current**. It is the canonical answer key. When a feature
> changes, edit here and regenerate the dataset — do not let weights be the source of
> truth. Each entry is intentionally short and self-contained for clean chunking.

---

## 1. What Omnecor is

- Omnecor (HMCI — Human-Machine Collaboration Interface) is a **local-first AI
  workstation**: an Express/tRPC backend + React client that integrates local and
  cloud AI, manages projects, and orchestrates multi-agent workflows.
- It is **provider-agnostic**: users bring their own API keys/subscriptions. No model
  is hardwired; providers are configured by the user.
- Default port is `3000`; it auto-increments if busy.

## 2. Execution modes (server-enforced)

- **Sovereign** 🔴 — 100% local. All cloud calls are blocked by `sovereignCheck`
  middleware. Use for air-gapped / private work.
- **Scrapper** ⚡ (default) — local-first with cloud fallback. Maximum efficiency.
- **Big Spender** 🔥 — cloud-first for maximum quality on production runs.
- Execution mode is distinct from **routing mode** (how the Valet distributes work).
  Routing must always respect the active execution mode.

## 3. The Valet Router

- A local fine-tuned ~1.5B classifier that decides, per task, the best provider/model
  and routing mode — without a cloud call for the decision itself.
- Enforces the hardcoded rules (todo.md/status.md, `/plan` docs, skills — see
  [HARDCODED_RULES.md](HARDCODED_RULES.md)).
- Ten routing modes: api_direct, valet_background, local_omesh, main_api, multi_api,
  main_api_omesh, multi_api_omesh, moe_chain, moe_chain_omesh, multi_task.
- Thirteen task categories it classifies into: code_generation, code_review, research,
  synthesis, media_generation, knowledge_retrieval, instruction_writing, integration,
  hardware, reporting, context_management, memory_operations, local_task.
- **Scrapper / Guided Walk-Through mode**: when no API keys are configured or
  automated routing fails, the Valet writes a copy-paste-ready prompt, recommends a
  free web UI, and walks the user through pasting the result back — zero dead-ends.

## 4. AI & Model Hub

- Supported provider families: OpenAI, Anthropic, Google Gemini, xAI (Grok), Ollama
  (local), Llama.cpp (local), Fal.ai (media). Voice adds Faster-Whisper (STT),
  XTTS-v2 (TTS), and optional ElevenLabs.
- Local model selection is VRAM-aware.

## 5. Agentic workforce

- **Multi-agent orchestration**: autonomous agents collaborate using shared context.
- **Human-in-the-Loop (HITL)**: critical agent actions require explicit approval.
- **GodMode pipelines**: 5-phase gated execution — DEFINE → PLAN → EXECUTE → REVIEW →
  SHIP, with per-phase approval gates.
- **Agent memory (RAG)**: ChromaDB vector store + `MemoryArchitectService` for
  long-horizon semantic context.
- **Agent audit trail**: every spawn, termination, and tool call is written to an
  immutable append-only `audit_log` (no delete/update API exists).

## 6. Neural Brain Map

- A React Flow spatial canvas for visualizing projects, files, and knowledge as
  interactive node graphs.
- Import any folder → Omnecor chunks, embeds, and indexes it into ChromaDB
  automatically. Drag-and-drop construction of knowledge graphs and pipeline flows.
- The Valet queries the Brain Map for `knowledge_retrieval` tasks and for `/plan`
  context.

## 7. Hardware integration (bridges)

- **Blender Bridge** — headless Python subprocess for 3D modeling/rendering.
- **KiCad Bridge** — PCB design automation + 3D viewer (`PCBViewer3D.tsx`).
- **ESPTool Bridge** — flash ESP32/ESP8266, auto-detect serial ports, live progress.
- **ComfyUI** — node-based media generation with async prompt queueing.
- Each bridge has a dedicated UI panel: Blender, KiCad (`KiCadPanel`), ESP Tool
  (`ESPToolPanel`), ComfyUI (`ComfyPanel`), plus an **Image Studio** (`ImageStudioPanel`)
  and **TTS** voice panels — reachable from the dashboard / SpecializedModuleLauncher.
- Hardware tasks route to the **local bridge**, not an AI provider.

## 8. Voice pipeline

- STT: Faster-Whisper microservice (real-time transcription, port 8001).
- TTS: XTTS-v2 (port 8002), optional ElevenLabs cloud enhancement.
- Voice cloning: RVC real-time conversion.

## 9. OMMESH distributed intelligence

- LAN mesh: mDNS/Bonjour auto-discovery of other Omnecor nodes.
- Secure federation via mTLS between nodes.
- VRAM-weighted routing: inference delegated to the mesh node with the most free VRAM.
- Real-time topology via `mesh:node_joined` / `mesh:node_left` WebSocket events.
- In `*_omesh` routing modes, OMMESH tasks are dispatched **first** to preserve local
  compute headroom for the routing calculation.

## 10. Agentic wallet & budgeting

- Per-project hard/soft spend limits (in cents).
- Real-time spend tracking via `budget:spend` WebSocket events.
- A **BudgetPanel** is front-and-center on the Dashboard home screen (not buried in
  Settings) so spend and limits are always visible.
- Live **Budget Spend** events surface as a floating amber card in the bottom-right
  (provider/model + cost), rendered by the same overlay as the HITL alert.
- Auto-downgrade: hitting a hard limit re-routes remaining tasks to local Ollama.
- Virtual cards via Lithic (optional); without `LITHIC_API_KEY`, a manual tracking
  mode logs spend without issuing cards.

## 11. Security & sovereignty

- Immutable audit log; PII redaction (`redactSensitiveData()`) before any log write.
- Prompt-injection defense (`PromptSanitizer`) fires `security:injection_attempt`.
- Zero-Login / air-gapped: `ZERO_LOGIN_MODE=true` bypasses OAuth and forces Sovereign.
  In this mode a dismissible **yellow Zero-Login banner** warns that all requests run as
  local admin with Sovereign enforced and the instance must not be exposed to a network.
- Extended OAuth providers: Manus, Google, Microsoft.

## 12. Persistence

- Two backends selectable via `OMNECOR_DB`: **SQLite** (default, zero-infra, Sovereign)
  or **MySQL/MariaDB** (multi-user/production, via `DATABASE_URL`).
- Stores chat history, session state, budgets, audit logs, pipeline records.

## 13. Canonical workflows (for routing + /plan grounding)

- **Start any task** → ensure `todo.md` + `status.md` exist (create if missing) →
  route the first sub-task.
- **`/plan` a project** → guided interview → build `project-docs/` (PRD, Feature-Plan,
  Voice-Tone, Design-Preferences, Rules/standards) → keep them updated after tasks.
- **Research → implement** → research (research-class providers) → synthesis (writing
  class) → Brain Map context check → code_generation (code class) → code_review →
  integration → update todo/status → offer to package a skill.
- **No API keys** → Guided Walk-Through Scrapper mode.

## 14. Honcho memory layer (cross-session "external brain")

- Honcho is an external user/session memory service (Plastic Labs). It persists
  per-user **facts**, conversation history, and long-term preferences **across sessions**,
  complementing the local ChromaDB / `MemoryArchitectService` "internal" memory.
- Hierarchy: app → user → session → messages, plus **metamessages** that store facts
  and summaries. Omnecor labels user facts `omnecor_fact`.
- Enabled by `HONCHO_API_KEY` (+ `HONCHO_APP_NAME`, default `omnecor`, and
  `HONCHO_ENVIRONMENT`, default `demo`). **If the key is unset, Honcho degrades silently**:
  writes are no-ops and reads return empty — the app works unchanged.
- In chat, the **`/btw`** command adds a persistent background note: it is saved locally
  *and* written to Honcho as a long-term fact (`honcho.addFact`). Recent facts
  (`honcho.getFacts`) are injected into the chat system prompt so the Valet "remembers."
- How it differs from the Brain Map: the Brain Map indexes *documents/code you import*
  for retrieval within a project; Honcho stores *durable facts about you* that follow you
  across every project and session.
- Memory tasks (store/recall a fact, `/btw`) are the `memory_operations` routing category
  — handled locally by the Valet; they never need a large model.

## 15. Context management (token budget & history control)

- A **Goal & Plan buffer** is the top context level and is **never pruned** — the project
  goal and plan always survive summarization (`contextManager.ts`).
- A rolling terminal/event log auto-summarizes once it exceeds **50 entries** (keeps the
  most recent 25, replaces older ones with a summary record).
- The chat input shows a **token-budget bar** (`tokenCount / maxTokens`) that turns amber
  at ≥70% and red at ≥90% of the model's window.
- **`/compress`** compresses the conversation history to reclaim tokens. AI-assisted
  summarization of context is the `context_management` routing category (local-capable,
  can escalate to a cloud model in Big Spender).
- **Per-message context exclusion**: any message can be toggled out of the context sent
  to the model, without deleting it from the transcript.

## 16. Fiction Mode (sandboxed creative workspace)

- Fiction Mode is a per-Brain-Map toggle (`FictionModeContext`) that opens a **Fiction
  Workspace** panel with three tabs: **Lore** (key→description world facts), **Cast**
  (characters with backstory), and **Timeline** (ordered story events).
- It is **sandboxed**: fiction state is stored per map in local storage
  (`omnecor_fiction_state_<mapId>`) and kept separate from real project knowledge, so
  creative/role-play content never contaminates factual project context. Standard Mode is
  the normal, non-fiction workspace.

## 17. UI shell & live status indicators

- **Execution Mode badge** — header chip reflecting `me.executionMode` live: Sovereign =
  red lock 🔒, Scrapper = green zap ⚡, Big Spender = amber flame 🔥.
- **PeerCard** — a persistent OMMESH peer indicator in the sidebar footer (visible on
  every page). Polls `mesh.discover` every 10s; shows a peer count, and when expanded,
  per-peer hostname, **latency (ms)**, and **available-model count**. Green dot = peers
  online, grey = none found.
- **HITL Alert Panel** — a floating bottom-right overlay that pops up when an autonomous
  agent loop is detected (via the action-hash detector over WebSocket). It is
  non-dismissible without an explicit choice — **Retry / Modify / Abort** (or
  Acknowledge & Clear) — and shows the action history and hashes.
- **Zero-Login banner** — see §11.

## 18. Chat slash commands

- `/clear`, `/new`, `/system` (set system prompt), `/export`, `/help`.
- `/compress` — compress history to save tokens (see §15).
- `/btw <note>` — add a persistent background context note (see §14).
- `/skill` — package the current workflow as a reusable skill (Rule 4).
- `/plan` — start the guided planning interview to build `project-docs/` (Rule 3).

## 19. Getting started & setup

- Prerequisites: Git, Node.js v22+, pnpm. Install deps with `pnpm install`, sync the DB
  with `pnpm run db:push`, then start with `npm run dev`. The UI is at
  `http://localhost:3000` (the port auto-increments if 3000 is busy).
- First launch runs an interactive **Setup Wizard** (re-openable at **Settings → System
  → Re-run Setup Wizard**). Steps: execution-mode selection, API providers, local Ollama
  setup, database, voice pipeline, hardware bridges, appearance/theme, LAN (Android thin
  client), cross-session memory (Honcho), and a summary.
- Provider API keys are stored **locally** and never sent to Omnecor's servers. Env vars:
  `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `FAL_KEY`, `ELEVENLABS_API_KEY`.
- Local models: Ollama is auto-detected at `http://localhost:11434` (override with
  `OLLAMA_ENDPOINT`); models can be pulled from the wizard.
- Database via `OMNECOR_DB`: SQLite default at `./data/omnecor.db` (zero-infra), or
  MySQL/MariaDB via `DATABASE_URL`.
- Honcho memory env: `HONCHO_API_KEY` (enables it), `HONCHO_APP_NAME` (default `omnecor`),
  `HONCHO_ENVIRONMENT` (`demo`/`local`/`production`, default `demo`). Unset = silently off.
- The Valet Router auto-starts when a trained artifact (`models/valet-router/current.json`,
  status `ready`) is present; `VALET_AUTO_START=false` opts out. With no artifact, routing
  uses the keyword fallback.
- Android thin client proxies to `http://<desktop-ip>:3000` over the same LAN; the port
  must be reachable (check firewall rules).

## 20. Navigation & UI map

- Main pages via the sidebar: **Dashboard, Chat, Model Hub, Neural Brain Map, Pipelines,
  Integrations, Settings**.
- Header holds the Command Palette (quick actions/search), the live Execution Mode badge,
  and system status. The sidebar footer holds the PeerCard (OMMESH peers).
- Theme is Dark (default) or Light, set in the wizard or **Settings → Appearance**; the
  choice is saved to `localStorage`.
- Settings groups include System (re-run wizard), Security (execution mode), Appearance,
  the provider keys, and Valet Router.

## 21. Troubleshooting (common issues)

- **Port already in use** → Omnecor auto-selects a free port and prints the URL; or set
  `PORT` in `.env`.
- **Local Ollama models won't load** → ensure Ollama is running and reachable at
  `OLLAMA_ENDPOINT` (default `http://localhost:11434`) and that the model is pulled.
- **`/btw` notes don't persist across sessions** → Honcho isn't configured; set
  `HONCHO_API_KEY`. Without it, notes stay only in the current browser session.
- **PeerCard shows no peers** → no other Omnecor node is running, nodes are on a different
  subnet/VLAN, or mDNS is blocked by a firewall.
- **Chat is running out of context tokens** → watch the token-budget bar (amber ~70%, red
  ~90%); run `/compress` (the Goal & Plan buffer is never pruned) or exclude individual
  messages from context.
- **Routing seems basic / the Valet looks "offline"** → no trained Valet Router artifact is
  present, so the keyword fallback is used until one is fetched/built (hardcoded rules are
  still enforced).
- **A hardware bridge (Blender/KiCad/ESPTool) won't connect** → set the correct executable
  path in the wizard's Hardware step (or auto-detect).

---

### Maintenance protocol
- One fact per bullet; keep bullets atomic so RAG chunking is clean.
- When code/features change, update the relevant section **and** bump
  `knowledge_base_version` in [routing_manifest.json](routing_manifest.json) so the
  dataset regeneration job knows to re-pull.
