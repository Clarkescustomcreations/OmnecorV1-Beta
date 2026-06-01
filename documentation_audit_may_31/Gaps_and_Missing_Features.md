# Gaps and Missing Features (todo.md vs. docs/)

This document lists the features marked as **COMPLETE** in `todo.md` that are currently missing or insufficiently covered in the `docs/` directory.

## 1. Phase 13 & 14 — Agentic Wallet & Virtual Cards
- **Status in Code:** Fully implemented (MySQL schema, Lithic integration, Budget UI).
- **Status in Docs:** **UNDOCUMENTED**.
- **Missing Information:**
    - How to configure `LITHIC_API_KEY`.
    - How to set project budgets and alert thresholds.
    - Explanation of "Auto-Downgrade to Ollama" logic on budget breach.
    - User guide for managing Virtual Credit Cards in the UI.
    - API documentation for `walletRouter` and `virtualCardRouter`.

## 2. Phase 15 — Execution Modes (Sovereign / Scrapper / Big Spender)
- **Status in Code:** Implemented (Middleware, UI Badge, DB Column).
- **Status in Docs:** **UNDOCUMENTED**.
- **Missing Information:**
    - Definitions of each mode:
        - **Sovereign**: 100% local, no cloud calls allowed.
        - **Scrapper**: Local-preferred, cloud for specialized tasks.
        - **Big Spender**: High-performance cloud models preferred.
    - Security implications and how the `sovereignCheck` middleware protects user privacy.
    - How to switch modes via the UI or Command Palette.

## 3. Phase 17 — Zero-Login Mode & Offline Boot
- **Status in Code:** Implemented (Env var `ZERO_LOGIN_MODE`, synthetic admin).
- **Status in Docs:** **UNDOCUMENTED**.
- **Missing Information:**
    - Instructions for enabling `ZERO_LOGIN_MODE=true`.
    - Explanation of what features are limited in this mode (e.g., OAuth).
    - Hardened Sovereign mode auto-enforcement details.

## 4. Phase 20 — Immutable Audit Log
- **Status in Code:** Implemented (Audit log table, middleware, redaction).
- **Status in Docs:** **PARTIALLY DOCUMENTED** (mentioned in code comments but not in user/security guides).
- **Missing Information:**
    - How to view/export the audit log (Admin Procedure).
    - What events are captured (HITL approvals, agent spawns, etc.).
    - Redaction policy for PII/Secrets in logs.

## 5. Phase 23 — Extended OAuth (Google & Microsoft)
- **Status in Code:** Implemented.
- **Status in Docs:** **OUTDATED**.
- **Missing Information:**
    - `README.md` and `Settings` documentation still focus primarily on "Manus OAuth" or general OAuth.
    - Missing setup guides for Google/Microsoft Client IDs/Secrets in `.env`.

## 6. Phase 8 — OMMESH Details
- **Status in Code:** Fully integrated.
- **Status in Docs:** **PARTIALLY DOCUMENTED** (High-level only).
- **Missing Information:**
    - Technical deep-dive into the mTLS handshake and mDNS discovery.
    - "VRAM-weighted job routing" logic explanation for developers.
    - Troubleshooting LAN discovery issues.

## 7. Phase 16a — Valet Router Training
- **Status in Code:** Dataset builder implemented.
- **Status in Docs:** **UNDOCUMENTED**.
- **Missing Information:**
    - How to trigger the dataset generation.
    - What the 10-category taxonomy entails.
