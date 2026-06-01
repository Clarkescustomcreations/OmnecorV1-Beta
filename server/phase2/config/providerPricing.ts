/**
 * @file server/phase2/config/providerPricing.ts
 * @description Per-provider, per-model token pricing constants for the Agentic Wallet.
 *
 * All costs are in MICROCENTS per token (1 microcent = $0.00000001).
 * This avoids floating-point errors when accumulating many small charges.
 *
 * Formula: estimatedCostMicrocents = (promptTokens * inputMicrocents) + (completionTokens * outputMicrocents)
 * To convert to USD cents: divide by 1_000_000
 * To convert to USD dollars: divide by 100_000_000
 *
 * Prices sourced from official provider pricing pages (2025-05-31).
 * Update this file when providers change pricing.
 */

export interface ModelPricing {
  /** Cost in microcents per input/prompt token */
  inputMicrocents: number;
  /** Cost in microcents per output/completion token */
  outputMicrocents: number;
}

/** Map of provider ID → model ID → pricing */
export const PROVIDER_PRICING: Record<string, Record<string, ModelPricing>> = {
  openai: {
    "gpt-4o":                    { inputMicrocents: 250,  outputMicrocents: 1000 },
    "gpt-4o-mini":               { inputMicrocents: 15,   outputMicrocents: 60   },
    "gpt-4-turbo":               { inputMicrocents: 1000, outputMicrocents: 3000 },
    "gpt-4":                     { inputMicrocents: 3000, outputMicrocents: 6000 },
    "gpt-3.5-turbo":             { inputMicrocents: 50,   outputMicrocents: 150  },
  },
  anthropic: {
    "claude-opus-4-8":           { inputMicrocents: 1500, outputMicrocents: 7500 },
    "claude-sonnet-4-6":         { inputMicrocents: 300,  outputMicrocents: 1500 },
    "claude-haiku-4-5-20251001": { inputMicrocents: 80,   outputMicrocents: 400  },
    "claude-3-5-sonnet-20241022":{ inputMicrocents: 300,  outputMicrocents: 1500 },
    "claude-3-opus-20240229":    { inputMicrocents: 1500, outputMicrocents: 7500 },
    "claude-3-haiku-20240307":   { inputMicrocents: 25,   outputMicrocents: 125  },
  },
  gemini: {
    "gemini-1.5-pro":            { inputMicrocents: 125,  outputMicrocents: 500  },
    "gemini-1.5-flash":          { inputMicrocents: 7,    outputMicrocents: 30   },
    "gemini-2.0-flash":          { inputMicrocents: 10,   outputMicrocents: 40   },
  },
  grok: {
    "grok-2":                    { inputMicrocents: 200,  outputMicrocents: 1000 },
    "grok-2-mini":               { inputMicrocents: 20,   outputMicrocents: 100  },
  },
  ollama: {
    // Local inference — zero cost by default
    "*":                         { inputMicrocents: 0,    outputMicrocents: 0    },
  },
  forge: {
    "*":                         { inputMicrocents: 0,    outputMicrocents: 0    },
  },
};

/** Default fallback pricing when model is not in the map */
const DEFAULT_PRICING: ModelPricing = { inputMicrocents: 100, outputMicrocents: 300 };

/**
 * Look up pricing for a provider+model combination.
 * Falls back to wildcard "*" entry, then to DEFAULT_PRICING.
 */
export function getModelPricing(provider: string, modelId: string): ModelPricing {
  const providerPricing = PROVIDER_PRICING[provider.toLowerCase()];
  if (!providerPricing) return DEFAULT_PRICING;
  return providerPricing[modelId] ?? providerPricing["*"] ?? DEFAULT_PRICING;
}

/**
 * Calculate estimated cost in microcents for a completed API call.
 */
export function calculateCostMicrocents(
  provider: string,
  modelId: string,
  promptTokens: number,
  completionTokens: number
): number {
  const pricing = getModelPricing(provider, modelId);
  return (promptTokens * pricing.inputMicrocents) + (completionTokens * pricing.outputMicrocents);
}
