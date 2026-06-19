/**
 * Real BPE token counting (pure-JS, no WASM).
 *
 * Uses js-tiktoken's lite tokenizer with on-demand rank data so the chat
 * context panel shows true token counts instead of a chars/4 approximation.
 *
 * Accuracy:
 * - OpenAI models → exact (o200k_base for GPT-4o/o-series, cl100k_base for GPT-4/3.5).
 * - Claude / Gemini / Grok have no public browser tokenizer; o200k_base is used
 *   as the closest modern large-vocabulary proxy.
 *
 * The lite build + per-encoding rank imports keep this out of the main bundle
 * (it only loads inside the lazy chat chunk) and avoid the WASM resolution
 * issues that ruled out @anthropic-ai/tokenizer under Vite.
 */
import { Tiktoken } from "js-tiktoken/lite";
import o200k_base from "js-tiktoken/ranks/o200k_base";
import cl100k_base from "js-tiktoken/ranks/cl100k_base";

type EncodingName = "o200k_base" | "cl100k_base";

// Tiktoken instances are reused — constructing one builds the BPE rank map.
const encoders: Partial<Record<EncodingName, Tiktoken>> = {};

function getEncoder(name: EncodingName): Tiktoken {
  let enc = encoders[name];
  if (!enc) {
    enc = new Tiktoken(name === "o200k_base" ? o200k_base : cl100k_base);
    encoders[name] = enc;
  }
  return enc;
}

/** Map a model id to the BPE encoding it uses (defaults to modern o200k_base). */
export function encodingForModel(modelId?: string): EncodingName {
  if (!modelId) return "o200k_base";
  const m = modelId.toLowerCase();
  // Legacy OpenAI (GPT-4 / GPT-3.5) and Claude 3-era models use cl100k_base.
  if (m === "gpt-4" || m.startsWith("gpt-4-") || m.includes("gpt-3.5") || m.includes("claude-3")) {
    return "cl100k_base";
  }
  // GPT-4o / o-series and modern large-vocab models (Claude 4.x, Gemini, Grok).
  return "o200k_base";
}

/**
 * Count tokens in `text` using the real tokenizer for `modelId`.
 * Never throws — special-token-looking substrings in user content are encoded
 * as ordinary text, and any unexpected failure falls back to a chars/4 estimate.
 */
export function countTokens(text: string, modelId?: string): number {
  if (!text) return 0;
  try {
    // (allowedSpecial=[], disallowedSpecial=[]) → treat special tokens as plain text.
    return getEncoder(encodingForModel(modelId)).encode(text, [], []).length;
  } catch {
    return Math.ceil(text.length / 4);
  }
}
