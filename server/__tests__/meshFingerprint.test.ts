/**
 * Regression test for the Session-31 OMMESH inbound-trust bug.
 *
 * The mesh pins peers by SHA-256 fingerprint with colons stripped — that is
 * the form DiscoveryService advertises, `ommesh.approvePeer` stores, and the
 * outbound `checkServerIdentity` compares. MeshServer's inbound gate used to
 * read `getPeerCertificate().fingerprint` (SHA-1, colon-separated), which can
 * NEVER equal a stored pin — so an approved peer was still rejected with 403
 * `untrusted_peer` on every inbound request. `canonicalPeerFingerprint` is the
 * single normalization both sides now share; live-verified 2026-07-02
 * (Linux → DadsPC `MESH_MTLS_OK`).
 */
import { describe, it, expect } from "vitest";
import { canonicalPeerFingerprint } from "../ommesh/core/MeshServer.js";

const SHA256_COLONS =
  "2E:0F:BE:9A:3E:22:1C:7F:01:E7:9A:C1:F5:4D:66:A3:68:DD:7E:53:82:06:EB:32:88:5C:0D:5A:7C:6B:CE:9D";
const SHA256_PINNED = SHA256_COLONS.replace(/:/g, "");

describe("canonicalPeerFingerprint (OMMESH inbound trust gate)", () => {
  it("normalizes fingerprint256 to the pinned form (colons stripped)", () => {
    expect(canonicalPeerFingerprint({ fingerprint256: SHA256_COLONS })).toBe(SHA256_PINNED);
  });

  it("matches exactly what approvePeer pins from discovery (round-trip equality)", () => {
    // DiscoveryService advertises fingerprint256.replace(/:/g,'') — the same
    // string an admin approves. The inbound form must be identical.
    const advertised = SHA256_COLONS.replace(/:/g, "");
    expect(canonicalPeerFingerprint({ fingerprint256: SHA256_COLONS })).toBe(advertised);
  });

  it("ignores the legacy SHA-1 `.fingerprint` field entirely", () => {
    const cert = {
      fingerprint: "AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD",
      fingerprint256: SHA256_COLONS,
    };
    expect(canonicalPeerFingerprint(cert)).toBe(SHA256_PINNED);
    expect(canonicalPeerFingerprint(cert)).not.toContain(":");
  });

  it("returns empty (fail-closed) for a missing/undefined certificate", () => {
    expect(canonicalPeerFingerprint(undefined)).toBe("");
    expect(canonicalPeerFingerprint(null)).toBe("");
    expect(canonicalPeerFingerprint({})).toBe("");
  });
});
