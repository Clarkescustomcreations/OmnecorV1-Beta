import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc.js";
import { MCPClientService } from "../phase2/services/MCPClientService.js";
import { AuditLogService } from "../phase2/services/AuditLogService.js";

export const mcpRouter = router({
  listConnectedServers: protectedProcedure.query(() => {
    return MCPClientService.getInstance().listConnectedServers();
  }),
  connectServer: protectedProcedure
    .input(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        transport: z.enum(["stdio", "websocket"]),
        command: z.string().optional(),
        args: z.array(z.string()).optional(),
        url: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await MCPClientService.getInstance().connectServer(input);
      AuditLogService.getInstance()
        .log({
          eventType: "mcp_server_connect",
          actorId: ctx.user!.id,
          actorType: "user",
          procedure: "mcp.connectServer",
          args: { id: input.id, name: input.name, transport: input.transport },
          result: null,
          ipAddress: ctx.req.ip ?? null,
          sessionId: null,
        })
        .catch(() => {});
      return { connected: true };
    }),
  disconnectServer: protectedProcedure
    .input(z.object({ serverId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await MCPClientService.getInstance().disconnectServer(input.serverId);
      AuditLogService.getInstance()
        .log({
          eventType: "mcp_server_disconnect",
          actorId: ctx.user!.id,
          actorType: "user",
          procedure: "mcp.disconnectServer",
          args: { serverId: input.serverId },
          result: null,
          ipAddress: ctx.req.ip ?? null,
          sessionId: null,
        })
        .catch(() => {});
      return { disconnected: true };
    }),
  listTools: protectedProcedure
    .input(z.object({ serverId: z.string().optional() }))
    .query(({ input }) => {
      return MCPClientService.getInstance().listTools(input.serverId);
    }),
  callTool: protectedProcedure
    .input(
      z.object({
        serverId: z.string(),
        toolName: z.string(),
        args: z.record(z.string(), z.unknown()),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const tools = MCPClientService.getInstance().listTools(input.serverId);
      const tool = tools.find(t => t.name === input.toolName);

      if (tool?.dangerous) {
        const approved = await ctx.services.hitl.requestApproval("mcp.callTool", {
          serverId: input.serverId,
          toolName: input.toolName,
          args: input.args,
          riskLevel: "high",
        });
        if (!approved) {
          throw new TRPCError({ code: "FORBIDDEN", message: "HITL approval denied for dangerous MCP tool." });
        }
      }

      const sanitized = ctx.services.promptSanitizer.sanitize(JSON.stringify(input.args));
      const safeArgs = JSON.parse(sanitized.clean) as Record<string, unknown>;

      return ctx.services.agent.callMCPTool(input.serverId, input.toolName, safeArgs);
    }),
  agenticOsStatus: protectedProcedure.query(() => ({
    configured: MCPClientService.getInstance().isAgenticOsConfigured(),
  })),
});
