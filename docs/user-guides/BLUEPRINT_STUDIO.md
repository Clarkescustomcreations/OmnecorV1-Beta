# Blueprint Studio — AI-Assisted Fabrication Planning

> **Route:** `/blueprint-studio` · **Sidebar:** *Blueprint Studio* · **tRPC namespace:** `blueprint.*`
> **Companion doc:** [Blueprint Studio — Architecture & Internals](../architecture/BLUEPRINT_STUDIO.md)

Blueprint Studio turns a plain-language description of a **physical** project into a
complete, followable **Build Plan**. Describe what you want to make — a welding
table, a shed, a go-kart frame, a printed enclosure, a cosplay armor set — and an
agentic planning session designs it, sizes the members with real engineering
math, writes the bill of materials and cut list, compiles 3D geometry and
dimensioned drawings, generates true-scale sewing/foam patterns, and lays out the
assembly steps. Everything is saved to a persistent plan you can revisit, edit by
hand, and export as a PDF booklet.

It is a first-class page alongside Chat and the 3D Designer, and it reuses the
same agentic chat stream, model selector, and Neural Map attachment you already
know from the rest of Omnecor.

---

## What makes it different from just chatting

The **plan document is the deliverable, not the chat transcript.** As the agent
works it writes directly into structured, persistent records — the BOM, the cut
list, the drawings, the verification runs — and the UI updates live. An answer
that only exists as prose in the conversation is treated as incomplete.

Two hard guarantees shape every plan:

1. **The AI never does structural math in its head.** Every span, load,
   deflection, buckling, or joint-strength number comes from a deterministic
   calculation engine (or a real finite-element solve). Each result records the
   formula, the substituted numbers, and a safety factor — so you can see *how*
   every safety-relevant figure was derived.
2. **Materials come from a real database.** Strength and stiffness values are
   pulled from published engineering data (graded-lumber design values, ASTM
   metal specs, filament datasheets), never invented by the model.

---

## Supported project categories

| Category | Examples |
|---|---|
| **Carpentry / Woodworking** | Tables, shelving, furniture, cabinets |
| **Metal Fabrication** | Welding tables, brackets, tube frames |
| **Structure** | Sheds, decks, pergolas, lofts |
| **Vehicle / Frame** | Go-karts, trailers, chassis members |
| **3D Printing / Prototype** | Printed parts, enclosures, jigs |
| **Costume** | Multi-part cosplay: fabric + EVA foam + printed parts |
| **Mixed materials** | Anything combining the above |
| **Other** | Everything else |

---

## Getting started

### 1. Create a plan

Click **New Plan** in the plans rail and fill in:

- **Title** — e.g. "4×2 ft steel welding table".
- **Brief** — the plain-language description, including the important constraints
  ("500 lb capacity", "outdoors", "must break down flat"). The more you give the
  planner, the fewer clarifying questions it asks.
- **Category** — from the table above; steers material recommendations and which
  calculations matter.
- **Units** — **imperial** (default) or **metric**. This is a *display* choice
  only; internally everything is stored in millimeters and newtons and converted
  for you.
