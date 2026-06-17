# Chat Slash Commands & Workflow Skills

This guide documents the interactive console slash commands and engineering workflow skills available in the Omnecor Chat interface.

---

## 1. Core Slash Commands

Type these commands directly into the chat input bar to trigger core workstation actions:

| Command | Action | Description |
|---|---|---|
| `/new` | Create Conversation | Starts a fresh chat session and loads the default system prompt. |
| `/clear` | Clear UI Context | Clears the current message log from the UI display (retains history in database). |
| `/compress` | Summarize Context | Asks the LLM to compress the message history into a concise context note to save token budget. |
| `/btw <note>` | Save Background Fact | Stores a persistent fact in the Honcho memory layer. This note is injected into all subsequent chat system prompts. |
| `/plan` | Project Planning | Activates the Valet Router's interview wizard to generate the standard `project-docs/` suite. |
| `/system` | System Diagnosis | Outputs workstation ZRAM, swap, CPU, and model status directly into the console. |
| `/export` | Save Chat Log | Exports the active session's conversation log as a Markdown or JSON file. |
| `/help` | List Commands | Displays inline help and usage guidelines. |

---

## 2. Engineering Workflow Skills (Slash Commands)

These 5 commands represent pre-built, specialized reasoning workflows. They help automate pairwise engineering tasks:

### `/architect`
- **Purpose**: Runs a collaborative planning session before building any new feature, database schema, or router.
- **How it works**: Injects the codebase design rules and architecture map into the system prompt. The model interviews you on requirements, outputs a technical implementation plan, and awaits approval.

### `/remember`
- **Purpose**: Solves the problem of memory loss between developer sessions.
- **Usage**:
  - `/remember save`: Compresses the current session's build results, decisions, problems, and next actions into the `memory.md` file.
  - `/remember restore`: Reads the existing `memory.md` on boot to restore full context and verify state.

### `/review`
- **Purpose**: Validates code, APIs, and schemas after completing a feature.
- **How it works**: Analyzes changes against the build plan, checks coding standards (RBAC, SQL Cascades, clean TypeScript, no raw color tokens), and reports errors or readiness.

### `/recover`
- **Purpose**: Activates when a developer action or fix attempt fails.
- **How it works**: Diagnoses the failure profile (Targeted Bug, Workspace Pollution, or Foundation Defect) and helps decide between a targeted fix, a hard reset, or an architectural rethink.

### `/imprint`
- **Purpose**: Extracts UI patterns and design details from newly built frontend components.
- **How it works**: Audits the file's style classes and updates `Context/UI-Registry.md` to ensure future components match.

---

## 3. Command Palette (`Ctrl + K`)

For keyboard-driven navigation, press `Ctrl + K` (or command icon) anywhere in the interface to trigger the **Command Palette**:
- **Navigation**: Search and jump directly to pages (Dashboard, Chat, 3D Designer, Model Hub, Settings).
- **Actions**: Trigger active project operations, toggle background notes, change theme schemes, or run YARA malware scans on the active workspace.
