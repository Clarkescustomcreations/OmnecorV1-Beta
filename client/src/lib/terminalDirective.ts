/**
 * Terminal Directive Parser
 *
 * Detects the <terminal_command> directive the AI uses to signal "run this in
 * the user's live terminal" from a completed assistant message. Only the FIRST
 * match is honored per message — the command allowlist store holds a single
 * in-flight approval slot (commandAllowlistStore.ts), so firing more than one
 * requestApproval() call at once would let a second request silently clobber
 * the first's pending promise. The system prompt instructs the model to issue
 * at most one directive per turn and wait for terminal output before another.
 */

const DIRECTIVE_REGEX = /<terminal_command>([\s\S]*?)<\/terminal_command>/;
const DIRECTIVE_REGEX_GLOBAL = /<terminal_command>[\s\S]*?<\/terminal_command>/g;

export interface TerminalDirectiveResult {
  /** Trimmed command text, or null if no directive was present. */
  command: string | null;
  /** Message content with the directive tag(s) replaced by a user-visible note. */
  stripped: string;
}

export function extractTerminalCommand(text: string): TerminalDirectiveResult {
  const match = text.match(DIRECTIVE_REGEX);
  const command = match ? match[1].trim() : null;

  if (!command) {
    // No valid directive — still strip any stray/empty tags so raw XML never renders.
    return { command: null, stripped: text.replace(DIRECTIVE_REGEX_GLOBAL, "") };
  }

  // Replace only the first (honored) directive with a visible confirmation note;
  // strip any further directives in the same message — only one runs per turn.
  const stripped = text
    .replace(DIRECTIVE_REGEX, `_Ran in terminal:_ \`${command}\``)
    .replace(DIRECTIVE_REGEX_GLOBAL, "");

  return { command, stripped };
}
