/**
 * Backend-aware on-device model catalog.
 *
 * Every recommended model carries per-quant **variants** because the Hexagon
 * NPU (ggml-hexagon in llama.rn) only executes four weight formats — Q4_0,
 * Q8_0, IQ4_NL and MXFP4. K-quants (Q4_K_M etc.) silently fall back to CPU
 * per-op, so "run it on the NPU" is first a file-choice problem:
 *
 *   - `quality` variant: Q4_K_M — best quality per byte for GPU/CPU runs.
 *   - `npu` variant: IQ4_NL where the repo publishes it (near-K-quant quality),
 *     Q4_0 otherwise; Q8_0 for ~1B models. Availability was verified per repo
 *     (bartowski publishes IQ4_NL for some models, Q4_0 for others — never
 *     reliably both), and `sizeGb` values are the real content-lengths.
 *
 * Models also declare **capabilities** so the chat UI can disable attachment /
 * photo buttons while a text-only model is selected instead of erroring at
 * send time. All current on-device models are text-only; llama.rn ships
 * multimodal (mtmd) support, so a future vision GGUF just flips the flag.
 */
export type PhoneEngine = "gguf" | "litert";

export type QuantKind =
  | "q4_k_m" | "q4_0" | "iq4_nl" | "q8_0" | "mxfp4" | "f16" | "unknown";

export interface ModelCapabilities {
  /** Model can consume image attachments. */
  images: boolean;
  /** Model can consume non-image file attachments. */
  files: boolean;
}

export interface ModelVariant {
  /** Weight quantization of this file. */
  quant: QuantKind;
  /** Whether the Hexagon NPU can execute these weights (ggml-hexagon set). */
  npuCapable: boolean;
  filename: string;
  /** Real download size (content-length), decimal GB. */
  sizeGb: number;
  url: string;
}

export interface CatalogModel {
  /** Display name without quant suffix, e.g. "Llama-3.2-3B". */
  name: string;
  engine: PhoneEngine;
  description: string;
  recommendedForPhone: boolean;
  capabilities: ModelCapabilities;
  /** First entry is the quality default; `pickVariant` chooses by accel mode. */
  variants: ModelVariant[];
}

/** Single-file download spec — the shape `model-download.ts` operates on. */
export interface ModelInfo {
  name: string;
  filename: string;
  sizeGb: number;
  description: string;
  recommendedForPhone: boolean;
  url: string;
}

const TEXT_ONLY: ModelCapabilities = { images: false, files: false };

/** Weight formats the ggml-hexagon (HTP) backend executes natively. */
const NPU_QUANTS: ReadonlySet<QuantKind> = new Set(["q4_0", "iq4_nl", "q8_0", "mxfp4"]);

export function isNpuQuant(q: QuantKind): boolean {
  return NPU_QUANTS.has(q);
}

/**
 * Classify a GGUF filename's quant. Order matters: match the most specific
 * token first (iq4_nl before q4_0 substring-alikes, q4_k_m before q4_k).
 */
export function classifyQuant(filename: string): QuantKind {
  const f = filename.toLowerCase();
  if (/iq4[_-]nl/.test(f)) return "iq4_nl";
  if (/q4[_-]k[_-]m/.test(f)) return "q4_k_m";
  if (/q4[_-]0/.test(f)) return "q4_0";
  if (/q8[_-]0/.test(f)) return "q8_0";
  if (/mxfp4/.test(f)) return "mxfp4";
  if (/[_-]f16/.test(f)) return "f16";
  return "unknown";
}

/** Whether a GGUF file (by name) can execute on the Hexagon NPU. */
export function isNpuCapableFile(filename: string): boolean {
  return isNpuQuant(classifyQuant(filename));
}

function gguf(
  name: string,
  description: string,
  recommendedForPhone: boolean,
  variants: Omit<ModelVariant, "npuCapable">[],
): CatalogModel {
  return {
    name,
    engine: "gguf",
    description,
    recommendedForPhone,
    capabilities: TEXT_ONLY,
    variants: variants.map((v) => ({ ...v, npuCapable: isNpuQuant(v.quant) })),
  };
}

const HF = "https://huggingface.co";

/**
 * GGUF catalog (llama.rn engine). All URLs + sizes verified against
 * HuggingFace content-length on 2026-07-05.
 */
