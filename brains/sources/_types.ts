/**
 * @file brains/sources/_types.ts
 * @description Shared shape for a built-in Brain Pack's curated source content
 * (Brains-Upgrade Phase 6 — "Team of Experts").
 *
 * Every built-in expert brain is authored as a reviewable, diffable TS module
 * (not just a compiled `.obp`) so the corpus is version-controlled and rebuildable
 * through the REAL pipeline (`BrainAuthoringService.authorPack` → on-device embed
 * → pack). This mirrors the Coding exemplar (`brains/sources/coding.ts`).
 *
 * Design contract, identical to the Coding brain:
 *  - Each {@link BrainFact} is a small, self-contained, durable reference fact.
 *  - Keep every `text` well under the 1500-char chunk size so each fact maps to
 *    exactly ONE corpus chunk — a clean 1:1 mapping that makes top-k retrieval
 *    crisp and the `[Brain: <name> · <fact.name>]` citation meaningful.
 *  - Content is original (no third-party text copied) so it ships CC0.
 */

export interface BrainFact {
  /** Stable, kebab-case label → becomes the chunk's `sourcePath` + citation. */
  name: string;
  /** One durable fact. Keep < 1500 chars so it is exactly one chunk. */
  text: string;
}

export interface BrainSourceModule {
  /** File stem + `.obp` name (e.g. "pcb-engineer" → brains/pcb-engineer.obp). */
  slug: string;
  /** Stable pack id (manifest.id / PK). */
  id: string;
  /** Human display name. */
  name: string;
  /** Domain tag recorded in the manifest + used for Valet category alignment. */
  domain: string;
  /** One-line pack description. */
  description: string;
  /** Always-on skills/rules text (prompt-prepended, budget-clipped). */
  charter: string;
  /** Curated corpus — one durable fact per entry (retrieved top-k). */
  sources: BrainFact[];
}
