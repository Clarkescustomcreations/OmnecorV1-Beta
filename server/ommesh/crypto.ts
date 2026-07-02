import { createHash, createHmac, timingSafeEqual } from "crypto";

/**
 * Constant-time comparison of two OMMESH secrets. Both sides are SHA-256
 * hashed first so the buffers are always equal length (timingSafeEqual
 * throws on length mismatch) and the comparison never leaks secret length.
 *
 * Used by WebSocketServer (mobile-node registration) and in tests.
 */
export function secretsMatch(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Verify an HMAC-SHA256 signature over the canonical payload (all body
 * fields except `sig`) using the provided OMMESH_SECRET. Fails closed when
 * secret is undefined or empty. The non-hex guard prevents timingSafeEqual
 * from receiving a length-mismatched buffer and throwing.
 *
 * Used by MeshServer (peer sync + mobile-node registration) and in tests.
 */
export function verifyHmacSig(
  parsedBody: Record<string, unknown>,
  sig: string,
  secret: string | undefined,
): boolean {
  if (!secret) return false;
  try {
    const canonical: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(parsedBody)) {
      if (k !== "sig") canonical[k] = v;
    }
    const canonicalStr = JSON.stringify(canonical);
    const expected = createHmac("sha256", secret).update(canonicalStr).digest("hex");
    const expectedBuf = Buffer.from(expected, "hex");
    if (!/^[0-9a-fA-F]{64}$/.test(sig)) return false;
    const sigBuf = Buffer.from(sig, "hex");
    if (sigBuf.length !== expectedBuf.length) return false;
    return timingSafeEqual(expectedBuf, sigBuf);
  } catch {
    return false;
  }
}
