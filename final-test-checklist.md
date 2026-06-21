# Omnecor Final Test Checklist

## How to Use

Work through each item. Mark ✅ verified, ❌ broken (note the issue).
Start the server: `pnpm dev` → open http://localhost:3000

---

## 1. Persistence (Restart-Survival Tests)

For each: perform the action, restart (`pnpm dev`), verify the state survived.

- [ ] Start a LoRA training job → restart → job appears with correct status in the UI (Training page)
- [ ] Register a file watcher for a project → restart → watcher is active (edit a file, confirm UI update)
- [ ] Connect an MCP server via Settings → restart → server reconnects automatically (Settings > MCP)
- [ ] Approve an OMMESH peer via Settings → restart → peer still trusted, no re-approval prompt
- [ ] Enable cross-node sync in OMMESH Settings → restart → toggle is still ON
- [ ] Submit a HITL approval request, do NOT resolve it, restart → shows as `pending` or `timed_out` in UI
- [ ] Set a project budget alert → consume over threshold → restart → alert does NOT re-fire on next chat message
- [ ] Trigger `async-job` tool in Chat → restart mid-job → job is marked `failed` (not orphaned)

---

## 2. Security

- [ ] **Path Traversal (trainingRouter)**: POST validateDataset with `datasetPath: "../../../../etc/passwd"` → expect 400/403, NOT file contents
- [ ] **ComfyUI Auth**: call any `comfyRouter` procedure without a session cookie → expect `401 UNAUTHORIZED`
- [ ] **Fal listImages Auth**: call `listImages` without session → expect `401 UNAUTHORIZED`
- [ ] **Honcho Spoofing**: authenticate as user A, send `addMessage` with user B's `openId` → expect `403 FORBIDDEN`
- [ ] **OMMESH Trust**: connect a new peer NOT in `ommesh_trusted_peers` table → connection rejected with 403

---

## 3. Integration Wiring

- [ ] Add a file to a watched project folder → within 2s, ChromaDB collection updates (verify via Brain Map or VectorDB query)
- [ ] Remove a file from a watched project → it is removed from ChromaDB (no stale embedding)
- [ ] Run a RecursiveMAS agent → MCP tool result appears in audit log with result preview
- [ ] Enable OMMESH cross-node sync → restart MeshNode → sync resumes automatically
- [ ] `/health` endpoint → returns `{ checks: { db: true/false, ollama: true/false, chromadb: true/false } }`
- [ ] Take Ollama offline → `/health` returns `status: "degraded"` not `"healthy"`

---

## 4. Performance

- [ ] Approve 50 curator posts at once → completes in <500ms (was N+1: 50 sequential queries)
- [ ] Bulk persona upsert (50 personas) → single batch existence check, not per-row loop
- [ ] `systemRouter.health` → `cpu.percent` is a realistic value (not always 5–25% random)
- [ ] `systemRouter.saveSettings` → settings saved without blocking the event loop (async I/O)
- [ ] Check server logs after 5 minutes: no `[perf] slow request` warnings for normal API calls

---

## 5. Error Handling

- [ ] Take Ollama offline, send a chat message → user sees error (not infinite spinner)
- [ ] Take ChromaDB offline → app continues (graceful degradation, no crash)
- [ ] Server logs after busy usage: no `UnhandledPromiseRejection` entries
- [ ] Trigger audit log failure (e.g., corrupt DB) → logged at `[AuditLog] write failed — event lost`, not swallowed silently
- [ ] integrationsRouter with a downstream service offline → `TRPCError INTERNAL_SERVER_ERROR` returned, not a hang

---

## 6. Observability

- [ ] Perform a `protectedProcedure` action → `audit.log` entry written with actor, procedure, args (redacted)
- [ ] Call an MCP tool → audit log entry contains tool name, args, AND result preview (first 500 chars)
- [ ] AuditLogService: with large audit log (simulate or check rotation logic) → `audit.log.1` created, `audit.log` restarted
- [ ] `systemRouter.health` → CPU percent is real (from `os.loadavg()`), not `Math.random()`
- [ ] AiProviderService budget warning → logged via `log.warn`, not `console.warn`

---

## 7. API Correctness

- [ ] Trigger `aiRouter` with missing session → response is `{ code: "NOT_FOUND", message: "Session not found" }` not 500
- [ ] Trigger bad path in `projectRouter.watchDirectory` → `TRPCError BAD_REQUEST` not uncaught Error
- [ ] Create a file attachment in Chat → attachment ID is a valid UUID (not `file_1234_abc12`)
- [ ] Create a PodcastStudio job → job ID is a valid UUID (not `Math.random` string)
- [ ] Trigger GPU gate in valetRouter without a GPU → `TRPCError PRECONDITION_FAILED` returned
- [ ] `modelManagement.getRunningModels` → returns `{ models: [...] }` from Ollama `/api/ps` (or empty array if offline)

---

## 8. Frontend State

- [ ] Approve a shell command via HITL dialog → navigate away and back → approval state retained correctly
- [ ] Toggle fiction mode ON → navigate to another page and back → fiction mode still ON
- [ ] `NeuralMapContext.updateMap` called rapidly in succession → no concurrent mutation race (check no duplicated DB entries)
- [ ] `commandAllowlistStore._resolvePending` → resolver is in Zustand state, not a module-level global

---

## 9. OMMESH / AI Infrastructure

- [ ] Launch two concurrent agents on the same user → each has a separate `agent_sessions` DB entry
- [ ] Check `agent_sessions` table after agent run → `agentType` field is set (`crewai`, `liteagent`, or `recursivemas`)
- [ ] OMMESH fingerprint trust: approve peer A, restart server → peer A is still trusted (check DB table `ommesh_trusted_peers`)
- [ ] `modelManagement.getRunningModels` returns VRAM data when a model is loaded in Ollama

---

## 10. Production Readiness

- [ ] `pnpm check` → 0 TypeScript errors
- [ ] `pnpm test` → all tests pass, no regressions
- [ ] SIGTERM server mid-request → DB not corrupted (open DB, check last N rows intact)
- [ ] Fresh install (empty `~/.omnecor/`) → server starts cleanly, migrations auto-applied, `/health` returns healthy
- [ ] `.gitignore` includes `tmp-valet-train/` — verify with `git check-ignore tmp-valet-train/`
- [ ] Request-duration logger: make a slow request (e.g., large file upload) → `[perf] slow request` log line appears

---

## Quick Commands

```bash
# Start dev server
pnpm dev

# Type-check
pnpm check

# Run tests
pnpm test

# Check audit log
tail -f ~/.omnecor/logs/audit.log

# Check DB tables (requires sqlite3)
sqlite3 ~/.omnecor/data/omnecor.db ".tables"
sqlite3 ~/.omnecor/data/omnecor.db "SELECT * FROM ommesh_trusted_peers;"
sqlite3 ~/.omnecor/data/omnecor.db "SELECT * FROM async_job_tracking ORDER BY created_at DESC LIMIT 10;"
sqlite3 ~/.omnecor/data/omnecor.db "SELECT * FROM hitl_pending_actions WHERE status='pending';"
sqlite3 ~/.omnecor/data/omnecor.db "SELECT * FROM agent_sessions ORDER BY created_at DESC LIMIT 10;"
```
