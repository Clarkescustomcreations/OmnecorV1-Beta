# Omnecor V1-Beta Documentation Update Task List

This document outlines the actionable checklist and todo list for cleaning, restructuring, and updating all repository documentation. 

Per project rules, **user-facing and technical documentation in the main repository must only reflect the professional, completed state of the product.** No progress logs, development session logs, phase checklists, or outdated stub disclaimers are allowed. The *only* files authorized to track project completion status, open development tasks, and current session memory are `memory.md`, `Context/Progress-Tracker.md`, and `Context/UI-Registry.md`.

---

## 1. Files Slated for Deletion

The following files represent development plans, phase statuses, or transient audits. They must be removed from the professional documentation suite.

### 1.1 Status, Audit, and Upgrade Plans (No longer needed)
- [ ] Delete `docs/june-3-doc-updates.md` (changelog and append-only dev notes).
- [ ] Delete `docs/MULTI-PLATFORM-COMPATIBILITY-AUDIT.md` (transient cross-platform compatibility audit).
- [ ] Delete `docs/MULTI-PLATFORM-FIX-PLAN.md` (transient batch fix plan).
- [ ] Delete `docs/UPGRADE-PLAN.md` (transient v2.3.0 → v3.0.0 upgrade roadmap).

### 1.2 Redundant Duplicates (Consolidation)
- [ ] Delete `docs/OAUTH_SETUP.md` (redundant; keep the more detailed `docs/setup/OAUTH_SETUP.md` as the single source of truth).
- [ ] Delete `docs/neural brain map/NEURAL_BRAIN_MAP_UI.md` (redundant; keep the identical `docs/frontend/NEURAL_BRAIN_MAP_UI.md`).
- [ ] Remove the empty `docs/neural brain map` directory to clean up space-containing folder names.

---

## 2. Accuracy Corrections (Stale Claims in Core Docs)

The following core files contain outdated database or platform requirements. They must be updated to align with the current fully-implemented codebase.

### 2.1 Database Setup (MySQL/TiDB references)
- [ ] **`README.md`**: Update line 36. Remove support claim for "MySQL/TiDB (multi-user / production)". Clarify that the backend runs exclusively on a unified **SQLite/libSQL** engine (local file or Turso cloud).
- [ ] **`README.md`**: Update line 217 (Mermaid diagram). Change `DB[(SQLite / MySQL)]` to `DB[(SQLite / libSQL)]`.
- [ ] **`docs/backend/DATABASE_SCHEMA.md`**: Ensure no references remain suggesting MySQL is a parallel runtime engine.

### 2.2 Platform Compatibility (Linux-only claims vs Windows/Android support)
- [ ] **`FAQ.md`**: Update line 27. Replace "Omnecor requires a Linux-based operating system" with support details for Windows (Native Installer), Linux (AppImage/deb/Flatpak), macOS (developer support), and Android (companion app thin client).
- [ ] **`INSTALL.md`**: Update line 28 (Operating System table). Add Windows 10/11 and Android 9+ rows to the system requirements table.
- [ ] **`docs/user-guides/Omnecor User Guide.md`**: Update lines 72 and 203. Revise statements claiming "official support only for Debian 12 and Ubuntu 20.04+" to present Omnecor as a cross-platform workstation supporting Windows 10/11 natively, Linux (deb/AppImage/Flatpak), and Android.
- [ ] **`ROADMAP.md`**: Update the v1.0 blockers to show Windows Installer (NSIS) and Android APK packaging are fully completed.

### 2.3 Shell Scripts & Tooling Commands
- [ ] **`QUICKSTART.md`** & **`docs/workflows/DEVELOPMENT_WORKFLOWS.md`**: Replace all references to `npm run dev` with `pnpm dev` (the workspace is strictly pnpm-only). Replace `pnpm run db:push` with `pnpm db:migrate`.
- [ ] **`packaging/windows/BUILD-WINDOWS.md`**:
  - Update any old repository name references (`Omnecor-HMCI-ai-workstation-AltV1`) to `OmnecorV1-Beta`.
  - Aligned installer version strings to `2.3.0-beta.1` or current `2.4.1` tags.
  - Correct the registry path to `HKCU\Software\Omnecor` (omitting `HMCI`).
  - Add the mandatory Valet Router model fetching step: `bash scripts/fetch-valet-model.sh` (or the equivalent PowerShell step).

