/**
 * @file brains/sources/index.ts
 * @description Registry of every built-in Brain Pack's curated source content
 * (Brains-Upgrade Phase 6 — "Team of Experts").
 *
 * The single source of truth the build script (server/scripts/buildBrains.ts)
 * and the eval harness read to (re)build and grade every shipped `.obp`. Each
 * entry is a reviewable, diffable TS module producing exactly one pack.
 *
 * Only the **Omnecor Expert** is intentionally Omnecor-specific; the rest are
 * general-purpose experts usable by any local model on any project (the
 * **Generalist** additionally knows Omnecor's empowerment ecosystem so it can
 * steer a model toward the right layer).
 */
import type { BrainSourceModule } from "./_types.js";

import { CODING_CHARTER, CODING_SOURCES } from "./coding.js";
import { SOFTWARE_ARCHITECT_CHARTER, SOFTWARE_ARCHITECT_SOURCES } from "./software-architect.js";
import { OMNECOR_EXPERT_CHARTER, OMNECOR_EXPERT_SOURCES } from "./omnecor-expert.js";
import { PCB_ENGINEER_CHARTER, PCB_ENGINEER_SOURCES } from "./pcb-engineer.js";
import { MODELER_3D_CHARTER, MODELER_3D_SOURCES } from "./3d-modeler.js";
import { AUDIO_PRODUCER_CHARTER, AUDIO_PRODUCER_SOURCES } from "./audio-producer.js";
import { CONTENT_WRITER_CHARTER, CONTENT_WRITER_SOURCES } from "./content-writer.js";
import { WORKFLOW_BLUEPRINTER_CHARTER, WORKFLOW_BLUEPRINTER_SOURCES } from "./workflow-blueprinter.js";
import { GENERALIST_CHARTER, GENERALIST_SOURCES } from "./generalist.js";

export const BRAIN_MODULES: BrainSourceModule[] = [
  {
    slug: "coding",
    id: "omnecor-coding",
    name: "Coding",
    domain: "coding",
    description:
      "Curated, durable software-engineering reference: language pitfalls, async/" +
      "concurrency, security, algorithms & complexity, SQL, git, testing, and API design.",
    charter: CODING_CHARTER,
    sources: CODING_SOURCES,
  },
  {
    slug: "software-architect",
    id: "omnecor-software-architect",
    name: "Software Architect",
    domain: "software-architecture",
    description:
      "Senior full-stack engineering for the modern TypeScript stack: React, Node.js, " +
      "tRPC, Drizzle ORM, system design, and testing conventions.",
    charter: SOFTWARE_ARCHITECT_CHARTER,
    sources: SOFTWARE_ARCHITECT_SOURCES,
  },
  {
    slug: "omnecor-expert",
    id: "omnecor-expert",
    name: "Omnecor Expert",
    domain: "omnecor",
    description:
      "Master of Omnecor's own architecture: server boundaries, tRPC tiers, Sovereign " +
      "security gates, the unified libSQL engine, OMMESH, core services, and the Brains subsystem.",
    charter: OMNECOR_EXPERT_CHARTER,
    sources: OMNECOR_EXPERT_SOURCES,
  },
  {
    slug: "pcb-engineer",
    id: "omnecor-pcb-engineer",
    name: "PCB & Schematics Engineer",
    domain: "pcb-hardware",
    description:
      "Hardware design: KiCad workflow, schematic capture, footprints, PCB layout, routing, " +
      "signal/power integrity, RF, components, and design-for-manufacture.",
    charter: PCB_ENGINEER_CHARTER,
    sources: PCB_ENGINEER_SOURCES,
  },
  {
    slug: "3d-modeler",
    id: "omnecor-3d-modeler",
    name: "3D Modeler",
    domain: "3d-modeling",
    description:
      "3D generation and spatial math: Blender modeling & scripting, Three.js/WebGL, meshes, " +
      "transforms, materials/PBR, the OpenGL pipeline, and real-time rendering.",
    charter: MODELER_3D_CHARTER,
    sources: MODELER_3D_SOURCES,
  },
  {
    slug: "audio-producer",
    id: "omnecor-audio-producer",
    name: "Audio & Podcast Producer",
    domain: "audio",
    description:
      "Text-to-speech and audio production: SSML pacing, voice selection, digital-audio " +
      "fundamentals, cleanup, loudness/LUFS mastering, and multi-speaker podcast production.",
    charter: AUDIO_PRODUCER_CHARTER,
    sources: AUDIO_PRODUCER_SOURCES,
  },
  {
    slug: "content-writer",
    id: "omnecor-content-writer",
    name: "Content Writer",
    domain: "writing",
    description:
      "Technical writing and documentation: clear concise prose, Markdown structure, " +
      "information architecture (README/Diátaxis), UI microcopy, and editing.",
    charter: CONTENT_WRITER_CHARTER,
    sources: CONTENT_WRITER_SOURCES,
  },
  {
    slug: "workflow-blueprinter",
    id: "omnecor-workflow-blueprinter",
    name: "Workflow Blueprinter",
    domain: "workflow",
    description:
      "Node-based graphs and execution logic: DAGs, data flow, fan-out/fan-in, idempotency, " +
      "retries/backoff, scheduling, observability, and workflow design.",
    charter: WORKFLOW_BLUEPRINTER_CHARTER,
    sources: WORKFLOW_BLUEPRINTER_SOURCES,
  },
  {
    slug: "generalist",
    id: "omnecor-generalist",
    name: "Generalist",
    domain: "general",
    description:
      "General-purpose operating discipline for any task: plan-before-acting, TODO.md tracking, " +
      "edge-case and vulnerability reasoning, verify-don't-guess, the Team-of-Experts roster, " +
      "Omnecor's empowerment layers, and Guided Walkthrough escalation.",
    charter: GENERALIST_CHARTER,
    sources: GENERALIST_SOURCES,
  },
];

/** Look up a single brain module by its slug (the `.obp` file stem). */
export function getBrainModule(slug: string): BrainSourceModule | undefined {
  return BRAIN_MODULES.find(m => m.slug === slug);
}
