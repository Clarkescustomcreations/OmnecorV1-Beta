# Omnecor Setup Wizard

The Setup Wizard is an interactive first-launch guide that walks you through configuring your Omnecor workstation. It appears automatically on first launch and can be re-opened at any time from **Settings → System → Re-run Setup Wizard**.

---

## Overview

The wizard is a multi-step flow designed to get your workstation fully operational as quickly as possible. Each step is optional — you can skip any configuration you want to complete later. Progress is saved between steps so you can pause and resume.

---

## Step 1 — Welcome & Mode Selection

**What it does:** Introduces Omnecor and prompts you to choose your primary execution mode.

**Choices:**

| Mode | Icon | Description |
|---|---|---|
| **Sovereign** | 🔴 | Air-gapped. All cloud API calls are blocked at the server middleware layer. Ideal for HIPAA-compliant or fully offline environments. |
| **Scrapper** | ⚡ | Local-first with cloud fallback. Ollama runs first; cloud providers are available with your own API keys. This is the **default** for most users. |
| **Big Spender** | 🔥 | Cloud-first. Prioritizes the highest-capability cloud models regardless of cost. |

You can change this at any time from **Settings → Security → Execution Mode**.

---

## Step 2 — API Providers

**What it does:** Lets you enter API keys for cloud AI providers. Keys are stored locally and are never transmitted to Omnecor's servers.

**Supported providers:**

| Provider | Environment Variable | Notes |
|---|---|---|
| OpenAI | `OPENAI_API_KEY` | GPT-4o, o1, etc. |
| Anthropic | `ANTHROPIC_API_KEY` | Claude Sonnet, Opus, Haiku |
| Google Gemini | `GEMINI_API_KEY` | Gemini 1.5 Pro, Flash |
| Fal.ai | `FAL_KEY` | Image / video generation |
| ElevenLabs | `ELEVENLABS_API_KEY` | Cloud TTS voice synthesis |

Skip this step entirely if you are running in **Sovereign Mode** or using only local Ollama models.

---

## Step 3 — Local Model Setup

**What it does:** Detects your locally running Ollama instance and lets you pull models directly from the wizard.

**Actions available:**

- **Auto-detect Ollama** — Omnecor pings `http://localhost:11434` and lists installed models.
- **Pull a model** — Enter any model name (e.g., `llama3.2`, `mistral`, `codellama`) to queue a pull.
- **Set custom endpoint** — If Ollama is running on a different host or port, update the `OLLAMA_ENDPOINT` value.

If Ollama is not installed, the wizard provides a one-click download link and post-install instructions.

---

## Step 4 — Database

**What it does:** Confirms the active database backend and optionally migrates to MySQL/MariaDB.

**SQLite (default):**

No action required. Omnecor will create `./data/omnecor.db` automatically on first launch. Recommended for single-user setups and offline operation.

**MySQL / MariaDB (optional):**

1. Enter your `DATABASE_URL` (e.g., `mysql://user:pass@localhost:3306/omnecor`).
2. Click **Test Connection** to verify credentials.
3. Click **Apply Schema** to run `db:push` and create all tables.

---

## Step 5 — Voice Pipeline (Optional)

**What it does:** Configures the speech-to-text (STT) and text-to-speech (TTS) bridges.

| Service | Default endpoint | Notes |
|---|---|---|
| Whisper STT | `http://localhost:8001` | FastAPI microservice |
| XTTS-v2 TTS | `http://localhost:8002` | FastAPI microservice |
| ElevenLabs TTS | Cloud | Requires `ELEVENLABS_API_KEY` from Step 2 |

The wizard will test each endpoint and show a green checkmark when reachable. If a service is not running, it provides the `pip install` and startup commands.

---

## Step 6 — Hardware Bridges (Optional)

**What it does:** Detects installed hardware tools and sets their executable paths.

| Bridge | Default path | Detection |
|---|---|---|
| Blender | `/usr/bin/blender` | `which blender` |
| KiCad CLI | `/usr/bin/kicad-cli` | `which kicad-cli` |
| ESPTool | `esptool.py` | `pip show esptool` |

Click **Auto-Detect** to run detection automatically. Override any path manually if your tool is installed in a non-standard location.

---

## Step 7 — Appearance

**What it does:** Sets your preferred color theme.

| Option | Description |
|---|---|
| **Dark** (default) | Dark background optimized for low-light environments. |
| **Light** | Light background best for bright environments. |

Your choice is saved to `localStorage` and can be changed at any time from **Settings → Appearance**.

See the [Light Mode / Appearance Guide](../user-guides/LIGHT_MODE.md) for full details on the theme system.

---

## Step 8 — Local Network (Android Thin Client)

**What it does:** Configures the workstation's LAN IP address so the Android thin client can connect.

This step is especially relevant when completing setup via the Android APK:

1. The wizard displays the workstation's detected local IP (e.g., `192.168.1.50`).
2. On the Android device, enter this IP address when prompted.
3. The Android app proxies all requests to `http://<desktop-ip>:3000` and delivers the full Omnecor UI on mobile.

**Requirements:**

- Android device and desktop must be on the same Wi-Fi / LAN.
- Port `3000` (or your configured `PORT`) must be reachable from the Android device (check firewall rules if needed).

---

## Step 9 — Cross-Session Memory (Optional)

**What it does:** Optionally configures Honcho external memory service for persistent background notes across sessions and projects.

**Configuration:**

1. If you have a **Honcho API key** from Plastic Labs, enter it here. (Optional — the feature is entirely optional and skippable.)
2. Set the application name (default: `omnecor`) and environment (default: `demo`).
3. Once configured, you can save background notes using `/btw <note>` in the chat, and they will persist across restarts and projects.

**Skip if:**
- You don't have or don't need a Honcho account.
- You prefer to keep background notes local to your current session only (stored in browser localStorage).

**Note:** If `HONCHO_API_KEY` is not set later, the feature is silently disabled — nothing breaks, and the app continues to work normally.

---

## Step 10 — Summary & Finish

The final step displays a checklist of configured items and any pending warnings (e.g., missing API keys, unreachable services). Click **Finish Setup** to dismiss the wizard and open the main Omnecor dashboard.

**Quick Tips:**
- **Peer Discovery**: Once you finish, the sidebar footer will show any other Omnecor nodes discovered on your local network (if OMMESH is enabled).
- **Token Budget**: In the chat, monitor the token budget bar under the input field to track context usage.
- **Valet Router**: If a trained Valet Router artifact is present, it will auto-start and intelligently route tasks. Otherwise, keyword-based routing is used as a fallback.

---

## Re-running the Wizard

To re-open the wizard at any time:

**Settings → System → Re-run Setup Wizard**

Or, reset wizard state entirely:

```bash
# Clears the wizard completion flag from the database
pnpm run reset:wizard
```

---

## Related Documentation

- [INSTALL.md](../../INSTALL.md) — Full installation guide including all package formats
- [Light Mode / Appearance](../user-guides/LIGHT_MODE.md) — Theme system details
- [Cloud Compute Rental](../user-guides/CLOUD_COMPUTE.md) — GPU rental integration
- [Persona & Agent Creation](../user-guides/PERSONA_AGENT_GUIDE.md) — Building custom AI personas