export const GGUF_CATALOG: CatalogModel[] = [
  gguf("Llama-3.2-3B", "Fast & compact — the S25 Ultra all-rounder", true, [
    {
      quant: "q4_k_m",
      filename: "Llama-3.2-3B-Instruct-Q4_K_M.gguf",
      sizeGb: 2.0,
      url: `${HF}/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf`,
    },
    {
      quant: "q4_0",
      filename: "Llama-3.2-3B-Instruct-Q4_0.gguf",
      sizeGb: 1.92,
      url: `${HF}/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_0.gguf`,
    },
  ]),
  gguf("Qwen2.5-3B", "Strong small Qwen — great NPU citizen", true, [
    {
      quant: "q4_k_m",
      filename: "Qwen2.5-3B-Instruct-Q4_K_M.gguf",
      sizeGb: 1.92,
      url: `${HF}/bartowski/Qwen2.5-3B-Instruct-GGUF/resolve/main/Qwen2.5-3B-Instruct-Q4_K_M.gguf`,
    },
    {
      quant: "q4_0",
      filename: "Qwen2.5-3B-Instruct-Q4_0.gguf",
      sizeGb: 1.82,
      url: `${HF}/bartowski/Qwen2.5-3B-Instruct-GGUF/resolve/main/Qwen2.5-3B-Instruct-Q4_0.gguf`,
    },
  ]),
  gguf("Llama-3.2-1B", "Tiny + Q8_0 — highest-fidelity small NPU model", true, [
    {
      quant: "q8_0",
      filename: "Llama-3.2-1B-Instruct-Q8_0.gguf",
      sizeGb: 1.32,
      url: `${HF}/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q8_0.gguf`,
    },
  ]),
  gguf("Qwen2.5-7B", "Highest quality — needs ~5 GB free RAM; may not load if memory is tight", false, [
    {
      quant: "q4_k_m",
      filename: "Qwen2.5-7B-Instruct-Q4_K_M.gguf",
      sizeGb: 4.7,
      url: `${HF}/bartowski/Qwen2.5-7B-Instruct-GGUF/resolve/main/Qwen2.5-7B-Instruct-Q4_K_M.gguf`,
    },
    {
      quant: "q4_0",
      filename: "Qwen2.5-7B-Instruct-Q4_0.gguf",
      sizeGb: 4.44,
      url: `${HF}/bartowski/Qwen2.5-7B-Instruct-GGUF/resolve/main/Qwen2.5-7B-Instruct-Q4_0.gguf`,
    },
  ]),
  gguf("Mistral-7B", "Strong instruction following", false, [
    {
      quant: "q4_k_m",
      filename: "Mistral-7B-Instruct-v0.3-Q4_K_M.gguf",
      sizeGb: 4.4,
      url: `${HF}/bartowski/Mistral-7B-Instruct-v0.3-GGUF/resolve/main/Mistral-7B-Instruct-v0.3-Q4_K_M.gguf`,
    },
    {
      quant: "iq4_nl",
      filename: "Mistral-7B-Instruct-v0.3-IQ4_NL.gguf",
      sizeGb: 4.13,
      url: `${HF}/bartowski/Mistral-7B-Instruct-v0.3-GGUF/resolve/main/Mistral-7B-Instruct-v0.3-IQ4_NL.gguf`,
    },
  ]),
  gguf("Llama-3.1-8B", "Meta's 8B — good for OMMESH worker role", false, [
    {
      quant: "q4_k_m",
      filename: "Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf",
      sizeGb: 4.9,
      url: `${HF}/bartowski/Meta-Llama-3.1-8B-Instruct-GGUF/resolve/main/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf`,
    },
    {
      quant: "iq4_nl",
      filename: "Meta-Llama-3.1-8B-Instruct-IQ4_NL.gguf",
      sizeGb: 4.67,
      url: `${HF}/bartowski/Meta-Llama-3.1-8B-Instruct-GGUF/resolve/main/Meta-Llama-3.1-8B-Instruct-IQ4_NL.gguf`,
    },
  ]),
];

/**
 * LiteRT-LM catalog (`.litertlm`, Google AI Edge engine). Only ungated
 * `litert-community` repos — gated Gemma builds arrive via the Edge Gallery
 * import path instead. These are CPU/GPU builds; LiteRT NPU delegates need
 * NPU-compiled files (Edge Gallery preview), so `npuCapable` stays false and
 * the NPU option for LiteRT is surfaced as experimental.
 */
