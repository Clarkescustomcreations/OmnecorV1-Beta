/**
 * Shim for @anthropic-ai/tokenizer to avoid tiktoken resolution errors in the browser demo.
 */
export const countTokens = (text: string) => Math.ceil((text || "").length / 4);
