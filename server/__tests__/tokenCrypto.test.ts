/**
 * Batch B — Items 14 & 15: Token at-rest crypto and OMMESH HMAC verification
 *
 * Item 15 — TokenRefreshService AES-256-GCM at-rest encryption:
 *   encryptToken() → decryptToken() round-trip when JWT_SECRET is set.
 *   Legacy base64 path (no JWT_SECRET) still works but warns.
 *   Tampered ciphertext throws a GCM authentication error.
 *
 * Item 14 — OMMESH HMAC timing-safe secret comparison:
 *   Exercises the REAL production functions from server/ommesh/crypto.ts
 *   (secretsMatch + verifyHmacSig) which are shared by MeshServer and
 *   WebSocketServer. Tests call the actual implementations, not inline copies.
 *     - Correct HMAC + timingSafeEqual → true.
 *     - Wrong secret → false.
 *     - Non-hex signature string (length mismatch guard) → false.
 *     - No OMMESH_SECRET configured → false (fail-closed).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHmac } from "crypto";
import { secretsMatch, verifyHmacSig } from "../ommesh/crypto.js";

// ── Item 15: TokenRefreshService at-rest encryption ──────────────────────────

describe("TokenRefreshService — AES-256-GCM token at-rest encryption (item 15)", () => {
  const ORIGINAL_JWT_SECRET = process.env.JWT_SECRET;

  beforeEach(() => {
    // Ensure a stable key for deterministic test setup
    process.env.JWT_SECRET = "test_jwt_secret_32bytes_minimum!!";
    // Also seed the cookie secret ENV reads (JWT_SECRET is the canonical env var
    // but ENV.cookieSecret may read from it directly)
    process.env.COOKIE_SECRET = process.env.JWT_SECRET;
  });

  afterEach(() => {
    if (ORIGINAL_JWT_SECRET === undefined) {
      delete process.env.JWT_SECRET;
      delete process.env.COOKIE_SECRET;
    } else {
      process.env.JWT_SECRET = ORIGINAL_JWT_SECRET;
    }
    vi.resetModules();
  });

  it("round-trip: encryptToken → decryptToken returns the original plaintext", async () => {
    const { encryptToken, decryptToken } = await import(
      "../phase2/services/TokenRefreshService.js"
    );
    const plaintext = "ya29.oauth-access-token-value";
    const encrypted = encryptToken(plaintext);
    expect(decryptToken(encrypted)).toBe(plaintext);
  });

  it("encrypted form has the v1: prefix and contains iv, tag, ciphertext", async () => {
    const { encryptToken } = await import(
      "../phase2/services/TokenRefreshService.js"
    );
    const encrypted = encryptToken("some-token");
    expect(encrypted).toMatch(/^v1:[0-9a-f]+:[0-9a-f]+:.+$/);
  });

  it("each call produces a different ciphertext (fresh random IV per call)", async () => {
    const { encryptToken } = await import(
      "../phase2/services/TokenRefreshService.js"
    );
    const a = encryptToken("same-plaintext");
    const b = encryptToken("same-plaintext");
    // Different IVs → different ciphertexts even for the same plaintext
    expect(a).not.toBe(b);
  });

  it("plaintext never appears in the encrypted output", async () => {
    const { encryptToken } = await import(
      "../phase2/services/TokenRefreshService.js"
    );
    const secret = "super-secret-token-value-1234";
    const encrypted = encryptToken(secret);
    expect(encrypted).not.toContain(secret);
  });

  it("GCM authentication: tampered ciphertext throws on decryption", async () => {
    const { encryptToken, decryptToken } = await import(
      "../phase2/services/TokenRefreshService.js"
    );
    const encrypted = encryptToken("sensitive-token");
    // Format: v1:<ivHex>:<tagHex>:<cipherBase64>
    const parts = encrypted.split(":");
    // Corrupt one character of the ciphertext (base64, last segment)
    const corrupted = parts.slice(0, 3).join(":") + ":" + parts[3].slice(0, -1) + "X";
    expect(() => decryptToken(corrupted)).toThrow();
  });

  it("legacy base64 path (no JWT_SECRET): encryptToken stores base64, decryptToken recovers it", async () => {
    delete process.env.JWT_SECRET;
    delete process.env.COOKIE_SECRET;
    vi.resetModules();

    const { encryptToken, decryptToken } = await import(
      "../phase2/services/TokenRefreshService.js"
    );
    const plaintext = "legacy-oauth-token";
    const encoded = encryptToken(plaintext);
    // Without JWT_SECRET the function falls back to plain base64 (no v1: prefix)
    expect(encoded).not.toMatch(/^v1:/);
    expect(decryptToken(encoded)).toBe(plaintext);
  });

  it("decryptToken handles a raw base64 legacy token (no v1: prefix)", async () => {
    const { decryptToken } = await import(
      "../phase2/services/TokenRefreshService.js"
    );
    const plaintext = "slack-bot-token-xoxb-abc";
    // Simulate a token that was stored before AES encryption was introduced
    const legacyEncoded = Buffer.from(plaintext).toString("base64");
    expect(decryptToken(legacyEncoded)).toBe(plaintext);
  });
});

// ── Item 14: OMMESH timing-safe HMAC verification ────────────────────────────
//
// secretsMatch and verifyHmacSig are imported directly from the production
// module server/ommesh/crypto.ts, which is the shared implementation used by
// both WebSocketServer (secretsMatch) and MeshServer (verifyHmacSig).
// Tests exercise the real code — any change to the production implementation
// is immediately reflected here.

describe("OMMESH timing-safe secret comparison — secretsMatch (item 14)", () => {
  it("correct secret matches itself", () => {
    expect(secretsMatch("correct-ommesh-secret", "correct-ommesh-secret")).toBe(true);
  });

  it("wrong secret does not match", () => {
    expect(secretsMatch("correct-ommesh-secret", "wrong-ommesh-secret")).toBe(false);
  });

  it("comparison always uses equal-length buffers (SHA-256 output is always 32 bytes)", () => {
    // timingSafeEqual throws if buffer lengths differ; SHA-256 pre-hashing prevents this
    // even when secrets have wildly different lengths.
    expect(() => secretsMatch("a", "a-very-long-secret-that-differs-in-length")).not.toThrow();
    expect(secretsMatch("a", "a-very-long-secret-that-differs-in-length")).toBe(false);
  });

  it("empty string is not equal to a non-empty string", () => {
    expect(secretsMatch("", "anything")).toBe(false);
  });

  it("empty string matches empty string", () => {
    expect(secretsMatch("", "")).toBe(true);
  });
});

describe("OMMESH HMAC mobile-registration signature — verifyHmacSig (item 14)", () => {
  const TEST_SECRET = "test-ommesh-secret-xyz";

  function buildSig(body: Record<string, unknown>, secret: string): string {
    const canonical = Object.fromEntries(
      Object.entries(body).filter(([k]) => k !== "sig")
    );
    return createHmac("sha256", secret).update(JSON.stringify(canonical)).digest("hex");
  }

  it("correct HMAC signature → true", () => {
    const body = { type: "mobile_node_register", nodeId: "phone-abc", timestamp: 1700000000 };
    const sig = buildSig(body, TEST_SECRET);
    expect(verifyHmacSig(body, sig, TEST_SECRET)).toBe(true);
  });

  it("wrong secret → false", () => {
    const body = { type: "mobile_node_register", nodeId: "phone-abc", timestamp: 1700000000 };
    const sig = buildSig(body, TEST_SECRET);
    expect(verifyHmacSig(body, sig, "WRONG-SECRET")).toBe(false);
  });

  it("tampered body (different nodeId) → false", () => {
    const body = { type: "mobile_node_register", nodeId: "phone-abc", timestamp: 1700000000 };
    const sig = buildSig(body, TEST_SECRET);
    const tamperedBody = { ...body, nodeId: "attacker-node" };
    expect(verifyHmacSig(tamperedBody, sig, TEST_SECRET)).toBe(false);
  });

  it("non-hex signature string (e.g. injection payload) → false (guard prevents timingSafeEqual throw)", () => {
    const body = { type: "register", nodeId: "x" };
    // Not a valid 64-char hex string → rejected by the regex guard before timingSafeEqual
    expect(verifyHmacSig(body, "'; DROP TABLE nodes; --", TEST_SECRET)).toBe(false);
    expect(verifyHmacSig(body, "<script>alert(1)</script>", TEST_SECRET)).toBe(false);
    expect(verifyHmacSig(body, "short", TEST_SECRET)).toBe(false);
    // 63 chars (one char short of the required 64)
    expect(verifyHmacSig(body, "a".repeat(63), TEST_SECRET)).toBe(false);
  });

  it("no OMMESH_SECRET configured → fail-closed (always returns false)", () => {
    const body = { type: "register", nodeId: "phone" };
    const sig = buildSig(body, TEST_SECRET);
    // undefined secret → fail-closed
    expect(verifyHmacSig(body, sig, undefined)).toBe(false);
  });

  it("the `sig` field is excluded from the canonical payload before signing", () => {
    // If `sig` were included, signing would be circular; exclusion is essential.
    const body = { type: "register", nodeId: "phone-xyz", timestamp: 999 };
    const sig = buildSig(body, TEST_SECRET);
    // Send the same body WITH the sig field included — the canonical excludes it
    const bodyWithSig = { ...body, sig };
    expect(verifyHmacSig(bodyWithSig, sig, TEST_SECRET)).toBe(true);
  });
});
