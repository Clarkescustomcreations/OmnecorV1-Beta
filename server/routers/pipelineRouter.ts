import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc.js";
import { PipelineEngineService } from "../phase2/services/PipelineEngineService.js";
import { AuditLogService } from "../phase2/services/AuditLogService.js";
import { HITLApprovalService } from "../phase2/services/HITLApprovalService.js";

export const pipelineRouter = router({
  createPipeline: protectedProcedure
    .input(z.object({ name: z.string().min(1), goal: z.string().min(10) }))
    .mutation(async ({ ctx, input }) => {
      return PipelineEngineService.getInstance().createPipeline(input.name, input.goal, ctx.user!.id);
    }),
  getPipeline: protectedProcedure
    .input(z.object({ pipelineId: z.string() }))
    .query(async ({ input }) => {
      const result = await PipelineEngineService.getInstance().getPipeline(input.pipelineId);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Pipeline not found" });
      return result;
    }),
  listPipelines: protectedProcedure.query(async ({ ctx }) => {
    return PipelineEngineService.getInstance().listPipelines(ctx.user!.id);
  }),
  approvePhase: protectedProcedure
    .input(z.object({
      pipelineId: z.string(),
      phase: z.enum(["DEFINE", "PLAN", "EXECUTE", "REVIEW", "SHIP"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const approved = await HITLApprovalService.getInstance().requestApproval("pipeline.approvePhase", {
        pipelineId: input.pipelineId,
        phase: input.phase,
      }, "command");
      if (!approved) throw new TRPCError({ code: "FORBIDDEN", message: "HITL approval denied for pipeline phase." });
      AuditLogService.getInstance().log({
        eventType: "pipeline_phase_approve",
        actorId: ctx.user!.id,
        actorType: "user",
        procedure: "pipeline.approvePhase",
        args: { pipelineId: input.pipelineId, phase: input.phase },
        result: null,
        ipAddress: ctx.req.ip ?? null,
        sessionId: null,
      }).catch((err) => console.warn("[AuditLog] write failed:", err));
      return PipelineEngineService.getInstance().approvePhase(input.pipelineId, input.phase, ctx.user!.id);
    }),
  abortPipeline: protectedProcedure
    .input(z.object({ pipelineId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      AuditLogService.getInstance().log({
        eventType: "pipeline_abort",
        actorId: ctx.user!.id,
        actorType: "user",
        procedure: "pipeline.abortPipeline",
        args: { pipelineId: input.pipelineId },
        result: null,
        ipAddress: ctx.req.ip ?? null,
        sessionId: null,
      }).catch((err) => console.warn("[AuditLog] write failed:", err));
      return PipelineEngineService.getInstance().abortPipeline(input.pipelineId);
    }),
});
