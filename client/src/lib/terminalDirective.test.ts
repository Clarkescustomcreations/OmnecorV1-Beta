import { describe, it, expect } from "vitest";
import { extractTerminalCommand } from "./terminalDirective";

describe("extractTerminalCommand", () => {
  it("returns null command and unchanged text when no directive is present", () => {
    const result = extractTerminalCommand("Just a normal reply with no commands.");
    expect(result.command).toBeNull();
    expect(result.stripped).toBe("Just a normal reply with no commands.");
  });

  it("extracts a single directive and strips it from the displayed text", () => {
    const result = extractTerminalCommand(
      "Let me check that for you.\n<terminal_command>ls -la</terminal_command>\nDone."
    );
    expect(result.command).toBe("ls -la");
    expect(result.stripped).toBe(
      "Let me check that for you.\n_Ran in terminal:_ `ls -la`\nDone."
    );
  });

  it("trims whitespace/newlines inside the directive", () => {
    const result = extractTerminalCommand(
      "<terminal_command>\n  npm test  \n</terminal_command>"
    );
    expect(result.command).toBe("npm test");
  });

  it("only honors the first directive when multiple are present", () => {
    const result = extractTerminalCommand(
      "<terminal_command>echo one</terminal_command> and <terminal_command>echo two</terminal_command>"
    );
    expect(result.command).toBe("echo one");
    // Both tags are stripped from the displayed text even though only the first runs.
    expect(result.stripped).not.toContain("<terminal_command>");
  });

  it("ignores an empty directive", () => {
    const result = extractTerminalCommand("<terminal_command></terminal_command>");
    expect(result.command).toBeNull();
  });
});