export const LITERT_CATALOG: CatalogModel[] = [
  {
    name: "Qwen2.5-1.5B-Instruct",
    engine: "litert",
    description: "Fast, high-quality 1.5B — best LiteRT default for the S25 Ultra",
    recommendedForPhone: true,
    capabilities: TEXT_ONLY,
    variants: [{
      quant: "q8_0",
      npuCapable: false,
      filename: "Qwen2.5-1.5B-Instruct_multi-prefill-seq_q8_ekv4096.litertlm",
      sizeGb: 1.5,
      url: `${HF}/litert-community/Qwen2.5-1.5B-Instruct/resolve/main/Qwen2.5-1.5B-Instruct_multi-prefill-seq_q8_ekv4096.litertlm`,
    }],
  },
  {
    name: "DeepSeek-R1-Distill-Qwen-1.5B",
    engine: "litert",
    description: "Reasoning distill — chain-of-thought on device",
    recommendedForPhone: true,
    capabilities: TEXT_ONLY,
    variants: [{
      quant: "q8_0",
      npuCapable: false,
      filename: "DeepSeek-R1-Distill-Qwen-1.5B_multi-prefill-seq_q8_ekv4096.litertlm",
      sizeGb: 1.8,
      url: `${HF}/litert-community/DeepSeek-R1-Distill-Qwen-1.5B/resolve/main/DeepSeek-R1-Distill-Qwen-1.5B_multi-prefill-seq_q8_ekv4096.litertlm`,
    }],
  },
  {
    name: "Phi-4-mini-instruct",
    engine: "litert",
    description: "Microsoft Phi-4 mini — strongest of the three, needs ~4 GB free",
    recommendedForPhone: false,
    capabilities: TEXT_ONLY,
    variants: [{
      quant: "q8_0",
      npuCapable: false,
      filename: "Phi-4-mini-instruct_multi-prefill-seq_q8_ekv4096.litertlm",
      sizeGb: 3.7,
      url: `${HF}/litert-community/Phi-4-mini-instruct/resolve/main/Phi-4-mini-instruct_multi-prefill-seq_q8_ekv4096.litertlm`,
    }],
  },
];

/**
 * Choose the variant to download for the given acceleration mode: NPU-capable
 * file when the user wants (or auto-may-get) the NPU, quality default
 * otherwise. Falls back to the first variant when no better match exists.
 */
export function pickVariant(model: CatalogModel, mode: "auto" | "cpu" | "gpu" | "npu"): ModelVariant {
  const wantNpu = mode === "npu" || mode === "auto";
  if (wantNpu) {
    const npu = model.variants.find((v) => v.npuCapable);
    if (npu) return npu;
  }
  const quality = model.variants.find((v) => !v.npuCapable);
  return quality ?? model.variants[0];
}

/** Adapt a catalog model + variant to the single-file download spec. */
export function variantToModelInfo(model: CatalogModel, variant: ModelVariant): ModelInfo {
  return {
    name: `${model.name} (${variant.quant.toUpperCase()})`,
    filename: variant.filename,
    sizeGb: variant.sizeGb,
    description: model.description,
    recommendedForPhone: model.recommendedForPhone,
    url: variant.url,
  };
}

/**
 * Capabilities for any on-device file (catalog or imported): matched against
 * the catalog when possible, else text-only — the safe truth for every current
 * GGUF/.litertlm chat model.
 */
export function capabilitiesForFile(filename: string): ModelCapabilities {
  for (const m of [...GGUF_CATALOG, ...LITERT_CATALOG]) {
    if (m.variants.some((v) => v.filename === filename)) return m.capabilities;
  }
  return TEXT_ONLY;
}

/**
 * True when a Hexagon NPU (HTP) backend device is actually present in this
 * llama.rn build/device combo. Cached — the device list is fixed for the
 * process lifetime. Returns false when llama.rn isn't installed/initialized.
 */
let _npuPresent: boolean | null = null;
export async function isNpuHardwarePresent(): Promise<boolean> {
  if (_npuPresent !== null) return _npuPresent;
  try {
    // Lazy import — same defensive pattern as local-inference.ts, so a build
    // without the native module never crashes at bundle-eval time.
    const { getBackendDevicesInfo } = await import("llama.rn");
    const devices = await getBackendDevicesInfo();
    _npuPresent = devices.some((d) => d.deviceName?.startsWith("HTP"));
  } catch {
    // Leave uncached on transient failure (e.g. JSI not ready yet).
    return false;
  }
  return _npuPresent;
}
