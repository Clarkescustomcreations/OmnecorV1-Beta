import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { Plus, ChevronDown, X, AlertTriangle, Plug } from "lucide-react";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Local type definitions (MCPClientService is not importable from frontend)
// ---------------------------------------------------------------------------
interface MCPTool {
  serverId: string;
  serverName: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  dangerous: boolean;
}

interface MCPServerConfig {
  id: string;
  name: string;
  transport: "stdio" | "websocket";
  command?: string;
  url?: string;
}

// ---------------------------------------------------------------------------
// Per-tool test state
// ---------------------------------------------------------------------------
interface ToolTestState {
  open: boolean;
  argsJson: string;
  result: unknown | null;
  loading: boolean;
  jsonError: boolean;
}

// ---------------------------------------------------------------------------
// Connect Server Form (collapsible)
// ---------------------------------------------------------------------------
function ConnectServerForm() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{
    id: string;
    name: string;
    transport: "stdio" | "websocket";
    command: string;
    url: string;
  }>({
    id: "",
    name: "",
    transport: "stdio",
    command: "",
    url: "",
  });

  const connectMutation = trpc.mcp.connectServer.useMutation({
    onError: (err) => toast.error(`Connect failed: ${err.message}`),
  });

  function handleConnect() {
    if (!connectMutation) return;
    const config: MCPServerConfig = {
      id: form.id,
      name: form.name,
      transport: form.transport,
      ...(form.transport === "stdio" ? { command: form.command } : { url: form.url }),
    };
    connectMutation.mutate(config, {
      onSuccess: () => {
        setOpen(false);
        setForm({ id: "", name: "", transport: "stdio", command: "", url: "" });
      },
      onError: (err) => toast.error(`Connect failed: ${err.message}`),
    });
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
                                        <Button variant="outline" size="sm" className="gap-2">
          <Plus className="w-4 h-4" />
          Connect Server
          <ChevronDown
            className={cn("w-4 h-4 transition-transform", open && "rotate-180")}
          />
        </Button>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="mt-3 p-4 border border-border rounded-lg bg-card space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Server ID
              </label>
              <Input
                placeholder="my-server"
                value={form.id}
                onChange={e => setForm(f => ({ ...f, id: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Display Name
              </label>
              <Input
                placeholder="My MCP Server"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Transport
            </label>
            <Select
              value={form.transport}
              onValueChange={(v: "stdio" | "websocket") =>
                setForm(f => ({ ...f, transport: v }))
              }
            >
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="stdio">stdio</SelectItem>
                <SelectItem value="websocket">websocket</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {form.transport === "stdio" && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Command
              </label>
              <Input
                placeholder="npx my-mcp-server"
                value={form.command}
                onChange={e => setForm(f => ({ ...f, command: e.target.value }))}
              />
            </div>
          )}

          {form.transport === "websocket" && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                URL
              </label>
              <Input
                placeholder="ws://localhost:3001"
                value={form.url}
                onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
              />
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <Button
              size="sm"
              onClick={handleConnect}
              disabled={!form.id || !form.name || connectMutation.isPending}
            >
              {connectMutation.isPending ? "Connecting…" : "Connect"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>

          {connectMutation?.isError && (
            <p className="text-xs text-destructive">
              {connectMutation.error?.message ?? "Connection failed"}
            </p>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ---------------------------------------------------------------------------
// Connected server chip
// ---------------------------------------------------------------------------
function ServerChip({ server }: { server: MCPServerConfig }) {
  const disconnectMutation = trpc.mcp.disconnectServer.useMutation({
    onError: (err) => toast.error(`Disconnect failed: ${err.message}`),
  });

  return (
    <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-secondary text-secondary-foreground text-xs font-medium border border-border">
      {server.name}
      <button
        className="ml-1 rounded-full hover:bg-muted p-0.5 transition-colors"
        onClick={() => disconnectMutation.mutate({ serverId: server.id }, { onError: (err) => toast.error(`Disconnect failed: ${err.message}`) })}
        aria-label={`Disconnect ${server.name}`}
      >
        <X className="w-3 h-3" />
      </button>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Tool test panel (per-card)
// ---------------------------------------------------------------------------
function ToolTestPanel({ tool }: { tool: MCPTool }) {
  const [state, setState] = useState<ToolTestState>({
    open: false,
    argsJson: "{}",
    result: null,
    loading: false,
    jsonError: false,
  });

  const callMutation = trpc.mcp.callTool.useMutation({
    onError: (err) => toast.error(`Tool call failed: ${err.message}`),
  });

  function handleRun() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(state.argsJson);
    } catch {
      setState(s => ({ ...s, jsonError: true }));
      return;
    }

    setState(s => ({ ...s, loading: true, result: null, jsonError: false }));
    callMutation.mutate(
      { serverId: tool.serverId, toolName: tool.name, args: parsed as Record<string, unknown> },
      {
        onSuccess: (data) =>
          setState(s => ({ ...s, loading: false, result: data })),
        onError: (err) =>
          setState(s => ({
            ...s,
            loading: false,
            result: { error: err.message ?? "Call failed" },
          })),
      }
    );
  }

  if (!state.open) {
    return (
      <Button
        size="sm"
        variant="outline"
        onClick={() => setState(s => ({ ...s, open: true }))}
      >
        Test
      </Button>
    );
  }

  return (
    <div className="mt-3 space-y-2">
      <Textarea
        className={cn(
          "font-mono text-xs min-h-[80px] resize-y",
          state.jsonError && "border-destructive focus-visible:ring-destructive/50"
        )}
        value={state.argsJson}
        onChange={e => {
          setState(s => ({ ...s, argsJson: e.target.value, jsonError: false }));
        }}
        placeholder="{}"
        spellCheck={false}
      />
      {state.jsonError && (
        <p className="text-xs text-destructive">Invalid JSON</p>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={handleRun}
          disabled={state.loading}
        >
          {state.loading ? "Running…" : "Run"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setState(s => ({ ...s, open: false, result: null }))}
        >
          Close
        </Button>
      </div>
      {state.result !== null && (
        <pre className="mt-2 p-3 rounded-md bg-muted text-xs overflow-auto max-h-48 whitespace-pre-wrap break-all">
          {JSON.stringify(state.result, null, 2)}
        </pre>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single tool card
// ---------------------------------------------------------------------------
function ToolCard({ tool }: { tool: MCPTool }) {
  return (
    <Card className="flex flex-col gap-0 py-0 overflow-hidden">
      <CardHeader className="px-4 pt-4 pb-0">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm">{tool.name}</CardTitle>
          <div className="flex gap-1 flex-shrink-0">
            {tool.dangerous && (
              <Badge variant="destructive" className="gap-1 text-xs">
                <AlertTriangle className="w-3 h-3" />
                Dangerous
              </Badge>
            )}
            <Badge variant="secondary" className="text-xs">
              {tool.serverName}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-4 pt-2 pb-4">
        <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
          {tool.description || "No description provided."}
        </p>
        <ToolTestPanel tool={tool} />
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// AgenticOS status row
// ---------------------------------------------------------------------------
function AgenticOsStatus() {
  const statusQuery = trpc.mcp.agenticOsStatus.useQuery();
  const data = statusQuery.data;

  if (statusQuery.isLoading) return null;

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground font-medium">AgenticOS:</span>
      {data?.configured ? (
        <Badge variant="default" className="bg-green-600 text-white border-transparent">
          AgenticOS Connected
        </Badge>
      ) : (
        <span className="text-muted-foreground text-xs">
          AgenticOS not configured — set{" "}
          <code className="font-mono bg-muted px-1 py-0.5 rounded">AGENTICOS_API_KEY</code>
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function MCPToolDirectory() {
  const serversQuery = trpc.mcp.listConnectedServers.useQuery();
  const toolsQuery = trpc.mcp.listTools.useQuery({});

  const servers = serversQuery.data ?? [];
  const tools = toolsQuery.data ?? [];

  // Group tools by serverName
  const grouped: Record<string, MCPTool[]> = {};
  for (const tool of tools) {
    if (!grouped[tool.serverName]) grouped[tool.serverName] = [];
    grouped[tool.serverName].push(tool);
  }

  return (
    <div className="space-y-6">
      {/* Header row: connect form + AgenticOS status */}
      <div className="flex flex-wrap items-center gap-4">
        <ConnectServerForm />
        <div className="ml-auto">
          <AgenticOsStatus />
        </div>
      </div>

      {/* Connected servers chips */}
      {servers.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
            Connected:
          </span>
          {servers.map((s: MCPServerConfig) => (
            <ServerChip key={s.id} server={s} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {servers.length === 0 && tools.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
            <Plug className="w-6 h-6 text-muted-foreground" />
          </div>
          <div>
            <p className="font-medium text-sm">Connect your first MCP server</p>
            <p className="text-xs text-muted-foreground mt-1">
              Use the "Connect Server" button above to add an MCP server and browse its tools.
            </p>
          </div>
        </div>
      )}

      {/* Tool directory grouped by server */}
      {Object.entries(grouped).map(([serverName, serverTools]) => (
        <div key={serverName} className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground border-b border-border pb-2">
            {serverName}
            <span className="ml-2 text-xs text-muted-foreground font-normal">
              {serverTools.length} {serverTools.length === 1 ? "tool" : "tools"}
            </span>
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {serverTools.map((tool: MCPTool) => (
              <ToolCard key={`${tool.serverId}-${tool.name}`} tool={tool} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
