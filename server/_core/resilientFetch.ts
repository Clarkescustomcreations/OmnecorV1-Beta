/**
 * @file server/_core/resilientFetch.ts
 * @description Production-safe wrapper around native fetch for external APIs.
 *
 * Provides three reliability primitives required by the endpoints audit:
 *   1. Timeout protection (AbortController) — no request hangs forever.
 *   2. Exponential backoff on 429 / 5xx — retry with 1s, 2s, 4s delays.
 *   3. Per-host circuit breaker — after N consecutive failures, fail fast for a
 *      cooldown window so we stop hammering a degraded provider.
 *
 * Uses only built-in fetch/AbortController — no new npm dependencies.
 * Backward compatible: callers that pass no options get sensible defaults.
 */

import { createLogger } from "./logger.js";

const log = createLogger("resilientFetch");

export interface ResilientFetchOptions extends RequestInit {
  /** Max retry attempts after the first try (default 3 → up to 4 total). */
  maxRetries?: number;
  /** Base backoff delay in ms; doubles each retry (default 1000). */
  baseDelayMs?: number;
  /** Per-request timeout in ms (default 30000). */
  timeoutMs?: number;
  /**
   * Logical name for the circuit breaker bucket. Defaults to the request URL's
   * origin so all calls to the same provider share one breaker.
   */
  circuitKey?: string;
  /** Disable retries entirely (still applies timeout + circuit breaker). */
  noRetry?: boolean;
}

// ─── Circuit breaker state ───────────────────────────────────────────────────

const CB_FAILURE_THRESHOLD = 5; // consecutive failures before opening
const CB_COOLDOWN_MS = 60_000; // how long the breaker stays open

interface BreakerState {
  failures: number;
  openedAt: number | null;
}

const breakers = new Map<string, BreakerState>();

function getBreaker(key: string): BreakerState {
  let b = breakers.get(key);
  if (!b) {
    b = { failures: 0, openedAt: null };
    breakers.set(key, b);
  }
  return b;
}

function isOpen(b: BreakerState): boolean {
  if (b.openedAt === null) return false;
  if (Date.now() - b.openedAt >= CB_COOLDOWN_MS) {
    // Cooldown elapsed → half-open: allow one trial request.
    b.openedAt = null;
    b.failures = 0;
    return false;
  }
  return true;
}

function recordSuccess(b: BreakerState): void {
  b.failures = 0;
  b.openedAt = null;
}

function recordFailure(b: BreakerState, key: string): void {
  b.failures += 1;
  if (b.failures >= CB_FAILURE_THRESHOLD && b.openedAt === null) {
    b.openedAt = Date.now();
    log.warn(`Circuit breaker OPEN for "${key}" after ${b.failures} consecutive failures`);
  }
}

/** Test-only: reset all circuit breaker state. */
export function __resetCircuitBreakers(): void {
  breakers.clear();
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Retryable: rate limit (429) or transient server errors (5xx). */
function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

export class CircuitOpenError extends Error {
  constructor(key: string) {
    super(`Circuit breaker open for "${key}" — provider temporarily unavailable`);
    this.name = "CircuitOpenError";
  }
}

// ─── Main entry point ────────────────────────────────────────────────────────

/**
 * fetch() with timeout, exponential backoff on 429/5xx, and a per-host circuit
 * breaker. Throws CircuitOpenError when the breaker is open. On exhausted
 * retries, returns the last Response (so the caller can read status/body) or
 * throws the last network error.
 */
export async function resilientFetch(
  url: string,
  options: ResilientFetchOptions = {}
): Promise<Response> {
  const {
    maxRetries = 3,
    baseDelayMs = 1000,
    timeoutMs = 30_000,
    circuitKey,
    noRetry = false,
    ...init
  } = options;

  const key = circuitKey ?? originOf(url);
  const breaker = getBreaker(key);

  if (isOpen(breaker)) {
    throw new CircuitOpenError(key);
  }

  const attempts = noRetry ? 1 : maxRetries + 1;
  let lastError: unknown;
  let lastResponse: Response | undefined;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);

      if (res.ok) {
        recordSuccess(breaker);
        return res;
      }

      // Non-OK response.
      if (isRetryableStatus(res.status) && attempt < attempts - 1) {
        lastResponse = res;
        const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
        const backoff = retryAfter ?? baseDelayMs * 2 ** attempt;
        log.warn(`${key} returned ${res.status}; retry ${attempt + 1}/${attempts - 1} in ${backoff}ms`);
        await delay(backoff);
        continue;
      }

      // Non-retryable non-OK (4xx other than 429): count toward breaker only
      // for 5xx-ish; 4xx are usually caller errors and shouldn't trip it.
      if (res.status >= 500) recordFailure(breaker, key);
      else recordSuccess(breaker); // provider is up, just rejected this request
      return res;
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      recordFailure(breaker, key);
      if (attempt < attempts - 1) {
        const backoff = baseDelayMs * 2 ** attempt;
        log.warn(`${key} request failed (${(err as Error)?.name ?? "error"}); retry ${attempt + 1}/${attempts - 1} in ${backoff}ms`);
        await delay(backoff);
        continue;
      }
    }
  }

  if (lastResponse) return lastResponse;
  throw lastError ?? new Error(`resilientFetch failed for ${key}`);
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.min(seconds * 1000, 30_000);
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, Math.min(date - Date.now(), 30_000));
  return null;
}