- **CAD engine** — **JSCAD** (built-in, zero-install — the default) or
  **OpenSCAD** (optional external binary). See [CAD engines](#3d-geometry--drawings-cad).

Plans are attached to your **active Neural Map** (project). Switching maps filters
the plans rail to that project. A plan survives its map being deleted.

### 2. Plan it in conversation

The middle column is a normal agentic chat with a model selector — pick any model
from the unified catalog (cloud, local runtime, Ollama, or a mesh peer). Just talk
to it:

> *"Design me a welding table, 48 × 24 inches, 36 inches tall, that can hold a
> 250 lb engine block on top. Steel. I want it to break down for storage."*

The planner will clarify requirements, propose an approach in prose, then start
recording — you'll watch the BOM, cut list, drawings and verification runs
populate the tabs on the right in real time. You can type follow-up turns while it
is still working, and you can hand-edit any of the structured tabs yourself.

### 3. Review the Build Plan

The right-hand panel is the plan document, organized into tabs:

| Tab | What's in it |
|---|---|
| **Overview** | The design description (markdown), concept renders, safety notes, and plan status. |
| **BOM** | Bill of materials — materials, hardware, tools, consumables with quantities, specs, costs, and suppliers. **Hand-editable.** |
| **Cut List** | Every part with exact dimensions and end-cut angles (miter + bevel). **Hand-editable.** |
| **Drawings** | Dimensioned three-view blueprint drawings (SVG) rendered inline. |
| **3D** | Compiled parts in an interactive viewer, with the FEA von-Mises stress heatmap overlaid when a simulation has run. |
| **Patterns** | True-scale printable pattern PDFs for fabric / foam pieces. |
| **Simulation** | Every engineering calc and FEA run, with inputs, workings, and pass/fail + safety factor. |
| **Steps** | Ordered assembly instructions, each with the parts and tools it needs. |
| **Files** | Every generated artifact (CAD source, meshes, STLs, drawings, DXF, patterns, renders, PDFs) for download. |

### 4. Export

Click **Export PDF** to produce the full Build Plan booklet: overview, safety
notes, BOM, cut list, verification results with workings, embedded drawings, and
concept renders — a print-ready document you can take to the shop.

---

## What the planner can do (the agent toolset)

The Blueprint agent has a purpose-built toolset — and **only** that toolset. It
has no file-edit or shell access; it designs, calculates, and records.

### Materials & sourcing
- **Materials catalog search** — looks up the built-in database of ~60 materials
  with real mechanical properties and typical costs, and reuses their catalog
  keys so calculations run on real numbers.
- **Web material search** *(cloud only)* — searches the live web for current
  prices, availability, and specialty items. Used **only** for cost/sourcing,
  never for mechanical properties. **Omitted entirely in Sovereign mode.**

### Engineering verification
- **Engineering calculation** — the deterministic engine. Structural solves:
  `beam_bending`, `column_buckling`, `fastener_group`, **`fillet_weld`** (weld
  throat/length capacity), **`bolted_connection`** (governs bolt-shear vs.
  plate-bearing vs. edge tear-out), **`torsion`** (shafts/axles — shear + angle of
  twist), and **`wood_joinery`** (lag/wood-screw withdrawal). Fabrication geometry:
  `rafter`, `stairs`, `compound_miter`, `triangle`. And for 3-D prints:
  **`printed_part`** (strength on the effective walls-plus-infill section, with the
  layer-adhesion knockdown when loaded across the layers) and **`heat_check`**
  ("will this plastic part survive direct sun / a hot car without softening?" —
  service temperature vs. a conservative scenario peak). Each result is saved to
  the Simulation tab with its formula workings and a governing safety factor.
- **FEA stress simulation** *(optional dependency)* — a real finite-element
  linear-static stress analysis on a compiled part. Returns max von-Mises stress,
  max displacement, and a safety factor, plus a stress field for the 3D heatmap.
  It runs as a **background job** — the Simulation tab shows it *running →
  completed*, and a client disconnect no longer loses a multi-minute solve.

### Layout & optimization
- **Cut optimization** — nests parts onto stock with saw kerf: 1-D (lumber/tube),
  2-D (sheet goods), or fabric yardage. Tells you exactly how many sticks, sheets,
  or yards to buy, and can **write that buy-quantity straight onto the matching
  BOM line** (no re-keying), saving the nesting run for provenance.

### Geometry & output
- **Compile CAD** — turns parametric CAD code into real geometry: an interactive
  3-D model, a binary STL, a dimensioned three-view drawing (SVG), and a DXF —
  all saved to the plan.
- **Import geometry** — bring in an existing **STL** (becomes a full part: 3D
  viewer, drawings, and FEA-ready) or a **DXF** outline (2-D preview + the original
  file), from the *Import STL/DXF* control on the 3D tab.
- **Generate pattern** — a true-scale, tiled, printable pattern PDF for fabric or
  foam pieces (with seam allowance, calibration square, registration marks, cut
  vs. stitch lines, and grainline arrows).
- **Generate concept image** — an illustrative render of the finished project
  (local ComfyUI, or cloud fal/openart when not in Sovereign mode).

### Revision history & exports
- **Part revisions** — recompiling or re-importing a part **supersedes** its prior
  files instead of piling up. The Drawings, 3D, and PDF views always show the
  latest; the Files tab shows each file's version and keeps superseded ones
  downloadable.
- **Shopping export** — the *Export list* button on the BOM tab downloads a CSV
  (open in a spreadsheet or import to a cart) plus a supplier-grouped printable
  buy-list with a known-price total. Fully offline / Sovereign-safe.

### The plan document writers
- **Update plan** — overview, assembly steps, safety notes, category, status.
- **Set BOM** / **Set cut list** — write the structured tables.

---

## Engineering verification in depth

The calc engine is basis-aware: it applies the right safety-factor treatment for
each material class.

| Strength basis | Applies to | Required safety factor |
|---|---|---|
| **Allowable** | Graded softwood lumber (factors already embedded in the published values) | 1.0 (compare stress directly) |
| **Yield** | Steel, aluminum (design against yield) | ≥ 1.67 (AISC-ASD-like, static loads) |
| **Ultimate** | Plastics, small-clear wood, composites, fabrics | ≥ 2.5 |

FDM-printed parts loaded across their layers additionally derate strength by the
material's **layer-adhesion factor** (Z-strength is much weaker than in-plane
strength) — so a printed bracket loaded the wrong way is flagged honestly.

