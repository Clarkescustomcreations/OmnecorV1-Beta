# Blueprint Studio — Architecture & Internals

> **User guide:** [Blueprint Studio — AI-Assisted Fabrication Planning](../user-guides/BLUEPRINT_STUDIO.md)
> **Shipped:** 2026-07-13 · **Router:** `server/routers/blueprintRouter.ts` · **Services:** `server/core_services/blueprint/`

Blueprint Studio is an agentic fabrication-planning system. This document covers
its data model, service layer, the reusable `ChatAgentRunner` extension it
introduced, and the calculation / CAD / FEA pipelines. For the "what it does and
how to use it" view, read the user guide first.

---

## Design principles

1. **The plan document is the deliverable.** Agent tools write directly to
   persistent DB rows (BOM, cut list, sim results, files) and the plan overview;
   the UI invalidates on `block_end` so the tabs update live. Chat prose alone is
   never the output.
2. **Deterministic math, never the model.** Every safety-relevant number flows
   through `calcEngine.ts` (closed-form) or `fea_bridge.py` (FEA). The system
   prompt forbids the model from doing structural math itself and requires it to
   quote the tool's safety factor and workings.
3. **Real material data.** Strength/stiffness values come from `materialsCatalog.ts`
   (published engineering data), never from the model.
4. **Sovereign-first.** The catalog, calcs, CAD, drawings, patterns, and FEA are
   all local. Only web price search and cloud concept renders are cloud-gated.
5. **The agent designs and records — it does not touch the host.** The Blueprint
   run disables built-in file/command tools; it gets a pure domain toolset only.

---

## Data model

Six tables in `drizzle/schema.ts` (migrations `0016`, `0017`). All dimensions
are stored canonically in **millimeters** (`*Mm`) and converted to the plan's
display `units` in the UI/agent layer. Every child table cascades on plan delete.

| Table | Holds |
|---|---|
| `blueprint_plans` | The plan row: title, brief, category, status, units, `cadEngine`, markdown `overview` + `safetyNotes`, JSON `assemblySteps`. Attached to a `neuralMaps` row (`set null` on map delete), owned by a user (`cascade`). |
| `blueprint_bom_items` | Bill-of-materials lines (material/hardware/tool/consumable) with `materialKey`, spec, quantity, unit, cost, supplier. |
| `blueprint_cut_items` | Cut-list lines: `partLabel`, `stockName`, dimensions, and end-cut angles (`miter1/2Deg`, `bevel1/2Deg`). |
| `blueprint_files` | Generated artifacts on disk: `cad_source`, `mesh_json`, `stl`, `drawing_svg`, `drawing_dxf`, `pattern_svg`, `pattern_pdf`, `concept_image`, `fea_result`, `plan_pdf`. Stores an absolute `path` under the data dir (validated on read) + JSON `meta`. **Revision lineage** (`0017`): `version` / `supersedesId` / `isLatest` — recompiling or re-importing a part supersedes its prior file rather than piling up. |
| `blueprint_sim_results` | Verification runs (`calc` \| `fea`): `inputs`, `results` (JSON), status, optional `fileId` for a result artifact. |
| `blueprint_messages` | The planning conversation — one thread per plan, `role` + flattened `content` + ordered `blocks` (`AssistantBlock[]`, the agentic render source of truth) + `tokenCount`. |

Ownership is enforced everywhere: `requireOwnedPlan()` (router) and `requirePlan()`
(toolset) both scope by `(planId, userId)` before any read or write, so no
endpoint or tool can touch another user's plan.

---

## Router surface (`blueprint.*`)

`blueprintRouter` is a standard tRPC router with these procedure groups:

- **Plans** — `list` / `create` / `get` / `update` / `delete`. `get` returns the
  full plan snapshot but strips absolute file paths (files are fetched by id).
- **Conversation** — `listMessages` / `appendMessage`, and the streaming
  `agentStream` subscription (see below).
- **BOM / cut list** — `upsertBomItem` / `deleteBomItem` / `upsertCutItem` /
  `deleteCutItem` for manual hand-tuning (the agent has its own writers).
- **Files** — `getFile` (returns base64 content) / `deleteFile`.
- **Geometry import** — `importGeometry` (STL → full part; DXF → 2-D outline preview; size + triangle guards; ownership-scoped).
- **Materials** — `materials.categories` / `materials.search`.
- **Concept renders** — `generateConcept` (manual button; `assertImageProviderAllowedInMode` gate).
- **Status + export** — `engineStatus` (JSCAD always up; OpenSCAD + FEA probed), `exportPdf`, and `exportBom` (CSV + supplier-grouped buy-list).

