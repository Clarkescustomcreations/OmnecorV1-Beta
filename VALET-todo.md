# VALET-todo — Automate the Valet Router (dataset → train → export → serve → verify)

Goal: turn the Valet Router from "scaffold + stock-model/keyword fallback" into a
**reproducible, automated pipeline** that produces a fine-tuned routing model, ships
or builds it, auto-serves it, and proves it works — runnable as **one command/job**
with no manual babysitting. Phased like `PKG-todo.md`, each phase ends in a
**Definition of Done (DoD)**.

## Current state (verified 2026-06-01)

- ✅ Dataset builder exists — `server/python_bridges/valet_dataset_builder.py`
      (Alpaca JSONL via local Ollama oracle, `EXAMPLES_PER_CATEGORY`, streams progress).
- ✅ LoRA trainer exists — `server/phase2/python_scripts/localLLMfine-tuning.py`
      (Unsloth + TRL `SFTTrainer`; args `--model_name --dataset_path --output_dir
      --epochs --r --lora_alpha --max_seq_length --save_method`; JSON progress to stdout).
- ✅ Process orchestration — `ProcessManagerService.spawnLoRATraining()` +
      `trainingRouter` (validateDataset / startTraining; WebSocket `training:${jobId}`).
- ✅ Inference server — `valet_router_inference.py` (`/health`, `/route`, `/modes`).
- ✅ TS bridge — `ValetRouterService` (HTTP → server, regex `ruleFallback` when offline).
- ⚠️ **No orchestrator** chaining build→validate→train→export→deploy as one flow.
- 🔴 **Inference ignores the trained artifact**: `get_model()` loads
      `os.environ["VALET_MODEL"]` (default `unsloth/Llama-3.2-1B-Instruct`) — never the
      LoRA `output_dir` / merged / gguf / ollama export. Training output is orphaned.
- 🔴 **Inference server is not auto-started** by the Node app (only the dataset
      builder is spawned, during a manual job) → in normal runs the router is
      keyword-rule-based only.
- ⚠️ **No eval gate** — nothing measures routing accuracy on a holdout set.
- ⚠️ **No artifact story** — no versioning, registry, or decision on bundle-vs-download.
- ⚠️ **Doc/model drift** — docs say fine-tuned Qwen2.5-1.5B; code defaults to Llama
      1B/8B stubs. Dataset oracle defaults to `llama3.2:latest` via Ollama.
- ⚠️ Heavy/fragile deps — `unsloth` is GPU-only and installed from git; `torch` is a
      large platform-specific install. No CPU training fallback.

### Three schema mismatches that block "out of the box" (verified 2026-06-01)

- 🔴 **M1** — `valet_dataset_builder.py` emits `{provider, model, local_capable,
      cost_tier, reasoning}`, **not** the schema the server parses.
- 🔴 **M2** — `valet_router_inference.py /route` parses `{mode, primary_provider,
      secondary_providers, reasoning, confidence, requires_todo_md, requires_status_md}`
      → a model trained on M1 can never satisfy it; always falls back.
- 🔴 **M3** — `localLLMfine-tuning.py` trains on `dataset_text_field="text"`, but the
      builder never writes a `text` field → SFT trains on empty text.

> **Training package authored:** `docs/ai-agents/valet-training/` now defines the single
> canonical contract (system prompt, I/O schema, ChatML `text` formatting), the Omnecor
> expert knowledge base, an updatable `routing_manifest.json`, the hardcoded-rules spec,
> and seed datasets for all five behavior classes (route / qa / rules / plan / skill).
> Phases A and B below wire the code to that package.

Legend: `[ ]` todo · `[x]` done · 🔴 blocker · ⚠️ risk · 💡 nice-to-have

---

## Phase A — Schema unification & code convergence (do FIRST — unblocks everything)

- [ ] **A.1** Adopt the canonical I/O contract (`valet-training/IO_CONTRACT.md`) as the
      one schema. Update the inference server's `RouteDecision` pydantic model and the TS
      `RouteDecision` interface (`ValetRouterService.ts`) to the extended schema
      (`category`, `primary_model`, `cost_tier`, `local_capable` added). Additive/back-compat.
- [ ] **A.2** Make the system prompt (`valet-training/VALET_SYSTEM_PROMPT.md`) the shared
      source used by generation, training, and inference — load it from disk in
      `valet_router_inference.py` instead of the inline prompt (kills train/inference skew).
- [ ] **A.3** Inference builds the prompt via `tokenizer.apply_chat_template` and injects
      the live `routing_manifest.json` + RAG context (IO_CONTRACT §6).
- [ ] **A.4** Reconcile the `/plan` docs filename: code says `Rules-Standards.md`, docs say
      `Rules/standards.md`. Pick `Rules/standards.md` in `ValetRouterService.HARDCODED_RULE`,
      the system prompt, and seeds so all three agree (HARDCODED_RULES.md note).
