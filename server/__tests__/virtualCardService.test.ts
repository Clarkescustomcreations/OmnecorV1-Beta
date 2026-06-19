import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// LITHIC_API_KEY must be present at import time so ENV.lithicApiKey is truthy.
process.env.LITHIC_API_KEY = process.env.LITHIC_API_KEY || "test_lithic_key";

vi.mock("../db.factory.js", () => {
  return {
    getDb: vi.fn().mockResolvedValue({
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(true),
      }),
    }),
  };
});

const { VirtualCardService, CardOperationError } = await import(
  "../phase2/services/VirtualCardService.js"
);
const { getDb } = await import("../db.factory.js");
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
      await svc.issueCard({ spendLimitCents: 1000, userId: "1" });
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
    const result = await svc.issueCard({ spendLimitCents: 1000, userId: "2" });
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
      svc.issueCard({ spendLimitCents: 500, userId: "3" })
    ).rejects.toBeInstanceOf(CardOperationError);
  });

  it("closes the Lithic card when local persistence fails (no orphaned live card)", async () => {
    // Card create succeeds at the provider, but the DB insert throws.
    vi.mocked(getDb).mockResolvedValueOnce({
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockRejectedValue(new Error("db locked")),
      }),
    } as never);

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ token: "card_orphan", pan: "4242424242424242", last_four: "4242" })
    );

    const svc = VirtualCardService.getInstance();
    await expect(
      svc.issueCard({ spendLimitCents: 1000, userId: "4" })
    ).rejects.toBeInstanceOf(CardOperationError);

    // A PATCH to /cards/card_orphan with state CLOSED must have been issued.
    const closeCall = fetchSpy.mock.calls.find(([url, init]) =>
      String(url).endsWith("/cards/card_orphan") &&
      (init as RequestInit | undefined)?.method === "PATCH"
    );
    expect(closeCall).toBeTruthy();
    expect(String((closeCall![1] as RequestInit).body)).toContain("CLOSED");
  });
});
