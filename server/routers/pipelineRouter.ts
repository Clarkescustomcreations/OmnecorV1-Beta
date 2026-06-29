import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc.js";
import { createLogger } from "../_core/logger.js";
const log = createLogger("pipelineRouter");

export const pipelineRouter = router({
  createPipeline: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1),
        goal: z.string().min(10),
        projectId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.pipeline.createPipeline(
        input.name,
        input.goal,
        ctx.user!.id,
        input.projectId
      );
    }),
  getPipeline: protectedProcedure
    .input(z.object({ pipelineId: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await ctx.services.pipeline.getPipeline(input.pipelineId);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Pipeline not found" });
      return result;
    }),
  listPipelines: protectedProcedure.query(async ({ ctx }) => {
    return ctx.services.pipeline.listPipelines(ctx.user!.id);
  }),
  approvePhase: protectedProcedure
    .input(
      z.object({
        pipelineId: z.string(),
        phase: z.enum(["DEFINE", "PLAN", "EXECUTE", "REVIEW", "SHIP"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const approved = await ctx.services.hitl.requestApproval(
        "pipeline.approvePhase",
        {
          pipelineId: input.pipelineId,
          phase: input.phase,
        },
        "command"
      );
      if (!approved) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "HITL approval denied for pipeline phase.",
        });
      }
      ctx.services.auditLog
        .log({
          eventType: "pipeline_phase_approve",
          actorId: ctx.user!.id,
          actorType: "user",
          procedure: "pipeline.approvePhase",
          args: { pipelineId: input.pipelineId, phase: input.phase },
          result: null,
          ipAddress: ctx.req.ip ?? null,
          sessionId: null,
        })
        .catch((err) => log.error("[AuditLog] write failed — event lost", err));
      return ctx.services.pipeline.approvePhase(
        input.pipelineId,
        input.phase,
        ctx.user!.id
      );
    }),
  abortPipeline: protectedProcedure
    .input(z.object({ pipelineId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      ctx.services.auditLog
        .log({
          eventType: "pipeline_abort",
          actorId: ctx.user!.id,
          actorType: "user",
          procedure: "pipeline.abortPipeline",
          args: { pipelineId: input.pipelineId },
          result: null,
          ipAddress: ctx.req.ip ?? null,
          sessionId: null,
        })
        .catch((err) => log.error("[AuditLog] write failed — event lost", err));
      return ctx.services.pipeline.abortPipeline(input.pipelineId);
    }),
});
