/**
 * @file server/phase2/routers/agentRouter.ts
 * @description Omnecor — Agent Orchestration Router
 */

import { z } from "zod";
import { router, publicProcedure, protectedProcedure } from "../../_core/trpc.js";
import { TRPCError } from "@trpc/server";
import { AuditLogService } from "../services/AuditLogService.js";

const agentTaskSchema = z.object({
  type: z.enum(["crewai", "liteagent", "n8n"]),
  goal: z.string().min(1),
  backstory: z.string().optional(),
  tools: z.array(z.string()).optional(),
  workflowId: z.string().optional(),
  input: z.record(z.string(), z.any()).optional(),
});

export const agentRouter = router({
  /**
   * Run a CrewAI crew.
   */
  runCrew: publicProcedure
    .input(agentTaskSchema)
    .mutation(async ({ ctx, input }) => {
      return ctx.services.agent.runCrew(input);
    }),

  /**
   * Run a LiteAgent task.
   */
  runLiteAgent: publicProcedure
    .input(agentTaskSchema)
    .mutation(async ({ ctx, input }) => {
      return ctx.services.agent.runLiteAgent(input);
    }),

  /**
   * Trigger an n8n webhook.
   */
  triggerN8n: publicProcedure
    .input(agentTaskSchema)
    .mutation(async ({ ctx, input }) => {
      return ctx.services.agent.triggerN8n(input);
    }),

  /**
   * Launch a RecursiveMAS crew.
   * HITL gate: requires manual approval when agentIds.length > 3 (high risk).
   */
  runRecursiveMAS: protectedProcedure
    .input(
      z.object({
        goal: z.string().min(1),
        agentIds: z.array(z.string()),
        maxIterations: z.number().int().min(1).max(50).optional(),
        mode: z.enum(["sequential", "hierarchical", "parallel"]).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // HITL gate for high-risk large crews
      if (input.agentIds.length > 3) {
        const approved = await ctx.services.hitl.requestApproval(
          "agent.runRecursiveMAS",
          {
            goal: input.goal,
            agentCount: input.agentIds.length,
            riskLevel: "high",
          }
        );
        if (!approved) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "RecursiveMAS crew execution rejected by HITL approval gate.",
          });
        }
      }

      await AuditLogService.getInstance().log({
        eventType: "agent_recursive_mas_spawn",
        actorId: ctx.user.id,
        actorType: "user",
        procedure: "agent.runRecursiveMAS",
        args: {
          goal: input.goal.slice(0, 200),
          agentCount: input.agentIds.length,
          mode: input.mode ?? "sequential",
        } as Record<string, unknown>,
        result: null,
        ipAddress: ctx.req.ip ?? ctx.req.socket?.remoteAddress ?? null,
        sessionId: null,
      }).catch(() => {});

      const jobId = await ctx.services.agent.runRecursiveMAS(input);
      return { jobId };
    }),

  /**
   * Get the status of a RecursiveMAS crew job.
   */
  getRecursiveMASStatus: protectedProcedure
    .input(z.object({ jobId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.services.agent.getRecursiveMASStatus(input.jobId);
    }),
});
