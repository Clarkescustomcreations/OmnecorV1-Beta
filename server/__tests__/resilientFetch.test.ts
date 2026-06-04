import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  resilientFetch,
  CircuitOpenError,
  __resetCircuitBreakers,
} from "../_core/resilientFetch.js";

function makeResponse(status: number, body = ""): Response {
  return new Response(body, { status });
}

describe("resilientFetch", () => {
  beforeEach(() => {
    __resetCircuitBreakers();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns immediately on a 2xx response", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(makeResponse(200, "ok"));
    const res = await resilientFetch("https://api.example.com/x");
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries on 429 then succeeds", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(makeResponse(429))
      .mockResolvedValueOnce(makeResponse(200, "ok"));
    const res = await resilientFetch("https://api.example.com/y", {
      baseDelayMs: 1, // keep the test fast
      maxRetries: 3,
      circuitKey: "test-429",
    });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries on 5xx up to maxRetries then returns last response", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(makeResponse(503));
    const res = await resilientFetch("https://api.example.com/z", {
      baseDelayMs: 1,
      maxRetries: 2,
      circuitKey: "test-5xx",
    });
    expect(res.status).toBe(503);
    // initial + 2 retries = 3 attempts
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry a 400 (caller error)", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(makeResponse(400));
    const res = await resilientFetch("https://api.example.com/bad", {
      baseDelayMs: 1,
      circuitKey: "test-400",
    });
    expect(res.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("opens the circuit after 5 consecutive failures and fails fast", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    const key = "test-circuit";
    // 5 calls with no retry → 5 consecutive failures → breaker opens.
    for (let i = 0; i < 5; i++) {
      await expect(
        resilientFetch("https://api.example.com/fail", { noRetry: true, circuitKey: key })
      ).rejects.toThrow();
    }
    // 6th call should fail fast with CircuitOpenError (no fetch attempt).
    await expect(
      resilientFetch("https://api.example.com/fail", { noRetry: true, circuitKey: key })
    ).rejects.toBeInstanceOf(CircuitOpenError);
  });
});
