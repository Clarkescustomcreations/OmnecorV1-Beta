# Persona & Agent Creation Guide

The **Character Persona Studio** is available at **Settings → Personas**. It lets you build a digital representation of yourself, a crafted social media identity, or a fully autonomous AI agent with its own voice, face, behavior, and communication channels — all tied into the Omnecor ecosystem.

---

## Table of Contents

1. [What Is a Persona?](#1-what-is-a-persona)
2. [Persona Types](#2-persona-types)
3. [Identity Tab](#3-identity-tab)
4. [Appearance Tab](#4-appearance-tab)
5. [Voice Tab](#5-voice-tab)
6. [Video Avatar Tab](#6-video-avatar-tab)
7. [Agent Configuration](#7-agent-configuration)
   - 7.1 [System Prompt](#71-system-prompt)
   - 7.2 [Enabled Tools](#72-enabled-tools)
   - 7.3 [Always-On Agent](#73-always-on-agent)
   - 7.4 [Model Backend](#74-model-backend)
   - 7.5 [Messaging Channels](#75-messaging-channels)
8. [Neural Brain Map Binding](#8-neural-brain-map-binding)
9. [Persona Library](#9-persona-library)
10. [Saving & Loading Personas](#10-saving--loading-personas)
11. [Use Cases](#11-use-cases)
12. [Data Storage](#12-data-storage)

---

## 1. What Is a Persona?

A Persona is a named, configurable AI entity that can:

- Have a distinct **identity** (name, bio, personality traits)
- Look a specific way via an **avatar image** or generated portrait
- Sound a specific way via **voice cloning or synthesis**
- Produce **lip-synced talking-head video**
- Run as an **autonomous agent** with a custom system prompt and tool permissions
- Stay **always-on** and respond to messages continuously
- Be reached through multiple **messaging channels** (in-app chat, webhooks, email, etc.)
- Have its own **knowledge graph** by linking to a Neural Brain Map

Personas are stored locally in `localStorage` under the key `omnecor_personas`. No persona data is sent to any server or external service.

---

## 2. Persona Types

Select the type that best describes your use case on the **Identity** tab.

| Type | Icon | Description |
|---|---|---|
| **Self Clone** | 📷 | A digital replica of yourself — same voice, face, and mannerisms. Use for automated replies, voice memos, or presence when you're unavailable. |
| **Social Media Persona** | 🌐 | A crafted public identity for content creation, brand presence, or marketing. Designed for consistency across platforms. |
| **Omnecor Agent** | 🧠 | A fully autonomous AI agent with a custom system prompt, tool access, and optional always-on mode. Engineered for task execution and workflow integration. |

---

## 3. Identity Tab

The Identity tab defines who the persona is.

### Display Name

A human-readable label (max 60 characters). This name appears in the Persona Library, chat headers, and tool call logs.

### Persona Type

Click one of the three type cards to switch types. Type affects which configuration sections are active (Agent Configuration only activates for **Omnecor Agent** type).

### Bio / Backstory

A free-text description (max 500 characters) of who this persona is, their domain of expertise, and their communication style. For agent personas this description is prepended to the system prompt as context.

### Personality Traits

Tags that describe the persona's character. Examples: `confident`, `empathetic`, `technical`, `concise`, `sarcastic`.

- Type a trait and press **Enter** or click **+** to add.
- Click the **×** on any tag to remove it.
- Up to 4 traits are shown in the preview card; the rest are stored and shown on hover.

Traits are injected into the agent system prompt as a structured list when the persona is active in a chat session.

### Neural Brain Map

Bind a Neural Brain Map to this persona. When active in a chat session, the map's knowledge graph and semantic context is injected into the model's context window via the RAG pipeline.

- If no maps exist, a prompt links you to the Brain Map page to create one.
- Select **No brain map** to disable knowledge injection.
- The map's root directories, indexing mode, and semantic chunks are all available to the persona.

See [Neural Brain Map documentation](../neural%20brain%20map/NEURAL_BRAIN_MAP_UI.md) for details on creating and managing maps.

---

## 4. Appearance Tab

The Appearance tab controls the persona's visual identity.

### Upload a Photo / Reference Image

Drag-and-drop or click to upload a PNG, JPG, or WEBP image. This image is used as:

- The **avatar thumbnail** displayed in the Persona Library and chat header.
- The **voice clone reference** for XTTS-v2 voice generation.
- The **base image** for AI-generated portrait variations.

Uploaded images are stored as data URLs in `localStorage` — no external upload occurs.

### AI Avatar Generation

If `FAL_KEY` or `OPENART_API_KEY` is set in your `.env`, you can generate a photorealistic portrait automatically:

1. Write a description in the prompt field. Example:
   ```
   Professional headshot, mid-30s, dark hair, blue background, photorealistic, studio lighting
   ```
2. Click **Generate Avatar**.
3. The best available provider is selected automatically (Fal.ai → OpenArt → local ComfyUI).

The generated image replaces the current avatar and can also be used as the voice clone reference.

---

## 5. Voice Tab

The Voice tab assigns a voice engine to the persona. All voice synthesis is used in chat TTS replies and video avatar generation.

### Voice Engine Options

#### Local XTTS-v2

Open-source neural TTS running as a local FastAPI microservice.

- Click the XTTS-v2 card to select it.
- Upload a **reference audio sample** (WAV or MP3, 10–30 seconds recommended). A clear, noise-free sample produces the best clone.
- Or enter the file path directly in the reference field (e.g., `/models/voices/my-voice.wav`).
- Click **Test Voice** to queue a synthesis and verify the clone quality in the TTS output panel.

#### RVC Conversion (Retrieval-Based Voice Conversion)

Converts synthesized speech into a target voice using a trained RVC model. Best for highly realistic real-person clones.

- Select an RVC model from the dropdown. Models are loaded from `./models/rvc/`.
- Place `.pth` model files in that directory for them to appear.

#### ElevenLabs (Cloud)

Ultra-realistic cloud voice synthesis. Requires `ELEVENLABS_API_KEY` in `.env`.

- When active, the panel shows all voices available on your ElevenLabs account.
- Select a voice from the dropdown.
- Click **Play** next to the test field to preview the selected voice with a live synthesis request.
- A badge shows `Active` / `No key` depending on whether the API key is configured.

### Test Phrase

Enter any text in the test field at the bottom of the tab and click the preview button to hear a synthesis sample before saving the persona.

---

## 6. Video Avatar Tab

The Video Avatar tab generates a **talking-head video** — a lip-synced video of the persona speaking. Pair this with the Voice tab configuration to produce synchronized audio + video output.

### Reference Upload

Upload a reference image (frontal face, clear lighting, neutral expression) or a short video clip. This file is used as the base for video generation.

### Video Providers

| Provider | Configured by | Notes |
|---|---|---|
| **OpenArt** | `OPENART_API_KEY` in `.env` | Video character generation |
| **Fal.ai** | `FAL_KEY` in `.env` | High-quality video synthesis |
| **D-ID Studio** | Manual API setup | Realistic talking-head from photo + audio |

Select the active provider and ensure the corresponding API key is set. The panel shows a **Ready** or **Not configured** badge per provider.

Video generation itself is triggered from the chat interface or a pipeline once the persona is saved — not from this configuration panel.

---

## 7. Agent Configuration

The Agent Configuration section is shown below the main tab panel when **Persona Type = Omnecor Agent**. It controls how the agent thinks, what it can do, and how it communicates.

---

### 7.1 System Prompt

The system prompt is injected at the top of every conversation this agent participates in. It defines the agent's role, constraints, and behavioral rules.

```
You are [Persona Name], a specialized AI assistant. Your expertise is in…
```

Best practices:
- Be explicit about the agent's domain and capabilities.
- Specify the output format if needed (e.g., "Always respond in Markdown").
- Include constraints (e.g., "Do not execute code that modifies the filesystem").
- Keep it under 2000 tokens for best performance; the bio and traits are appended automatically.

---

### 7.2 Enabled Tools

Tools grant the agent permission to call specific capabilities during a conversation.

**Suggested tools (click to toggle):**

| Tool | Description |
|---|---|
| `web_search` | Perform web searches and return results |
| `code_executor` | Execute code in a sandboxed runtime |
| `file_reader` | Read files from the local filesystem |
| `image_gen` | Generate images via the connected image provider |
| `tts_synthesize` | Synthesize speech using the persona's voice engine |
| `calendar` | Read and write calendar events |
| `email` | Send and receive email |
| `database_query` | Run read-only queries against the local database |

Add custom tool names by typing in the input field and pressing **Enter** or clicking **+**. Custom tools must be registered in the server's tool registry to be callable.

---

### 7.3 Always-On Agent

The **Always-On** toggle keeps the agent running continuously and ready to respond to messages from any enabled messaging channel without requiring a user to initiate a conversation.

When enabled, a **green pulse indicator** appears in the Persona Library card and in the chat header when this persona is active.

**Behavior:**
- The agent monitors its enabled messaging channels for incoming messages.
- Upon receiving a message, it runs inference using the configured model backend and routes the reply to the originating channel.
- The agent maintains context across messages within a session window.

---

### 7.4 Model Backend

Select where the agent's inference runs when Always-On is active.

| Backend | Description | When to use |
|---|---|---|
| **Ollama (Local)** | Runs entirely on your workstation using a local Ollama model. | Default for private, sovereign operation. |
| **Omesh Network** | Distributes inference across your LAN mesh of Omnecor nodes. | When you have multiple workstations and want to load-balance. |
| **Cloud Compute** | Uses an active GPU session from Vast.ai, RunPod, or Lambda Labs. | For large models or when local VRAM is insufficient. |
| **External API** | Calls OpenAI, Anthropic, Gemini, Grok, or any compatible API endpoint. | For maximum model quality or access to specific capabilities. |

**Ollama:** Choose from locally installed models. A live list is fetched from `http://localhost:11434`.

**Omesh Network:** Shows the number of active mesh peers. Inference is routed to the healthiest peer automatically.

**Cloud Compute:** Requires an active GPU session started from **Settings → Cloud Compute**. A dropdown lists all running sessions with provider, elapsed time, and current cost.

**External API:** Specify the provider, model ID (e.g., `gpt-4o`, `claude-sonnet-4-6`), and an optional per-persona API key override. If no per-persona key is set, the global key from **Settings → API Providers** is used.

---

### 7.5 Messaging Channels

Configure how users and external systems can interact with the always-on agent.

| Channel | Description |
|---|---|
| **In-App Chat** | Chat with this agent directly inside the Omnecor interface. A link opens the chat page with this persona pre-selected. |
| **Webhook** | The agent accepts messages via HTTP POST to a configurable endpoint. Set a signing secret to verify incoming HMAC signatures. |
| **n8n Workflow** | Trigger the agent from an n8n automation. Enter the n8n Workflow ID; messages are sent to the agent via the configured webhook URL. |
| **Desktop Notifications** | Receive OS-level alerts when the agent produces a response. Clicking the notification opens the Omnecor chat. Requires browser notification permission. |
| **Email** | Route messages through an email address. The agent monitors the inbox and replies via the configured SMTP/IMAP settings. |

**Enabling a channel:** Click its row to toggle it on. When active, the row highlights and any required configuration fields expand inline:

- **Webhook:** Endpoint URL + optional HMAC signing secret.
- **n8n:** Workflow ID.
- **Email:** Target email address.
- **Desktop Notifications:** A one-time browser permission prompt.

Multiple channels can be active simultaneously. Replies are sent back to the originating channel.

---

## 8. Neural Brain Map Binding

A Neural Brain Map bound to a persona injects semantic knowledge into every conversation the persona participates in. This is configured in the **Identity tab** (see [section 3](#3-identity-tab)).

When a persona with a bound map is active in chat:

1. The user's message is embedded using the same model used to index the map.
2. The top-K semantically similar chunks are retrieved from ChromaDB.
3. Retrieved chunks are injected into the model's context as a `system` message block labeled `[Knowledge Context]`.
4. The model generates its reply with awareness of the retrieved knowledge.

This enables the agent to answer questions about your codebase, documents, or any indexed directory without explicit uploads per session.

---

## 9. Persona Library

The **Persona Library** grid at the bottom of the page displays all saved personas.

Each card shows:
- Avatar image (or a placeholder icon)
- Display name
- Persona type badge
- Personality traits (truncated)

**Hover actions:**
- **Load** — populates the editor above with the persona's full configuration.
- **Delete (trash icon)** — permanently removes the persona from `localStorage`.

A currently-loaded persona's ID is tracked in component state. Saving overwrites the existing record; no duplicate is created.

---

## 10. Saving & Loading Personas

### Save

Click **Save Persona** in the preview card (left column). The persona must have a name. A success toast confirms the save.

- If the current persona ID matches an existing saved persona, it overwrites the record.
- If it's a new persona (newly generated UUID), it is prepended to the library.

### New Persona

Click **New Persona** in the preview card or in the library header. This discards unsaved changes to the current editor and opens a blank persona form.

### Load from Library

Hover over a library card and click **Load**. The editor scrolls to the top and populates with the persona's saved data.

---

## 11. Use Cases

### Personal Digital Assistant

Create a **Self Clone** persona with your voice (XTTS-v2 reference), your photo, and a system prompt describing your communication style. Enable **In-App Chat** and set the backend to a capable local model. Use it to draft replies, summarize documents, or handle routine queries in your voice.

### Brand Content Agent

Create a **Social Media Persona** with a branded avatar, a consistent bio, and tone-of-voice traits. Enable the **Webhook** channel so your social media management tool can POST content briefs and receive AI-generated posts in your brand voice.

### Code Review Bot

Create an **Omnecor Agent** named "Code Reviewer" with:
- System prompt: strict code review standards, output format as inline comments.
- Tools: `file_reader`, `code_executor`.
- Backend: a capable code model (e.g., `codellama:34b` via Ollama or `gpt-4o` via API).
- Channel: `n8n` wired to your CI/CD pipeline.

The agent reviews pull requests automatically and posts structured feedback.

### Research Assistant

Bind your research project's Neural Brain Map to a **Self Clone** or **Agent** persona. The persona can answer questions about your papers, notes, and codebase with full semantic retrieval — no context window management required.

---

## 12. Data Storage

All persona data is stored in **browser `localStorage`** under the key `omnecor_personas`.

| Data | Location | Notes |
|---|---|---|
| Persona configuration | `localStorage` (key: `omnecor_personas`) | JSON array, survives page reloads |
| Avatar images | `localStorage` (as data URLs) | Large avatars may approach localStorage limits (~5 MB per origin) |
| Voice reference paths | `localStorage` | File paths are stored; audio files remain on disk |
| Brain map bindings | `localStorage` (key: `omnecor_neural_maps`) | Map objects with root directories and metadata |

**Backup:** Export your personas by opening the browser DevTools console and running:

```js
copy(localStorage.getItem("omnecor_personas"));
```

Paste the result into a `.json` file. Restore by running:

```js
localStorage.setItem("omnecor_personas", '<paste JSON here>');
location.reload();
```

---

## Related

- [PersonaCreationPanel.tsx](../../client/src/components/settings/PersonaCreationPanel.tsx) — Full UI source
- [Settings.tsx — Personas tab](../../client/src/pages/Settings.tsx) — Integration point
- [Neural Brain Map UI](../neural%20brain%20map/NEURAL_BRAIN_MAP_UI.md) — Knowledge graph documentation
- [Cloud Compute Rental](CLOUD_COMPUTE.md) — GPU sessions for persona model backends
- [Agentic Wallet](../wallet/AGENTIC_WALLET.md) — Cost tracking for cloud-backed personas
- [VALET_ROUTER.md](../ai-agents/VALET_ROUTER.md) — How routing interacts with active personas
