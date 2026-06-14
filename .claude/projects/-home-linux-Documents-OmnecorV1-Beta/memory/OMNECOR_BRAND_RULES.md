# Omnecor Brand Rules
### Version 1.0 — Internal Reference Document

---

## 1. Name & Origin

### The Name

**Omnecor** is one word. Title case always. Never all-caps, never hyphenated, never split.

| ✓ Correct | ✗ Incorrect |
|-----------|-------------|
| Omnecor | OMNECOR |
| Omnecor HMCI | OmneCore |
| Omnecor v1 Beta | Omne-Cor |

### Etymology

The name is a deliberate compression of three ideas that define what the product does:

**Omni** — everything, all-in-one. From Latin *omnis*. Omnecor is not a specialist tool; it is the unifying layer across every creative and technical discipline.

**Cor** — the root does double and triple duty, intentionally:
- *Core* — the central engine. Everything routes through it.
- *Cor* (Latin) — heart. The product is the heart of your workflow.
- *Cortex* — specifically the prefrontal cortex: the executive function center of the human brain that holds context, plans ahead, and coordinates action across systems. Omnecor began as a "prefrontal cortex for your AI minds" — a context-holding orchestration layer before the name *CORTEX* was in use elsewhere.

The spelling change from *Omni* to *Omne* and the dropped trailing *e* from *Core* were deliberate: they compress the two roots into a single, pronounceable word that carries both meanings without spelling either one out.

### The Acronym

**O.M.N.E.C.O.R.**
> *Operational Memory Never Escapes — Context Overview Remains*

This is the defining promise of the product in sentence form. Omnecor holds context. It doesn't forget. It keeps the full picture in view while you work. Use the acronym expansion in long-form writing (documentation, README intros, marketing copy) as a mission statement, not as a logo treatment.

---

## 2. Tagline

**Primary tagline:**
> Operational Memory Never Escapes. Context Overview Remains.

This is the full acronym expanded as prose. Use it as the opening line of any product description, README hero, or about page.

**Short form (one-liner):**
> Where imagination becomes infrastructure.

Use this for UI subheadings, social bios, and anywhere a single concise line is needed.

**Descriptor (technical context):**
> Context-Aware AI Infrastructure.

Use for developer documentation, API references, and technical integration guides where precision matters more than poetry.

**Do not mix taglines in the same layout.** Pick one per context and be consistent.

---

## 3. Who Omnecor Is For

Omnecor exists for people who refuse to stay in one lane. The audience spans four overlapping groups:

**Developers & Hackers** — people who build things that didn't exist before and need their tooling to keep up.

**Hardware Engineers** — PCB designers, firmware writers, makers bridging physical and digital. Omnecor speaks their language natively (KiCad, ESPTool, Blender).

**AI Researchers & Power Users** — people running local models, building custom agents, experimenting at the frontier of what models can do.

**Creative Professionals** — artists, filmmakers, 3D artists, musicians using AI as a medium. ComfyUI, Fal.ai, voice cloning — these are first-class features, not afterthoughts.

**What unifies them:** the freedom to expand imagination into creation. Omnecor does not ask you to choose between disciplines. It is built for the person who codes, designs hardware, generates media, and runs AI agents — often in the same afternoon.

---

## 4. Voice & Tone

Omnecor's voice is that of an **intelligent co-pilot**: confident without being arrogant, technically precise without being cold, and always in service of the person using it.

### Principles

**Be direct.** State what something does before explaining how. Lead with capability, follow with mechanism.

**Be specific.** "Stream tokens from any local or cloud model" is better than "powerful AI capabilities." Specificity builds trust.

**Don't over-explain.** Omnecor's audience is smart. Avoid hand-holding language. Assume competence.

**Use active voice.** Omnecor *routes*, *watches*, *streams*, *connects*, *generates* — not "is able to route" or "can be used to stream."

**Keep it grounded.** The product does extraordinary things. Let the capability speak. Avoid breathless marketing language ("revolutionary," "game-changing," "unprecedented").

### Tone by Context