- [ ] **A.5** Unify the routing taxonomy on the manifest categories (replace the builder's
      ad-hoc list and the doc's separate list with the manifest as the single taxonomy).
- **DoD:** the schema a trained model emits is exactly what the server parses; the same
  system prompt + chat template are used in generation, training, and inference.

---

## Phase B — Dataset generator upgrade (expertise + rules + RAG, not just routing)

- [ ] **B.1** Extend `valet_dataset_builder.py` per `valet-training/DATASET_GENERATION.md`:
      load the `seed/*.jsonl`, read `routing_manifest.json` + `OMNECOR_KNOWLEDGE_BASE.md`,
      and generate **all five classes** (route / qa / rules / plan / skill) at the target mix.
- [ ] **B.2** Emit the canonical response schema (A.1) for `route` rows, with labels looked
      up from the manifest (not guessed by the oracle), plus 10% hard negatives.
- [ ] **B.3** Write the ChatML **`text`** field per row (`--emit-text`) so the trainer
      works unmodified (fixes M3).
- [ ] **B.4** Generate `qa` pairs from the knowledge base and repo docs so the model learns
      to **use retrieved context** — the basis for the runtime RAG ("pull and update").
- [ ] **B.5** Emit `metadata.json` (per-class counts, manifest_version, oracle model, seed)
      + a stratified holdout eval set for Phase 4.
- **DoD:** one `valet_dataset_builder.py` run produces a balanced, `text`-formatted dataset
  covering routing **and** Omnecor expertise **and** the hardcoded-rule behaviors, derived
  from the live manifest + knowledge base.

---

## Phase 0 — Decisions, prerequisites, deps bootstrap

- [ ] **0.1 Lock the base model.** Recommended: **`Qwen2.5-1.5B-Instruct`** (matches the
      docs/branding and is the right size for a router). Set it as the single default in
      `trainingRouter` schema, `ProcessManagerService`, and `valet_router_inference.py`
      (`VALET_MODEL`). Eliminate the conflicting `llama-3-8b` / `Llama-3.2-1B` defaults.
- [ ] **0.2 Choose the distribution model (the big fork):**
      - **A — Maintainer-built, shipped (recommended for beta):** the pipeline runs once on
        a GPU box / CI, produces a versioned artifact (gguf or Ollama model), which is
        bundled or downloaded on demand. Users get a working router with no training.
      - **B — On-device build (Sovereign power-users):** the app runs the pipeline locally
        (needs GPU + heavy deps). Optional, gated behind a setting.
      - **Default plan: A as the shipping path, B as an opt-in Phase 5.**
- [ ] **0.3 Choose the export/runtime format.** Recommended **`--save_method gguf`** served
      via **llama.cpp** (already integrated: `llamacpp_bridge.py`) **or** `--save_method
      ollama` served via the existing Ollama integration. Avoid shipping raw torch+unsloth
      to end users. Decide one; the inference server (Phase 3) must match.
- [ ] **0.4 Python deps bootstrap.** Add a `scripts/setup-valet-ml.sh` (or extend
      `packaging/scripts/install.sh`) that creates a venv and installs the ML stack
      (`torch` per platform, `transformers`, `trl`, `datasets`, and—if GPU—`unsloth`).
      Pin versions. Make it idempotent and skip on machines without a GPU when in mode A.
- [ ] **0.5 GPU/CPU detection.** Reuse `packaging/scripts/detect_gpu.py` to decide
      training feasibility and to pick `torch` dtype; fail fast with a clear message if
      on-device training (mode B) is requested without a supported GPU.
- **DoD:** base model + distribution + export format are decided and recorded here; a
  single bootstrap script installs the ML deps reproducibly on a target GPU box.

---

## Phase 1 — Orchestrate the pipeline (one job: build → validate → train → export)

- [ ] **1.1 Author an orchestrator** `server/python_bridges/valet_pipeline.py` (or a TS
      coordinator) that runs, in order, with a single entrypoint:
      1. dataset build (`valet_dataset_builder.py`)
      2. dataset validation (reuse `trainingRouter.validateDataset` logic)
      3. LoRA train (`localLLMfine-tuning.py`)
      4. export (per 0.3) + register artifact (Phase 2)
      Each step streams the existing JSON progress lines; the orchestrator aggregates them.
- [ ] **1.2 Expose it as one tRPC procedure** `trainingRouter.buildValetRouter` that
      spawns the orchestrator via `ProcessManager`, returns a `jobId`, and streams unified
      progress on `training:${jobId}`. Add a CLI wrapper (`pnpm valet:build`) for headless/CI.
- [ ] **1.3 Make it idempotent + resumable.** Skip dataset rebuild if a fresh dataset hash
      exists; skip train if an artifact for the same (base model + dataset hash + config)
      is already registered. Surface a `--force` flag.
- [ ] **1.4 Config file** `valet.config.json` (base model, examples-per-category, epochs,
      LoRA r/alpha, save_method, eval thresholds) so a run is fully declarative and
      reproducible. Set a fixed seed.
- [ ] **1.5 Preconditions check.** Before starting: Ollama reachable with the oracle model
      pulled (dataset step), disk space, GPU present (mode B). Fail with actionable errors.
- **DoD:** `pnpm valet:build` (or the tRPC call) runs end-to-end on a GPU box and produces
  a trained, exported artifact from scratch, with streamed progress and no manual steps.

---

## Phase 2 — Artifact: export, version, registry, distribution

- [ ] **2.1 Deterministic output path** `models/valet-router/<base>-<datasetHash>-<date>/`
      containing the export (gguf/ollama/merged) + `metadata.json` (base model, dataset
      hash, config, eval scores, git SHA).
- [ ] **2.2 Model registry / pointer.** Write a `models/valet-router/current.json` that
      names the active artifact. The inference server reads this (not a hardcoded HF stub).
- [ ] **2.3 Distribution (mode A).** Decide bundle vs download:
      - small gguf (~1–1.5 GB for a 1.5B Q4) → host as a GitHub release asset; add a
        `scripts/fetch-valet-model.sh` that downloads + checksums into `models/valet-router/`.
      - Wire `packaging/models/` (already referenced in `electron-builder.yml extraResources`)
        so desktop builds can ship or fetch it.
- [ ] **2.4 `.gitignore`** the `models/valet-router/` weights; commit only `current.json`
      schema + metadata, never large binaries.
- **DoD:** a built artifact is versioned with metadata and resolvable via `current.json`;
  a fresh machine can obtain the model via one fetch script with checksum verification.

---

## Phase 3 — Serve the trained model + auto-start 🔴

- [ ] **3.1 Load the real artifact.** Rewrite `valet_router_inference.py:get_model()` to
      resolve the model from `current.json` (Phase 2.2) instead of the HF stub. For gguf →
      use `llamacpp_bridge.py`; for ollama → call the local Ollama model; for merged HF →
      `from_pretrained(local_path)`. Set `health.model_loaded` truthfully.
- [ ] **3.2 Auto-start the server with the app.** Have the Node backend spawn the FastAPI
      router (via `ProcessManager`) on boot when an artifact is present and the active
      routing mode needs it; health-check on `:8010/health`; restart on crash.
- [ ] **3.3 Graceful degradation.** Keep the `ruleFallback` path, but log clearly when the
      model is absent so the keyword fallback is observable (today it's silent — see
      `ValetRouterService.route`). Surface model status in Settings → Valet Router.
- [ ] **3.4 Resource guardrails.** Respect VRAM/CPU limits; don't auto-start the model
      server in `api_direct` mode where it isn't used.
- **DoD:** with an artifact present, starting the app auto-launches the router server,
  `/health` reports `model_loaded: true`, and `/route` returns model-driven decisions; with
  no artifact, the app still runs on the documented keyword fallback.

---

## Phase 4 — Evaluation gate (prove the router actually routes)

- [ ] **4.1 Holdout eval set.** The dataset builder already writes a validation split
      (`VAL_PATH`). Add `valet_eval.py` that runs the trained model over it and reports
      per-category accuracy + confusion matrix + mean confidence.
- [ ] **4.2 Acceptance thresholds** in `valet.config.json` (e.g. overall ≥ 0.85, no
      category < 0.70). The pipeline (1.1) **fails the job** if thresholds aren't met, so a
      bad model is never registered as `current`.
- [ ] **4.3 Baseline comparison.** Compare model accuracy vs the keyword `rule_based_route`
      on the same holdout — the model must beat rules, else the rule fallback is preferable.
- [ ] **4.4 Record scores** into `metadata.json` (2.1) and print a summary at job end.
- [ ] **4.5 Expertise + rules eval.** Beyond routing accuracy, score the `qa` class for
      factual correctness against `OMNECOR_KNOWLEDGE_BASE.md` and assert the rule reflexes
      fire (todo/status creation, `/plan` docs list, skill offer) on held-out `rules/plan/
      skill` prompts.
- **DoD:** the pipeline emits accuracy numbers, gates registration on thresholds, and
  demonstrates the trained router beats the keyword baseline on the holdout set **and**
  answers Omnecor questions correctly while honoring the hardcoded rules.

---

## Phase 7 — Runtime RAG + expertise upkeep ("pull and update")

- [ ] **7.1 Inject the live manifest.** The router server loads `routing_manifest.json`
      at startup and injects it into the system prompt (A.3) so model names update without
      retraining.
- [ ] **7.2 Brain Map retrieval.** For `qa` / `knowledge_retrieval` tasks, retrieve
      relevant chunks from the Neural Brain Map (ChromaDB) + `OMNECOR_KNOWLEDGE_BASE.md`
      and pass them as `{{RAG_CONTEXT}}`. The model is already trained to use them (B.4).
- [ ] **7.3 Knowledge refresh job.** A scheduled task re-embeds the knowledge base + repo
      docs when they change (bump `knowledge_base_version`); optionally pull latest model
      IDs per provider and open a manifest-update PR for review.
- [ ] **7.4 Drift check.** CI fails if the system prompt / schema in code diverges from
      `valet-training/` (single-source enforcement).
- **DoD:** updating a fact in the knowledge base or a model name in the manifest changes
  the router's behavior **without retraining**; the router answers from current data.

---

## Phase 5 — On-device automation (optional, Sovereign power-users)

- [ ] **5.1 Setting + gate.** Settings → Valet Router → "Train local router" (off by
      default). Requires GPU (0.5) and the ML venv (0.4); refuses gracefully otherwise.
- [ ] **5.2 First-run / scheduled trigger.** Optionally kick `buildValetRouter` on first
      launch or on a schedule, reusing the same orchestrator (1.1) — no separate code path.
- [ ] **5.3 Background + cancelable.** Long job runs via `ProcessManager` (already
      timeout-exempt), cancelable from the UI, progress on the existing WebSocket channel.
- **DoD:** a power-user with a GPU can produce and activate a local router entirely from
  the UI, using the identical pipeline that maintainers/CI use.

---

## Phase 6 — CI automation, docs reconciliation, sign-off

- [ ] **6.1 CI pipeline job** (GPU runner) that runs `pnpm valet:build` on a tagged
      release, enforces the eval gate, and publishes the artifact as a release asset.
- [ ] **6.2 Reconcile docs.** Update `docs/ai-agents/VALET_ROUTER.md` + README to state the
      actual base model/size, that the router is a fine-tuned classifier produced by this
      pipeline, and how it's distributed. Remove the unverifiable "fine-tuned 1.5B" claim
      until 4.x passes.
- [ ] **6.3 Reproducibility check.** Two runs from the same `valet.config.json` + dataset
      hash produce equivalent eval scores (seeded).
- [ ] **6.4 Final sign-off:**
      - [ ] `pnpm valet:build` green from scratch on a clean GPU box
      - [ ] artifact fetchable + checksum-verified on a fresh machine
      - [ ] app auto-serves it; `/health` model_loaded:true; `/route` model-driven
      - [ ] eval thresholds met and beat keyword baseline
      - [ ] docs match reality

---

## Risk register

| # | Risk | Phase | Impact |
|---|------|-------|--------|
| V1 | Inference never loads trained artifact (loads HF stub) | 3.1 | Training output orphaned; "router" is keyword rules |
| V2 | Router server not auto-started | 3.2 | Model exists but unused in normal runs |
| V3 | `unsloth` GPU-only / git-installed; `torch` heavy | 0.4 | Pipeline unrunnable on many machines; flaky installs |
| V4 | Dataset oracle quality (Ollama small model) caps accuracy | 1.1/4.x | Garbage-in → router worse than rules |
| V5 | No eval gate → ship a bad router | 4.2 | Mis-routing, wasted cloud spend, bad UX |
| V6 | Large weights in git / bundle bloat | 2.3/2.4 | Repo + installer size blowup |
| V7 | Doc claims outrun reality (Qwen2.5-1.5B fine-tuned) | 6.2 | Trust / beta credibility |
| V8 | Path with spaces+parens breaks native/py tooling (see PKG-todo R7) | all | Build/train failures in this checkout |
| V9 | Schema mismatch M1/M2/M3 not fixed before training | A/B | Trained model unparseable; SFT trains on empty `text` |
| V10 | Train/inference prompt skew (different system prompt or template) | A.2/A.3 | Silent routing-accuracy collapse in prod |
| V11 | 1.5B capacity split across route + assist modes | B (mix) | Underfit one mode; tune mix, consider rank/epochs, or two adapters |
| V12 | RAG/manifest stale or not injected | 7.x | "Expert" answers wrong/old facts despite the design |

---

## Notes
- This plan **automates orchestration of existing tools**; it does not assume rewriting the
  trainer or dataset builder, which already work. The critical code changes are concentrated
  in Phase 3 (artifact loading + auto-start) and the new orchestrator (Phase 1).
- Companion to `PKG-todo.md` — the shipped router artifact (Phase 2/3) feeds the desktop
  packaging's `packaging/models/` resource path.
