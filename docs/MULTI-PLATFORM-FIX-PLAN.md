# Multi-Platform Fix Plan
## Execution Strategy for 59 Cross-Platform Compatibility Issues

**Date:** June 4, 2026  
**Model Routing:**
- 🟢 **Haiku** — Low-risk config/path changes, no logic complexity
- 🔵 **Sonnet 4.6** — Medium complexity, logic changes, integration work
- 🔴 **Opus 4.8** — High-risk/security changes (Electron upgrade, installer security)

---

## Agent Assignments

### 🟢 HAIKU — Batch 1: Packaging & Config Files

**Agent H1: Android + Flatpak + deb**
- `packaging/electron-app/android/app/src/main/AndroidManifest.xml` — Add 5 missing permissions
- `packaging/flatpak/org.omnecor.HMCI.yml` — Node20→22, python311→312, update path refs
- `packaging/deb/debian/control` — Add libsqlite3-0, libssl3, libnotify4, libxtst6, libnss3

**Agent H2: Server Path Fixes**
- `server/routers/kicadRouter.ts:154` — Replace `/tmp/omnecor_gerbers` with `os.tmpdir()`
- `server/phase2/services/ESPToolService.ts:374` — Accept `COM*` ports, not just `/dev/`
- `server/phase2/config/index.ts:122,141` — Replace `process.env.HOME || "/home/user"` with `os.homedir()`

**Agent H3: Client UI Simple Fixes**
- `client/src/pages/Settings.tsx:352-353` — Dynamic default paths per `process.platform`
- `client/src/hooks/useMobile.tsx:11-16` — Add `typeof window !== 'undefined'` guard
- `packaging/electron-app/src/renderer/src/components/wizard/SetupWizard.tsx:33,55` — Guard `window.api.getSystemInfo()`, use env port

---

### 🔵 SONNET 4.6 — Batch 2: Integration & Logic Fixes

**Agent S1: WebSocket + Capacitor**
- `client/src/main.tsx:49-50` — Guard window.location, support Capacitor server env
- `client/src/hooks/useOmnecorSocket.ts:54-56` — Use VITE_WS_URL or Capacitor config

**Agent S2: localStorage Fallbacks**
- `client/src/contexts/ThemeContext.tsx` — try-catch + in-memory fallback
- `client/src/contexts/FictionModeContext.tsx` — try-catch + in-memory fallback
- `client/src/lib/appPreferences.ts` — try-catch wrapper utility

**Agent S3: Python Binary + Spawn Paths**
- `server/routers/valetRouter.ts:56,163-165` — Use `PYTHON_SCRIPTS.pythonBin`, absolute paths
- `server/_core/systemRouter.ts:186-199` — Improve binary detection with `which`/`where` + registry hints

**Agent S4: GPU Detection + Dev Tools**
- `server/python_bridges/detect_gpu.py:25-54` — Add Windows wmic + macOS system_profiler
- `packaging/electron-app/src/main/index.ts:201-224` — Windows wmic GPU branch
- `.claude/skills/run-omnecor/driver.mjs:12,18,25` — Cross-platform /tmp, Playwright, find command

**Agent S5: Process Signal Handling**
- `server/phase2/services/ProcessManagerService.ts` — Detect Windows, use taskkill instead of SIGKILL

---

### 🔴 OPUS 4.8 — Batch 3: Security-Critical Changes

**Agent O1: Electron Security Upgrade**
- `packaging/electron-app/package.json` — Electron 28→39+, electron-builder latest, electron-vite latest
- `packaging/electron-app/electron-builder.yml` — Enable npmRebuild, update targets

**Agent O2: Windows Installer Security**
- `packaging/windows/omnecor.nsh` — Add Node 22+ version check, VC++ runtime check, Python 3.10+ check

---

## File Conflict Map (No overlaps)

| Agent | Files Touched |
|-------|--------------|
| H1 | AndroidManifest.xml, flatpak.yml, deb/control |
| H2 | kicadRouter.ts, ESPToolService.ts, config/index.ts |
| H3 | Settings.tsx, useMobile.tsx, SetupWizard.tsx |
| S1 | main.tsx, useOmnecorSocket.ts |
| S2 | ThemeContext.tsx, FictionModeContext.tsx, appPreferences.ts |
| S3 | valetRouter.ts, systemRouter.ts |
| S4 | detect_gpu.py, electron/main/index.ts, driver.mjs |
| S5 | ProcessManagerService.ts |
| O1 | electron/package.json, electron-builder.yml |
| O2 | windows/omnecor.nsh |

**Zero file conflicts across all 10 agents — all can run in parallel.**
