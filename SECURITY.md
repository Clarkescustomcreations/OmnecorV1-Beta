# Security Policy for Omnecor

Omnecor is committed to providing a secure and robust environment for managing your AI workflows. This document outlines the security measures implemented within Omnecor and best practices for users to maintain a secure setup.

## 1. Core Security Features

Omnecor incorporates several security features to protect your data and system:

-   **Local-First Data Sovereignty**: By design, Omnecor prioritizes local data storage. Your sensitive project data and AI models reside on your machine, minimizing exposure to external threats. Cloud synchronization is optional and user-controlled.

-   **Rate Limiting**: The Express server implements rate limiting to prevent abuse and denial-of-service attacks. This helps ensure the stability and availability of the Omnecor application.

-   **CSRF and Path Traversal Protection**: Backend middleware is in place to enforce secure resource access, protecting against Cross-Site Request Forgery (CSRF) and path traversal vulnerabilities.

-   **Data Encryption**: Sensitive local project data is protected using AES-256-GCM encryption, ensuring confidentiality and integrity.

-   **Authentication and Authorization**: Omnecor includes session-based authentication (JWT-signed cookies), OAuth2 login (Google, Microsoft), and a full RBAC matrix with four roles: `viewer`, `user`, `admin`, and `owner`. tRPC procedure types enforce role requirements at the router layer (`publicProcedure`, `protectedProcedure`, `adminProcedure`, `ownerProcedure`).

-   **Human-in-the-Loop (HITL) Gates**: Dangerous or irreversible operations (firmware flash, virtual card issuance, MCP tool calls marked `dangerous:true`, peer federation approval, multi-agent crew runs with >3 agents) require explicit human approval before execution. Loop detection (action hash tracking, 3-repetition threshold) triggers HITL alerts and logs violations to the audit trail.

-   **Append-Only Audit Log with Retention**: Every `protectedProcedure` call is automatically logged to the `audit_log` table via `auditMiddleware`. PII and secrets are redacted before insertion via `PromptSanitizer`. Entries can never be edited; the only deletion path is a time-based retention purge (default **14 days**, configurable to 28 days or permanent under Settings → Security → Audit Log Retention — permanent shows a storage-size warning). A background sweep enforces the window every 6 hours, and retention changes are themselves audit-logged. Logs are accessible via `auditRouter` and displayed in the Settings → Audit Log panel.

-   **Integration Lifecycle Management**: All third-party OAuth integrations (GitHub, Notion, Slack, Google Drive, Dropbox, OneDrive, social platforms) are managed by `IntegrationManagementService`. Users can inspect health status, refresh OAuth tokens, and fully disconnect any integration via `trpc.integrationManagement.*` — no orphaned tokens left in the database. Health state is cached (60s TTL) to prevent API throttling. All operations are scoped to the authenticated user.

-   **Secure Storage Proxy**: A secure storage proxy is implemented to handle interactions with external storage, ensuring that data transfers are managed safely.

-   **OMMESH Security**: The OMMESH distributed mesh intelligence layer federates securely via mTLS (mutual Transport Layer Security), ensuring authenticated and encrypted communication between Omnecor nodes.

-   **External API Security Hardening**: All calls to 30+ external cloud services (AI providers, payment processors, cloud compute, etc.) are hardened with:
    -   **Circuit breakers**: Automatic fail-fast after repeated failures to prevent cascading outages
    -   **Exponential backoff**: Transient failures are retried with intelligent delays
    -   **Token refresh safety**: OAuth tokens are automatically refreshed with pre-flight expiry checks
    -   **Sensitive data redaction**: Payment card numbers, API keys, and tokens are automatically scrubbed from logs and error messages
    -   **Transaction atomicity**: Cloud compute and payment operations are protected against orphaned charges
    -   **Error wrapping**: Sensitive API errors are logged internally; users see safe, actionable error messages
    
    See [docs/backend/EXTERNAL_APIS.md](docs/backend/EXTERNAL_APIS.md) for a complete reference of all integrated services.

## 2. Best Practices for Users

To enhance the security of your Omnecor installation, we recommend the following best practices:

-   **Keep Your System Updated**: Regularly update your operating system, Node.js, and Omnecor to benefit from the latest security patches and improvements.

-   **Strong Passwords/Credentials**: If Omnecor integrates with external services requiring credentials, use strong, unique passwords and consider using a password manager.

-   **Network Security**: Ensure your local network is secure. Use firewalls and secure Wi-Fi configurations to prevent unauthorized access to your Omnecor instance.

-   **Environment Variable Management**: Store sensitive information, such as API keys, in your `.env` file and ensure this file is not committed to version control. Follow secure practices for managing environment variables.

-   **Regular Backups**: Implement a regular backup strategy for your `~/.omnecor` directory and Drizzle-managed database files to ensure data recovery in case of system failure or data loss.

-   **Monitor Logs**: Periodically review Omnecor logs (located in `server/_core/logs`) for any unusual activity or error messages that might indicate a security concern.

## 3. Code Integrity & Audit Hygiene (2026-06-10)

As part of the V1-Beta finalization sweep, all stale diagnostic comments were removed from the codebase:

-   **484 `UI-AUDIT-FINDING/SUGGESTION` comment lines** removed from 6 client-side TSX files. These were injected by an automated scanner in earlier sessions and did not reflect actual code defects — their presence could mislead future auditors.
-   **140 `UI-LOGIC-AUDIT` comment lines** removed from 24 server router files.
-   **Misleading placeholder comments** removed from `discoveryRouter.ts` (which already queries the database), `agentSettingsRouter.ts`, and `brainmapRouter.ts`. *(Update 2026-06-12: the `updateBotTheme`/`updateDiscoveryKeywords` stubs and the `brainmap` router were removed entirely in the production-readiness sweep — they had zero callers and silently dropped data.)*
-   **TypeScript gate**: `pnpm check` passes with 0 errors after all removals.

These removals are purely cosmetic but security-relevant: misleading comments can cause reviewers to trust that a check is performed when it is not (or vice versa). The current comment state now reflects actual behavior.

## 4. Production-Readiness Hardening (2026-06-12)

The V1-Beta production-readiness sweep (see `Beta-Code-Sweep.md`) added the following protections:

-   **WebSocket upgrade authentication**: `/ws` connections now verify a session credential — the session cookie (browser SPA), an `Authorization: Bearer` header, or a `?token=` query parameter (mobile APK). Unauthenticated LAN sockets may only attempt `mobile_node_register`, and only when `OMMESH_SECRET` is configured.
-   **Timing-safe OMMESH secret comparison**: mobile node registration compares secrets with SHA-256 + `crypto.timingSafeEqual` (no timing or length leak), and registration **fails closed** when `OMMESH_SECRET` is unset (loopback and zero-login excepted).
-   **OAuth endpoint rate limiting**: all `/api/oauth/*` routes have a dedicated limiter (10 requests / 15 minutes per IP) on top of the global limiter.
-   **Upload hardening**: attachment uploads use an extension allowlist — executables, scripts, and active content (exe, dll, bat, cmd, ps1, sh, msi, jar, apk, svg, html, …) are stored as `.bin`; the `/uploads` route is served with `X-Content-Type-Options: nosniff`, `Content-Disposition: attachment`, and a sandboxing `Content-Security-Policy` so uploaded HTML/SVG can never execute in the app origin.
-   **Configurable session lifetime**: `SESSION_TTL_MS` controls the session JWT + cookie lifetime (default one year for local-first installs; network deployments should set e.g. `604800000` = 7 days).
-   **Dependency floor pins**: `pnpm audit` is clean across all workspaces; security floors live in `pnpm-workspace.yaml` (drizzle-orm ≥0.45.2, @trpc/server ≥11.8.0, shell-quote ≥1.8.4, joi ≥18.2.1, uuid ≥11.1.1, and others).

## 5. Reporting Security Vulnerabilities

If you discover a security vulnerability in Omnecor, please report it responsibly by contacting the maintainers directly. Do not disclose the vulnerability publicly until it has been addressed.

## 6. License

This security policy is part of the Omnecor project, which is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