| Context | Tone | Example |
|---------|------|---------|
| UI labels & buttons | Terse, active | "Watch directory" not "Start watching" |
| Tooltips | One sentence, plain | "Reconnects automatically with exponential backoff" |
| Error messages | Clear, never blame the user | "Couldn't reach Ollama — is it running on port 11434?" |
| README / docs | Precise, slightly warm | Lead with what it does, then how |
| Marketing / About | Confident, expansive | Use the mission-statement tone of the acronym |
| Code comments | Functional | Explain *why*, not *what* |

### Words to Use

- orchestrate, route, stream, connect, wire, watch, generate, expand
- workspace, context, memory, inference, mesh, node, bridge
- sovereign, local, live, real-time

### Words to Avoid

- revolutionary, game-changing, powerful, seamless, robust (overused)
- "just" (diminishes capability: "just click here")
- "easy" (patronising to the audience)
- CORTEX (legacy name — not used in Omnecor)

---

## 5. Sub-Brands & System Names

### HMCI — Human-Machine Collaboration Interface

HMCI is the formal designation for what Omnecor is. Use it in technical documentation, the header lockup, and anywhere a formal product classification is needed.

**Full form:** Omnecor HMCI
**Pronunciation:** H-M-C-I (spell each letter)
**Usage:** Always paired with Omnecor. Never standalone. "The Omnecor HMCI" or "Omnecor's HMCI architecture." Not "the HMCI."

HMCI captures the design intent: this is not just AI tooling — it is a structured interface between human intent and machine execution. The human remains the decision-maker; Omnecor handles coordination.

### OMMESH

OMMESH is the distributed mesh intelligence layer — the subsystem that lets multiple Omnecor nodes discover each other on a LAN, federate securely via mTLS, and route inference requests by available VRAM.

**Format:** All caps. OMMESH.
**Usage:** Use when describing the distributed/multi-node capability specifically. Not part of the primary brand identity — it is a named subsystem.

**Example:** "OMMESH turns your local network into a unified compute pool."

---

## 6. Color Palette

The Omnecor visual identity uses **dark slate as the foundation with warm amber as the signature accent**. This combination is deliberately uncommon in AI tooling (which defaults to blue or green) and creates immediate visual distinctiveness.

### Brand Palette

| Role | Name | Hex | OKLCH |
|------|------|-----|-------|
| Background (deep) | Obsidian | `#0e0f14` | `oklch(0.10 0.012 240)` |
| Background (surface) | Dark Slate | `#151620` | `oklch(0.14 0.012 240)` |
| Background (card) | Slate | `#1c1e2b` | `oklch(0.18 0.012 240)` |
| Primary accent | Amber | `#f59e0b` | `oklch(0.75 0.18 75)` |
| Amber (hover/bright) | Amber Light | `#fbbf24` | `oklch(0.82 0.17 80)` |
| Amber (muted) | Amber Dim | `#92620a` | `oklch(0.52 0.14 70)` |
| Text (primary) | Offwhite | `#f0f0f5` | `oklch(0.96 0.008 240)` |
| Text (secondary) | Slate Grey | `#8b8fa8` | `oklch(0.62 0.016 240)` |
| Text (muted) | Dim Slate | `#52566a` | `oklch(0.42 0.014 240)` |
| Border | Slate Line | `#2a2d3e` | `oklch(0.24 0.012 240)` |
| Destructive | Coral Red | `#ef4444` | `oklch(0.62 0.22 25)` |
| Success | Neural Green | `#22c55e` | `oklch(0.72 0.18 145)` |
| Node pulse | Synapse Blue | `#3b82f6` | `oklch(0.62 0.18 240)` |

### Usage Rules

**Amber is the voice of Omnecor.** It is used for: primary interactive elements, active states, the logo mark, key callouts, and progress indicators. It should feel warm and alive against the cool slate background.

**Slate is the canvas.** Three levels of depth (Obsidian → Dark Slate → Slate) create visual hierarchy without borders. Cards lift off the background; the sidebar recedes.

**Do not use blue as a primary action color** in Omnecor-branded contexts. The current UI uses Tailwind blue for primary buttons — this should migrate to Amber in brand-aligned contexts. Synapse Blue is reserved for neural graph nodes and connection indicators.

