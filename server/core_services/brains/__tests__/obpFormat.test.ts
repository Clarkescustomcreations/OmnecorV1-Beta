/**
 * `.obp` Brain Pack container format — pure pack/unpack + integrity tests.
 * No DB, no vector store, no embedder: this exercises the self-contained format
 * logic (gzip round-trip, base64 F32LE embeddings, charter-hash and chunk-count
 * integrity, dimension validation) directly.
 */
import { describe, it, expect } from "vitest";
import zlib from "zlib";
import {
  packBrain,
  unpackBrain,
  encodeEmbedding,
  decodeEmbedding,
  computeCharterHash,
  OBP_FORMAT_VERSION,
  type PackBrainInput,
} from "../obpFormat.js";

/** Build a deterministic unit-ish vector of the given dimension. */
function vec(dim: number, seed: number): number[] {
  return Array.from({ length: dim }, (_, i) => Math.sin(seed + i) * 0.1);
}

function sampleInput(over: Partial<PackBrainInput> = {}): PackBrainInput {
  return {
    id: "coding-basics",
    name: "Coding Basics",
    version: "1.0.0",
    domain: "coding",
    description: "A small coding brain",
    embedder: { id: "all-MiniLM-L6-v2", dim: 384 },
    charter: "Always write tests. Prefer clarity over cleverness.",
    chunks: [
      { id: "c1", text: "Use optional chaining to guard nulls.", metadata: { topic: "ts" }, embedding: vec(384, 1) },
      { id: "c2", text: "Memoize expensive React renders.", metadata: { topic: "react" }, embedding: vec(384, 2) },
    ],
    provenance: { source: "curated", builtBy: "test" },
    ...over,
  };
}

describe("obpFormat — embedding codec", () => {
  it("round-trips a vector exactly through base64 F32LE", () => {
    const v = vec(384, 7);
    const decoded = decodeEmbedding(encodeEmbedding(v), 384);
    expect(decoded.length).toBe(384);
    // Float32 precision: compare with tolerance.
    for (let i = 0; i < v.length; i++) {
      expect(decoded[i]).toBeCloseTo(v[i], 5);
    }
  });

  it("rejects a blob whose byte length is not a multiple of 4", () => {
    const bad = Buffer.from([1, 2, 3]).toString("base64");
    expect(() => decodeEmbedding(bad)).toThrow(/not a multiple of 4/i);
  });

  it("rejects a blob that decodes to the wrong dimension", () => {
    const b64 = encodeEmbedding(vec(128, 1));
    expect(() => decodeEmbedding(b64, 384)).toThrow(/dimension mismatch/i);
  });
});

describe("obpFormat — pack / unpack", () => {
  it("round-trips a full pack", () => {
    const buf = packBrain(sampleInput());
    const pack = unpackBrain(buf);
    expect(pack.manifest.formatVersion).toBe(OBP_FORMAT_VERSION);
    expect(pack.manifest.id).toBe("coding-basics");
    expect(pack.manifest.chunkCount).toBe(2);
    expect(pack.manifest.embedder).toEqual({ id: "all-MiniLM-L6-v2", dim: 384 });
    expect(pack.manifest.charterSha256).toBe(computeCharterHash(sampleInput().charter));
    expect(pack.charter).toContain("Always write tests");
    expect(pack.chunks.map(c => c.id)).toEqual(["c1", "c2"]);
    expect(decodeEmbedding(pack.chunks[0].embedding, 384).length).toBe(384);
  });

  it("produces a gzip stream (magic bytes 0x1f 0x8b)", () => {
    const buf = packBrain(sampleInput());
    expect(buf[0]).toBe(0x1f);
    expect(buf[1]).toBe(0x8b);
  });

  it("rejects a chunk whose embedding dimension disagrees with the embedder", () => {
    expect(() =>
      packBrain(sampleInput({
        chunks: [{ id: "c1", text: "x", embedding: vec(128, 1) }],
      }))
    ).toThrow(/embedding has 128 dims, expected 384/i);
  });

  it("rejects non-gzip input", () => {
    expect(() => unpackBrain(Buffer.from("not a pack"))).toThrow(/not a valid \.obp/i);
  });

  it("rejects a tampered charter (hash mismatch)", () => {
    const pack = unpackBrain(packBrain(sampleInput()));
    // Tamper: change the charter text but keep the old hash in the manifest.
    const tampered = { ...pack, charter: pack.charter + " (edited)" };
    const buf = zlib.gzipSync(Buffer.from(JSON.stringify(tampered), "utf-8"));
    expect(() => unpackBrain(buf)).toThrow(/charter hash mismatch/i);
  });

  it("rejects a chunk-count mismatch", () => {
    const pack = unpackBrain(packBrain(sampleInput()));
    const broken = { ...pack, chunks: pack.chunks.slice(0, 1) }; // manifest still says 2
    const buf = zlib.gzipSync(Buffer.from(JSON.stringify(broken), "utf-8"));
    expect(() => unpackBrain(buf)).toThrow(/chunk count mismatch/i);
  });

  it("rejects an unknown format version", () => {
    const pack = unpackBrain(packBrain(sampleInput()));
    const broken = { ...pack, manifest: { ...pack.manifest, formatVersion: 99 } };
    const buf = zlib.gzipSync(Buffer.from(JSON.stringify(broken), "utf-8"));
    expect(() => unpackBrain(buf)).toThrow(/invalid brain pack/i);
  });

  it("accepts an empty corpus (charter-only brain)", () => {
    const buf = packBrain(sampleInput({ chunks: [] }));
    const pack = unpackBrain(buf);
    expect(pack.manifest.chunkCount).toBe(0);
    expect(pack.chunks).toEqual([]);
  });
});
