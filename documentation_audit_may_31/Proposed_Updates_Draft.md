# Proposed Updates Draft: Critical Sections

This document provides ready-to-use content for the most critical missing documentation sections.

---

## Draft A: Agentic Wallet & Budgeting (For User Guide)

### 2.10. Agentic Wallet
Omnecor features a built-in "Agentic Wallet" to help you manage costs when using cloud-based AI providers (OpenAI, Anthropic, Fal.ai, etc.).

- **Project Budgets**: Set a hard limit (in cents) for each project.
- **Alert Thresholds**: Receive real-time notifications when you reach a percentage of your budget (e.g., 80%).
- **Auto-Downgrade**: If a hard limit is hit, Omnecor will automatically attempt to route remaining tasks to local providers (like Ollama) to prevent overages.
- **Virtual Credit Cards**: Integrated with Lithic, Omnecor can issue unique virtual cards for specific projects or agents, ensuring total financial isolation.

**Configuration**: Set `LITHIC_API_KEY` in your `.env` to enable card issuance. Without a key, the wallet functions in "Manual Tracking" mode.

---

## Draft B: Execution Modes & Sovereignty (For User Guide)

### 11. Security & Sovereignty: Execution Modes
Omnecor operates in three distinct "Execution Modes" to balance power with privacy. These can be toggled from the header or Settings.

1. **Sovereign Mode (Red Lock)**
   - **Privacy First**: All cloud-dependent features are strictly disabled.
   - **Enforcement**: The backend blocks any tRPC procedure tagged as `cloud`.
   - **Use Case**: Working on highly sensitive/classified data.

2. **Scrapper Mode (Green Zap) — DEFAULT**
   - **Efficiency First**: Local models (Ollama, Llama.cpp) are preferred.
   - **Cloud Fallback**: Cloud models are used only when local models are unavailable or specific cloud-only tools (like Fal.ai Video) are requested.
   - **Use Case**: Standard development and daily tasks.

3. **Big Spender Mode (Amber Flame)**
   - **Quality First**: High-performance cloud models (GPT-4o, Claude 3.5 Sonnet) are used by default.
   - **Use Case**: Final production runs, complex reasoning tasks, or large-scale media generation.

---

## Draft C: Zero-Login Mode (For Setup Guide)

### 4.4. Zero-Login & Air-Gapped Operation
For enterprise or high-security environments, Omnecor supports a "Zero-Login" mode.

- **Enable**: Set `ZERO_LOGIN_MODE=true` in `.env`.
- **Behavior**:
  - Skips OAuth registration and identity provider checks.
  - Generates a synthetic "Local Admin" session.
  - Auto-enforces **Sovereign Mode** by default.
  - Entirely offline; no external SDK calls are made during boot.

---

## Draft D: Immutable Audit Log (For Security Guide)

### 11.2. Immutable Audit Logging
Omnecor maintains an append-only audit log of all critical system events.

- **Integrity**: Logs are stored in an insert-only table; the system provides no methods for updating or deleting log entries via the API.
- **Redaction**: Sensitive data (API keys, PII) is automatically redacted before logging using the `redactSensitiveData` utility.
- **Captured Events**:
  - User Logins/Logouts.
  - HITL (Human-In-The-Loop) Approvals/Rejections.
  - Agent Spawn and Termination.
  - Critical Tool Calls (Blender, KiCad, ESPTool).
  - Budget changes and Virtual Card issuance.
