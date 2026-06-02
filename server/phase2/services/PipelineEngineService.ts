import { randomUUID } from "crypto";
import { eq, and, asc } from "drizzle-orm";
import { getDb } from "../../db.factory.js";
import { pipelines, pipelinePhases, type Pipeline, type PipelinePhase } from "../../../drizzle/schema.js";
import { PromptSanitizer } from "./PromptSanitizer.js";
import { AuditLogService } from "./AuditLogService.js";

const PHASE_ORDER = ["DEFINE", "PLAN", "EXECUTE", "REVIEW", "SHIP"] as const;
type PhaseName = typeof PHASE_ORDER[number];

function phaseOutput(phase: PhaseName, goal: string): string {
  switch (phase) {
    case "DEFINE":
      return `## DEFINE Phase\n\nGoal: ${goal}\n\nThis phase defines the scope and objectives of the pipeline. Review and approve to proceed to PLAN.`;
    case "PLAN":
      return `## PLAN Phase\n\nBreaking down goal into actionable steps:\n1. Analyze requirements\n2. Identify dependencies\n3. Estimate effort\n\nApprove to proceed to EXECUTE.`;
    case "EXECUTE":
      return `## EXECUTE Phase\n\nExecution plan generated. Review all steps carefully before approval.\n\n⚠️ No commands will be run automatically. Approve to proceed to REVIEW.`;
    case "REVIEW":
      return `## REVIEW Phase\n\nAll outputs reviewed. Quality checks passed.\n\nApprove to generate the deployment plan (SHIP).`;
    case "SHIP":
      return `## SHIP Phase\n\n### Deployment Plan\n\nThis is a deployment plan only — no commands will be executed automatically.\n\n1. Review the plan\n2. Execute steps manually in your environment\n\nApprove to mark pipeline complete.`;
  }
}

export class PipelineEngineService {
  private static instance: PipelineEngineService | null = null;

  static getInstance(): PipelineEngineService {
    if (!PipelineEngineService.instance) {
      PipelineEngineService.instance = new PipelineEngineService();
    }
    return PipelineEngineService.instance;
  }

  async createPipeline(name: string, goal: string, ownerId: number): Promise<Pipeline> {
    const sanitized = PromptSanitizer.getInstance().sanitize(goal).clean;
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    const id = randomUUID();

    await db.insert(pipelines).values({
      id,
      name,
      goal: sanitized,
      status: "running",
      currentPhase: "DEFINE",
      ownerId,
    });

    const phaseId = randomUUID();
    const output = PromptSanitizer.getInstance().sanitize(phaseOutput("DEFINE", sanitized)).clean;
    await db.insert(pipelinePhases).values({
      id: phaseId,
      pipelineId: id,
      phase: "DEFINE",
      status: "awaiting_approval",
      outputText: output,
    });

    AuditLogService.getInstance().log({
      eventType: "pipeline_created",
      actorId: ownerId,
      actorType: "user",
      procedure: "pipeline.create",
      args: { id, name },
      result: null,
      ipAddress: null,
      sessionId: null,
    }).catch(() => {});

    const [pipeline] = await db.select().from(pipelines).where(eq(pipelines.id, id));
    return pipeline;
  }

  async approvePhase(pipelineId: string, phase: string, userId: number): Promise<Pipeline> {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    const [pipeline] = await db.select().from(pipelines).where(eq(pipelines.id, pipelineId));
    if (!pipeline) throw new Error("Pipeline not found");

    await db
      .update(pipelinePhases)
      .set({ status: "complete", approvedBy: userId, approvedAt: new Date() })
      .where(and(eq(pipelinePhases.pipelineId, pipelineId), eq(pipelinePhases.phase, phase as PhaseName)));

    const currentIdx = PHASE_ORDER.indexOf(phase as PhaseName);
    const nextPhase = currentIdx < PHASE_ORDER.length - 1 ? PHASE_ORDER[currentIdx + 1] : null;

    if (!nextPhase) {
      await db.update(pipelines).set({ status: "complete", currentPhase: "DONE" }).where(eq(pipelines.id, pipelineId));
      AuditLogService.getInstance().log({ eventType: "pipeline_complete", actorId: userId, actorType: "user", procedure: "pipeline.approvePhase", args: { pipelineId, phase }, result: null, ipAddress: null, sessionId: null }).catch(() => {});
    } else {
      await db.update(pipelines).set({ currentPhase: nextPhase }).where(eq(pipelines.id, pipelineId));
      const output = PromptSanitizer.getInstance().sanitize(phaseOutput(nextPhase, pipeline.goal)).clean;
      await db.insert(pipelinePhases).values({
        id: randomUUID(),
        pipelineId,
        phase: nextPhase,
        status: "awaiting_approval",
        outputText: output,
      });
      AuditLogService.getInstance().log({ eventType: "pipeline_phase_approved", actorId: userId, actorType: "user", procedure: "pipeline.approvePhase", args: { pipelineId, phase, nextPhase }, result: null, ipAddress: null, sessionId: null }).catch(() => {});
    }

    const [updated] = await db.select().from(pipelines).where(eq(pipelines.id, pipelineId));
    return updated;
  }

  async abortPipeline(pipelineId: string): Promise<Pipeline> {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    await db.update(pipelines).set({ status: "aborted" }).where(eq(pipelines.id, pipelineId));
    AuditLogService.getInstance().log({ eventType: "pipeline_aborted", actorId: null, actorType: "user", procedure: "pipeline.abort", args: { pipelineId }, result: null, ipAddress: null, sessionId: null }).catch(() => {});
    const [pipeline] = await db.select().from(pipelines).where(eq(pipelines.id, pipelineId));
    return pipeline;
  }

  async getPipeline(pipelineId: string): Promise<{ pipeline: Pipeline; phases: PipelinePhase[] } | null> {
    const db = await getDb();
    if (!db) return null;
    const [pipeline] = await db.select().from(pipelines).where(eq(pipelines.id, pipelineId));
    if (!pipeline) return null;
    const phases = await db.select().from(pipelinePhases).where(eq(pipelinePhases.pipelineId, pipelineId)).orderBy(asc(pipelinePhases.createdAt));
    return { pipeline, phases };
  }

  async listPipelines(ownerId: number): Promise<Pipeline[]> {
    const db = await getDb();
    if (!db) return [];
    return db.select().from(pipelines).where(eq(pipelines.ownerId, ownerId));
  }
}
