import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc.js";
import { MCPClientService } from "../phase2/services/MCPClientService.js";
import { AuditLogService } from "../phase2/services/AuditLogService.js";
import { createLogger } from "../_core/logger.js";
const log = createLogger("mcpRouter");

export const mcpRouter = router({
  listConnectedServers: protectedProcedure.query(() => {
    return MCPClientService.getInstance().listConnectedServers();
  }),
  // Connecting an stdio MCP server spawns a local OS process (the command/args
  // are user-supplied). That is arbitrary local code execution by design, so it
  // is gated behind admin/owner. The basename whitelist in MCPClientService is a
  // secondary guard, not the authorization boundary.
  connectServer: adminProcedure
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
      if (ctx.user?.executionMode === "sovereign" && input.transport === "websocket" && input.url) {
        try {
          const parsedUrl = new URL(input.url);
          const hostname = parsedUrl.hostname;
          const isLocal = hostname === "localhost" || hostname === "127.0.0.1" || hostname.endsWith(".local");
          if (!isLocal) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "Sovereign mode: remote MCP connections are disabled.",
            });
          }
        } catch (err) {
          if (err instanceof TRPCError) throw err;
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Invalid websocket URL.",
          });
        }
      }

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
        .catch((err) => log.error("[AuditLog] write failed — event lost", err));
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
        .catch((err) => log.error("[AuditLog] write failed — event lost", err));
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
      const config = MCPClientService.getInstance().listConnectedServers().find(c => c.id === input.serverId);
      if (ctx.user?.executionMode === "sovereign" && config) {
        if (config.transport === "websocket" && config.url) {
          try {
            const parsedUrl = new URL(config.url);
            const hostname = parsedUrl.hostname;
            const isLocal = hostname === "localhost" || hostname === "127.0.0.1" || hostname.endsWith(".local");
            if (!isLocal) {
              throw new TRPCError({
                code: "FORBIDDEN",
                message: "Sovereign mode: remote MCP tool calls are disabled.",
              });
            }
          } catch {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "Sovereign mode: remote MCP tool calls are disabled.",
            });
          }
        }
      }

      const tools = MCPClientService.getInstance().listTools(input.serverId);
      const tool = tools.find(t => t.name === input.toolName);

      if (tool?.dangerous) {
        const approved = await ctx.services.hitl.requestApproval("mcp.callTool", {
          serverId: input.serverId,
          toolName: input.toolName,
          args: input.args,
          riskLevel: "high",
        }, "command");
        if (!approved) {
          throw new TRPCError({ code: "FORBIDDEN", message: "HITL approval denied for dangerous MCP tool." });
        }
      }

      const sanitized = ctx.services.promptSanitizer.sanitize(JSON.stringify(input.args));
      const safeArgs = JSON.parse(sanitized.clean) as Record<string, unknown>;

      const result = await ctx.services.agent.callMCPTool(input.serverId, input.toolName, safeArgs);
      AuditLogService.getInstance().log({
        eventType: "mcp_tool_result",
        actorId: ctx.user?.id ?? null,
        actorType: "user",
        procedure: `mcp.callTool/${input.toolName}`,
        args: { serverId: input.serverId, toolName: input.toolName },
        result: { preview: JSON.stringify(result).slice(0, 500) },
        ipAddress: null,
        sessionId: null,
      }).catch((err) => log.error("[AuditLog] write failed — event lost", err));
      return result;
    }),
  agenticOsStatus: protectedProcedure.query(() => ({
    configured: MCPClientService.getInstance().isAgenticOsConfigured(),
  })),
});
