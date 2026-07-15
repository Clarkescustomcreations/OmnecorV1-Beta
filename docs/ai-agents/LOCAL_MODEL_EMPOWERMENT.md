# Empowering Small Local Models (SLMs) with Omnecor

A core philosophy of Omnecor is **Local-First Autonomy**. While the platform seamlessly
integrates with massive frontier cloud models (Claude, GPT‑4o, Gemini) via `cloudProcedure`
routing, one of its most powerful capabilities is closing the gap for small models running on
modest local hardware.

The question is often asked: **Can a 1.5B–8B parameter model running locally on an RTX 4060
(8 GB VRAM) — or even a phone — beat its stock benchmarks and perform complex, multi-step
agentic work?**

With Omnecor's architectural scaffolding, the answer is **Yes**. Omnecor surrounds smaller
models with a resilient ecosystem that patches their inherent weaknesses — context limits,
tool-calling fragility, brittle CLI syntax, hallucinated math, and hardware constraints —
letting them "punch above their weight class." A small model plugged into Omnecor is never
working alone: it is wrapped in a self-correcting harness, given high-level tools instead of raw
shell, handed pre-compressed context, backstopped by deterministic engines for anything it
shouldn't guess at, and able to borrow a bigger GPU (or a full sub-agent) from anywhere on the
LAN.

This document is the complete inventory of what Omnecor has built to empower local models, and
where each piece lives in the codebase.

---

## At a glance

| Empowerment layer | What it fixes | Key implementation |
|---|---|---|
| Omnecor-owned runtime | Depends on no external stack; runs its own GGUFs | `LocalLlmRuntimeService` (llama-server) |
| Unified model catalog | One list across local/mesh/cloud with capabilities | `ModelCatalogService` |
| OMMESH VRAM routing | 8 GB card borrows a bigger GPU on the LAN | `RoutingEngine` + `HostTelemetry` + `MeshServer` |
| Background sub-agents & delegation | Offload a whole task to a peer; long jobs continue | `SubAgentHostService`, `DelegationService`, `AsyncJobService` |
| Try‑Fail‑Fix harness | Malformed JSON / tool errors don't crash the run | `ChatAgentRunner`, `LocalSubAgentWorker` |
| Native MCP + Skills hosting | High-level tools instead of fragile bash | `MCPClientService`, `mcp-local-skills.ts` |
| Pre-built "easy command" skills | Model reads a recipe instead of improvising | `list_agent_skills` / `read_agent_skill` |
| External Brains (Brain Packs) | Portable expertise + retrieval, no big context | `BrainPackService`, `EmbeddedVectorStore`, `injectBrainContext` |
| Neural Map RAG | 50k-line repo compressed to ~1.5k tokens | `MemoryArchitectService` + `injectMapRagContext` |
| Deterministic domain toolsets | Never hallucinate math/structure | Blueprint Studio (`buildBlueprintTools`, FEA/calc engines) |
| Sequential MoE chains | Ensemble intelligence on one small GPU | hot-swap via `LocalLlmRuntimeService.ensureModelLoaded` |
| Valet Router | Route each task to the right-sized model | `ValetRouterService` |

---

## 1. Omnecor Hosts Its Own Inference Runtime (No Ollama Required)

