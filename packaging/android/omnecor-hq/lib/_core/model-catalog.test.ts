/**
 * Unit tests for the backend-aware model catalog — the pure logic that decides
 * whether a file can execute on the Hexagon NPU and which variant a user
 * downloads for their acceleration mode. (Device probing / engine loading is
 * native-only and covered by the on-device verification pass.)
 */
import { describe, it, expect } from "vitest";
import {
  classifyQuant, isNpuQuant, isNpuCapableFile, pickVariant,
  variantToModelInfo, capabilitiesForFile,
  GGUF_CATALOG, LITERT_CATALOG,
} from "./model-catalog";

describe("classifyQuant", () => {
  it("classifies every quant token, most specific first", () => {
    expect(classifyQuant("Mistral-7B-Instruct-v0.3-IQ4_NL.gguf")).toBe("iq4_nl");
    expect(classifyQuant("Llama-3.2-3B-Instruct-Q4_K_M.gguf")).toBe("q4_k_m");
    expect(classifyQuant("Llama-3.2-3B-Instruct-Q4_0.gguf")).toBe("q4_0");
    expect(classifyQuant("Llama-3.2-1B-Instruct-Q8_0.gguf")).toBe("q8_0");
    expect(classifyQuant("gpt-oss-20b-MXFP4.gguf")).toBe("mxfp4");
    expect(classifyQuant("model-f16.gguf")).toBe("f16");
    expect(classifyQuant("some-random-model.gguf")).toBe("unknown");
  });

  it("is case-insensitive and accepts dash separators", () => {
    expect(classifyQuant("MODEL-iq4-nl.GGUF")).toBe("iq4_nl");
    expect(classifyQuant("model-q4-k-m.gguf")).toBe("q4_k_m");
    expect(classifyQuant("model-Q4-0.gguf")).toBe("q4_0");
  });

  it("never mistakes a K-quant for the NPU-capable Q4_0", () => {
    // q4_k_m contains no "q4_0" token, but ordering still matters for q4_k
    // variants — a K-quant must NOT classify as NPU-capable.
    expect(isNpuCapableFile("Qwen2.5-7B-Instruct-Q4_K_M.gguf")).toBe(false);
    expect(isNpuCapableFile("Qwen2.5-7B-Instruct-Q4_0.gguf")).toBe(true);
  });
});

describe("isNpuQuant (ggml-hexagon supported set)", () => {
  it("accepts exactly Q4_0 / IQ4_NL / Q8_0 / MXFP4", () => {
    expect(isNpuQuant("q4_0")).toBe(true);
    expect(isNpuQuant("iq4_nl")).toBe(true);
    expect(isNpuQuant("q8_0")).toBe(true);
    expect(isNpuQuant("mxfp4")).toBe(true);
    expect(isNpuQuant("q4_k_m")).toBe(false);
    expect(isNpuQuant("f16")).toBe(false);
    expect(isNpuQuant("unknown")).toBe(false);
  });
});

describe("catalog integrity", () => {
  it("every GGUF model with 2 variants has one quality + one NPU file", () => {
    for (const m of GGUF_CATALOG) {
      expect(m.variants.length).toBeGreaterThanOrEqual(1);
      expect(m.variants.some((v) => v.npuCapable)).toBe(true);
      for (const v of m.variants) {
        // npuCapable must agree with the filename-derived truth the loaders use
        expect(v.npuCapable).toBe(isNpuCapableFile(v.filename));
        expect(v.url).toMatch(/^https:\/\/huggingface\.co\/.+\.(gguf|litertlm)$/);
        expect(v.sizeGb).toBeGreaterThan(0);
      }
    }
  });

  it("all current phone models are text-only (attachment gating truth)", () => {
    for (const m of [...GGUF_CATALOG, ...LITERT_CATALOG]) {
      expect(m.capabilities).toEqual({ images: false, files: false });
      for (const v of m.variants) {
        expect(capabilitiesForFile(v.filename)).toEqual({ images: false, files: false });
      }
    }
  });

  it("unknown files default to text-only capabilities", () => {
    expect(capabilitiesForFile("mystery-model.gguf")).toEqual({ images: false, files: false });
  });
});

describe("pickVariant", () => {
  const llama3b = GGUF_CATALOG.find((m) => m.name === "Llama-3.2-3B")!;

  it("npu/auto modes pick the NPU-capable file", () => {
    expect(pickVariant(llama3b, "npu").quant).toBe("q4_0");
    expect(pickVariant(llama3b, "auto").quant).toBe("q4_0");
  });

  it("gpu/cpu modes pick the quality file", () => {
    expect(pickVariant(llama3b, "gpu").quant).toBe("q4_k_m");
    expect(pickVariant(llama3b, "cpu").quant).toBe("q4_k_m");
  });

  it("falls back to the only variant when no better match exists", () => {
    const tiny = GGUF_CATALOG.find((m) => m.name === "Llama-3.2-1B")!;
    // Single Q8_0 variant serves every mode (it's both quality AND NPU-capable).
    expect(pickVariant(tiny, "cpu").quant).toBe("q8_0");
    expect(pickVariant(tiny, "npu").quant).toBe("q8_0");
    for (const m of LITERT_CATALOG) {
      expect(pickVariant(m, "npu")).toBe(m.variants[0]);
    }
  });
});

describe("variantToModelInfo", () => {
  it("adapts a variant to the download spec with a quant-suffixed name", () => {
    const llama3b = GGUF_CATALOG.find((m) => m.name === "Llama-3.2-3B")!;
    const npu = llama3b.variants.find((v) => v.npuCapable)!;
    const spec = variantToModelInfo(llama3b, npu);
    expect(spec.name).toBe("Llama-3.2-3B (Q4_0)");
    expect(spec.filename).toBe(npu.filename);
    expect(spec.sizeGb).toBe(npu.sizeGb);
    expect(spec.url).toBe(npu.url);
  });
});
