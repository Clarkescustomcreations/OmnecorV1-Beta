# Omnecor — Persona-Based Dual-Sided Test Plan

> Created 2026-07-03. Companion to `Verification-Pass.md` (which tracks the automated
> suite). This doc plans **exploratory, workflow-level testing** run from both sides of
> the system: driving the UI as a human user would (Playwright / chrome-devtools) and
> running inside the AI harness (direct tRPC callers, service invocation, mesh nodes).
> Goal: end-user-experience issues, obscure edge cases, workflow polish, consistency
> gaps, and hidden regressions that unit/route tests can't see.

---

## Method — every scenario is tested twice

| Side | How | Session |
|---|---|---|
| **Outside (user seat)** | Playwright / chrome-devtools MCP driving the real UI at the dev server | `dev-seed-user.ts` cookie (scrapper mode) |
| **Inside (AI seat)** | `appRouter.createCaller(ctx)` via `trpcHarness.ts`, or raw tRPC HTTP calls — exercising the same procedures the UI calls | Seeded users per scenario (incl. second user + non-admin roles for security) |

A finding counts as **confirmed** when the defect reproduces on at least one side and
the root cause is identified. Cross-side disagreement (works via API, broken in UI, or
vice-versa) is itself a finding class — it means a wiring/consistency bug.

**Evidence per finding:** repro steps, side(s) affected, severity (P0 crash/data-loss,
P1 broken workflow, P2 degraded UX, P3 polish), screenshot or test snippet, suspected
file. Log findings in the table at the bottom of this doc.

**Standing checks applied inside every scenario** (from AGENTS.md / OMNECOR directive):
1. **Persistence** — restart the server mid-scenario; no user work may be lost.
2. **Shared project workspace** — all pages/features must operate on the *selected*
   Project/Neural Map; state bleed between projects is a P1.
3. **No-subscription operation** — every workflow must complete with Honcho and all
   cloud services absent (local-only path exists and is discoverable).

---

## The guiding question is shifting

The automated suite (`Verification-Pass.md`) answers **"Does feature X work?"** This plan
is deliberately moving the question up a level to **"Can Persona Y complete Job Z?"**

Those are fundamentally different questions. A *Job* — design an ESP32 sensor, produce a
PCB, research a topic and cite it, create and publish a video — naturally exercises the UI,
routers, MCPs, OMMESH, AI providers, local + cloud models, the browser, Android, SSH, GPU,
and the database *in one flow*, without ever having to enumerate those features. If the job
completes, the parts demonstrably work together; if it stalls, the seam that broke is the
finding. Feature-level checks prove the parts exist; job-level checks prove the workstation
is usable for real engineering work. This document keeps both, but the job layer
(Section J) is the more realistic measure of beta-readiness.

Three axes organize the rest of this plan:

- **WHAT to verify — Jobs** (Section J): complete engineering workflows with binary
  success criteria.
- **HOW to verify — Personas** (Personas 1–5, below): reusable *test strategies*, not
  one-off tests. Each persona is a lens you point at any job.
- **WHERE to verify — Distributed** (Section D): run different personas on different
  nodes at once so the workstation verifies itself from multiple perspectives
  simultaneously.

---

## Personas are test strategies, not test cases

The five personas below are the reusable *strategies* applied to the jobs in Section J.
"Builder runs Job J1" and "Breaker runs Job J1" are two different verifications of the same
workflow. Read Personas 1–5 as the toolkit; read Section J as the work.

---

## Persona 1 — The Builder (complete real projects end-to-end)

Four project archetypes, each run start-to-finish. The Builder never works around a
bug — a workaround needed = a finding.

### B1 — Software project ("understand and extend a repo")
1. Create a new Project + Neural Map; ingest a local repo into Brain Map.
2. From **the same selected project**: open Chat, ask the persona questions about the
   ingested code; attach a file; verify knowledge-base retrieval references map content.
3. Create an agent task (RecursiveMAS via `agent` router) scoped to the project.
4. Switch to a second project, then back — verify chat history, map layout, agent
   state all restored to the right project.
5. **Restart server** at step 3; verify ingestion, chat history, and agent job survive.
- Watch for: map ingestion progress feedback, chat referencing the *wrong* project's
  knowledge, lazy folder expansion regressions (see neural-map-layout memory).

### B2 — ML project ("dataset → fine-tune → serve")
1. Build a dataset via `dataset` router / Curator page.
2. LLM Builder: configure a QLoRA fine-tune; run smoke-scale job (4060 verified OK).
3. Track the job on the Jobs surface; verify progress events over WS.
4. Completed model appears in Model Hub; register with Valet Router; route a chat
   request through it and confirm the response comes from the new model.
