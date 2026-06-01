import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc.js";
import { ValetRouterService } from "../phase2/services/ValetRouterService.js";

export const valetRouter = router({
  status: protectedProcedure.query(async () => {
    const svc = ValetRouterService.getInstance();
    const available = await svc.isAvailable();
    return { available, url: process.env.VALET_ROUTER_URL ?? "http://127.0.0.1:8010" };
  }),

  getModes: protectedProcedure.query(async () => {
    const svc = ValetRouterService.getInstance();
    const modes = await svc.getModes();
    return { modes };
  }),

  testRoute: protectedProcedure
    .input(z.object({
      task: z.string().min(1).max(2000),
      preferredMode: z.enum([
        "api_direct", "valet_background", "local_omesh", "main_api",
        "multi_api", "main_api_omesh", "multi_api_omesh", "moe_chain",
        "moe_chain_omesh", "multi_task",
      ]).optional(),
      availableProviders: z.array(z.string()).optional(),
    }))
    .mutation(async ({ input }) => {
      const svc = ValetRouterService.getInstance();
      const decision = await svc.route({
        task: input.task,
        preferredMode: input.preferredMode,
        availableProviders: input.availableProviders,
        taskType: "chat",
      });
      return decision;
    }),
});