### The planning stream

`agentStream` is a subscription that mirrors `aiProvider.agentChatStream` — same
`AgentStreamEvent` contract, so the client reuses the `AssistantStream`
renderer — but the run is configured for domain-only work:

```ts
runner.run({
  input: { providerId, modelId, messages, systemPrompt, maxTokens, targetNodeId },
  userId, executionMode, conversationId: planId,
  includeBuiltInTools: false,                 // no edit_file / run_command / start_job
  extraTools: buildBlueprintTools({ planId, userId, executionMode, signal }),
  signal,
});
```

- The user turn is persisted **before** the stream starts, so history survives a
  mid-stream disconnect.
- History rows with empty content are filtered out before the provider call
  (providers reject empty parts — Gemini 400s).
- The assistant turn is persisted on `done` **only if it produced content or
  blocks** — an empty turn is never written (it would only poison later history).
- Sovereign gating follows the `agentChatStream` pattern: the provider is gated
  per-call via `assertProviderAllowedInMode`; cloud-only tools gate themselves.
- Emits go through `guardedEmit` so a client disconnect can't crash the server.

---

## The reusable piece: `ChatAgentRunner.extraTools`

Blueprint Studio's most reusable contribution is a generalization of the agentic
loop. `ChatAgentRunner` now accepts:

```ts
interface AgentRunParams {
  // …existing…
  includeBuiltInTools?: boolean;   // default true; false = no edit_file/run_command/start_job
  extraTools?: ExtraAgentTool[];   // injected domain tools
}

interface ExtraAgentTool {
  title: string;                   // human label for the rendered tool chip
  definition: ToolDefinition;      // name + description + JSON-Schema parameters
  execute: (args: Record<string, unknown>) => Promise<string>;
}
```

