# Agentic Wallet

The Agentic Wallet is Omnecor's built-in financial management layer for cloud AI API costs. It prevents runaway spend during long agentic workflows and provides per-project financial isolation through Lithic virtual card integration.

## Architecture

```
Cloud API Call
     │
     ▼
AiProviderService.call()
     │
     ▼
WalletService.recordSpend()  ──► spend_log (INSERT ONLY)
     │                        ──► budget:spend WebSocket event
     ▼
Budget Check
  ├─ OK: continue
  ├─ ALERT (threshold%): fire notification, continue
  └─ HARD LIMIT: throw PAYMENT_REQUIRED, auto-route to Ollama
```

## Configuration

| Variable | Required | Description |
|---|---|---|
| `LITHIC_API_KEY` | No | Enables virtual card issuance. Without it, wallet runs in tracking-only mode. |

No other configuration is required. Budget limits are set per-project via the UI or `wallet.setBudget` tRPC procedure.

---

## Project Budgets

### Setting a Budget

Navigate to **Settings → Agentic Wallet → Project Budgets**, or call:

```typescript
await trpc.wallet.setBudget.mutate({
  projectId: 'my-project',
  limitCents: 500,      // $5.00 hard limit
  alertThreshold: 80,   // Alert at 80% ($4.00)
  mode: 'hard',         // 'soft' = alert only, 'hard' = block + auto-downgrade
});
```

### Budget Modes

| Mode | Behavior at Limit |
|---|---|
| `soft` | Sends a warning notification. Cloud calls continue. |
| `hard` | Blocks all cloud calls. Remaining tasks auto-route to local Ollama/Llama.cpp models. |

### Viewing Spend

```typescript
const summary = await trpc.wallet.getSpendSummary.query({
  projectId: 'my-project',
  from: '2026-06-01',
  to: '2026-06-30',
});
// Returns: { totalCostCents, byProvider: [...], byModel: [...] }
```

---

## Spend Log

Every cloud inference call creates an immutable entry in the `spend_log` table:

| Field | Description |
|---|---|
| `provider` | Provider name (e.g. `anthropic`, `openai`, `fal`) |
| `modelId` | Model identifier (e.g. `claude-sonnet-4-6`) |
| `promptTokens` | Input tokens consumed |
| `completionTokens` | Output tokens generated |
| `estimatedCostMicrocents` | Cost in microcents (1/1,000,000 of a dollar) for precision on small calls |

**This table is INSERT-ONLY.** There is no API endpoint that updates or deletes entries. Compliance exports are available via `audit.exportAuditLog`.

---

## Virtual Credit Cards (Lithic Integration)

### Prerequisites
- Set `LITHIC_API_KEY` in `.env`
- User must have `role = 'admin'` or `'owner'`

### Issuing a Card

```typescript
const card = await trpc.virtualCard.issueCard.mutate({
  projectId: 'my-project',
  spendLimitCents: 1000,  // Optional: mirrors project budget
  label: 'Agent: Video Gen Pipeline',
});
// Returns: { cardToken, last4, status, spendLimit }
```

### HITL Approval (Active)

Card issuance is gated behind a **Human-in-the-Loop (HITL) approval** workflow. When `virtualCard.issueCard` is called, the procedure **suspends** and submits the request to `HITLApprovalService` before any card is created:

- The approval payload includes `userId`, `spendLimitDollars`, `memo`, and a `riskNote` so the approver sees exactly what they are authorizing (a real virtual card charged against the Lithic account).
- The request is audit-logged (`hitl_request`, then `hitl_approved` / `hitl_rejected`).
- **Approve** → issuance proceeds normally.
- **Reject** → throws `FORBIDDEN` (`"Card issuance rejected by administrator."`); no card is issued.
- **No response within 5 minutes** → auto-rejects with `TIMEOUT` (`"Card issuance approval timed out after 5 minutes."`); the procedure never hangs indefinitely.

Rate limiting (1 issuance per 60s per user) runs **before** the approval flow is started.

### Use Cases
- **Project Isolation**: Each project gets a unique card number. If an agent leaks credentials, only that card is exposed.
- **Agent Isolation**: Issue a separate card per autonomous agent run for forensic spend attribution.
- **Automated Limits**: Card-level spend limits act as a second enforcement layer independent of the software budget.

### Card Status

```typescript
const status = await trpc.virtualCard.getCardStatus.query({ cardToken: 'tok_...' });
// Returns: { status: 'OPEN'|'PAUSED'|'CLOSED', spendYtd, spendLimit }
```

---

## Real-Time Budget Events

The `budget:spend` WebSocket event fires after every cloud call. The frontend uses this to update spend progress bars without polling:

```json
{
  "type": "budget:spend",
  "payload": {
    "projectId": "my-project",
    "provider": "anthropic",
    "modelId": "claude-sonnet-4-6",
    "promptTokens": 2048,
    "completionTokens": 512,
    "estimatedCostMicrocents": 69000,
    "budgetUsedPercent": 65,
    "budgetStatus": "ok"
  }
}
```

`budgetStatus` values:
- `"ok"` — Under alert threshold
- `"alert"` — At or above alert threshold; notification sent
- `"hard_limit"` — Budget exhausted; cloud calls blocked; auto-downgrade active

---

## Tracking-Only Mode (No Lithic Key)

Without `LITHIC_API_KEY`, the wallet still:
- Logs all cloud spend to `spend_log`
- Fires `budget:spend` WebSocket events
- Enforces project budget limits (soft and hard)
- Sends alert notifications at threshold

Virtual card issuance is unavailable. `virtualCard.issueCard` will throw `PRECONDITION_FAILED` with message: `"LITHIC_API_KEY not configured"`.