Every structural result carries a plain warning that these checks are **guidance
for personal fabrication**, and that structural work on anything people occupy
(buildings, decks, stairs) or road-going vehicles must be verified against local
code and by a licensed engineer.

---

## The materials database

The offline catalog holds **61 materials across 11 categories**, each with the
real mechanical properties the calc engine consumes and purchasable stock sizes:

- **Lumber** (12) — NDS №2-grade design values for SPF, DF-L, SYP, cedar, etc.
- **Steel** (9) — ASTM A36 / A500 tube / A513, with yield and modulus.
- **Aluminum** (5) — 6061-T6 extrusions and sheet.
- **Sheet goods** (5) — plywood, MDF, OSB, melamine.
- **Filament** (8) — PLA, PETG, ABS, ASA, Nylon, TPU, PC, CF-nylon — with
  layer-adhesion knockdown factors from datasheets.
- **Resin** (2), **fabric** (7), **foam** (2) EVA/craft, **thermoplastic** (1)
  Worbla, **fastener** (7), **notion** (3) zippers/velcro/elastic.

Because it is fully offline, **Blueprint Studio works end-to-end in Sovereign
(air-gapped) mode** — the only thing you lose is live web price lookups and cloud
concept renders.

---

## 3D geometry & drawings (CAD)

Blueprint Studio compiles **parametric** CAD code (the agent writes it; you never
have to) into real geometry. There are two engines:

### JSCAD — the built-in default (zero install)
JavaScript CAD via [`@jscad/modeling`](https://openjscad.xyz/), executed
in-process in a sandbox. Nothing to install, and geometry renders instantly. This
is the right choice for almost everyone.

### OpenSCAD — optional external binary
If you already work in OpenSCAD and want to use its language, install the OpenSCAD
binary and point Omnecor at it in **Settings → Advanced (`openscadPath`)** — the
exact same pattern as the Blender and KiCad integrations. Omnecor probes it with
`--version`; if it isn't found, the planner tells you and offers to switch the
plan back to JSCAD.

Either engine produces the same outputs: a viewer mesh, a binary **STL**, a
dimensioned **three-view drawing** (SVG with a title block and real dimensions in
your plan's units), and a **DXF** for CAM/laser/CNC handoff.

---

## Finite-element stress analysis (optional)

For 3-D parts where a closed-form beam/column check isn't enough, the planner can
run a **real FEA**: Gmsh tetrahedral meshing plus a TET4 linear-static elasticity
solve. It returns the maximum von-Mises stress, maximum displacement, and a
safety factor, and saves the stress field so the **3D tab shows a color heatmap**
of where the part is highly stressed.

FEA is an **optional capability**. Enable it with:

```bash
pip install gmsh numpy scipy
```

If those aren't installed, Blueprint Studio degrades gracefully — it tells you FEA
is unavailable (with the install hint) and relies on the closed-form engineering
calcs instead. A run can take up to a few minutes; cancelling the turn kills the
solver.

---

## Sovereign mode behavior

Blueprint Studio is designed to stay fully useful air-gapped. In Sovereign mode:

| Feature | Sovereign behavior |
|---|---|
| Materials catalog, calcs, cut optimization, CAD, drawings, patterns, FEA | **Fully available** (all local) |
| Planning conversation | Available with a **local** model (runtime / Ollama / mesh peer) |
| Concept renders | **Local ComfyUI only** (cloud fal/openart blocked) |
| Web material price search | **Removed from the toolset entirely** |

The provider you pick for the conversation is gated per-call, exactly like the
main chat — a cloud model is refused in Sovereign mode, a local one is allowed.

---

## Tips for good plans

- **Front-load the constraints.** Load, span, environment (indoor/outdoor),
  budget, and any "must break down / must fit through a door" rules up front save
  a round of clarifying questions.
- **Ask it to verify.** "Check the top rail for a 250 lb point load in the middle"
  produces a saved calc with a safety factor you can trust and export.
- **Get a concept render early.** It's a fast sanity check that the planner
  understood the shape you're after before it commits to dimensions.
- **Hand-tune freely.** The BOM and cut list are editable — adjust a supplier,
  fix a price, tweak a length — and the changes are part of the exported plan.
- **Set the status.** Move a plan `draft → planning → ready → building →
  complete` so the plans rail reflects where each project stands.

---

## Related

- [Blueprint Studio — Architecture & Internals](../architecture/BLUEPRINT_STUDIO.md) — schema, services, the `ChatAgentRunner` domain-tool extension, and the CAD/FEA pipelines.
- [3D Designer & PCB Editor](3D_DESIGNER.md) — the interactive 3D/PCB workspace (a different tool: freeform editing vs. Blueprint's plan-driven generation).
- [Execution Modes](../sovereignty/EXECUTION_MODES.md) — what Sovereign / Scrapper / Big Spender block and allow.
