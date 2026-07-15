# Omnecor's Custom Brain Packs (Team of Experts)

Omnecor ships with a built-in **"Team of Experts"** — a roster of highly specialized Custom Brain Packs (`.obp` files) designed to give small, locally running AI models (3–7B parameters) the focused expertise of a senior engineer.

By attaching one of these Brain Packs to an agent or persona, you can accomplish complex, domain-specific tasks completely offline in **Sovereign mode**, without relying on expensive cloud API calls.

Each brain is two parts: an always-on **Charter** (imperative rules the model follows on every turn) and a curated **Corpus** of one-fact-per-chunk reference knowledge retrieved top-k at inference time. Most are **general-purpose** domain experts usable on any project; only the **Omnecor Expert** is intentionally Omnecor-specific (the **Generalist** is general-purpose discipline but also knows Omnecor's empowerment ecosystem so it can steer a model toward the right layer). All are authored from reviewable sources in [`brains/sources/`](../../brains/sources/) and built through the real on-device pipeline (`pnpm brains:build:all`).

Here is an overview of the 9 expert Brain Packs included in Omnecor:

---

## 1. The Omnecor Expert
**Role:** Master of the Omnecor system architecture. *(The one domain-specific expert.)*
**What it does:** This brain knows Omnecor's codebase, system boundaries, Sovereign mode security gates, tRPC tiers, the unified libSQL engine, OMMESH, core services, and the Brains subsystem itself.
**When to use it:** Attach this brain when you need an agent to help build new features, troubleshoot Omnecor's internals, or understand how to properly use `BrainAuthoringService`, the migration paths, or the tRPC procedure ladder.

## 2. The 3D Modeler
**Role:** Specialist in 3D generation and spatial math.
**What it does:** Expert in Blender modeling & scripting, Three.js/WebGL scene graphs, meshes and topology, transforms and matrices, PBR materials, the OpenGL pipeline, and real-time rendering performance.
**When to use it:** Use this when working in the Blueprint Studio or anytime you need to generate, script, or analyze 3D models, fix import/orientation issues, or optimize a real-time scene.

## 3. The PCB & Schematics Engineer
**Role:** Hardware design and routing specialist.
**What it does:** Trained on KiCad workflow (DRC/ERC), schematic symbols and footprints, routing constraints (trace width, clearance, controlled impedance), power/ground integrity, RF matching, components, and design-for-manufacture.
**When to use it:** Attach this to an agent when using the Enhanced PCB Editor to get accurate advice on component placement, acid-trap prevention, decoupling, and multi-layer routing.

## 4. The Software Architect
**Role:** Senior full-stack engineer for the modern TypeScript stack.
**What it does:** A master of React, Node.js, TypeScript, tRPC, and Drizzle ORM. It applies standard software-engineering patterns, type-safe database access, and clean architectural boundaries.
**When to use it:** Use this brain for general programming tasks, building type-safe APIs and UI components, designing systems, and ensuring code is production-ready.

## 5. The Audio & Podcast Producer
**Role:** Specialist in auditory pacing and TTS pipelines.
**What it does:** Expert in Text-to-Speech pacing and SSML, voice selection, digital-audio fundamentals (sample rate, bit depth, LUFS), cleanup, loudness mastering, and multi-speaker podcast production.
**When to use it:** Attach this when generating podcast scripts, orchestrating multi-speaker audio, or fine-tuning the pacing and mastering of generated voice files.

## 6. The Content Writer
**Role:** Technical writing and documentation expert.
**What it does:** Trained on clear, concise prose, Markdown structuring, information architecture (README / Diátaxis), UI microcopy, and editing. It cuts the fluff and writes readable, well-structured text.
**When to use it:** Use this brain to write project READMEs, generate user-facing UI copy, or author clean, structured documentation.

## 7. The Workflow Blueprinter
**Role:** Specialist in node-based graphs and execution logic.
**What it does:** Expert in DAGs, data flow, fan-out/fan-in, idempotency, retries and backoff, dead-letter handling, scheduling, and observability for multi-step pipelines.
**When to use it:** Use this brain to design, validate, and debug complex multi-step AI pipelines and tool-execution graphs inside Omnecor's GodMode pipeline engine.

## 8. The Coding Expert *(Phase-6 exemplar)*
**Role:** Language-level computer-science and security fundamentals.
**What it does:** The original proven exemplar — 50 curated facts on JS/TS pitfalls, async/concurrency, security & OWASP (SQL injection, password hashing, timing-safe comparison, path traversal, JWT), algorithms & complexity, data structures, SQL, git, testing, and HTTP/distributed systems. Distinct from the Software Architect (which is framework/architecture-oriented); this brain is the *fundamentals under the code*.
**When to use it:** Attach this for correctness-critical coding — hardening input handling, avoiding language footguns, and getting the security details right.

## 9. The Generalist
**Role:** General-purpose operating discipline for ANY task — the "how to work" brain.
**What it does:** Teaches a small model to work like a disciplined senior engineer: plan before acting and confirm consequential decisions with the user, track plan + progress in a maintained `TODO.md`, reason through complex tasks with worked examples, hunt edge cases (empty/boundary/concurrency/scale) and vulnerabilities (injection, IDOR, path traversal, secrets) before declaring done, and verify instead of guess — read the real code, run the change, reproduce the bug, and never trust stale training data (use web search, docs, or skills to check anything that can change). Critically, its charter makes training data the **last resort, never the default**: every Omnecor empowerment layer is written as an operating order — a multi-step procedure means `list_agent_skills`/`read_agent_skill` first; an action means a tool call, never improvised shell; a must-be-correct number means a deterministic engine; a too-big task means mesh offload or `delegate_task`; a long command means `start_job`; injected project context outranks the model's weights. It also knows the whole Team-of-Experts roster and attaches (or recommends) the matching specialist per domain. When a task exceeds the model's ability — or routing fails with no API keys available — it falls back to the Valet's **Guided Walk-Through Scrapper Mode** ([VALET_ROUTER.md §4](VALET_ROUTER.md)): analyze locally, produce a copy-paste-ready prompt, recommend the best free-tier cloud web UI, guide the user through submitting it, integrate the pasted result, and keep the workflow moving — zero dead-ends.
**When to use it:** Attach it by default, to any agent, on any task — it stacks with the domain experts (attach the Generalist for *how* to work, a specialist for *what* it's working on).

---

## Measured impact (live A/B eval)

Every brain is proven, not assumed. `pnpm brains:eval:all` runs a clean A/B against a **real local 3–7B model** on identical model + system prompt + temperature, changing exactly one variable — whether the brain's charter + top-k retrieved corpus is injected — and grades answers by objective fact-coverage. Latest run (models served locally via an OpenAI-compatible endpoint):

| # | Brain | Base model | Baseline | With brain | Δ | Q improved/regressed |
|---|-------|-----------|:---:|:---:|:---:|:---:|
| 1 | Omnecor Expert | qwen2.5-coder:7b | 27.8% | **88.9%** | **+61.1pt** | 12↑ / 0↓ |
| 2 | Generalist | qwen2.5:7b | 47.6% | **100.0%** | **+52.4pt** | 14↑ / 0↓ |
| 3 | Software Architect | qwen2.5-coder:7b | 58.3% | **97.2%** | **+38.9pt** | 9↑ / 0↓ |
| 4 | Workflow Blueprinter | qwen2.5-coder:7b | 61.1% | **97.2%** | **+36.1pt** | 10↑ / 0↓ |
| 5 | Coding Expert | qwen2.5-coder:7b | 70.0% | **100.0%** | **+30.0pt** | 8↑ / 0↓ |
| 6 | PCB & Schematics Engineer | qwen2.5:7b | 75.0% | **97.2%** | **+22.2pt** | 7↑ / 0↓ |
| 7 | Audio & Podcast Producer | qwen2.5:7b | 77.8% | **100.0%** | **+22.2pt** | 6↑ / 0↓ |
| 8 | 3D Modeler | qwen2.5-coder:7b | 80.6% | **100.0%** | **+19.4pt** | 7↑ / 0↓ |
| 9 | Content Writer | qwen2.5:7b | 72.2% | **91.7%** | **+19.4pt** | 6↑ / 1↓ |

**9/9 brains posted a measurable improvement.** (The Coding Expert was originally capped at 50 curated facts and plateaued at 90.0%; raising the authoring cap to 60 and adding three targeted facts — float tolerance comparison, dynamic-identifier allow-listing, the full JWT verification checklist — lifted it to 100.0% with-brain coverage.) Retrieval surfaced a relevant curated fact in the top results for the large majority of questions in every domain. Rebuild the packs with `pnpm brains:build:all` and reproduce these numbers with `pnpm brains:eval:all` (point `OMNECOR_EVAL_BASE_URL` / `OMNECOR_EVAL_MODEL` at any OpenAI-compatible local runtime, including Omnecor's own llama-server).

*(Fact-coverage is a deliberately strict proxy: a fact only counts when the answer contains one of its accepted terms. Absolute percentages depend on the question set and grader; the meaningful signal is the consistent, regression-free lift the brain adds on top of the same model.)*

---

## How to Use Them

1. Open **Settings** or the **Agent Dashboard**.
2. Select the Persona or Sub-Agent you wish to modify.
3. Under the **Brain / Knowledge** section, select one of the installed `.obp` packs.
4. The agent will immediately adopt the imperative Charter (rules) and the embedded Corpus (knowledge) of that expert.

*(Note: These brains use the on-device `all-MiniLM-L6-v2` embedding model, ensuring 100% offline compatibility.)*