Omnecor does not depend on any external inference stack. `LocalLlmRuntimeService` supervises
**`llama-server`** (llama.cpp's OpenAI-compatible HTTP server) as a managed child process:
Omnecor discovers a `llama-server` binary (PATH or the usual install locations, Windows and
POSIX) and a `.gguf` model, spawns the engine, and posts raw completions to it — so the app is
fully functional even when Ollama is absent.

* **Auto-start + self-healing:** the runtime starts on boot (opt out with
  `LOCAL_LLM_AUTO_START=false`), watches the process, and respawns with backoff on a crash. If no
  binary or model is found, it logs a single actionable line and stays out of the way.
* **Hot-swap loader:** `ensureModelLoaded(modelId)` stops the current model and spawns the next,
  freeing the prior model's VRAM/RAM. This is the primitive that makes MoE chains (§11) and the
  phone/desktop model-lifecycle manager possible on constrained hardware.
* **CUDA / CPU builds:** the runtime runs whatever `llama-server` build is present (e.g. a CUDA
  build on an NVIDIA box, CPU elsewhere), giving the local model real GPU acceleration without a
  heavyweight dependency.

Because it owns the runtime, Omnecor can guarantee tool access, streaming, and capability flags
for every local model — the same contract cloud models get.

## 2. The Unified Model Catalog

`ModelCatalogService.getCatalog()` merges **every model this node can currently run with full
tool access** into one deduplicated, capability-tagged list:

* the Omnecor-owned local runtime (§1),
* an optional local Ollama instance,
* models advertised by **OMMESH peers** (loaded on demand over mTLS — see §3),
* any cloud provider with a configured API key.

Each entry is tagged with a `location` (`local` / `mesh-peer:<nodeId>` / `cloud:<provider>`) and
`capabilities`, and deduped by location + content hash. For a Sovereign/air-gapped user,
`getCatalog({ isSovereign: true })` skips the cloud source entirely rather than making a live
call to a cloud model-list endpoint. The web and phone pickers merge the phone's on-device
models into this same list client-side.

The payoff for small models: the picker treats a 1.5B local GGUF, a peer's 14B, and a cloud
frontier model as first-class peers, and every one of them can drive the same agentic tool loop.

## 3. OMMESH VRAM Routing — Borrow a Bigger GPU on the LAN

An 8 GB card can't hold a 32B model — but another machine on the network might. **OMMESH** is
Omnecor's distributed LAN layer, and it lets a small local node **offload inference to a
better-provisioned peer** while the user keeps talking to their local instance.

* **VRAM-weighted peer selection.** `RoutingEngine.calculateScore()` ranks candidate nodes by
  **free** GPU VRAM headroom weighted against current utilization
  (`vramWeight * 0.6 + utilizationWeight * 0.4`). Nodes with no GPU (or no telemetry yet) score a
  flat minimal `0.1`, so a GPU-equipped peer always wins over a CPU-only one, and a peer only
  wins if it *strictly* out-scores the current best.
* **Real telemetry.** `HostTelemetry` reports each host's free VRAM (MB), GPU utilization (%), and
  temperature by shelling out to `nvidia-smi` / `rocm-smi` (multi-GPU hosts sum free VRAM). Free
  headroom — not card size — is what routing optimizes for.
* **Strict-mTLS cross-node inference.** `MeshServer` exposes a TLS 1.3, CA-signed, fingerprint-
  pinned HTTPS endpoint (`MESH_PORT`, default 3001); only trusted peers connect. A Sovereign-mode
  guard prevents cloud providers from tunnelling through mesh routing.
* **Pinning.** The catalog surfaces each peer's models; selecting one passes a `targetNodeId` so
  the run is pinned to that exact peer instead of the auto-scorer's pick.

Verified in practice as a 3‑PC + phone mesh (Linux + two RTX cards + an Android node registering
over WebSocket), so a laptop-class model can transparently answer from a workstation-class GPU.

## 4. Background Sub-Agents, Delegation & Long-Job Continuation

Small models do better when a hard task is handed off whole, and when long-running work doesn't
block the chat.

* **Full sub-agent on a peer.** `DelegationService` + `SubAgentHostService` let the origin spawn a
  complete sub-agent on a trusted mesh peer (its own managed conversation + sandbox). The
  `delegate_task` tool is offered only when the run allows delegation (`allowDelegation`), and the
  spawn is always HITL-gated even under auto-approve — another machine is outside "the active
  map." Delegated runs cannot themselves delegate, so chains can't runaway.
* **In-process agent worker.** `LocalSubAgentWorker` runs a `<tool_call>` agent loop
  (sandbox execution + MCP skills) for background tasks, with the Try‑Fail‑Fix loop of §5 baked
  in (`maxRetries`, default 3).
* **Async job continuation.** `AsyncJobService.track(jobId, context)` remembers which conversation
  started a long command (`start_job` — builds, downloads, training). When the job finishes, the
  WebSocket layer broadcasts a **condensed** result back to the originating client, which injects
  it as a new conversation turn — **re-prompting the agent** so it can react. The model ends its
  turn immediately after starting the job instead of blocking, then picks up where it left off.

## 5. The Try‑Fail‑Fix Harness (Syntax & Tool Resilience)

Small models (especially 1.5B–7B) stumble on strict JSON, escaping, and first-try tool payloads.
In a naive system one unescaped quote crashes the orchestration layer. Omnecor's agentic core —
`ChatAgentRunner` for interactive chat and `LocalSubAgentWorker` for background tasks — wraps
inference in a **Try‑Fail‑Fix loop** at two levels:

* **Parse level:** a balanced-brace extractor tolerates messy/partial tool blocks, and a
  malformed call is caught rather than fatal. `LocalSubAgentWorker` injects the exact error back
  as a `System Error: <message>. Please fix and try again.` turn so the model sees its own mistake
  and self-corrects (up to `maxRetries`).
* **Execution level:** when a tool *runs* but fails, the runner returns the failure text to the
  model (e.g. `Tool "x" failed: <message>. Adjust the arguments or take a different approach.`)
  instead of aborting the turn — the model gets a concrete signal to retry differently.

The same loop carries the rest of the agentic experience for local models: HITL approval for
file edits / commands, a structured block stream (command / edit / job / MCP / sub-agent boxes),
and native `<think>` / `message.thinking` reasoning capture folded into a collapsible section.
This is what lets `qwen2.5-coder` or `llama3.1:8b` navigate multi-tool workflows even when they
fumble the first formatting attempt.

## 6. Native MCP Tool Hosting + Skills

Small models struggle to compose reliable multi-step CLI (chained `grep`/`sed`/pipes). Omnecor
lowers the cognitive load by giving them **high-level tools** instead of raw shell.

* **Native MCP client.** `MCPClientService` connects to any configured Model Context Protocol
  server (stdio or HTTP), discovers its tools, and dispatches to them. In the tool loop, any
  action that isn't a built-in falls through to MCP — so external tool servers (web search,
  fetch, databases, domain APIs) appear to the model as native capabilities it can just call.
