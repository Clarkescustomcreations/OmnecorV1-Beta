# Dataset Generation

How the full training set is assembled from the seeds + live Omnecor sources, and the
exact format the trainer consumes. This supersedes the routing-only logic in the
current `valet_dataset_builder.py` (which must be upgraded — VALET-todo Phase B).

---

## 1. Inputs (sources of truth)

| Source | Feeds | Behavior class |
|---|---|---|
| `seed/routing.seed.jsonl` + `routing_manifest.json` | routing decisions | `route` |
| `seed/omnecor_qa.seed.jsonl` + `OMNECOR_KNOWLEDGE_BASE.md` | expert Q&A | `qa` |
| `seed/hardcoded_rules.seed.jsonl` + `HARDCODED_RULES.md` | rule enforcement | `rules` |
| `seed/plan_mode.seed.jsonl` | /plan interviews | `plan` |
| `seed/skills.seed.jsonl` | skill offers | `skill` |

> **KB is the single QA source.** The builder generates `qa` pairs **only** from
> `OMNECOR_KNOWLEDGE_BASE.md` (`extract_kb_bullets` → `make_qa_from_bullet`). It does **not**
> crawl `docs/**` or `README.md`. So anything you want the Valet to answer must be distilled
> into the knowledge base — that's why the wider product docs are kept current and then
> hand-distilled into `OMNECOR_KNOWLEDGE_BASE.md` (setup, navigation, troubleshooting,
> features). *(Auto-ingesting `docs/**` is possible future work; it is not implemented today.)*

> **"Pull and update"**: the generator reads the **live** manifest and knowledge base
> at build time. When you update a model name or a feature fact, the next dataset build
> reflects it. Facts are never frozen only in weights.

## 2. Target mix (per ~10k-example build)

| Class | Share | Why |
|---|---|---|
| `route` | 55% | Routing is the primary job; needs the most coverage + 10% hard negatives. |
| `qa` | 20% | Omnecor expertise. |
| `rules` | 10% | todo/status enforcement reflexes. |
| `plan` | 10% | /plan interview behavior. |
| `skill` | 5% | skill-offer reflex. |

Balance `route` examples across **all 13 manifest categories** (including the new
`context_management` and `memory_operations`) **and** all three execution modes (include
Sovereign-forces-local, no-keys→Guided-Walk-Through, and no-provider-available cases where
the requested provider is absent from `available_providers`).

> **Verify, don't assume:** percentages on a 10k build look fine on paper but a category
> can still come out thin. After generation, read `metadata.json` per-class/per-category
> counts and **flag any behavior class or route category below ~500 absolute examples**
> (especially the boundary-ambiguous pairs: synthesis vs. knowledge_retrieval,
> local_task vs. integration, context_management vs. synthesis, memory_operations vs.
> knowledge_retrieval). Top up seeds for any thin category and regenerate.

## 3. Augmentation (multiply the seeds)

For each seed, generate paraphrases/variants using the local Ollama oracle (reuse the
existing `ollama_generate()` helper):

- **route**: generate new realistic user prompts per category (existing `PROMPT_SEEDS`
  approach), then attach the **manifest-derived** decision (don't ask the oracle to
  pick the model — look it up in `routing_manifest.json` so labels are correct and
  consistent). Add 10% hard negatives (near-miss category, corrected label).
- **qa**: for each knowledge-base bullet, have the oracle phrase 2–4 natural questions;
  the answer is the bullet text (lightly rewritten). This keeps answers factual. Cover
  **two tiers**: (1) *system knowledge* (execution modes, Brain Map, OMMESH, database,
  Honcho, security) and (2) *user-workflow / UI / troubleshooting* ("how do I switch to
  Sovereign mode?", "where's the Fiction Mode toggle?", "what is the yellow banner?",
  "my PeerCard shows no peers — why?", "how do I free up context tokens?"). The original
  seeds were system-only; the second tier must be seeded explicitly (see
  `omnecor_qa.seed.jsonl`).
- **rules / plan / skill**: paraphrase the seed user turns; keep assistant outputs
  faithful to the seed behavior (don't let the oracle invent — use it only to vary the
  user phrasing).

Determinism: fix `random.seed` and record the oracle model + manifest version in the
dataset `metadata.json`.

## 4. The `text` field (REQUIRED — fixes M3)

Every row must include a preformatted `text` field in **Qwen2.5 ChatML**, because the
trainer reads `dataset_text_field="text"`. Build it as:

```
<|im_start|>system
{SYSTEM_PROMPT with {{ROUTING_MANIFEST}} and {{RAG_CONTEXT}} filled}
<|im_end|>
<|im_start|>user
{input}
<|im_end|>
<|im_start|>assistant
{output}
<|im_end|>
```

- For `route` rows, fill `{{ROUTING_MANIFEST}}` with a **compact JSON snapshot** of the
  manifest categories, and leave `{{RAG_CONTEXT}}` empty.
- For `qa` rows, fill `{{RAG_CONTEXT}}` with the source knowledge-base bullet(s) (teaches
  the model to use retrieved context), and include a compact manifest.
- For `rules/plan/skill` rows, fill context as relevant; manifest may be omitted/compact.

Keep `instruction/input/output` in the row too (for review + regeneration); only `text`
is trained on.

## 5. Validation split + holdout

- 90/10 train/val split (the existing builder already does this).
- Additionally hold out a **stratified eval set** (≥ 30 per category for `route`) used
  by `valet_eval.py` to compute per-category accuracy and compare against the keyword
  baseline (Phase 4 gate).

## 6. Build command (target)

After the Phase-B upgrade, one command produces everything:

```bash
# env: OLLAMA_URL, ORACLE_MODEL, EXAMPLES_PER_CATEGORY
python3 server/python_bridges/valet_dataset_builder.py \
  --seeds docs/ai-agents/valet-training/seed \
  --manifest docs/ai-agents/valet-training/routing_manifest.json \
  --knowledge docs/ai-agents/valet-training/OMNECOR_KNOWLEDGE_BASE.md \
  --system-prompt docs/ai-agents/valet-training/VALET_SYSTEM_PROMPT.md \
  --out data/valet/train.jsonl --val-out data/valet/val.jsonl --emit-text
```

`--emit-text` is the flag that writes the ChatML `text` field. Outputs land under
`data/valet/` (git-ignored).

## 7. Required code changes (tracked in VALET-todo Phase B)

1. Extend `valet_dataset_builder.py` to: load seeds, read manifest + knowledge base,
   generate all five classes (not just routing), emit the canonical schema (§ IO_CONTRACT
   §3), and write the `text` field.
2. Replace the builder's ad-hoc category list with the manifest categories.
3. Emit `metadata.json` (seed counts per class, manifest_version, oracle model, seed).
