# Cloud Compute Rental

Omnecor integrates with GPU cloud rental providers — **Vast.ai**, **RunPod**, and **Lambda Labs** — so you can spin up remote GPU instances and route heavy AI workloads to them without leaving the application. All session costs are tracked in your Agentic Wallet.

---

## Overview

The Cloud Compute panel is available at **Settings → Cloud Compute**.

It provides four sub-tabs:

| Tab | Purpose |
|---|---|
| **Active Sessions** | Live view of running GPU instances with real-time cost meters |
| **Start Session** | Rent a new instance by selecting provider, GPU tier, and billing unit |
| **History** | Log of all past sessions with cost and duration |
| **Subscriptions** | Register monthly pre-paid compute plans for accurate wallet spend tracking |

---

## Supported Providers

| Provider | API Key Variable | Billing | Notes |
|---|---|---|---|
| **Vast.ai** | `VASTAI_API_KEY` | Per-minute or per-hour | Marketplace of consumer/enterprise GPUs |
| **RunPod** | `RUNPOD_API_KEY` | Per-second / per-hour | Serverless and on-demand pods |
| **Lambda Labs** | `LAMBDA_API_KEY` | Per-hour | Datacenter-grade A100/H100 instances |

Add API keys to your `.env` file and restart the server to enable live provisioning. Sessions are tracked locally in all cases even without an API key (tracking-only mode).

---

## Starting a Session

1. Go to **Settings → Cloud Compute → Start Session**.
2. **Select a provider** — the card shows whether your API key is configured and how many GPU tiers are available.
3. **Choose a GPU instance** — dropdown lists available tiers with VRAM and hourly rate.
4. **Set billing unit** — per-minute or per-hour (availability depends on provider).
5. **Enter a Wallet Project ID** — links this session's cost to a project budget (default: `"default"`).
6. Review the **estimated cost** shown before confirming.
7. Click **Start Session**.

If no API key is configured, the session is tracked locally and a toast informs you that real hardware was not provisioned. This is useful for budget planning and wallet dry-runs.

---

## Active Sessions

The **Active Sessions** tab shows all currently running instances. Costs update every 30 seconds.

| Field | Description |
|---|---|
| Instance label | Provider name, GPU tier, and instance ID |
| Provider | vast.ai / runpod / lambda |
| Project ID | The wallet project budget this session bills against |
| Elapsed | Minutes since the session was started |
| Current cost | Estimated spend so far in USD |

Click **Stop** to terminate a session. The final cost is immediately written to the Agentic Wallet's `spend_log` table and a `budget:spend` WebSocket event is emitted to update all open budget meters.

---

## Session History

The **History** tab displays a paginated log of all past sessions (up to 50 most recent, configurable). Columns:

- Provider, Instance, Project, Status (`running` / `stopped` / `error`)
- Total cost in USD
- Start time

---

## Monthly Subscriptions

Register your pre-paid cloud plans so their costs appear correctly in wallet spend summaries.

1. Go to **Settings → Cloud Compute → Subscriptions**.
2. Select the provider and enter the plan name, monthly cost (USD), and optional notes.
3. Click **Register Subscription**.

Registered subscriptions appear in wallet monthly reports. Cancel them at any time from the same panel.

---

## Wallet Integration

All cloud compute costs flow into the Agentic Wallet:

- Every session stop event writes a `budget:spend` record.
- Per-project hard limits still apply — if a project budget is exhausted, new cloud sessions for that project are blocked until the limit is raised or reset.
- Subscription costs are factored into monthly spend summaries.
- If `LITHIC_API_KEY` is configured, a virtual credit card can be issued per project for card-network-level financial isolation.

See [Agentic Wallet documentation](../wallet/AGENTIC_WALLET.md) for full budget configuration details.

---

## Using Cloud Compute with Personas

A running cloud session can be assigned as the model backend for an Always-On agent persona:

1. Start a session in **Settings → Cloud Compute**.
2. Open **Settings → Personas** and open or create a persona of type **Omnecor Agent**.
3. In the **Agent Configuration** section, enable **Always-On**.
4. Under **Model Backend**, select **Cloud Compute**.
5. Pick the active session from the dropdown.

The persona will route all its inference requests to the selected GPU instance. See [Persona & Agent Guide](PERSONA_AGENT_GUIDE.md) for full details.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `VASTAI_API_KEY` | No | Vast.ai API key for live provisioning |
| `RUNPOD_API_KEY` | No | RunPod API key for live provisioning |
| `LAMBDA_API_KEY` | No | Lambda Labs API key for live provisioning |
| `LITHIC_API_KEY` | No | Issues virtual credit cards per project |

All keys are optional. Without them, sessions are tracked locally only.

---

## Troubleshooting

**"No active sessions" after starting one**

Wait up to 2–3 minutes for provisioning. The Active Sessions panel auto-refreshes every 30 seconds. If the session never appears, check the server log for a `cloudCompute.startSession` error — typically a malformed API key or provider outage.

**Cost shows $0.0000**

This is expected for sessions started without an API key (tracking-only mode). Real costs appear only when hardware is provisioned via the provider API.

**Session stuck in "running" after server restart**

Sessions started before a server restart may linger in the database. Stop them manually from the Active Sessions panel or run:

```bash
pnpm run cleanup:compute-sessions
```

---

## Related

- [CloudComputePanel.tsx](../../client/src/components/settings/CloudComputePanel.tsx) — UI source
- [Agentic Wallet](../wallet/AGENTIC_WALLET.md) — Budget and spend tracking
- [Persona & Agent Guide](PERSONA_AGENT_GUIDE.md) — Connecting cloud compute to a persona
- [Settings → Cloud Compute tab](../../client/src/pages/Settings.tsx) — Settings page integration
