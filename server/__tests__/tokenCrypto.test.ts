/**
 * Batch B — Items 14 & 15: Token at-rest crypto and OMMESH HMAC verification
 *
 * Item 15 — platformTokens AES-256-GCM at-rest encryption:
 *   encryptPlatformToken() → decryptPlatformToken() round-trip when JWT_SECRET is set.
 *   Legacy plaintext passthrough (no JWT_SECRET, or tokens written before
 *   encryption existed) still resolves.
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
import { secretsMatch, verifyHmacSig, hashModelList } from "../ommesh/crypto.js";

// ── Item 15: platformTokens at-rest encryption ───────────────────────────────

describe("platformTokens — AES-256-GCM token at-rest encryption (item 15)", () => {
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

  it("round-trip: encryptPlatformToken → decryptPlatformToken returns the original plaintext", async () => {
    const { encryptPlatformToken, decryptPlatformToken } = await import(
      "../oauth/platformTokens.js"
    );
    const plaintext = "ya29.oauth-access-token-value";
    const encrypted = encryptPlatformToken(plaintext);
    expect(decryptPlatformToken(encrypted)).toBe(plaintext);
  });

  it("encrypted form has the v1: prefix and contains iv, tag, ciphertext", async () => {
    const { encryptPlatformToken } = await import("../oauth/platformTokens.js");
    const encrypted = encryptPlatformToken("some-token");
    expect(encrypted).toMatch(/^v1:[0-9a-f]+:[0-9a-f]+:.+$/);
  });

  it("each call produces a different ciphertext (fresh random IV per call)", async () => {
    const { encryptPlatformToken } = await import("../oauth/platformTokens.js");
    const a = encryptPlatformToken("same-plaintext");
    const b = encryptPlatformToken("same-plaintext");
    // Different IVs → different ciphertexts even for the same plaintext
    expect(a).not.toBe(b);
  });

  it("plaintext never appears in the encrypted output", async () => {
    const { encryptPlatformToken } = await import("../oauth/platformTokens.js");
    const secret = "super-secret-token-value-1234";
    const encrypted = encryptPlatformToken(secret);
    expect(encrypted).not.toContain(secret);
  });

  it("GCM authentication: tampered ciphertext throws on decryption", async () => {
    const { encryptPlatformToken, decryptPlatformToken } = await import(
      "../oauth/platformTokens.js"
    );
    const encrypted = encryptPlatformToken("sensitive-token");
    // Format: v1:<ivHex>:<tagHex>:<cipherBase64>
    const parts = encrypted.split(":");
    // Deterministically flip the first nibble of the GCM auth tag (hex). Any
    // change to the tag makes authentication fail, so this always throws — unlike
    // "replace last ciphertext char with X", which is a no-op when that char is
    // already X and made this test flaky under the full suite.
    const tag = parts[2];
    const flippedTag = (tag[0] === "0" ? "1" : "0") + tag.slice(1);
    const corrupted = [parts[0], parts[1], flippedTag, parts[3]].join(":");
    expect(() => decryptPlatformToken(corrupted)).toThrow();
  });

  it("no JWT_SECRET: stores plaintext (no v1: prefix), decrypt returns it unchanged", async () => {
    delete process.env.JWT_SECRET;
    delete process.env.COOKIE_SECRET;
    vi.resetModules();

    const { encryptPlatformToken, decryptPlatformToken } = await import(
      "../oauth/platformTokens.js"
    );
    const plaintext = "legacy-oauth-token";
    const encoded = encryptPlatformToken(plaintext);
    // Without JWT_SECRET the value is stored as-is (no encryption available)
    expect(encoded).not.toMatch(/^v1:/);
    expect(encoded).toBe(plaintext);
    expect(decryptPlatformToken(encoded)).toBe(plaintext);
  });

  it("decrypt passes through a legacy plaintext token (no v1: prefix) unchanged", async () => {
    const { decryptPlatformToken } = await import("../oauth/platformTokens.js");
    // A token written before at-rest encryption existed is stored verbatim.
    const legacyPlain = "xoxb-slack-bot-token-abc";
    expect(decryptPlatformToken(legacyPlain)).toBe(legacyPlain);
  });

  it("decrypt of null/undefined/empty returns empty string", async () => {
    const { decryptPlatformToken } = await import("../oauth/platformTokens.js");
    expect(decryptPlatformToken(null)).toBe("");
    expect(decryptPlatformToken(undefined)).toBe("");
    expect(decryptPlatformToken("")).toBe("");
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

// ── Model-Fabric Phase 4: hashModelList (mDNS TXT "catalog version") ────────

describe("hashModelList (Model-Fabric Phase 4 beacon-minimal advertising)", () => {
  it("is deterministic for the same model list", () => {
    const models = [{ name: "llama3.2:3b", contextWindow: 8192, vramReq: 2048, provider: "ollama" }];
    expect(hashModelList(models)).toBe(hashModelList(models));
  });

  it("is order-independent — re-enumerating the same set in a different order hashes the same", () => {
    const a = [
      { name: "llama3.2:3b", contextWindow: 8192, vramReq: 2048, provider: "ollama" },
      { name: "qwen2.5:7b", contextWindow: 32768, vramReq: 5000, provider: "ollama" },
    ];
    const b = [a[1]!, a[0]!];
    expect(hashModelList(a)).toBe(hashModelList(b));
  });

  it("changes when a model is added or removed", () => {
    const base = [{ name: "llama3.2:3b", contextWindow: 8192, vramReq: 2048, provider: "ollama" }];
    const withExtra = [...base, { name: "qwen2.5:7b", contextWindow: 32768, vramReq: 5000, provider: "ollama" }];
    expect(hashModelList(base)).not.toBe(hashModelList(withExtra));
    expect(hashModelList([])).not.toBe(hashModelList(base));
  });

  it("changes when a field on the same-named model changes (e.g. context window)", () => {
    const v1 = [{ name: "llama3.2:3b", contextWindow: 8192, vramReq: 2048, provider: "ollama" }];
    const v2 = [{ name: "llama3.2:3b", contextWindow: 4096, vramReq: 2048, provider: "ollama" }];
    expect(hashModelList(v1)).not.toBe(hashModelList(v2));
  });

  it("the empty list always hashes to the same constant", () => {
    expect(hashModelList([])).toBe(hashModelList([]));
    expect(hashModelList([])).toHaveLength(16);
  });
});
