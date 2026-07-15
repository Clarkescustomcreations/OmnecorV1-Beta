/**
 * @file brains/eval/index.ts
 * @description Registry of every built-in brain's A/B eval question set
 * (Brains-Upgrade Phase 6). Consumed by server/scripts/evalBrain.ts.
 */
import type { EvalSpec } from "./_types.js";

import coding from "./coding.cases.js";
import softwareArchitect from "./software-architect.cases.js";
import omnecorExpert from "./omnecor-expert.cases.js";
import pcbEngineer from "./pcb-engineer.cases.js";
import modeler3d from "./3d-modeler.cases.js";
import audioProducer from "./audio-producer.cases.js";
import contentWriter from "./content-writer.cases.js";
import workflowBlueprinter from "./workflow-blueprinter.cases.js";

export const EVAL_SPECS: EvalSpec[] = [
  coding,
  softwareArchitect,
  omnecorExpert,
  pcbEngineer,
  modeler3d,
  audioProducer,
  contentWriter,
  workflowBlueprinter,
];

export function getEvalSpec(slug: string): EvalSpec | undefined {
  return EVAL_SPECS.find(s => s.slug === slug);
}
