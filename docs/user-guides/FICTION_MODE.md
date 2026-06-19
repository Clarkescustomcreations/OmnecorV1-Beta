# Fiction Mode — User Guide

Fiction Mode is a dedicated creative/narrative workspace inside Omnecor. It
locks down the tools that don't belong in a storytelling session — the
terminal, Agent Networking, the wallet, and cloud calls — and replaces them
with persona-driven creative writing support and a structured story bible
tied to your Neural Brain Map.

**Access:** Toggle **Fiction Mode** from the sidebar, or from the banner
inside Chat once a Brain Map is active.

---

## 1. What Fiction Mode Changes

When Fiction Mode is active:

- **Locked:** Terminal access, Agent Networking, the Agentic Wallet, and any
  `cloudProcedure`-tagged call are blocked while the mode is on — the chat
  banner shows this explicitly (`Terminal · Agent Net · Wallet · Cloud
  blocked`).
- **Visual indicator:** The chat surface gets a distinct purple-glow border
  so it's always visually obvious you're in a creative session, not a
  production/dev one.
- **Persona selector:** A persona picker appears directly in the chat banner
  — pick which voice/character is actively guiding the session.
- **Custom guardrails:** Whatever guardrails you've configured are injected
  into the AI's system prompt automatically, so tone and content boundaries
  stay consistent without re-explaining them every session.

Nothing about your regular (non-fiction) chats, projects, or data is
affected — Fiction Mode is a per-session toggle, not a global account
setting.

---

## 2. The Fiction State (Story Bible)

Fiction Mode isn't just a locked-down chat — it maintains its own structured
state, scoped to whichever Neural Brain Map you're working in:

| Element | What it holds |
|---|---|
| **Nodes** | Characters, locations, items, factions — anything you want tracked as a discrete story entity |
| **Relationships** | Connections between nodes (ally, rival, parent, owns, etc.) |
| **Timeline** | Chronological events in your story's internal history |
| **Lore** | Free-form world-building facts (key/value), referenced by the AI for consistency |

This state is saved per Brain Map — switching maps switches your active
story's nodes, relationships, timeline, and lore along with it. It's cached
locally and synced to the database, so it survives across sessions and
devices.

---

## 3. Typical Workflow

1. Open or create a Brain Map for your project (a novel, a campaign setting,
   a script).
2. Toggle **Fiction Mode** on.
3. Pick a persona from the chat banner — this becomes the "voice" guiding
   the session (a co-writer, an editor, a specific character, etc.).
4. Start writing. As characters, places, and events come up, add them to the
   Fiction state via the Brain Map panel so the AI has consistent context to
   draw on in later sessions.
5. Toggle Fiction Mode off when you're done — your regular tools (terminal,
   Agent Networking, wallet) become available again immediately.

---

## 4. Why the Lockdown?

The restricted tool set exists so a creative session can't accidentally
trigger something irreversible or costly — running a terminal command,
posting to a connected social account, or spending from the Agentic Wallet —
while you're in an exploratory, free-form writing context. It also keeps the
AI's behavior consistent: guardrails injected for creative work shouldn't
leak into a development or admin session, and vice versa.

---

## Tips

- **Keep one Brain Map per story/project.** Fiction state is scoped per-map,
  so mixing multiple stories into one map will mix their characters and lore
  together.
- **Use Lore for anything you'd hate to contradict later** — naming
  conventions, magic system rules, established history. The AI references it
  on every turn, so it's the cheapest way to keep a long project consistent.
- **Personas carry tone, not memory.** Switching personas mid-session changes
  voice and guardrails immediately, but your Fiction state (nodes,
  relationships, timeline, lore) stays exactly as it was.
