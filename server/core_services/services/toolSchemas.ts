/**
 * @file services/toolSchemas.ts
 * @description Single source of truth for the agentic tool contract (Model-Fabric
 * Phase 2 — capability-tiered dual tool-protocol). `ChatAgentRunner`'s built-in
 * actions (edit_file/run_command/start_job) are defined once here as JSON Schema
 * and projected into whatever shape each transport needs:
 *  - the TEXT protocol embeds them as prose in the system prompt (unchanged,
 *    proven wording lives in ChatAgentRunner);
 *  - the NATIVE protocol passes `toOpenAiToolSchemas()` as `ChatInput.tools`,
 *    which `AiProviderService` forwards as-is to OpenAI/Ollama or converts for
 *    Anthropic;
 *  - the llama-server local runtime (no native tools endpoint — Phase 1 kept it
 *    on the raw, template-free `/completion` path) gets a flattened grammar
 *    schema + compact reminder text so its own tier upgrade is "same `<tool_call>`
 *    marker, but grammar-guaranteed valid JSON" rather than OpenAI's `tool_calls`
 *    wire format.
 */

/** The text-protocol trigger marker, also reused as llama-server's grammar trigger word. */
export const TOOL_CALL_TAG = "<tool_call>";

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema (object type) describing the call's arguments. */
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

export interface OpenAiToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface AnthropicToolSchema {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/** The 3 built-in agentic actions ChatAgentRunner executes directly. MCP tools
 * are intentionally not enumerated here (dynamic, server-discovered) — same
 * scope the text protocol has always had; the model can still name one and it
 * falls through to the MCP dispatcher either way. */
export const AGENT_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "edit_file",
    description:
      "Create or modify a file scoped to the active project. Provide \"path\" plus EITHER \"content\" (the full new file) OR \"search\" and \"replace\" (an exact, unique snippet to swap). Requires user approval; only written to disk on approval.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project-relative file path." },
        content: { type: "string", description: "Full new file contents (whole-file write)." },
        search: { type: "string", description: "Exact, unique snippet to replace (search/replace edit)." },
        replace: { type: "string", description: "Replacement text for \"search\"." },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "run_command",
    description:
      "Run a CLI command to completion and see its output now. Requires user approval. Never a shell line — command and args are spawned directly, no shell interpolation.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "The executable to run." },
        args: { type: "array", items: { type: "string" }, description: "Argument list." },
      },
      required: ["command"],
      additionalProperties: false,
    },
  },
  {
    name: "start_job",
    description:
      "Start a long-running command (builds, downloads, training) that continues asynchronously. End your turn right after starting it; you'll be re-prompted with the result when it finishes.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "The executable to run." },
        args: { type: "array", items: { type: "string" }, description: "Argument list." },
        label: { type: "string", description: "Human-readable label for the job." },
        kind: { type: "string", enum: ["build", "download", "process", "other"] },
      },
      required: ["command"],
      additionalProperties: false,
    },
  },
];

/**
 * Mesh delegation (Mesh-Delegation.md) — spawn a full sub-agent on a trusted
 * OMMESH peer. NOT part of `AGENT_TOOL_DEFINITIONS`: it is only offered when
 * the run allows delegation (`AgentRunParams.allowDelegation`, set by the
 * origin's `agentChatStream`) — a delegated run itself never gets it, so
 * delegation can't chain peer-to-peer.
 */
export const DELEGATE_TOOL_DEFINITION: ToolDefinition = {
  name: "delegate_task",
  description:
    "Delegate a self-contained task to another Omnecor node on the mesh. A full sub-agent runs it THERE (its own tools, its own filesystem) and streams into a new managed chat; you are re-prompted with the condensed result when it finishes — end your turn right after delegating. Requires user approval.",
  parameters: {
    type: "object",
    properties: {
      node: { type: "string", description: "Target mesh node id (one of the discoverable peer names)." },
      task: { type: "string", description: "The complete, self-contained instruction for the sub-agent." },
      label: { type: "string", description: "Short human label for the delegation (defaults to the task's first line)." },
      scope_path: {
        type: "string",
        description: "Optional explicit directory ON THE PEER to work in (shown to the user at approval). Omit for a fresh sandbox.",
      },
      model: { type: "string", description: "Optional model id from the peer's catalog. Omit for the peer's default." },
    },
    required: ["node", "task"],
    additionalProperties: false,
  },
};

/** Canonical native tool-call schema (OpenAI-compatible `tools` param shape) —
 * what `ChatInput.tools` carries end-to-end. Every provider converts FROM this. */
export function toOpenAiToolSchemas(defs: ToolDefinition[] = AGENT_TOOL_DEFINITIONS): OpenAiToolSchema[] {
  return defs.map((d) => ({
    type: "function" as const,
    function: { name: d.name, description: d.description, parameters: d.parameters },
  }));
}

/** Anthropic's `tools` param uses `input_schema` instead of a nested `function` object. */
export function openAiToolsToAnthropic(tools: OpenAiToolSchema[]): AnthropicToolSchema[] {
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }));
}

/**
 * A single flattened JSON Schema — the union of every tool's fields with
 * `action` constrained to a known name — compiled by llama-server into a GBNF
 * grammar (via its `json_schema` request field) and applied lazily once the
 * `<tool_call>` trigger word fires (`grammar_lazy` + `grammar_triggers`, see
 * AiProviderService.chatLocalLlm). This forces syntactically valid JSON for
 * whichever tool the model picks, without per-action validation — the same
 * looseness the text protocol already has today (a model can send irrelevant
 * extra fields; ChatAgentRunner's executors only read what they need).
 */
export function buildLocalLlmToolGrammarSchema(tools: OpenAiToolSchema[]): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    action: { type: "string", enum: tools.map((t) => t.function.name) },
  };
  for (const t of tools) {
    const params = t.function.parameters as { properties?: Record<string, unknown> } | undefined;
    for (const [key, schema] of Object.entries(params?.properties ?? {})) {
      if (!(key in properties)) properties[key] = schema;
    }
  }
  return {
    type: "object",
    properties,
    required: ["action"],
    additionalProperties: true,
  };
}

/**
 * Compact tool listing for llama-server's native tier. Unlike a true native
 * function-calling model (OpenAI/Anthropic/Ollama, which need zero extra prompt
 * text), llama-server's raw `/completion` path has no `tools` channel — the
 * model still needs to know the `<tool_call>` trigger convention. The reminder
 * skips format rules/JSON examples entirely (the grammar enforces the shape),
 * which is the actual "less prompt pollution" win for this tier.
 */
export function buildLocalLlmToolReminder(tools: OpenAiToolSchema[]): string {
  const list = tools.map((t) => `- "${t.function.name}" — ${t.function.description}`).join("\n");
  return `You can take real actions. To use one, stop your reply with ${TOOL_CALL_TAG} immediately followed by the call — valid JSON is enforced for you.\n\nAvailable actions:\n${list}`;
}
