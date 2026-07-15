/**
 * @file brains/eval/_types.ts
 * @description Shared types for the generalized Brain-Pack A/B eval harness
 * (Brains-Upgrade Phase 6 — "repeat Phase 6 for all brains").
 *
 * Each built-in brain has a matching `<slug>.cases.ts` question set. The harness
 * (server/scripts/evalBrain.ts) runs the SAME local model on the SAME base
 * system prompt at temperature 0 for each question, changing exactly ONE
 * variable — whether the brain's charter + top-k retrieved corpus is injected —
 * and grades answers by objective fact-coverage.
 */

export interface EvalCase {
  /** The question posed to the model. */
  q: string;
  /**
   * Expected facts. Each entry is a GROUP of accepted substrings (synonyms);
   * ANY match counts that fact as covered. Matching is case-insensitive.
   */
  facts: string[][];
}

export interface EvalSpec {
  /** The `.obp` file stem under brains/ (e.g. "pcb-engineer" → brains/pcb-engineer.obp). */
  slug: string;
  /** Human name for the report header. */
  name: string;
  /**
   * The local model to grade with, held CONSTANT across baseline vs brain.
   * Code domains use a coder model; general domains use a general instruct model.
   * Overridable per-run via OMNECOR_EVAL_MODEL.
   */
  model: string;
  /** The base system prompt — IDENTICAL in both conditions. */
  baseSystem: string;
  /** The graded questions. */
  cases: EvalCase[];
}
