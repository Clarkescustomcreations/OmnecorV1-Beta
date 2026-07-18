# How To Make an Expert Brain Pack

A practical guide to authoring a new built-in **Expert Brain** for Omnecor's Team of
Experts (§8 of `LOCAL_MODEL_EMPOWERMENT.md`). Follow it exactly and your brain will
actually *lift* a small local model instead of just adding tokens.

---

## The one rule that matters: reasoning base + domain layer

**A brain is not a pile of facts. It is a way of thinking, plus knowledge.**

We measured this. On reason-hard tasks (write a correct algorithm) run against
`qwen2.5-coder:7b`:

| Brain attached | score vs no-brain baseline |
|---|---|
| **Generalist** (pure solving *process*, no domain facts) | **+20 pts (helped)** |
| **Coding** (domain *knowledge/standards*, no solving process) | **+0 (a draw)** |

The domain expert did **nothing** on coding tasks; the generalist — which only teaches
*how to think* (decompose → reason edge cases → verify) — nearly doubled the score. The
**reasoning discipline is the active ingredient**, and the old expert charters didn't
have it.

So every expert charter is composed:

```
CHARTER = REASONING_BASE  (the blueprint — how to think)
        + domain layer    (what to know, specific to this expert)
```

`REASONING_BASE` lives in `brains/sources/_reasoning-base.ts` and is imported by every
expert. **Never re-write the reasoning process in an expert charter — import the base.**
The generalist brain *is* the base; each expert is base-plus-specialty.

---

## Anatomy of a brain

A brain is authored as a reviewable, diffable TS module — **not** a hand-built `.obp`:

`brains/sources/<slug>.ts` exports exactly two things:

```ts
import { REASONING_BASE } from "./_reasoning-base.js";
import type { BrainFact } from "./_types.js";

// 1. The always-on CHARTER = base + a SHORT domain layer.
export const <NAME>_CHARTER = `${REASONING_BASE}

Domain layer — <domain>. On any <domain> task, ALSO apply:
1. <the few non-negotiable, always-true rules for this domain>
2. ...
N. Cite the corpus when you use it; prefer its specific guidance over a generic recollection.`;

// 2. The CORPUS — retrieved top-k at inference time. One durable fact per entry.
export const <NAME>_SOURCES: BrainFact[] = [
  { name: "kebab-case-topic", text: `One self-contained, durable reference fact, well under 1500 chars.` },
  // ...
];
```

### Charter vs corpus — which goes where?

- **Charter** = *always injected* on every request the brain is attached to. Put the
  handful of **always-true operating rules** here. It is spent on every turn, so it must
  earn its tokens. **Keep the domain layer short** (≈6–9 rules). The reasoning base is
  already the process; the domain layer is only the domain's non-negotiables.
- **Corpus** (`SOURCES`) = *retrieved top-k* by semantic similarity to the current prompt.
  Put the **reference facts** here — the specifics you'd look up. Each `BrainFact`:
  - is **self-contained** and **durable** (not version-specific trivia that goes stale);
  - is **well under 1500 chars** so it maps to exactly **one** retrieval chunk;
  - has a **kebab-case `name`** — it becomes the `[Brain: <Name> · <name>]` citation;
  - is **original content** (no copied third-party text) so it ships CC0.

---

## Steps

1. **Write** `brains/sources/<slug>.ts` (charter = `REASONING_BASE` + domain layer; corpus
   = curated `BrainFact[]`). Study `brains/sources/coding.ts` as the exemplar.
2. **Register** it in `brains/sources/index.ts` — add a `BRAIN_MODULES` entry:
   `{ slug, name, domain, description, charter: <NAME>_CHARTER, sources: <NAME>_SOURCES }`.
3. **Build** the pack (runs the real pipeline: chunk → on-device embed with
   all-MiniLM-L6-v2 → `.obp`):
   - one brain: `npx tsx server/scripts/buildBrains.ts <slug>`
   - all: `pnpm brains:build:all`
   Output: `brains/<slug>.obp`.
4. **Import** into a running instance: `brains.importBuiltins` (Brains manager UI →
   "Built-ins", or `BrainPackService.importBuiltins(userId)`). Re-import replaces the
   prior copy, so rebuild → re-import to iterate.
5. **Evaluate — this is not optional.** A brain that doesn't measurably help is worse than
   none (it spends tokens). Prove it lifts a small model *on tasks in its domain*:
   ```
   BENCH_TIER=hard BENCH_BRAIN=<slug> OLLAMA_BASE_URL=http://<gpu-node>:11434 \
     npx tsx server/scripts/benchmark-agentic.ts
   ```
   Compare the `empowered+brain` arm to the `empowered` (no-brain) arm on the SAME run.
   **If it's a draw, the charter is missing the reasoning base or the domain layer is
   noise** — fix the charter, don't add more corpus.

---

## Pitfalls (each one cost real measurement)

- **Domain knowledge alone doesn't lift reason-hard work.** Always build on
  `REASONING_BASE`. A charter that is only "validate input / escape HTML / write tests"
  teaches standards, not a solving process, and scores a draw.
- **Over-instruction degrades small-model tool use (TD-060).** A charter that demands
  "plan, present the plan, confirm with the user, track a TODO.md" *on every turn* makes a
  7B over-elaborate on simple tasks — it inflated a long-horizon run from ~12 steps to the
  40-step ceiling and dropped accuracy. `REASONING_BASE` is already **proportional** ("a
  simple task is done directly; reserve the discipline for multi-step work") — keep the
  domain layer proportional too. Never tell an autonomous headless agent to "confirm with
  the user" or "make a TODO.md" for a one-shot task.
- **Put always-true rules in the charter, look-up facts in the corpus.** The charter is
  paid every turn; the corpus is retrieved only when relevant. Mis-placing bloats every
  request or buries the fact where retrieval won't find it.
- **Keep each corpus fact to one chunk (<1500 chars).** A fact that spills into two chunks
  retrieves half of itself.
- **Test with a real small model + the tool loop**, not by eyeballing the charter. The
  only proof a brain helps is a measured lift over the no-brain arm.

---

## Reference

- Base: `brains/sources/_reasoning-base.ts` · Types: `brains/sources/_types.ts` ·
  Exemplar: `brains/sources/coding.ts` · Registry: `brains/sources/index.ts`
- Pipeline: `BrainAuthoringService.authorPack` · Build: `server/scripts/buildBrains.ts` ·
  Import/manage: `BrainPackService` · Injection at inference: `server/_core/brainContext.ts`
- Eval: `server/scripts/benchmark-agentic.ts` (`BENCH_BRAIN=<slug>`), `server/scripts/evalBrain.ts`
- Background: `LOCAL_MODEL_EMPOWERMENT.md` §8, `Context/Tracker-Docs/Tech-Debt.md` TD-060.
