import { createHash, createHmac, timingSafeEqual } from "crypto";

/** One advertised model entry, matching `NodeCapabilities.models[number]`. */
interface HashableModel {
  name: string;
  contextWindow: number;
  vramReq: number;
  provider?: string;
}

/**
 * Deterministic short hash of a node's advertised model list — the mDNS TXT
 * "catalog version" for Model-Fabric Decision 4 (beacon-minimal advertising).
 * A peer compares this against its cached value for the node and only fetches
 * the full list over mTLS (`GET /models`) when it changes, so the TXT record
 * stays small regardless of how many models a node hosts. Order-independent
 * (sorted before hashing) so re-publishing the same model set in a different
 * enumeration order never looks like a change.
 */
export function hashModelList(models: HashableModel[]): string {
  const canonical = models
    .map((m) => `${m.name}|${m.contextWindow}|${m.vramReq}|${m.provider ?? ""}`)
    .sort()
    .join("\n");
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

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
