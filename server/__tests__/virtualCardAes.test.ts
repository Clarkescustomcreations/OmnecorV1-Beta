/**
 * Batch B — Item 13: VirtualCardService AES-256-GCM encrypt/decrypt round-trip
 *
 * The PAN (card number) is encrypted by encryptToken() immediately on receipt
 * from Lithic and stored in the DB. revealPan() decrypts it on demand.
 *
 * These methods are private, so we exercise them end-to-end:
 *   1. Mock the Lithic fetch to return a known PAN.
 *   2. Capture the encrypted values written to the DB by issueCard().
 *   3. Feed those values back through a mocked select in revealPan().
 *   4. Assert the recovered plaintext equals the original PAN.
 *
 * Also tests GCM authentication: a tampered auth tag must cause decryption to
 * throw rather than silently return garbled data.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, seedUser } from "./_helpers/trpcHarness.js";
import { virtualCards } from "../../drizzle/schema.js";

// LITHIC_API_KEY must be set at import time so ENV.lithicApiKey is truthy.
process.env.LITHIC_API_KEY = "test_lithic_key_for_aes";

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("../db.factory.js", () => ({
  getDb: vi.fn(),
}));

// ── Imports (after mocks) ────────────────────────────────────────────────────

const { VirtualCardService } = await import(
  "../phase2/services/VirtualCardService.js"
);
const { getDb } = await import("../db.factory.js");
const { __resetCircuitBreakers } = await import("../_core/resilientFetch.js");

// ── Helpers ──────────────────────────────────────────────────────────────────

function jsonResponse(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Build a mock DB that:
 *  - On insert().values(v): captures v into `captured` and resolves.
 *  - On select().from().where().limit(): returns `selectRows`.
 */