---

## 3. Missing Feature Technical Guides (Completed Code vs Missing Docs)

Document the following major systems that are fully functional in code but lack detailed descriptions in the user-facing guides.

### 3.1 OMMESH Setup & Bidirectional Routing
- [ ] Create `docs/setup/OMMESH_SETUP.md` (or add a dedicated section in `Omnecor User Guide.md`):
  - Explain how to configure `OMMESH_SECRET` across multiple nodes.
  - Step-by-step connection guide for two computers on a LAN or Tailscale.
  - How to configure the Snapdragon NPU OMMESH phone node.
  - How to verify mesh routing (`MeshNode.routeInference()` / `MeshServer`).

### 3.2 Always-Listening Voice Mode
- [ ] Create `docs/user-guides/ALWAYS_LISTEN.md`:
  - Guide to obtaining and setting up a Picovoice Porcupine wake word key.
  - Guide to importing a custom `.ppn` wake word file.
  - Description of the Whisper STT download and local execution pipeline.
  - Explanation of the Kotlin-based foreground service keeping microphone capture alive when backgrounded.

### 3.3 Slash-Command Workflows
- [ ] Create `docs/user-guides/SLASH_COMMANDS.md` (or document under chat guide):
  - Document the `/architect`, `/remember`, `/review`, `/recover`, and `/imprint` commands.
  - Detail how each command initiates a specialized engineering sub-task or updates project memory.

### 3.4 Podcast Studio
- [ ] Update `docs/user-guides/Omnecor User Guide.md` (or enhance `docs/user-guides/Omnecor User Guide.md#podcast-studio`):
  - Document source ingestion (website URLs, text files, text drafts).
  - Guide to multi-speaker script generation and local TTS / ElevenLabs voice selection.
  - Detail how to play, download, and manage history in the newly wired UI.

### 3.5 3D Designer & PCB Viewer
- [ ] Create `docs/user-guides/3D_DESIGNER.md` (or merge into main user guide):
  - Explain the scope of the 4-mode workspace (Viewer, PCB Flow, Sandbox Preview, VFS Code Editor).
  - Document the AI context bridge (how the canvas feeds model queries).
  - Explain the Blender/KiCad native desktop app synchronization.

---

## 4. Verification Checklists (Already Completed in Code)

The following items from the compatibility and upgrade plans have been verified in the code and do not require additional logic changes. They only need verification that their documentation matches reality.

### 4.1 Multi-Platform Compatibility Verification
- [x] **Temp Directories**: All `/tmp` hardcoded directories in `kicadRouter.ts`, `BlenderService.ts`, and core server scripts are replaced with platform-agnostic `os.tmpdir()` path resolution.
- [x] **ESP Ports**: `ESPToolService.ts` accepts both Linux/macOS `/dev/` paths and Windows `COM*` formats.
- [x] **Home Directory**: Configurations in `config/index.ts` use `os.homedir()` fallbacks instead of hardcoded UNIX `HOME` variables.
- [x] **Electron Runtime**: Upgraded from EOL Electron 28 to Electron 39.8.10.
- [x] **Debian System Libraries**: Control file has complete system dependencies (`libsqlite3-0`, `libssl3`, etc.).
- [x] **Capacitor WebSocket Connection**: APK uses dynamic `?token=` parameter on connection URL to handle cookie-less React Native WebSockets.
- [x] **Zustand & tRPC Stores**: React 19 duplicate context collisions resolved; tRPC client ranges aligned.

### 4.2 Upgrade Plan Verification
- [x] **Agentic Wallet**: Spend logging, budgets, hard limits, and auto-downgrades to Ollama are fully functional.
- [x] **Virtual Cards**: Ephemeral card generation using Lithic API is implemented and gated by HITL.
- [x] **Execution Modes**: Sovereign, Scrapper, and Big Spender modes are enforced by tRPC middleware.
- [x] **Prompt Sanitizer**: Unicode, hidden character filtering, and adversarial injection detection are active.
- [x] **Google & Microsoft OAuth**: Identity logins are fully wired.
- [x] **Valet Router**: Qwen2.5-1.5B GGUF local model routing is complete and packaged.
- [x] **Saved Scripts**: LocalStorage scripts are migrated and backed up by Drizzle server database.
