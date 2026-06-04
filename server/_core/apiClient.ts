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

import { resilientFetch, CircuitOpenError } from "./resilientFetch.js";
import { redactSensitive } from "./redaction.js";

export interface ApiFetchOptions extends RequestInit {
  /** Timeout in milliseconds (default: 30 000). */
  timeoutMs?: number;
  /** Max retries on 429/5xx (default: 3). Set 0 to disable. */
  maxRetries?: number;
  /** Circuit-breaker bucket key (default: request URL origin). */
  circuitKey?: string;
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
  const { timeoutMs = 30_000, maxRetries = 3, circuitKey, ...fetchOptions } = options;

  let response: Response;
  try {
    // resilientFetch adds timeout, exponential backoff on 429/5xx, and a
    // per-host circuit breaker so a rate-limited or degraded provider doesn't
    // fail immediately or get hammered.
    response = await resilientFetch(url, {
      ...fetchOptions,
      timeoutMs,
      maxRetries,
      circuitKey,
    });
  } catch (err) {
    if (err instanceof CircuitOpenError) {
      throw new Error(`[${ctx.label}] provider temporarily unavailable (circuit open)`);
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[${ctx.label}] network error: ${redactSensitive(msg)}`);
  }

  if (!response.ok) {
    // Read a small prefix of the body for debug context, but cap it and run it
    // through the central redactor so we never leak keys/tokens/PANs/PII.
    let hint = "";
    try {
      const text = await response.text();
      const sanitized = redactSensitive(text).slice(0, 200);
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
