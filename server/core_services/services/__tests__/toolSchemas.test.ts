import { describe, it, expect } from "vitest";
import {
  AGENT_TOOL_DEFINITIONS,
  TOOL_CALL_TAG,
  toOpenAiToolSchemas,
  openAiToolsToAnthropic,
  buildLocalLlmToolGrammarSchema,
  buildLocalLlmToolReminder,
} from "../toolSchemas.js";
import { buildTextToolSystemPrompt } from "../ChatAgentRunner.js";

describe("toolSchemas", () => {
  it("toOpenAiToolSchemas projects every built-in tool as an OpenAI function schema", () => {
    const tools = toOpenAiToolSchemas();
    expect(tools).toHaveLength(AGENT_TOOL_DEFINITIONS.length);
    for (const t of tools) {
      expect(t.type).toBe("function");
      expect(typeof t.function.name).toBe("string");
      expect(typeof t.function.description).toBe("string");
      expect(t.function.parameters).toMatchObject({ type: "object" });
    }
    expect(tools.map((t) => t.function.name)).toEqual(
      expect.arrayContaining(["edit_file", "run_command", "start_job"]),
    );
  });

  it("openAiToolsToAnthropic renames `parameters` to `input_schema` and drops the `function` wrapper", () => {
    const tools = toOpenAiToolSchemas();
    const anthropic = openAiToolsToAnthropic(tools);
    expect(anthropic).toHaveLength(tools.length);
    anthropic.forEach((a, i) => {
      expect(a.name).toBe(tools[i].function.name);
      expect(a.description).toBe(tools[i].function.description);
      expect(a.input_schema).toBe(tools[i].function.parameters);
    });
  });

  it("buildLocalLlmToolGrammarSchema constrains `action` to the known tool names and unions their fields", () => {
    const schema = buildLocalLlmToolGrammarSchema(toOpenAiToolSchemas());
    expect(schema).toMatchObject({ type: "object", required: ["action"], additionalProperties: true });
    const properties = (schema as { properties: Record<string, unknown> }).properties;
    expect((properties.action as { enum: string[] }).enum).toEqual(
      expect.arrayContaining(["edit_file", "run_command", "start_job"]),
    );
    // Fields from every tool are present (union), e.g. edit_file's "path" and
    // run_command's "command" both need to be selectable regardless of which
    // action the model picks (the grammar doesn't gate fields per-action).
    expect(properties).toHaveProperty("path");
    expect(properties).toHaveProperty("command");
    expect(properties).toHaveProperty("label");
  });

  it("buildLocalLlmToolReminder lists every tool name and mentions the trigger tag", () => {
    const reminder = buildLocalLlmToolReminder(toOpenAiToolSchemas());
    expect(reminder).toContain(TOOL_CALL_TAG);
    for (const def of AGENT_TOOL_DEFINITIONS) {
      expect(reminder).toContain(`"${def.name}"`);
    }
    // The reminder is deliberately shorter than the text protocol's full
    // instruction block — no JSON example/format rules (grammar enforces
    // shape) — that's the actual "less prompt pollution" win for this tier.
    expect(reminder.length).toBeLessThan(buildTextToolSystemPrompt().length);
  });
});
