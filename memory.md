# Memory — Async Long-Job Continuation + 5 Skill Commands

Last updated: 2026-06-15

---

## DO NOT REMOVE THIS NOTE **Important: Read AGENTS.md Before Beginning The Next Session**

---

## What was built

Two workstreams, both designed via `/architect` and fully implemented this session.

### Workstream 1 — Async long-job tool + token-saving continuation — ✅ COMPLETE

The AI agent can fire a long shell/build/download job, end its turn immediately (no
token-burning poll loop), and be re-prompted with a *condensed* result when the job
finishes — the raw multi-thousand-line log never enters the model context.

- `server/phase2/services/ProcessManagerService.ts` — added opt-in `captureMode: "raw"`
  (bounded stdout ring buffer, `maxCaptureLines` default 100) + `getCapturedOutput(jobId)`.
- `server/phase2/services/JobResultCondenser.ts` — NEW. Pure `condenseJobResult` (exit code
  + status + last-N tail + regex-extracted error/traceback lines, deduped/capped) and
  `formatCondensedResultForAgent`. Optional LLM summary is a pluggable hook (off by default
  — keeps Sovereign mode air-gapped).
- `server/phase2/services/AsyncJobService.ts` — NEW. Singleton; subscribes to ProcessManager
  `lifecycle`, condenses tracked jobs on terminal state, emits a `result` event. `track()` /
  `isTracked()` / `setSummarizer()`.
- `server/routers/jobRouter.ts` — added `startAsync` (protectedProcedure): HITL-gated
  (`command` category, deny carries reason), arg-array spawn (no shell interp), `cwd` via
  `validatePath`, `timeoutMs: 0`, `captureMode: "raw"`, returns `{ jobId, status: "started" }`
  immediately, then `AsyncJobService.track()`.
- `server/phase2/websocket/WebSocketServer.ts` — added `"asyncJobResult"` to ServerMessage
  union; broadcasts `result` to `asyncjob:{userId}` (mirrored to `asyncjob:all`).
- `client/src/pages/Chat.tsx` — subscribes to `asyncjob:{me.id}` (NOT asyncjob:all), injects
  the condensed result as a system message and AUTO re-prompts Valet if idle (passes
  priorMessages incl. the result to `handleSendMessage`); if a stream is active it only
  injects. Socket handler kept stable via refs (conversationRef/isStreamingRef/
  handleSendMessageRef) so the WS doesn't reconnect each render.
- HITL deny-with-reason threaded end-to-end: `requestApprovalDetailed()` in
  `HITLApprovalService.ts` (boolean `requestApproval` kept as wrapper; 6 existing callers
  unchanged), `approveAction(id, approved, reason?)`, `denyReason?` on `CriticalAction`
  (`shared/hitl.ts`), `reason` on `hitlRouter.resolve`, deny textarea in
  `client/src/components/CriticalActionChecklist.tsx`.
- Tests: `server/__tests__/processManagerCapture.test.ts`,
  `jobResultCondenser.test.ts`, `asyncJobService.test.ts` (13 new tests).

### Workstream 2 — 5 AGENTS.md skills as Omnecor runtime commands — ✅ COMPLETE

architect / remember / review / recover / imprint, on BOTH the in-chat `/` slash menu AND
the global Command Palette, as DISTINCT NEW commands (alongside existing /plan, /btw,
/compress), full functional ports.

- `server/routers/workflowRouter.ts` — NEW, registered in `server/routers.ts` as `workflow`.
  `reviewContext` (git diff via execFile arg-array + plan excerpts), `rememberSave`
  (compress session via AiProviderService → redactSensitive → write project memory.md),
  `rememberRestore`, `imprint` (read component, regex-extract Tailwind classes, append entry
  to project ui-registry.md). Side-effecting writes wrapped in try/catch → TRPCError.
  Artifacts scoped per-project under `PATHS.projects/<projectId>/` (validatePath enforces
  containment).