- Watch for: job progress stalling silently, model artifacts not linked to the project,
  Valet auto-start interactions (`VALET_AUTO_START`), Ollama vs valet model-list
  consistency in dropdowns.

### B3 — Media project ("script → voice → audio")
1. Podcast Studio: write/generate a script in the project context.
2. TTS render (Kokoro :8002); play back in UI; export artifact.
3. Image generation for cover art (ComfyUI :8188 local path — must work sovereign).
- Watch for: audio player state after navigation away/back, artifact persistence,
  long TTS job UX (can the user tell it's working?).

### B4 — Hardware project ("design → flash")
1. PCB/KiCad editor: open/edit a design in the project.
2. ESP32 path: compile → flash → BLE verify (hardware chain live-verified 2026-06-30;
   /dev/ttyUSB0, esptool venv gotchas in memory).
- Watch for: serial-port busy/brltty errors surfacing as actionable UI messages,
  design changes persisting to the project.

### B5 — Cross-node build (mesh)
Run B2's inference step routed across the 4-way OMMESH (3 PCs + APK) — the Builder
should not have to know/care which node served the request, but the UI should show it.

---

## Persona 2 — The Explorer (every menu, dialog, and setting)

Systematic sweep of all 18 routes: `/`, `/chat`, `/brain-map`(+external),
`/3d-designer`(+external), `/llm-builder`, `/model-hub`, `/pipelines`,
`/podcast-studio`, `/integrations`, `/agent-networking`, `/wallet`, `/notifications`,
`/settings`, `/setup`, `/terms`, `/404`.

Per page:
- Open **every** menu, dialog, tab, dropdown, context menu; toggle **every** setting
  and confirm the control fires a real tRPC call (network tab / router log) or mutates
  state — a control that no-ops is a finding. Cross-reference `Context/UI-Registry.md`
  and assume every entry is wrong until proven (per the `registry-tracker` skill).
- **Settings matrix:** flip each setting, then verify the feature it claims to affect
  actually reads it. `SettingsService.getSetting` is the canonical server reader (see
  settings-architecture memory) — confirm UI writes reach it. A setting that persists
  but no code path consumes = finding.
- **Empty / first-run state:** brand-new project with no data — every page must render a
  sensible empty state, never throw.
- **Deep-link / direct-nav:** hit `/llm-builder`, `/model-hub`, `/pipelines`, `/wallet`
  directly without the home flow — does the selected-project context resolve, or is it
  null?
- **Global-vs-project scoping:** for each feature confirm whether it honors the selected
  project or is correctly flagged global. A mismatch is the AGENTS.md shared-workspace
  invariant being violated (P1).

Watch for: dead buttons, unlabeled surfaces, dialogs with no cancel/escape path, tabs
that lose state on switch, dropdowns populated from the wrong project.

---

## Persona 3 — The Breaker (invalid input, removed deps, disconnected services)

Goal: error-handling and resilience — the "degrade gracefully with no subscription"
promise, tested for real.

- **Service-down matrix:** kill each optional Python microservice individually and in
  combination — Whisper 8001, TTS 8002, RVC 8003, Fal 8004, Valet 8010, RecursiveMAS
  8011, llama.cpp 8013, ComfyUI 8188. The owning router must return a clean, user-visible
  error and the rest of the app must stay up. No unhandled rejections, no white screen.
  (Cross-reference `Service-Matrix.md`.)
- **Sovereign-mode gauntlet:** switch to `sovereign`, attempt every cloud-backed action
  (Anthropic / OpenAI / ElevenLabs / Fal). Per the sovereign-mode memory, *only* AI
  inference blocks — email / OAuth / social / GitHub must still work. A cloud inference
  call that slips through, or a non-inference feature wrongly blocked, is a finding.
- **Malformed input:** oversized prompts, huge uploads, invalid dataset formats,
  unicode/emoji/RTL in project names, negative/overflow numbers in wallet & spend limits,
  corrupt model files into LLM Builder.
- **Dependency removal mid-flight:** delete a project that has an in-flight job or open
  chat referencing it — orphan handling and FK cascade (schema has cascade on; verify it
  actually cleans up and strands no rows).
- **Interrupt/restart mid-workflow:** kill the server during a training run or streaming
  chat — resume, clean error, or corrupt state?
- **Concurrency:** two surfaces (UI + AI caller, or two mesh nodes) mutate the same
  project at once — last-write-wins, lost update, or conflict?

---

## Persona 4 — The Security Tester (unauthorized actions, cross-project, permissions)

Goal: authorization boundaries, behaviorally. Complements the static `/security-review`.
Fastest coverage is as the AI caller with a doctored ctx hitting all 52 routers.

- **Procedure-tier enforcement:** for each router attempt `protectedProcedure` with no
  session, `adminProcedure`/`ownerProcedure` as a plain user, and `cloudProcedure` in
  sovereign mode. Every one must reject with the correct code.
- **Cross-project / cross-tenant (IDOR):** as user A, try to read/mutate user B's project,
  dataset, model, chat session, wallet, and neural map by guessing/replaying IDs. The
  ownership filters in the tRPC harness must actually filter.
- **Mesh trust:** present a valid CA-signed cert from an *unknown* peer to `MeshServer` —
  fingerprint pinning must reject it. Attempt mobile `mobile_node_register` with wrong or
  absent `OMMESH_SECRET` — must fail closed. (See `meshFingerprint.test.ts` — extend
  behaviorally.)
- **Auth surface:** OAuth flow tampering, `app_session_id` cookie replay/forgery,
  `ZERO_LOGIN_MODE` never reachable over network, local-auth password hashing (extend
  `oauthLocalAuthPasswordHashing.test.ts` behaviorally).
- **Secret leakage:** no API keys / tokens in router responses, audit logs, or the client
  bundle.

---

## Persona 5 — The Long-Run Agent (hours, task-switching, leak hunting)

Goal: resource leaks, state drift, memory growth — what unit tests never catch. Run in
the background (async job / `run_in_background`) while other personas' findings are
triaged.

- **Soak loop:** cycle B1–B5 continuously for hours, switching projects between each.
  Watch server RSS, open FDs, libSQL connection count, WebSocket handle count, orphaned
  Python child processes. Steady-state = pass; monotonic growth = leak.
- **WS churn:** repeatedly connect/disconnect `/ws`, navigate pages, background/foreground
  the APK — no accumulating listeners or zombie subscriptions.
- **Async job accumulation:** fire many long jobs (`jobs` router), complete some, cancel
  others, restart mid-flight — no stuck "running" rows, no leaked workers.
- **Selected-project drift:** after hundreds of project switches, the active-project
  context must stay consistent across all pages and the DB — no stale `projectId`
  bleeding one project's data into another.
- **Mesh endurance:** leave the 4-way mesh (3 PCs + phone) running cross-node inference;
  watch for mTLS session leaks and mDNS re-advertisement storms.

---

## Section J — AI Workflow Verification (job-based)

Verify **jobs, not features.** Each job below is a complete engineering workflow with a
binary success line: either the persona reached the end state or it did not. Run each job
under whichever personas are relevant (Builder proves it completes; Breaker proves it fails
cleanly; Security proves another user can't hijack it; Long-Run proves it survives
repetition). Every step is a checkbox — record the first step that breaks as the finding.

Legend: ✅ backed by a verified router/hardware path · ⚠️ real but partial/known-gap ·
🔩 not an Omnecor feature (harness/CLI/hardware action).

### J1 — Embedded Engineer
**Goal:** design an ESP32 environmental sensor, end to end.
**Success criteria (in order):**
1. ✅ Creates a Project + Neural Map.
2. ✅ Chats with the AI to spec the sensor (scoped to the project).
3. ⚠️ Generates firmware (AI-authored sketch — verify it lands in the project workspace).
4. ✅ Compiles (`esp.compile`).
5. ✅ Flashes to real hardware (`esp.flash`, `/dev/ttyUSB0` — chain live-verified 2026-06-30).
6. ✅ Verifies BLE advertise (`OMNECOR_TEST_OK`, per esp32-hardware-verified memory).
7. ⚠️ Updates project docs from the run result.
8. 🔩 Commits to git — **known gap: Omnecor has no git-commit procedure.** Today this is a
   harness/CLI action; flag whether it *should* become an in-app feature.

### J2 — PCB Engineer
**Goal:** take a KiCad project from schematic to fabrication outputs.
**Success criteria:**
1. ✅ Opens/creates a KiCad project in the workspace (`kicad.openProject`).
2. ✅ Schematic export (`kicad.exportSchematic`).
3. ✅ ERC clean (`kicad.runERC`).
4. ✅ PCB + DRC clean (`kicad.runDRC`).
5. ✅ Gerbers (`kicad.exportGerbers`).
6. ✅ BOM (`kicad.exportBOM` / `downloadBOM`) — bonus: `kicad.getQuote`.
- Watch for: outputs written to disk but not linked to the project; ERC/DRC failures
  surfaced as actionable UI, not silent.

### J3 — Research Agent
**Goal:** investigate a topic and produce a cited report.
**Success criteria:**
1. ✅ BrainMap indexing of sources into the project (`neuralMaps`).
2. ⚠️ Chroma vector store populated (verify embeddings actually persist).
3. ⚠️ RAG retrieval returns the *project's* content in chat (`knowledgeBase`).
4. ⚠️ Citations trace back to real indexed sources (not hallucinated).
5. ⚠️ Report generated and saved to the project.
- This is the job most likely to expose the neural-map remote-ingestion shell (github:// /
  integration:// roots are decorative labels, not ingested — see memory). Confirm which
  source types actually index.

### J4 — Video Creator
**Goal:** create and publish a short video.
**Success criteria:**
1. ✅ Script authored in project context (Podcast Studio / chat).
2. ⚠️ Voice render (Kokoro :8002 — must also work sovereign/local).
3. ⚠️ Assets generated (image/video via `imageGen` / ComfyUI :8188 local path).
4. ⚠️ Render/assemble into a final artifact.
5. ✅ Schedule for publish (`scheduling.schedulePost` / `publishNow`) — sovereign-gated
   per hybrid-social-publishing memory.
- Watch for: the discovery half of the social pipeline is a shell (memory); this job tests
  the *publishing* half, which is real.

Each job carries the three standing checks (persistence-across-restart, shared-project
scoping, no-subscription operation). A job that only completes with cloud subscriptions
present is itself a finding.

---

## Section D — Distributed Verification

The unique layer: run **different personas on different nodes at the same time**, so the
workstation verifies itself from multiple perspectives simultaneously across the OMMESH
4-way (mesh full-pass confirmed 2026-07-03 — see memory).

Reference topology:

| Node | Persona / role | Exercises |
|---|---|---|
| **Linux (primary)** | Builder | drives a Job J1–J4 to completion via the UI |
| **Windows (RTX 4060, 192.168.1.78)** | Explorer | GPU workflows + menu/settings sweep |
| **Android (S25 Ultra APK)** | Breaker | mobile edge cases, connectivity loss, backgrounding |
| **Harness (inside)** | Observer | direct tRPC callers asserting DB/router truth mid-flow |
| **OMMESH** | Coordinator | routes cross-node inference; asserts node-agnostic results |

What distributed runs uniquely catch:
- **Cross-node state coherence** — a job started on Linux whose inference is served by the
  Windows GPU must produce identical, project-scoped results regardless of which node ran it.
- **Perspective disagreement** — the inside Observer sees DB truth while the outside Builder
  sees UI truth; divergence is a wiring bug invisible to either side alone.
- **Concurrent-load faults** — Breaker on Android hammering while Builder runs on Linux
  surfaces races, lock contention, and mesh session leaks that single-node runs never hit.

Run via the `/ommesh-mesh-test` skill for the transport layer, then layer the personas on
top. This does not replace single-node runs — it's the capstone once a job passes solo.

---

## Suggested run sequence

1. **Smoke** — Explorer control sweep + Breaker service-down matrix on one node. Cheap,
   catches the loudest regressions.
2. **Job as Builder** — pick one Section J job and drive it to its success line (J2/PCB is
   the most fully-wired ✅ chain; J1/Embedded exercises the most surfaces incl. hardware).
   A completed job is the single highest-value verification — it proves the parts work
   *together*.
3. **Re-run the same job as Breaker + Security** — same workflow, different strategy: prove
   it fails cleanly and can't be hijacked cross-user.
4. **Security sweep** — as the AI caller across all 52 routers (fast, high coverage), then
   spot-check IDOR through the UI.
5. **Distributed (Section D)** — once a job passes solo, run it across the OMMESH 4-way +
   APK with personas split across nodes.
6. **Soak** — kick off the Long-Run loop in the background while triaging findings 1–5.

---

## Findings log

Severity: P0 crash/data-loss · P1 broken workflow · P2 degraded UX · P3 polish.

| # | Date | Job | Persona | Step / Scenario | Side(s) | Severity | Summary | Suspected file | Status |
|---|------|-----|---------|-----------------|---------|----------|---------|----------------|--------|
| _ | | | | | | | _(no runs logged yet — populate as scenarios execute)_ | | |