**Any feature can now run the agentic loop with a pure domain toolset.** Injected
tools are:
- dispatched **before** the MCP fallthrough,
- rendered in the UI as the existing `mcp` tool box (`server: "feature"`), with no
  HITL prompt (they don't touch the host),
- described to the model in the **text tool protocol** by rendering their JSON
  Schema generically — so a model without native function-calling still uses them
  correctly.

The proven built-in tool wording is unchanged when `extraTools` is empty. When
`includeBuiltInTools` is false, the prompt omits the built-ins entirely and
renumbers the injected tools from 1, adapting the worked example. This is covered
by the `buildTextToolSystemPrompt` tests in `blueprintCadService.test.ts`.

This is the seam any future "agent-driven domain surface" (not just Blueprint)
should build on.

---

## Service layer (`server/core_services/blueprint/`)

| File | Responsibility |
|---|---|
| `blueprintAgentTools.ts` | Builds the `ExtraAgentTool[]`, the system prompt, and `loadPlanSnapshot`. The single source of the tool surface. |
| `calcEngine.ts` | Pure-TS deterministic engineering calculations. No I/O. |
| `materialsCatalog.ts` | The offline 61-material database + search/lookup helpers. |
| `BlueprintCadService.ts` | Dual-engine parametric CAD (JSCAD sandbox / OpenSCAD binary), STL build, artifact storage + path-validated read. |
| `meshUtils.ts` | Mesh math: JSCAD → mesh, volume/area/bounds, STL (binary+ASCII) parse/write, feature-edge extraction, orthographic edge projection. |
| `drawingSvg.ts` | Three-view dimensioned drawing SVG + minimal R12 DXF. |
| `patternPdf.ts` | Seam-allowance polygon offset + tiled 1:1 pattern PDF. |
| `planPdf.ts` | The full Build Plan PDF booklet. |
| `bomExport.ts` | Shopping export — RFC-4180 CSV + supplier-grouped buy-list (pure, Sovereign-safe). |
| `conceptRender.ts` | Concept image bytes via ComfyUI / fal / openart. |
| `webMaterialSearch.ts` | DuckDuckGo material price/sourcing search (cloud-gated). |
| `BlueprintFeaService.ts` | Node side of the FEA bridge — availability probe + run. |
| `geometryImport.ts` | STL/DXF import helpers — minimal LINE/LWPOLYLINE DXF reader + outline-preview SVG (STL reuses `parseStl`). |
| `fileStore.ts` | `persistPlanFile` — file save + revision-lineage logic shared by the toolset and geometry import. |

### Calc engine

Pure functions, SI-metric internally. Every calc returns a uniform `CalcResult`
envelope: `inputs`, `outputs`, `workings` (formula + substitution lines),
`safetyFactor`, `pass`, `warnings`. Safety-factor policy is driven by the
material's `strengthBasis`:

| Basis | Required SF | Class |
|---|---|---|
| `allowable` | 1.0 | Graded lumber (factors embedded) |
| `yield` | 1.67 | Steel / aluminum |
| `ultimate` | 2.5 | Plastics / MOR wood / composites |

FDM parts loaded across layers additionally derate by `layerAdhesionFactor`.
Supported: `beam_bending` (simple/cantilever/fixed, point + UDL, four section
shapes), `column_buckling` (Euler, four end conditions), `fastener_group`,
`fillet_weld` (0.6·FEXX throat capacity), `bolted_connection` (min of bolt-shear /
bearing / tear-out), `torsion` (T·c/J + angle of twist), `wood_joinery` (NDS
withdrawal), `printed_part` (effective walls+infill section + layer-adhesion),
`heat_check` (service-temp vs. scenario peak), `rafter`, `stairs` (IRC riser
check), `compound_miter`, `triangle` (SSS/SAS/ASA), plus nesting
(`nest1D`/`nest2D`/`fabricYardage`) and rollup helpers.

### CAD service — dual engine

- **JSCAD (default, in-process):** AI-generated JS runs in a `node:vm` context
  with only a `jscad` global (`@jscad/modeling`) and a captured `console`. No fs /
  network / process access is exposed; `codeGeneration` is disabled; a wall-clock
  timeout (15 s) stops runaway loops. The script defines `main()` returning a
  solid, an array of solids, or `[{ name, geometry }]` for multi-part assemblies.
  **Note:** the sandbox prevents *accidents* (infinite loops, fs access), not a
  hostile-multitenant boundary — the code is the user's own AI-generated design
  script on their own machine, mirroring how Blender `executeScript` already works.
- **OpenSCAD (optional):** path from `getSetting("openscadPath")`, probed with
  `--version`, `.scad` compiled to binary STL via a safe `spawn` (argument array,
  never a shell string), then parsed back to the same mesh contract.

A `MAX_TRIANGLES` (400k) guardrail refuses meshes that would swamp the viewer or
DB payloads. Both engines yield `CompiledPart` (`MeshJson` in mm) → mesh JSON,
STL, drawing SVG, and DXF, all persisted via `saveArtifact`.

### Artifact storage & path safety

Artifacts live under `resolveDataPath("blueprints/<planId>/")`. `planId` is a
server-generated UUID (sanitized anyway), filenames are sanitized and prefixed
with a short random id, and `readArtifact` refuses any resolved path that escapes
the blueprints tree (`path.relative` starts-with `..` check). The router's `get`
strips absolute paths from the client payload — files are fetched by id through
`getFile`.

### FEA bridge

`fea_bridge.py` (Gmsh tet meshing + TET4 linear-static elasticity via
numpy/scipy) is spawned file-in/file-out by `BlueprintFeaService`. Availability is
probed (`import gmsh, numpy, scipy`) and cached for 5 minutes so the UI/agent can
degrade with an install hint. The bridge emits exactly one strict-JSON line on
stdout (last `{`-line wins). The nodal von-Mises field is saved as a `fea_result`
file for the 3D heatmap.

**Async solve.** The `run_fea` tool writes a `running` `blueprint_sim_results`
row up-front, then runs the solve **decoupled from the chat-stream `AbortSignal`**
— a client disconnect no longer kills a multi-minute solve; a background handler
updates the row to `completed`/`failed` and persists the field file regardless.
The tool still `await`s the result so the agent reports it in the connected case;
the Simulation tab shows the row transition running → completed.

---

## Client

- `client/src/pages/BlueprintStudio.tsx` — three-column layout: plans rail ·
  planning conversation (`AssistantStream` + `ModelSelector`) · Build Plan tabs.
  Lazy-loaded and route-boundaried in `App.tsx` at `/blueprint-studio`.
- `client/src/components/blueprint/PlanTabs.tsx` — the Build Plan viewer
  (Overview / BOM / Cut List / Drawings / 3D / Patterns / Simulation / Steps /
  Files); BOM + cut list are inline-editable.
- `client/src/components/blueprint/BlueprintMeshViewer.tsx` — the 3D part viewer
  with the optional FEA stress-heatmap overlay.

---

## Sovereign gating summary

| Surface | Gate |
|---|---|
| Planning conversation provider | `assertProviderAllowedInMode` (per-call, like main chat) |
| `generate_concept_image` / `generateConcept` | `assertImageProviderAllowedInMode` (local ComfyUI allowed; fal/openart blocked) |
| `search_materials_web` | **Not added to the toolset at all** when `isSovereignMode` |
| Catalog, calcs, CAD, drawings, patterns, FEA | Ungated — all local |

---

## Gotchas hit during the build (recorded so they don't recur)

- **Migration drift silently blocks all future migrations.** A live install had an
  older-generation `0015` applied (different hash than the regenerated file); the
  runtime auto-migrator re-ran it, failed on an already-existing object, and
  **warn-and-continued — skipping every later migration including `0016`.** Repair:
  record the current hash in `__drizzle_migrations` + apply the missing DDL, then
  `pnpm db:migrate`. Verify via `/health` → `migrationOk: true`.
- **Gemini streaming needs `alt=sse`.** Without it, `:streamGenerateContent`
  returns one pretty-printed multi-line JSON array; the per-line parser drops
  every line and the stream "completes" with zero chunks and no error.
- **pdfkit/svg-to-pdfkit must be esbuild externals.** fontkit loads font metrics
  via `__dirname`-relative paths, which esbuild inlining breaks (`__dirname is not
  defined` at runtime). Also: pdfkit's built-in Helvetica is WinAnsi — Greek/math
  glyphs (σ τ δ ⁴ ≥ ✓) must be transliterated or you get mojibake.
- **Never persist empty assistant turns**, and filter empty-content history before
  provider calls (Gemini 400s on empty parts) — a failed earlier turn must not
  poison the next.

---

## Testing

**86 tests across 5 files** (all green). See the Verification-Pass entries.

| File | Tests | Focus |
|---|---|---|
| `server/__tests__/blueprintCalcEngine.test.ts` | 37 | Golden-value checks of every closed-form result against hand-computed textbook formulas (PL/4, 5wL⁴/384EI, Euler, rafter/stairs/miter/triangle, nesting, SF policy), **the six added calcs** (weld throat/capacity, bolted-connection governing limit state, torsion τ/θ, NDS withdrawal, printed-part effective section + layer knockdown, heat-check scenario peaks), and the input-guard errors (unknown scenario / mode / strength basis). |
| `server/__tests__/blueprintCadService.test.ts` | 23 | JSCAD compile (volume/bounds/mass, multi-part, booleans, sandbox denies `require`/`process`), STL round-trip, feature-edge projection, drawing/DXF, seam-offset + pattern PDF, the `ChatAgentRunner` extraTools prompt integration, **and the DXF reader** (LINE/LWPOLYLINE → segments, open vs. closed, outline SVG). |
| `server/__tests__/blueprintRouter.test.ts` | 20 | Route-level against the real in-memory libSQL harness: CRUD, per-user ownership on every plan-scoped endpoint, child-row cascade, materials surface, the agent toolset writing BOM/cut/sim/plan rows (incl. sovereign web-tool omission), **cut→BOM upsert + provenance, revision lineage, async-FEA running→completed + signal-decoupling, CSV/buy-list export, and STL/DXF import**. |
| `server/__tests__/blueprintAgentStream.test.ts` | 3 | Subscription-level `agentStream`: user-turn-first + non-empty-assistant persistence, empty-history filtering handed to the runner, non-owner rejection with no writes (mocked runner + CAD/FEA probes). |
| `server/__tests__/blueprintPlanPdf.test.ts` | 3 | `buildPlanPdf` booklet structure (`%PDF-`…`%%EOF`, embedded drawing), WinAnsi glyph transliteration in workings, and an empty-plan run. |

---

## Extension ideas

**Shipped in the 2026-07-13 enhancements pass** (the `extraTools`/`persistPlanFile`
seams made each additive): weld / bolted-connection / torsion / wood-joinery /
printed-part / heat-check calcs, cut→BOM write-through, per-part revision history,
async (disconnect-surviving) FEA, the BOM shopping export, and STL/DXF import.

**Still open:** gusset + weld-group calcs, a fastener/hardware sub-catalog, live
price refresh over `search_materials_web`, and STEP/IGES import (deferred — needs
an OpenCascade-class dependency, out of scope for the light importer).