function buildMockDb(
  captured: { row?: Record<string, unknown> },
  selectRows: unknown[] = []
) {
  return {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockImplementation(async (row: Record<string, unknown>) => {
        captured.row = row;
        return true;
      }),
    }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(selectRows),
        }),
      }),
    }),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("VirtualCardService — AES-256-GCM PAN encrypt/decrypt round-trip", () => {
  const KNOWN_PAN = "4111111111111111";

  beforeEach(() => {
    __resetCircuitBreakers();
    vi.restoreAllMocks();
  });

  it("issueCard encrypts the PAN; revealPan decrypts it back to the original", async () => {
    const captured: { row?: Record<string, unknown> } = {};

    // issueCard: fetch succeeds with a known PAN, DB insert captures the row
    vi.mocked(getDb).mockResolvedValueOnce(buildMockDb(captured) as never);
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({
        token: "card_roundtrip",
        pan: KNOWN_PAN,
        last_four: "1111",
        exp_month: 12,
        exp_year: 2030,
      })
    );

    const svc = VirtualCardService.getInstance();
    const issued = await svc.issueCard({ spendLimitCents: 500, userId: "42" });
    expect(issued).not.toBeNull();

    // Verify the DB row has the three AES-GCM fields
    expect(captured.row).toMatchObject({
      encryptedCredentials: expect.any(String),
      ivHex: expect.any(String),
      authTagHex: expect.any(String),
      lastFour: "1111",
    });

    // The encrypted blob must not contain the plaintext PAN
    expect(String(captured.row!.encryptedCredentials)).not.toContain(KNOWN_PAN);

    // revealPan: DB select returns the captured encrypted row
    vi.mocked(getDb).mockResolvedValueOnce(
      buildMockDb(
        {},
        [
          {
            encryptedCredentials: captured.row!.encryptedCredentials,
            ivHex: captured.row!.ivHex,
            authTagHex: captured.row!.authTagHex,
          },
        ]
      ) as never
    );

    const revealed = await svc.revealPan("card_roundtrip", 42);
    expect(revealed).toBe(KNOWN_PAN);
  });

  it("each call to issueCard produces a different IV (ciphertext is non-deterministic)", async () => {
    const first: { row?: Record<string, unknown> } = {};
    const second: { row?: Record<string, unknown> } = {};

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ token: "card_a", pan: KNOWN_PAN, last_four: "1111" })
    );
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ token: "card_b", pan: KNOWN_PAN, last_four: "1111" })
    );

    const svc = VirtualCardService.getInstance();

    vi.mocked(getDb).mockResolvedValueOnce(buildMockDb(first) as never);
    await svc.issueCard({ spendLimitCents: 100, userId: "1" });

    vi.mocked(getDb).mockResolvedValueOnce(buildMockDb(second) as never);
    await svc.issueCard({ spendLimitCents: 100, userId: "1" });

    // Different IVs → same plaintext encrypts to different ciphertext
    expect(first.row!.ivHex).not.toBe(second.row!.ivHex);
    expect(first.row!.encryptedCredentials).not.toBe(second.row!.encryptedCredentials);
  });

  it("revealPan returns null when the card row has no encrypted credentials", async () => {
    // Simulate a row missing encryption data (e.g. created before AES was introduced)
    vi.mocked(getDb).mockResolvedValueOnce(
      buildMockDb(
        {},
        [{ encryptedCredentials: null, ivHex: null, authTagHex: null }]
      ) as never
    );

    const svc = VirtualCardService.getInstance();
    const result = await svc.revealPan("card_missing", 1);
    expect(result).toBeNull();
  });

  it("revealPan returns null when the DB select returns an empty set", async () => {
    // Verifies null-return branch when no row is returned (e.g. wrong token).
    // The ownership WHERE clause SQL is verified separately in the real-DB test below.
    vi.mocked(getDb).mockResolvedValueOnce(
      buildMockDb({}, []) as never
    );

    const svc = VirtualCardService.getInstance();
    const result = await svc.revealPan("card_other_user", 99);
    expect(result).toBeNull();
  });

  it("revealPan ownership filter: real-DB WHERE clause rejects a different userId", async () => {
    // Uses a real in-memory SQLite DB so the AND(token=x, userId=y) predicate
    // actually executes — a SQL bug (wrong column, missing and()) would be caught.
    const testDb = await createTestDb();
    const owner = await seedUser(testDb.db, { role: "user" });

    // Seed a card row for `owner.id` with dummy (non-functional) AES values.
    // The test never decrypts these — it verifies the WHERE clause returns no row.
    await testDb.db.insert(virtualCards).values({
      userId: owner.id,
      token: "card-owner-only",
      memo: "ownership test card",
      lastFour: "9999",
      expMonth: 12,
      expYear: 2030,
      encryptedCredentials: "ZHVtbXk=",
      ivHex: "0".repeat(32),
      authTagHex: "0".repeat(32),
      spendLimitCents: 100,
      status: "OPEN",
    });

    vi.mocked(getDb).mockResolvedValueOnce(testDb.db as never);

    const svc = VirtualCardService.getInstance();
    // A different userId — WHERE clause should find no matching row
    const result = await svc.revealPan("card-owner-only", owner.id + 999);
    expect(result).toBeNull();
  });

  it("GCM authentication: tampered authTag causes decryption to throw", async () => {
    const captured: { row?: Record<string, unknown> } = {};

    vi.mocked(getDb).mockResolvedValueOnce(buildMockDb(captured) as never);
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({ token: "card_tamper", pan: KNOWN_PAN, last_four: "1111" })
    );

    const svc = VirtualCardService.getInstance();
    await svc.issueCard({ spendLimitCents: 100, userId: "7" });

    // Flip the first byte of the auth tag (any corruption invalidates GCM auth)
    const originalTag = captured.row!.authTagHex as string;
    const flippedByte = (parseInt(originalTag.slice(0, 2), 16) ^ 0xff)
      .toString(16)
      .padStart(2, "0");
    const tamperedTag = flippedByte + originalTag.slice(2);

    vi.mocked(getDb).mockResolvedValueOnce(
      buildMockDb(
        {},
        [
          {
            encryptedCredentials: captured.row!.encryptedCredentials,
            ivHex: captured.row!.ivHex,
            authTagHex: tamperedTag, // tampered
          },
        ]
      ) as never
    );

    // GCM decryption with wrong auth tag throws "Unsupported state or unable to authenticate data"
    await expect(svc.revealPan("card_tamper", 7)).rejects.toThrow();
  });
});
