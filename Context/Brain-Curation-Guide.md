# Brain Curation & Creation Guide

This guide defines the standards for creating **Brain Packs (`.obp`)** for Omnecor. Our goal is to ship Omnecor with a "Team of Experts" — a roster of domain-specific brains that allow smaller, local AI models (3–7B) to perform complex tasks by giving them focused expertise. 

By following these curation instructions, you ensure the AI wastes no context space and adheres strictly to Omnecor's architectural and operational standards.

---

## 1. The Team of Experts (The Roster)

We are building a core team of 7 experts. Each Brain Pack must be strictly scoped to its domain to prevent context dilution.

1. **The Omnecor Expert** — Knows everything about Omnecor's architecture, system boundaries, Sovereign mode, tRPC tiers, database schema, and execution paths.
2. **The 3D Modeler** — Expert in Blender, Three.js patterns, scene graphs, materials, and spatial math.
3. **The PCB & Schematics Engineer** — Expert in KiCad rules, routing, schematic symbols, footprints, and hardware design constraints.
4. **The Software Architect** — Expert in React, Node, TypeScript, Drizzle ORM, and general software engineering patterns.
5. **The Audio & Podcast Producer** — Expert in TTS pacing, voice generation scripting, audio pipelines, and timing.
6. **The Content Writer** — Expert in Markdown structuring, documentation formatting, grammar, and clear technical writing.
7. **The Workflow Blueprinter** — Expert in node-based pipeline building, execution graphs, data flow, and workflow design.

---

## 2. The Charter Template

The **Charter** is the always-on ruleset injected directly into the prompt. To maintain consistency, every Brain's Charter must be written in the imperative voice and follow this exact 3-part structure.

**Strict Rule:** Use imperative framing ("Be a...") rather than declarative ("You are a..."). This provides stronger behavioral steering for local models.

```markdown
### 1. Role
Be a senior [Domain] engineer. Your purpose is to [clear, concise statement of what this expert solves]. You value [key metrics, e.g., type safety, spatial accuracy, routing efficiency] above all else.

### 2. Absolute Rules
- Never [Action]. (e.g., "Never use raw hex colors.")
- Always [Action]. (e.g., "Always validate paths via validatePath().")
- [Rule 3]
- [Rule 4]

### 3. Standard Operating Procedures (SOPs)
1. **Understand:** Before answering, explicitly state the constraints.
2. **Plan:** Draft the approach using established domain patterns.
3. **Execute:** Provide the solution, heavily citing the retrieved corpus.
4. **Verify:** Check the output against the Absolute Rules.
```

---

## 3. Corpus Curation Standards

The **Corpus** is the retrieved reference knowledge. The `BrainAuthoringService` allows URL scraping, but **we mandate clean, locally-curated Markdown files** to maximize signal-to-noise ratio and preserve token context space.

Follow these rules when curating source files for the Corpus:

1. **Zero Fluff:** Strip out introductions, marketing copy, and filler text. Only retain hard rules, code snippets, API references, and architectural decisions.
2. **Markdown Headings:** Use clean `##` and `###` headings. The chunker splits on natural boundaries, and clear headings ensure chunks remain semantically whole.
3. **Code Blocks:** Use properly fenced code blocks with the correct language tag. Ensure snippets are self-contained.
4. **Local Storage:** Place all curated `.md` files in a dedicated directory: `brains/sources/[domain-name]/`.

*Example of a good Corpus file:*
```markdown
## KiCad Routing Constraints
- Min trace width: 0.2mm
- Clearance: 0.15mm

### Allowed Angles
Route traces at 45-degree angles. Never use 90-degree corners to avoid acid traps and impedance mismatches.
```

---

## 4. Build Pipeline Checklist

Once the Charter is written and the Corpus files are curated, run the distillation pipeline to generate the `.obp` pack.

1. [ ] **Curate Sources:** Ensure all reference material is saved as clean Markdown in `brains/sources/[domain-name]/`.
2. [ ] **Write the Charter:** Verify the Charter follows the 3-part imperative template.
3. [ ] **Configure the Spec:** Create a `BuildBrainSpec` object. Set `includeRawChunks: true`.
4. [ ] **(Optional) Enable Distillation:** If using a cloud model (Sovereign mode permitting during authoring), configure `distill: { providerId, modelId }` to generate synthetic Q&A pairs from the corpus.
5. [ ] **Run the Build:** Execute `BrainAuthoringService.getInstance().build(userId, spec)`.
6. [ ] **Verify the Pack:** Ensure the resulting `.obp` file is written to the user brains directory and successfully imports (`embedderMatch: true`).
7. [ ] **Test:** Attach the new Brain to a persona and verify that the local model successfully cites the corpus and follows the Charter's absolute rules.