* **Built-in agent tools.** `AGENT_TOOL_DEFINITIONS` gives every model three approval-gated
  primitives — `edit_file` (whole-file or search/replace, scoped to the active project),
  `run_command` (spawned directly, no shell interpolation), and `start_job` (async, continues via
  §4). Deciding "use tool X" is far cheaper for a small model than "write bash script Y."
* **Skills over MCP.** A bundled MCP server (`server/scripts/mcp-local-skills.ts`, registered via
  `register-local-skills.ts` into `mcpServerConfigs`) exposes `list_agent_skills` and
  `read_agent_skill`, scanning Omnecor's `skills/` root and standard skill directories. The model
  can *discover* and *read* a step-by-step skill instead of improvising a procedure.

## 7. Pre-Built "Easy Command" Skills

Building on §6, Omnecor ships **pre-authored skills** — packaged recipes for common,
error-prone workflows — so a small model doesn't have to derive a procedure from scratch. Rather
than hoping the model remembers the right flags, it calls `read_agent_skill` and follows a
vetted recipe. This turns fragile, open-ended "figure out how to do X" prompts into reliable
"follow this known-good procedure for X" executions — exactly the shape small models handle well.

## 8. External Brains (Brain Packs) — Portable Expertise Without Big Context

**Brain Packs** give a small model deep domain expertise it doesn't have in-weights, without
inflating the context window. A Brain Pack is a portable `.obp` file bundling a **charter**
(always-on operating instructions) plus a pre-embedded **corpus** (reference material).

* **Local, embedder-independent engine.** `EmbeddingService` produces embeddings locally and
  `EmbeddedVectorStore` stores/searches them with no external vector DB — so Brains work
  air-gapped. `BrainPackService` handles the `.obp` import/export; `BrainAuthoringService` builds
  new packs.
