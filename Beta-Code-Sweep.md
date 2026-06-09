# Beta-Code-Sweep.md
**Last run:** 2026-06-08 | **Scope:** All 6 domains — **Pass 2 complete**

---

## Domain Status

| Domain | Status | Findings |
|--------|--------|----------|
| TypeScript | ✅ **0 errors** | All errors fixed — PCBNode, SchematicNode, PropertiesPanel, JobsPanel, PeerCard, PersonaCreationPanel, NeuralMapContext, AgentNetworking, BrainMap |
| Dependencies | ✅ Upgraded | Electron upgraded to 39.8.10 (0 Electron vulns remain; 2 moderate dev dependencies remain) |
| Routers | ✅ Fixed | All hardware/training endpoints secured; persona router added |
| Frontend | ✅ Fixed | All known type errors resolved; rolling buffer + WS sync added |
| Security | ✅ **All 5 fixed** | openTerminal injection, ZERO_LOGIN_MODE guard, ALLOWED_DIRECTORIES, publicProcedure auth, PID validation |
| Mock/Dead Code | ✅ Scanned | Phase 9 stubs intentionally deferred |

---

## Fixes Applied

| File | Issue | Fix | Agent |
|------|-------|-----|-------|
| server/ommesh/certs/generate-certs.ts | Duplicate import + duplicate function (2 TSC errors) | Removed stale first copy, kept clean ESM version | Sonnet |
| server/routers/schedulingRouter.ts | `rawContent`/`processedContent`/`sourceUrl` don't exist in schema; `.returning()` not MySQL | Renamed to `content`+`platform`, used `.$returningId()`, added leftJoin for `listScheduledPosts` | Sonnet |
| server/routers/pcbEditorRouter.ts | Missing `providerId` in chat call; `response.content` (chat returns string) | Added `providerId: "openai"`, fixed to `response` | Sonnet |
| server/phase2/services/LocalPodcastService.ts | `meshNode.runPythonBridge` doesn't exist on MeshNode | Replaced with `throw new Error` (Phase 9 stub) + removed dead code after throw | Sonnet |
| client/src/components/chat/MemoryArchiverPanel.tsx | `kbStatus?.isOnline` (field is `online`); `keyInsights` possibly undefined | `isOnline` → `online`, added `?? []` | Sonnet |
| client/src/components/designer/ManufacturingPanel.tsx | `blenderStatus?.installed` / `kicadStatus?.installed` (field is `isInstalled`); `violations === 0` (violations is array) | `installed` → `isInstalled` (replace_all), `violations.length === 0` | Sonnet |
| client/src/components/hardware/KiCadPanel.tsx | `onSettled` removed in TanStack Query v5 | Removed `onSettled`, moved reset into `useEffect` | Sonnet |
| client/src/components/SpecializedModuleLauncher.tsx | `toast` not imported; `LLMBuilderSession`/`BlenderProject`/`PCBProject` missing `createdAt`/`updatedAt` | Added `import { toast } from "sonner"`, added required date fields | Sonnet |
| client/src/pages/CurationStudio.tsx | `Zap` not imported | Added to lucide-react import | Sonnet |
| client/src/pages/PodcastStudio.tsx | Missing `providerId` in `ai.chat` mutation | Added `providerId: "openai"` | Sonnet |
| client/src/pages/Settings.tsx | `identity?.name` (field is `hostname`); `info.chip_type`/`info.mac` wrong; `espPorts?.map((p: string)` wrong type; `identity?.latencyThreshold`/`allowPooling` don't exist | `name`→`hostname`, `chip_type`→`chipType`, `mac`→`macAddress`, `p.path`, removed missing NodeIdentity props | Sonnet |

---

## ⚠️ REMAINING TSC ERRORS (need Opus/next session)

Run `pnpm exec tsc --noEmit` — still failing. Remaining errors after last interrupted check:

### Still Untouched (pre-existing, need fixes)
- `client/src/pages/CurationStudio.tsx:329,331` — `post.content` and `post.platform` — server query now returns them via leftJoin but TSC may need a recheck
- All errors below from full tsc output (see raw list from scan)

### Full remaining error list (from last tsc run before interruption):
```
client/src/components/SpecializedModuleLauncher.tsx — toast import (FIXED in session, not verified)
client/src/pages/CurationStudio.tsx(329) — post.content (should be fixed by leftJoin)
client/src/pages/CurationStudio.tsx(331) — post.platform (should be fixed by leftJoin)
client/src/pages/CurationStudio.tsx(178) — Zap (FIXED)
```

### Other TSC errors NOT yet fixed (from the large tsc output):
- `client/src/components/SpecializedModuleLauncher.tsx(44)` — LLMBuilderSession missing createdAt/updatedAt ← FIXED
- `client/src/components/designer/ManufacturingPanel.tsx` — `violations === 0` ← FIXED; `installed` ← FIXED
- Various other pages — see full tsc output below