- `client/src/lib/skillWorkflows.ts` — NEW. The 5 workflow preambles + metadata.
- `client/src/components/chat/ChatInput.tsx` + `ChatInterface.tsx` — extended SlashCommand
  union + COMMANDS; `onCommand` now `(cmd, arg?)`; `/remember`/`/imprint` keep input open for
  an inline arg (like `/btw`), intercepted in `handleSend`.
- `client/src/pages/Chat.tsx` `handleCommand` — 5 new cases (preamble inject for
  architect/recover; reviewContext fetch + inject for review; rememberSave/Restore and
  imprint call workflowRouter). Plus an `omnecor:run_workflow` window-event listener for the
  palette bridge.
- `client/src/hooks/useCommandRegistry.ts` + `client/src/components/shell/CommandPalette.tsx`
  — added a "Workflows" group (5 entries) that navigates to /chat and dispatches
  `omnecor:run_workflow`.

## Decisions made

- Continuation re-prompt is event-driven via the existing terminal→chat bridge pattern (WS →
  inject system message → auto-`handleSendMessage` when idle). Auto-re-prompt is skipped
  while a stream is active to avoid racing it.
- Condenser LLM-summary is a pluggable injected hook, off by default (Sovereign-safe);
  tail+regex condensing is the always-on path.
- Skill side-effects are deterministic server ops, not reliant on a Node LLM tool loop (the
  in-app assistant `AiProviderService.chat` is single-shot streaming; iterative agent loops
  live in the Python crews `recursive_mas_bridge.py`).
- Skill artifacts live under `PATHS.projects/<projectId>/` because `validatePath`'s allow-list
  is the app data dir (`~/.omnecor`), NOT the repo. The user's active project is the unit of
  work, not the Omnecor repo.

## Problems solved

- HITLApprovalService signature change kept backward-compatible: added
  `requestApprovalDetailed` (returns `{approved, reason}`) and left `requestApproval`
  (boolean) as a wrapper, so the 6 existing callers were untouched.
- TS doesn't narrow a `terminal` boolean — AsyncJobService uses an explicit three-literal
  guard so `event.state` types as `CondensedJobStatus`.
- Condenser error regex: `\berror\b` missed camelCase exceptions (ValueError); switched to
  `error\b` so `...Error:` matches while plural "0 errors" stays excluded (+ NOISE filter).
- imprint surfaced a raw-color violation: `text-rose-500` in CriticalActionChecklist →
  fixed to semantic `text-destructive`.

## Current state

- Gates GREEN: `pnpm check` 0 errors, `pnpm test` 338 passed (22 files), `pnpm build` clean.
- `pnpm audit --prod`: 2 LOW, PRE-EXISTING (dompurify via streamdown>mermaid — NOT introduced
  here; no deps added). Fix is a one-line pin `dompurify >=3.4.8` in pnpm-workspace.yaml,
  deferred (that file is being edited in the user's IDE).
- Reference skill bodies `docs/ai-agents/Skills/` were DELETED after porting (per user); the
  rest of `docs/ai-agents/` (valet-training, VALET_ROUTER, etc.) is intact.
- `/review` run + all 6 findings fixed. `/imprint` run (fixed the raw color; did NOT write a
  visual table into Context/UI-Registry.md — that file is a feature-connection audit, not a
  visual-pattern registry).

## Next session starts with

1. Read AGENTS.md first (mandatory).
2. Open items from THIS work (optional polish): pin `dompurify >=3.4.8` in pnpm-workspace.yaml
   to clear the 2 low audit findings; optionally wire the condenser's LLM summary to Haiku 4.5
   via AiProviderService behind `cloudProcedure`; decide whether to start a separate
   `Context/UI-Visual-Registry.md` for /imprint visual patterns.
3. Carried over from prior session (still pending): **Phase 5, Feature 27 — End-to-End Build
   Smoke Tests** (web, Electron, Android).

## Open questions

- Whether to enable the condenser LLM-summary by default (currently off for Sovereign safety).
- Whether auto-re-prompt-on-job-completion is the desired UX vs. inject-only (currently
  auto-re-prompts when idle).
