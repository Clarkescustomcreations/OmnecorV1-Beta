/**
 * @file server/phase2/routers/agentRouter.ts
 * @description Omnecor — Agent Orchestration Router
 */

import { z } from "zod";
import { router, publicProcedure } from "../../_core/trpc.js";

const agentTaskSchema = z.object({
  type: z.enum(["crewai", "liteagent", "n8n"]),
  goal: z.string(),
  backstory: z.string().optional(),
  tools: z.array(z.string()).optional(),
  workflowId: z.string().optional(),
  input: z.record(z.any()).optional(),
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
});
