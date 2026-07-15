/**
 * VectorStore factory — backend selection. The embedded (libSQL-native) store
 * is the zero-infra DEFAULT; ChromaDB is opt-in via OMNECOR_VECTOR_BACKEND so
 * the whole app stays on ONE backend (no writer/reader split-brain).
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  resolveVectorBackend,
  getVectorStore,
  __resetVectorStoreForTests,
} from "../VectorStore.js";
import { EmbeddedVectorStore } from "../EmbeddedVectorStore.js";
import { VectorDBService } from "../VectorDBService.js";

const original = process.env.OMNECOR_VECTOR_BACKEND;

afterEach(() => {
  if (original === undefined) delete process.env.OMNECOR_VECTOR_BACKEND;
  else process.env.OMNECOR_VECTOR_BACKEND = original;
  __resetVectorStoreForTests();
});

describe("resolveVectorBackend", () => {
  it("defaults to the embedded backend", () => {
    delete process.env.OMNECOR_VECTOR_BACKEND;
    expect(resolveVectorBackend()).toBe("embedded");
  });

  it("selects chroma only when explicitly configured", () => {
    process.env.OMNECOR_VECTOR_BACKEND = "chroma";
    expect(resolveVectorBackend()).toBe("chroma");
  });

  it("falls back to embedded for any unrecognized value", () => {
    process.env.OMNECOR_VECTOR_BACKEND = "pinecone";
    expect(resolveVectorBackend()).toBe("embedded");
  });
});

describe("getVectorStore", () => {
  it("returns the EmbeddedVectorStore by default", () => {
    delete process.env.OMNECOR_VECTOR_BACKEND;
    __resetVectorStoreForTests();
    expect(getVectorStore()).toBeInstanceOf(EmbeddedVectorStore);
  });

  it("returns the ChromaDB VectorDBService when configured", () => {
    process.env.OMNECOR_VECTOR_BACKEND = "chroma";
    __resetVectorStoreForTests();
    expect(getVectorStore()).toBeInstanceOf(VectorDBService);
  });

  it("memoizes the store instance for a given backend", () => {
    delete process.env.OMNECOR_VECTOR_BACKEND;
    __resetVectorStoreForTests();
    expect(getVectorStore()).toBe(getVectorStore());
  });
});
