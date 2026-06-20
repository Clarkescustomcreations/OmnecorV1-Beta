# Fiction Mode — User Guide

Fiction Mode is a dedicated creative/narrative workspace inside Omnecor. It
locks down the tools that don't belong in a storytelling session — the
terminal, Agent Networking, the wallet, and cloud calls — and replaces them
with persona-driven creative writing support and a structured story bible
tied to your Neural Brain Map.

**Access:** Toggle **Fiction Mode** from the button in the sidebar. It is
always visible there — you no longer need to be on the chat page to find it.

---

## 1. What Fiction Mode Changes

Fiction Mode is now a **true global mode**: the toggle state lives in the
app-wide Zustand store rather than inside a single page's component tree.
Every part of the UI reacts to it the moment it changes.

When Fiction Mode is active:

- **Locked:** Terminal access, Agent Networking, the Agentic Wallet, and any
  `cloudProcedure`-tagged call are blocked. The `/agent-networking` and
  `/wallet` sidebar entries are greyed out and show a tooltip — *"This
  feature is disabled while Fiction Mode is active"* — so the restriction is
  visible before you even try to navigate there.
- **Whole-app visual indicator:** The entire dashboard shell gets a purple
  tint, a glowing border, and a backdrop-blur on the sidebar — with a 500 ms
  transition in and out. It's impossible to be in a creative session without
  knowing it.
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
2. Toggle **Fiction Mode** on from the sidebar button.
3. Pick a persona from the chat banner — this becomes the "voice" guiding
   the session (a co-writer, an editor, a specific character, etc.).
4. Start writing. As characters, places, and events come up, add them to the
   Fiction state via the Brain Map panel so the AI has consistent context to
   draw on in later sessions.
5. Toggle Fiction Mode off when you're done — the purple tint fades, the
   sidebar entries unlock, and your regular tools (terminal, Agent
   Networking, wallet) become available again immediately.

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
- **The purple tint is intentional.** The whole-app visual shift means you
  can't accidentally stay in Fiction Mode across context switches — if the UI
  looks different, the mode is on.