* **Injection.** `injectBrainContext()` (`server/_core/brainContext.ts`) resolves the attached
  brains (per-chat `brainIds` unioned with a persona's durable `data.brains`), then injects **(1)
  every brain's charter (always-on)** and **(2) a merged, ranked top-k retrieval from compatible
  brains' corpora** into the system prompt, under a token budget. Ownership-scoped — a run never
  resolves another user's brains.
* **Team of Experts.** Multiple brains attach at once and are merged, so a single small model can
  answer with a coding brain, a PCB brain, and a writing brain simultaneously (shipped packs
  include `coding`, `pcb-engineer`, `software-architect`, `content-writer`, `3d-modeler`,
  `omnecor-expert`, `workflow-blueprinter`). Attach per-chat (BrainToggle) or durably on a
  persona/Valet route; packs sync across the mesh over OMMESH.

The effect: a generalist 7B gains specialist grounding on demand, and only the relevant slices
of that expertise ever hit the prompt.

## 9. Neural Map RAG (Context Compression)

An 8 GB VRAM limit means you can't use huge context windows without spilling into slow system
RAM. The **Neural Brain Map** pre-filters context so the model stays in fast VRAM while still
"knowing" the whole project. Before a prompt reaches the model, Omnecor:

1. Vectorizes the active project workspace into local collections
   (`MemoryArchitectService`, ChromaDB — local, so it works in Sovereign mode);
2. Runs a semantic search (RAG) on the user's prompt;
3. Injects only the most relevant chunks — `injectMapRagContext()` retrieves ~1,500 tokens of the
   best excerpts and merges them into the system prompt, gated by the map's `enableAIContext`.

A 50,000-line codebase compresses to the ~1,500 most relevant tokens, and remote sources
(`github://…`, integrations) can be indexed into the same collection. **Bidirectional with
Blueprint Studio:** a Project's attached Build Plans are folded into chat context, and a Project's
brief/goals are folded into the Blueprint agent (`injectBlueprintContext` / `buildProjectContextBlock`).

## 10. Deterministic Domain Toolsets — Never Let a Small Model Guess

The single biggest failure mode for a small model doing real-world work is **confidently
hallucinating numbers**. Omnecor's answer is to hand the model deterministic tools and forbid it
from doing the math itself. **Blueprint Studio** is the flagship example:

* The Blueprint agent (`buildBlueprintTools`) exposes ~13 engineering calc types, a real FEA
  bridge (`BlueprintFeaService`, Gmsh + linear-static solve), a dual CAD engine (JSCAD / OpenSCAD),
  cut-list nesting, a 61-material catalog with real mechanical properties, and pattern/PDF export.
* Its system prompt hard-rules that **every span, load, deflection, weld, bolt, or joint number
  MUST come from the calc engine or FEA** — the model designs and narrates, but the safety-relevant
  numbers are computed, not invented.
* **Now available inside the main chat.** With the chat "Fabrication" toggle on, the same toolset
  is injected into the general agentic loop (`buildChatBlueprintTools`): a small model can turn
  "design me a 500 lb welding table" into a real, persisted Build Plan (BOM, cut list, dimensioned
  drawings, verified structure) attached to a Project — creating a new Project automatically if
  none is active.

This pattern — offload anything that must be *correct* to a deterministic engine — is what lets a
7B model produce engineering-grade output that would normally require both a much larger model and
a human engineer.

## 11. Sequential MoE (Mixture of Experts) Chains

A single 7B model can't simultaneously be a senior architect, a coder, and a rigorous QA tester.
The **MoE Chain** feature lets an 8 GB user chain multiple local GGUFs *sequentially*:

* **Step 1 (Research):** load a reasoning model (e.g. a quantized `deepseek-r1` / `deepseek-coder`)
  to plan.
* **Step 2 (Code):** Omnecor unloads the reasoner and loads `qwen2.5-coder:7b` to write the code.
* **Step 3 (Review):** unload the coder, load a strict evaluator to review.

Each swap is a `LocalLlmRuntimeService.ensureModelLoaded()` hot-swap (stop current → spawn next,
freeing the prior model's memory), so the chain achieves ensemble-level intelligence while
respecting strict local hardware limits.

## 12. The Valet Router — Right-Sized Model per Task

`ValetRouterService` classifies each task (chat / code / research / router) and routes it to the
most appropriate model. In the chat picker this is the **`auto-valet`** selection: a fast
fine-tuned router decides the primary provider/model for the turn, with a configurable fallback if
the router is offline. This keeps small local models on the tasks they handle well and escalates
(to a peer via §3, or to cloud) only when a task genuinely needs more — the small model is never
set up to fail on work that's out of its depth.

---

## How it fits together

A local model in Omnecor is scaffolded on every side at once:

1. **Runtime** (§1) runs it; the **catalog** (§2) lists it beside mesh and cloud peers.
2. The **Valet Router** (§12) sends it only tasks it can handle; harder ones **offload over
   OMMESH** (§3) or **delegate** to a peer sub-agent (§4).
3. Its context is **pre-compressed by RAG** (§9) and **enriched by Brain Packs** (§8), so it stays
   in fast VRAM while "knowing" the project and the domain.
4. It acts through **high-level MCP tools and pre-built skills** (§6–7) instead of fragile shell,
   and anything that must be numerically correct is **offloaded to deterministic engines** (§10).
5. When it fumbles JSON or a tool call, the **Try‑Fail‑Fix harness** (§5) feeds the error back and
   lets it self-correct; long jobs **continue asynchronously** (§4).
6. For multi-role work it **hot-swaps through an MoE chain** (§11).

The result is that "local inference" in Omnecor is not a single small model straining alone — it
is a small model at the center of a resilient, self-correcting, hardware-aware agentic system.

---

## Benchmark Results: `qwen2.5-coder:7b`

To answer whether a smaller model can beat its stock benchmarks when empowered by Omnecor, an
automated harness (`server/scripts/benchmark-qwen-coder.ts`) was run against `qwen2.5-coder:7b`
hosted on a local Ollama server (node 201).

**The Test Suite:** the model was run through a multi-case suite to prove consistent performance
rather than a one-off success. Tasks included:
1. Basic tool invocation (printing strings via `python3`).
2. Local filesystem inspection (safely running `ls` on constrained directories).
3. Multi-step algorithmic reasoning (generating and running a Python script to compute math).

**The Result:** across multiple distinct runs, the 7B model consistently demonstrated successful
reasoning and execution:
1. **Tool Invocation:** accurately crafted JSON tool payloads with zero formatting errors across
   tests.
2. **Try‑Fail‑Fix Resiliency:** on harder multi-step tasks that traditionally cause 7B models to
   hallucinate CLI commands, the sandbox intercepted failures and let the model self-correct.
3. **Completion & Speed:** tasks completed consistently in under 2–4 seconds each — proving the
   Omnecor harness functionally elevates a 7B model to reliable, multi-step agentic work that would
   normally require a 70B+ class model, without sacrificing speed.
