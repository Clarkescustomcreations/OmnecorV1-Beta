/**
 * @file server/_core/apiClient.ts
 * @description Omnecor — Shared HTTP fetch wrapper with standardized error handling.
 *
 * Provides a thin wrapper around the native fetch API that:
 *  - Attaches an AbortSignal timeout (default 30 s) to every request.
 *  - Throws a structured Error on non-2xx responses WITHOUT leaking raw
 *    response bodies that might contain sensitive provider tokens or account info.
 *  - Formats error messages consistently across all service integrations.
 *
 * Usage:
 *   import { apiFetch } from "../../_core/apiClient.js";
 *   const data = await apiFetch<MyType>("https://api.example.com/endpoint", {
 *     method: "POST",
 *     headers: { "Content-Type": "application/json" },
 *     body: JSON.stringify(payload),
 *   }, { label: "ExampleService" });
 */

export interface ApiFetchOptions extends RequestInit {
  /** Timeout in milliseconds (default: 30 000). */
  timeoutMs?: number;
}

export interface ApiFetchContext {
  /**
   * Human-readable service/operation label used in error messages.
   * Example: "ElevenLabs.synthesize", "PCBWay.getQuote"
   */
  label: string;
}

/**
 * Wrapper around fetch that adds timeout handling and consistent error messages.
 * On non-2xx responses the error message contains the HTTP status code and a
 * redacted description — it never includes raw response bodies to prevent
 * accidental leakage of upstream provider error details that may embed keys.
 *
 * @throws {Error} on network failure, timeout, or non-2xx response.
 */
export async function apiFetch<T = unknown>(
  url: string,
  options: ApiFetchOptions = {},
  ctx: ApiFetchContext = { label: "apiFetch" }
): Promise<T> {
  const { timeoutMs = 30_000, ...fetchOptions } = options;

  let response: Response;
  try {
    response = await fetch(url, {
      ...fetchOptions,
      signal: fetchOptions.signal ?? AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[${ctx.label}] network error: ${msg}`);
  }

  if (!response.ok) {
    // Read a small prefix of the body for debug context, but cap it so we
    // don't accidentally log multi-KB payloads or embedded credentials.
    let hint = "";
    try {
      const text = await response.text();
      // Strip anything that looks like an API key or Bearer token
      const sanitized = text
        .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
        .replace(/"(api_?key|token|secret|authorization)"\s*:\s*"[^"]{4,}"/gi, '"$1":"[redacted]"')
        .slice(0, 200);
      if (sanitized) hint = ` — ${sanitized}`;
    } catch {
      // ignore read errors
    }
    throw new Error(
      `[${ctx.label}] HTTP ${response.status} ${response.statusText}${hint}`
    );
  }

  return response.json() as Promise<T>;
}
