import { TRPCError } from "@trpc/server";

// ─────────────────────────────────────────────────────────────────────────────
// Sovereign-mode cloud-provider guard (shared)
//
// Air-gapped ("sovereign") users must never reach a cloud AI provider. The
// canonical enforcement is the `cloudProcedure` tier (sovereignCheck middleware),
// but several routers call `ctx.services.aiProvider.chat()` directly on a
// `protectedProcedure` with a hardcoded cloud provider. Those call sites must
// invoke this guard so a sovereign user cannot tunnel a cloud call through them.
//
// This is the single source of truth — previously the set + guard were copied
// inline in aiRouter, podcastRouter, and agentMessengerRouter.
// ─────────────────────────────────────────────────────────────────────────────

/** LLM provider ids that hit an external cloud endpoint. */
export const CLOUD_PROVIDER_IDS = new Set([
  "openai",
  "anthropic",
  "gemini",
  "grok",
  "huggingface",
]);

/** Image-generation provider ids that hit an external cloud endpoint. */
export const CLOUD_IMAGE_PROVIDER_IDS = new Set(["fal", "openart"]);

/**
 * Throw FORBIDDEN if a sovereign user targets a cloud LLM provider.
 * Local providers (ollama/llamacpp/ommesh/forge) pass through untouched.
 */
export function assertProviderAllowedInMode(
  providerId: string,
  executionMode: string | undefined,
): void {
  if (executionMode === "sovereign" && CLOUD_PROVIDER_IDS.has(providerId)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Sovereign mode: cloud provider "${providerId}" is disabled. Use a local provider (ollama, llamacpp, ommesh).`,
    });
  }
}

/**
 * Throw FORBIDDEN if a sovereign user targets a cloud image provider.
 * Local image generation (ComfyUI) passes through untouched.
 */
export function assertImageProviderAllowedInMode(
  providerId: string,
  executionMode: string | undefined,
): void {
  if (executionMode === "sovereign" && CLOUD_IMAGE_PROVIDER_IDS.has(providerId)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Sovereign mode: cloud image provider "${providerId}" is disabled. Use the local provider (ComfyUI).`,
    });
  }
}
