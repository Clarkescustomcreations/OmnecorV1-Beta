# Technical Documentation Updates Required

The following technical documents are significantly outdated and require surgical updates to reflect the v2.x.x schema and API changes.

## 1. `docs/backend/DATABASE_SCHEMA.md`
**Missing Tables:**
- `project_budgets`: id, projectId, limitCents, alertThreshold, mode (enum).
- `spend_log`: id, budgetId, provider, model, tokens, cost, createdAt.
- `audit_log`: id, eventType, actorId, procedure, args, result, ipAddress, createdAt.

**Missing Columns:**
- `users.executionMode`: enum('sovereign', 'scrapper', 'big_spender').
- `users.loginMethod`: expanded for 'google' and 'microsoft'.

**Recommendation:** Regenerate table tables using `drizzle-kit inspect` or manually sync with `drizzle/schema.ts`.

## 2. `docs/api/TRPC_API.md`
**Missing Routers:**
- `wallet`: getBudget, setBudget, getSpendSummary.
- `virtualCard`: issueCard, getCardStatus.
- `audit`: getAuditLog, exportAuditLog (Admin only).
- `system`: setExecutionMode, loginProviders.
- `training`: generateValetDataset.

**Missing Concepts:**
- `cloudProcedure` and `adminProcedure` metadata tags.
- Explain the `sovereignCheck` middleware logic that wraps `cloudProcedure`.

## 3. `docs/api/WEBSOCKET_API.md`
**Missing Events:**
- `budget:spend`: Emitted when an agent/user incurs costs.
- `security:injection_attempt`: Emitted when PromptSanitizer blocks a threat.
- `mesh:node_joined` / `mesh:node_left`: Real-time OMMESH status.

## 4. `.env.example` Synchronization
While the file exists, the documentation in `docs/setup/CONFIGURATION.md` (or similar) does not explain the new critical variables:
- `LITHIC_API_KEY`
- `ZERO_LOGIN_MODE`
- `GOOGLE_CLIENT_ID` / `SECRET`
- `MICROSOFT_CLIENT_ID` / `SECRET`
- `OLLAMA_PROXY_TOKEN`
