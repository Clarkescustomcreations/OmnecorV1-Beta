/**
 * Regression coverage for the local-owner password hashing scheme in
 * `server/_core/oauth.ts` (CodeQL: js/insufficient-password-hash).
 *
 * `hashPassword`/`verifyPassword` were hardened to use explicit
 * OWASP-recommended scrypt cost parameters (N=2^17, r=8, p=1) instead of
 * Node's lower built-in defaults, with the cost encoded into the stored hash
 * string so already-hashed passwords (old "<salt>:<hash>" format, implicitly
 * N=16384) keep working after the upgrade.
 */
import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "../_core/oauth.js";
import crypto from "node:crypto";

// The hardened cost (N=2^17) makes each hash deliberately expensive (~1s+ on a
// loaded machine, several hashes per test). Vitest's 5s default flakes under
// full-suite parallelism — give these tests explicit headroom.
const SCRYPT_TEST_TIMEOUT_MS = 60_000;

describe("local auth password hashing", { timeout: SCRYPT_TEST_TIMEOUT_MS }, () => {
  it("hashes with the hardened cost and round-trips through verifyPassword", async () => {
    const stored = await hashPassword("correct horse battery staple");
    expect(stored).toMatch(/^scrypt:131072:8:1:[0-9a-f]{32}:[0-9a-f]{128}$/);

    await expect(
      verifyPassword("correct horse battery staple", stored)
    ).resolves.toBe(true);
    await expect(verifyPassword("wrong password", stored)).resolves.toBe(
      false
    );
  });

  it("still verifies legacy '<salt>:<hash>' hashes from Node's old scrypt defaults", async () => {
    const salt = crypto.randomBytes(16);
    const derived = await new Promise<Buffer>((resolve, reject) => {
      crypto.scrypt(
        "legacy-password",
        salt,
        64,
        { N: 16384, r: 8, p: 1 },
        (err, buf) => (err ? reject(err) : resolve(buf))
      );
    });
    const legacyStored = `${salt.toString("hex")}:${derived.toString("hex")}`;

    await expect(
      verifyPassword("legacy-password", legacyStored)
    ).resolves.toBe(true);
    await expect(
      verifyPassword("wrong-password", legacyStored)
    ).resolves.toBe(false);
  });

  it("rejects malformed stored hashes instead of throwing", async () => {
    await expect(
      verifyPassword("anything", "not-a-valid-hash")
    ).resolves.toBe(false);
    await expect(verifyPassword("anything", "")).resolves.toBe(false);
    await expect(
      verifyPassword("anything", "scrypt:not-a-number:8:1:abcd:abcd")
    ).resolves.toBe(false);
  });

  it("produces a unique salt (and hash) per call for the same password", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    expect(a).not.toBe(b);
  });
});
