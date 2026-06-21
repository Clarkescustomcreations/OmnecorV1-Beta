/**
 * Shared AI chat helper for screens that need a one-shot LLM call against the
 * desktop's real `ai.chat` tRPC mutation (the 3D Viewer's Ask-AI / Analyze, etc.).
 *
 * Mirrors the call the Chat screen makes: resolve a provider from
 * `ai.getProviders` (falling back to Ollama), then POST to `ai.chat`. Returns
 * the assistant text. Throws if the server is unreachable so callers can show
 * a real error rather than a mock.
 */
import { trpcQuery, trpcMutate } from "./trpc-fetch";
import { resolveDefaultModel } from "./ai-models";

let _cachedProviderId: string | null = null;

/** Resolve a usable providerId, caching the first success for the session. */
export async function resolveProviderId(): Promise<string> {
  if (_cachedProviderId) return _cachedProviderId;
  try {
    const providers = await trpcQuery<{ id: string; name: string }[]>("ai.getProviders");
    // Prefer a non-mesh provider for screen actions (mesh = phone worker).
    const pick = providers?.find((p) => p.id !== "ommesh") ?? providers?.[0];
    _cachedProviderId = pick?.id ?? "ollama";
  } catch {
    _cachedProviderId = "ollama";
  }
  return _cachedProviderId;
}

export interface AskAiOptions {
  /** The user's question / instruction. */
  prompt: string;
  /** Optional extra context prepended to the user turn (model/design/code). */
  context?: string;
  /** Optional system prompt to steer the assistant. */
  systemPrompt?: string;
  /** Model id; resolved from the PC's real available models when omitted. */
  modelId?: string;
}

/** One-shot chat against the desktop. Returns the assistant's reply text. */
export async function askAi(opts: AskAiOptions): Promise<string> {
  const providerId = await resolveProviderId();
  const modelId = opts.modelId ?? (await resolveDefaultModel(providerId));
  if (!modelId) {
    throw new Error(
      `No model available for "${providerId}". Install an Ollama model on the PC or configure a cloud provider in Settings.`,
    );
  }
  const content = opts.context ? `${opts.context}\n\n${opts.prompt}` : opts.prompt;
  const res = await trpcMutate<{ content: string }>("ai.chat", {
    providerId,
    modelId,
    messages: [{ role: "user", content }],
    ...(opts.systemPrompt ? { systemPrompt: opts.systemPrompt } : {}),
  });
  return res?.content ?? "";
}