**Amber on Obsidian** passes WCAG AA for large text (≥18px). For body text on dark backgrounds, use Offwhite, not Amber.

---

## 7. Typography

Omnecor has no single mandated typeface — it is a developer tool that runs in browsers. The typographic rules are therefore defined by role and weight rather than specific font files.

### Principles

**Headings** — geometric sans-serif, medium to bold weight. Suggested: Inter, Geist, or Space Grotesk. `font-bold tracking-tight`.

**Body / UI** — system sans-serif stack or Inter. Legible at 13–14px. `font-normal`.

**Code / technical labels** — monospace. JetBrains Mono or Geist Mono preferred. Used for: file paths, hashes, version strings, procedure names, terminal output.

**All-caps labels** — used sparingly for section labels and status badges. Always `letter-spacing: 0.06em` minimum. Never all-caps for headings or body copy.

### Scale (UI)

| Role | Size | Weight | Class pattern |
|------|------|--------|---------------|
| Page title | 24px | Bold | `text-2xl font-bold tracking-tight` |
| Section heading | 18px | Semibold | `text-lg font-semibold` |
| Card title | 14px | Medium | `text-sm font-medium` |
| Body / label | 13px | Normal | `text-sm` |
| Caption / meta | 11px | Normal | `text-xs text-muted-foreground` |
| Code / mono | 12px | Normal | `font-mono text-xs` |

---

## 8. Logo Direction

The current logo (circle + dot on `#1a1a2e` with `#e94560` red accent) is a placeholder. The rethink direction is **neural / organic** — nodes, networks, synapses.

### Concept

The logo should read as a **neural node**: the fundamental unit of the Omnecor system. A single node with radiating connections — not a corporate icon, not a letter mark. Something that communicates *network intelligence* at a glance.

### Design Principles for the Mark

**Asymmetric but balanced.** Organic neural structures are not perfectly symmetrical. The mark should feel grown, not constructed.

**Warm amber on dark slate.** The primary mark renders amber `#f59e0b` on Obsidian `#0e0f14`. No red. No blue.

**Scalable to 16px.** At favicon size, it must reduce to a recognisable dot-and-connection form.

**No letterforms in the mark.** The wordmark handles the name. The icon mark stands alone.

### Wordmark

When paired with the icon mark:

- "Omnecor" in title case, geometric sans-serif, medium weight
- Amber accent on the **·** (interpunct) between Omne and cor if a separator is used: **Omne·cor** — this reinforces the etymology without over-explaining
- "HMCI" in caps, small, below or beside — set in muted slate text

### Clear Space

Minimum clear space around the logo mark: half the height of the mark on all sides. Never crowd it with other elements.

---

## 9. Logo & Brand Don'ts

- Do not rotate the mark
- Do not use the old red `#e94560` accent in new brand materials
- Do not render the mark on a light background without an explicit light-mode version
- Do not place "CORTEX" anywhere in Omnecor-branded material
- Do not use the HMCI acronym without spelling it out on first reference
- Do not abbreviate Omnecor to "Omne" or "OC"
- Do not use gradient fills on the primary mark

---

## 10. The System Name Hierarchy

When writing about the product's architecture, use this naming ladder:

```
Omnecor                  ← the product / brand
  └── Omnecor HMCI       ← the platform designation
        ├── OMMESH        ← distributed mesh layer
        ├── Neural Brain Map  ← project visualisation subsystem
        ├── HITL          ← Human-In-The-Loop safety layer
        └── [module name] ← Blender Bridge, KiCad Bridge, etc.
```

Top-level communications lead with **Omnecor**. Technical documentation can reference subsystem names freely once Omnecor is established as the context.

---

## 11. Mission Statement

> Omnecor is the prefrontal cortex for your AI workforce —  
> the context-holding, memory-preserving, operation-coordinating core  
> that lets you build, design, generate, and engineer  
> without switching tools, losing context, or working in silos.
>
> Operational Memory Never Escapes. Context Overview Remains.

Use this in full in the About page, press kit, and project README. Use individual sentences as pull quotes.

---

*Document maintained by Clarkes Custom Creations. Update version number on any substantive change.*
