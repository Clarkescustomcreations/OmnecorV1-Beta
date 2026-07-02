import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// LITHIC_API_KEY must be present at import time so ENV.lithicApiKey is truthy.
process.env.LITHIC_API_KEY = process.env.LITHIC_API_KEY || "test_lithic_key";
// In-suite Lithic mock: pin the API base so tests hit a fake host (never real
// Lithic) and can assert the env-switch (LITHIC_API_BASE) resolves into the URL.
// Captured at module load, so it must be set before the dynamic import below.
process.env.LITHIC_API_BASE = "https://lithic.mock.test";

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

describe("VirtualCardService.listTransactions (in-suite Lithic mock)", () => {
  // getDb stub whose ownership select resolves to `rows`.
  const dbReturning = (rows: unknown[]) => ({
    select: () => ({ from: () => ({ where: () => ({ limit: async () => rows }) }) }),
  });

  beforeEach(() => {
    __resetCircuitBreakers();
    vi.restoreAllMocks();
  });
  afterEach(() => vi.restoreAllMocks());

  it("hits the env-configured LITHIC_API_BASE and maps the Lithic response", async () => {
    vi.mocked(getDb).mockResolvedValue(dbReturning([{ token: "card_x" }]) as never);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        data: [
          { token: "txn_1", amount: 1299, currency: "USD", status: "SETTLED", merchant: { descriptor: "OPENAI" }, created: "2026-06-30T00:00:00Z" },
        ],
      })
    );

    const svc = VirtualCardService.getInstance();
    const txns = await svc.listTransactions("card_x", 1);

    expect(txns).toEqual([
      { token: "txn_1", amount: 1299, currency: "USD", status: "SETTLED", merchantDescriptor: "OPENAI", created: "2026-06-30T00:00:00Z" },
    ]);
    // Env-switch resolved into the request URL (never real Lithic).
    const url = String(fetchSpy.mock.calls[0]?.[0]);
    expect(url).toContain("https://lithic.mock.test/transactions?card_token=card_x");
  });

  it("returns [] and makes no external call when the card is not owned by the user", async () => {
    vi.mocked(getDb).mockResolvedValue(dbReturning([]) as never);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const svc = VirtualCardService.getInstance();
    expect(await svc.listTransactions("card_not_mine", 1)).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns [] on a non-OK Lithic response (never throws to the caller)", async () => {
    vi.mocked(getDb).mockResolvedValue(dbReturning([{ token: "card_x" }]) as never);
    // 404 is a non-retryable client error, so resilientFetch returns it immediately
    // (a 429/5xx would trip the backoff/retry path); the service maps any !ok → [].
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ error: "not_found" }, 404));
    const svc = VirtualCardService.getInstance();
    expect(await svc.listTransactions("card_x", 1)).toEqual([]);
  });
});
