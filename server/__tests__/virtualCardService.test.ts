import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// LITHIC_API_KEY must be present at import time so ENV.lithicApiKey is truthy.
process.env.LITHIC_API_KEY = process.env.LITHIC_API_KEY || "test_lithic_key";

const { VirtualCardService, CardOperationError } = await import(
  "../phase2/services/VirtualCardService.js"
);
const { __resetCircuitBreakers } = await import("../_core/resilientFetch.js");

function jsonResponse(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("VirtualCardService.issueCard", () => {
  beforeEach(() => {
    __resetCircuitBreakers();
    vi.restoreAllMocks();
  });
  afterEach(() => vi.restoreAllMocks());

  it("never exposes the raw Lithic error body (no PAN leak)", async () => {
    const leakyBody = JSON.stringify({
      error: "card_declined",
      card: { pan: "4242424242424242", cvv: "123" },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(leakyBody, { status: 402 }));

    const svc = VirtualCardService.getInstance();
    let thrown: unknown;
    try {
      await svc.issueCard({ spendLimitCents: 1000, userId: "u1" });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(CardOperationError);
    const msg = (thrown as Error).message;
    expect(msg).not.toContain("4242424242424242");
    expect(msg).not.toContain("123");
    expect(msg).not.toContain("card_declined");
    expect(msg).toContain("402");
  });

  it("encrypts the PAN and never returns it in plaintext on success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        token: "card_abc",
        pan: "4242424242424242",
        last_four: "4242",
        exp_month: 12,
        exp_year: 2030,
      })
    );

    const svc = VirtualCardService.getInstance();
    const result = await svc.issueCard({ spendLimitCents: 1000, userId: "u2" });
    expect(result).not.toBeNull();
    expect(result!.last4).toBe("4242");
    expect(result!.encryptedPan).toBeTruthy();
    // The plaintext PAN must not appear anywhere in the returned object.
    expect(JSON.stringify(result)).not.toContain("4242424242424242");
  });

  it("wraps network errors in a safe CardOperationError", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNRESET secret-host-internal"));
    const svc = VirtualCardService.getInstance();
    await expect(
      svc.issueCard({ spendLimitCents: 500, userId: "u3" })
    ).rejects.toBeInstanceOf(CardOperationError);
  });
});