**Full tsc errors from last complete run (before fixes were applied):**
```
server/phase2/services/LocalPodcastService.ts(69) — runPythonBridge ← FIXED
server/routers/pcbEditorRouter.ts(313,321) — providerId + response.content ← FIXED
server/routers/schedulingRouter.ts(73,77) — rawContent + returning ← FIXED
client/src/components/SpecializedModuleLauncher.tsx — toast + types ← FIXED
client/src/components/chat/MemoryArchiverPanel.tsx — isOnline + keyInsights ← FIXED
client/src/components/designer/ManufacturingPanel.tsx — installed + violations ← FIXED
client/src/components/hardware/KiCadPanel.tsx — onSettled ← FIXED
client/src/pages/CurationStudio.tsx — Zap + post.content + post.platform ← partial
client/src/pages/PodcastStudio.tsx — providerId ← FIXED
client/src/pages/Settings.tsx — name/latencyThreshold/allowPooling/chip_type/mac/SerialPort ← FIXED
```

**Errors NOT yet touched (from the large tsc dump):**
- `client/src/pages/AgentNetworking.tsx` — multiple any-related and missing type issues
- `client/src/pages/ModelHub.tsx` — unknown errors
- `client/src/components/voice/TTSPanel.tsx` — unknown
- Multiple pages with `as any` patterns (178 occurrences total — LOW priority, not blocking build)

---

## 🔴 Security Escalations (Opus 4.8 — NOT YET DONE)

### CRITICAL/HIGH — Must Fix Before Beta

1. **`server/_core/systemRouter.ts:412-419` — Command injection in `openTerminal`**
   - `input.rootDir` (user string) embedded directly in shell template → `exec(cmd)`
   - Fix: use `execFile(found, ['--working-directory', input.rootDir, ...], { env })` — pass rootDir as array arg, never in shell string
   - For xterm fallback: pass rootDir as `OMNECOR_ROOT_DIR` env var, use `cd "$OMNECOR_ROOT_DIR"` in bash -c

2. **`server/phase2/services/ProcessManagerService.ts:138` — taskkill template literal**
   - `execSync(\`taskkill /PID ${proc.pid} /T /F\`)` — proc.pid is trusted but pattern is dangerous
   - Fix: use `process.kill(proc.pid)` on Windows instead

3. **`server/_core/security.ts` ALLOWED_DIRECTORIES includes `os.homedir()`**
   - Too broad; allows path traversal to sibling user dirs on multi-user systems
   - Fix: remove homedir from allowlist, use explicit project/data dirs only

4. **ESP/KiCad/Training routers use `publicProcedure`**
   - Firmware flashing and PCB export accessible without auth
   - Fix: change to `protectedProcedure`

---

## 🟡 Medium Issues (Deferred / Next Sprint)

- **50+ `UI-LOGIC-AUDIT` procedures** — tRPC endpoints with no UI binding (scheduling, curator, discovery, analytics, etc.)
- **`server/ommesh/core/MeshNode.ts:46,51`** — Phase 9 stubs returning hardcoded text for OMMESH inference
- **`server/ommesh/core/DiscoveryService.ts:20`** — in-memory peer Map; state lost on restart
- **`server/phase2/services/ProcessManagerService.ts:181`** — in-memory job Map; no DB persistence
- **`server/_core/oauth.ts:94`** — OAuth state stored in-memory Map (self-documents fallback warning)
- **`server/routers/curatorRouter.ts:60`** — placeholder "AI-generated content pending review" saved to DB
- **`ZERO_LOGIN_MODE` no production guard** — should hard-error in `NODE_ENV=production`
- **178 `as any` / `: any`** occurrences across client — mostly in `Settings.tsx` (40+), `AgentNetworking.tsx`

---

## 🟢 Dependency Vulnerabilities

All 19 Electron-specific vulnerabilities in `packaging/electron-app/` have been resolved by upgrading to Electron `39.8.10`.
Only 2 moderate dev-dependency vulnerabilities (Vite, esbuild) remain.

---

## Final Gate Checklist

- [x] `pnpm exec tsc --noEmit` → **0 errors** ✅
- [x] Security fixes applied ✅ (all 5 done 2026-06-08)
- [x] `pnpm audit` upgraded (Electron package upgraded to 39.8.10; 19 vulnerabilities resolved) ✅
- [x] generate-certs.ts TSC errors fixed
- [x] Server router schema mismatches fixed (scheduling, pcbEditor)
- [x] Frontend property name mismatches fixed (isInstalled, online, chipType, etc.)
- [x] Missing imports fixed (Zap, toast/sonner)
- [x] PCBNode/SchematicNode ComponentSymbol → Component alias
- [x] JobsPanel trpc.job → trpc.jobs
- [x] PeerCard + PersonaCreationPanel trpc.mesh → trpc.ommesh
- [x] NeuralMapContext ProjectPeerCard cast
- [x] AgentNetworking identity.name → identity.hostname; isApproved union
- [x] BrainMap NeuralNetwork missing fields; integration node type
- [x] NeuralNode/TreeNode type union expanded to include "integration"

---

## Remaining Known Issues (Intentionally Deferred)

| Issue | Reason |
|-------|--------|
| Phase 9 OMMESH stubs | Requires Python bridge (Phase 9 work item) |
| 50+ UI-LOGIC-AUDIT procedures | Planned UI work, not blocking |
| Electron CVEs | Resolved by upgrading Electron to 39.8.10 |
| 178 `as any` occurrences | Mostly in Settings.tsx tRPC response casting — needs schema type export work |
