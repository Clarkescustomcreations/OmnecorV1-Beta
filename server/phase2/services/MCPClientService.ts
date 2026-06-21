import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { WebSocketClientTransport } from "@modelcontextprotocol/sdk/client/websocket.js";
import { ENV } from "../../_core/env.js";
import path from "path";
import { getDb } from "../../db.factory.js";
import { mcpServerConfigs } from "../../../drizzle/schema.js";
import { eq } from "drizzle-orm";
import { createLogger } from "../../_core/logger.js";
const log = createLogger("MCPClient");

export interface MCPServerConfig {
  id: string;
  name: string;
  transport: "stdio" | "websocket";
  command?: string;
  args?: string[];
  url?: string;
}

export interface MCPTool {
  serverId: string;
  serverName: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  dangerous: boolean;
}

export interface MCPCallResult {
  serverId: string;
  toolName: string;
  result: unknown;
  isError: boolean;
}

const DANGEROUS_PATTERN = /delete|remove|exec|run|write|create|modify/i;

export class MCPClientService {
  private static instance: MCPClientService | null = null;

  private clients = new Map<string, Client>();
  private configs = new Map<string, MCPServerConfig>();
  private toolCache = new Map<string, MCPTool[]>();

  private constructor() {}

  static getInstance(): MCPClientService {
    if (!MCPClientService.instance) {
      MCPClientService.instance = new MCPClientService();
    }
    return MCPClientService.instance;
  }

  /** Restore all previously connected MCP servers from DB (call at startup). */
  async restoreFromDb(): Promise<void> {
    try {
      const db = await getDb();
      const rows = await db.select().from(mcpServerConfigs);
      for (const row of rows) {
        const config: MCPServerConfig = {
          id: row.id,
          name: row.name,
          transport: row.transport,
          command: row.command ?? undefined,
          args: (row.args as string[] | null) ?? undefined,
          url: row.url ?? undefined,
        };
        await this.connectServer(config).catch(err =>
          log.warn("MCP: failed to restore server connection", { id: row.id, err: (err as Error).message })
        );
      }
      if (rows.length > 0) {
        log.info("MCP: restored server connections from DB", { count: rows.length });
      }
    } catch (err) {
      log.warn("MCP: failed to restore from DB", err);
    }
  }

  async connectServer(config: MCPServerConfig): Promise<void> {
    if (this.clients.has(config.id)) {
      await this.disconnectServer(config.id);
    }

    const client = new Client({ name: "omnecor-hmci", version: "3.0.0" });

    let transport;
    if (config.transport === "stdio") {
      if (!config.command) throw new Error(`stdio transport requires a command for server "${config.id}"`);
      const baseCmd = path.basename(config.command).replace(/\.exe$/i, "");
      const whitelist = ["node", "npx", "python", "python3"];
      if (!whitelist.includes(baseCmd)) {
        throw new Error(`Forbidden MCP stdio command: "${config.command}". Whitelisted commands are: node, npx, python, python3`);
      }
      transport = new StdioClientTransport({ command: config.command, args: config.args ?? [] });
    } else {
      if (!config.url) throw new Error(`websocket transport requires a url for server "${config.id}"`);
      transport = new WebSocketClientTransport(new URL(config.url));
    }

    await client.connect(transport);

    const { tools } = await client.listTools();
    const mcpTools: MCPTool[] = tools.map(t => ({
      serverId: config.id,
      serverName: config.name,
      name: t.name,
      description: t.description ?? "",
      inputSchema: (t.inputSchema as Record<string, unknown>) ?? {},
      dangerous: DANGEROUS_PATTERN.test(t.name),
    }));

    this.clients.set(config.id, client);
    this.configs.set(config.id, config);
    this.toolCache.set(config.id, mcpTools);

    getDb().then(db =>
      db.insert(mcpServerConfigs).values({
        id: config.id,
        name: config.name,
        transport: config.transport,
        command: config.command ?? null,
        args: config.args ?? null,
        url: config.url ?? null,
      }).onConflictDoUpdate({
        target: mcpServerConfigs.id,
        set: { name: config.name, command: config.command ?? null, args: config.args ?? null, url: config.url ?? null },
      })
    ).catch(err => log.warn("MCP: failed to persist server config", err));
  }

  async disconnectServer(serverId: string): Promise<void> {
    const client = this.clients.get(serverId);
    if (client) {
      await client.close().catch(() => {});
    }
    this.clients.delete(serverId);
    this.configs.delete(serverId);
    this.toolCache.delete(serverId);
    getDb().then(db =>
      db.delete(mcpServerConfigs).where(eq(mcpServerConfigs.id, serverId))
    ).catch(err => log.warn("MCP: failed to remove server config from DB", err));
  }

  listConnectedServers(): MCPServerConfig[] {
    return Array.from(this.configs.values());
  }

  listTools(serverId?: string): MCPTool[] {
    if (serverId) {
      return this.toolCache.get(serverId) ?? [];
    }
    const all: MCPTool[] = [];
    for (const tools of this.toolCache.values()) {
      all.push(...tools);
    }
    return all;
  }

  async callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<MCPCallResult> {
    const client = this.clients.get(serverId);
    if (!client) throw new Error(`MCP server "${serverId}" is not connected.`);

    const raw = await client.callTool({ name: toolName, arguments: args });

    return {
      serverId,
      toolName,
      result: raw,
      isError: raw.isError === true,
    };
  }

  isAgenticOsConfigured(): boolean {
    return !!ENV.agenticOsApiKey;
  }

  async connectAgenticOsRegistry(): Promise<void> {
    if (!ENV.agenticOsApiKey) return;
    try {
      await this.connectServer({
        id: "__agenticos__",
        name: "AgenticOS Registry",
        transport: "websocket",
        url: `wss://registry.agenticos.dev/mcp?token=${encodeURIComponent(ENV.agenticOsApiKey)}`,
      });
    } catch (err) {
      console.warn("[MCPClientService] AgenticOS registry connection failed:", (err as Error).message);
    }
  }
}
