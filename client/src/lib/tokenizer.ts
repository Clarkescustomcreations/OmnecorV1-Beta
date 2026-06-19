/**
 * Token count approximation for the chat context indicator.
 *
 * js-tiktoken was tried but its BPE rank files (3.4 MB static imports) bloated
 * the Chat chunk to ~4 MB and caused bare-specifier resolution errors in the
 * browser under Vite's dev-server. For a UI progress bar a tight approximation
 * is sufficient; users can trust the model's own context-limit rejection if they
 * actually go over.
 *
 * Approximation strategy:
 *   - ~4 chars per token for English prose (same as OpenAI's rule of thumb)
 *   - Code tends to tokenize into shorter tokens; adjust with a 0.75× multiplier
 *     when the text looks code-heavy (many non-alpha chars).
 */

type EncodingName = "o200k_base" | "cl100k_base";

/** Map a model id to the encoding it nominally uses (kept for API compatibility). */
export function encodingForModel(modelId?: string): EncodingName {
  if (!modelId) return "o200k_base";
  const m = modelId.toLowerCase();
  if (m === "gpt-4" || m.startsWith("gpt-4-") || m.includes("gpt-3.5") || m.includes("claude-3")) {
    return "cl100k_base";
  }
  return "o200k_base";
}

/**
 * Estimate tokens in `text`. Returns a fast approximation; never throws.
 * The `modelId` parameter is accepted for API compatibility but does not change
 * the result — both cl100k and o200k average ~4 chars/token for typical content.
 */
export function countTokens(text: string, _modelId?: string): number {
  if (!text) return 0;
  const nonAlpha = (text.match(/[^a-zA-Z0-9\s]/g) ?? []).length;
  const ratio = nonAlpha / Math.max(text.length, 1);
  // Code-heavy text (>25% non-alpha chars) tokenises into shorter tokens.
  const charsPerToken = ratio > 0.25 ? 3 : 4;
  return Math.ceil(text.length / charsPerToken);
}
