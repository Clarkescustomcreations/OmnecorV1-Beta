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
- Auto-downgrade: hitting a hard limit re-routes remaining tasks to local Ollama.
- Virtual cards via Lithic (optional); without `LITHIC_API_KEY`, a manual tracking
  mode logs spend without issuing cards.

## 11. Security & sovereignty

- Immutable audit log; PII redaction (`redactSensitiveData()`) before any log write.
- Prompt-injection defense (`PromptSanitizer`) fires `security:injection_attempt`.
- Zero-Login / air-gapped: `ZERO_LOGIN_MODE=true` bypasses OAuth and forces Sovereign.
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

---

### Maintenance protocol
- One fact per bullet; keep bullets atomic so RAG chunking is clean.
- When code/features change, update the relevant section **and** bump
  `knowledge_base_version` in [routing_manifest.json](routing_manifest.json) so the
  dataset regeneration job knows to re-pull.
