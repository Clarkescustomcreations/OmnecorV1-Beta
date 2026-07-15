/**
 * @file server/core_services/services/EmbeddingService.ts
 * @description Omnecor — Local Sentence-Embedding Service (ONNX, on-device)
 *
 * Produces normalized sentence embeddings entirely on-device using
 * all-MiniLM-L6-v2 (384-dim) via onnxruntime-node. This is the embedder behind
 * the EmbeddedVectorStore (libSQL native vectors), so semantic retrieval works
 * with ZERO external infrastructure — no ChromaDB container, no cloud API —
 * satisfying the air-gapped Sovereign promise.
 *
 * Pipeline (matches sentence-transformers all-MiniLM-L6-v2 exactly):
 *   text → BERT WordPiece tokenize (uncased, accent-stripped, [CLS]…[SEP])
 *        → ONNX forward (input_ids, attention_mask, token_type_ids)
 *        → attention-masked MEAN pooling over token embeddings
 *        → L2 normalize
 *
 * Model resolution (first hit wins):
 *   1. OMNECOR_EMBED_MODEL_DIR                     (explicit override)
 *   2. ~/.omnecor/models/all-MiniLM-L6-v2          (cache; packager pre-seeds)
 *   3. one-time SHA-256-verified download           (only if online + allowed)
 *
 * Failure is non-fatal: if the model can't be loaded (offline + not cached),
 * the service stays in a degraded state and callers (RAG, vector store) degrade
 * gracefully rather than crashing — mirroring how ChromaDB-offline is handled.
 */

import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import crypto from "crypto";
import type * as OrtType from "onnxruntime-node";
import { EMBEDDING_CONFIG } from "../config/index.js";
import { createLogger } from "../../_core/logger.js";

const log = createLogger("EmbeddingService");

// ─────────────────────────────────────────────────────────────────────────────
// BERT WordPiece tokenizer (uncased) — faithful port of HF BertTokenizer's
// basic + wordpiece tokenization. Deterministic and dependency-free so the
// same token ids are produced at index time and query time.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_INPUT_CHARS_PER_WORD = 100;

/** CJK ideograph ranges that BertTokenizer isolates into single tokens. */
function isChineseChar(cp: number): boolean {
  return (
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x20000 && cp <= 0x2a6df) ||
    (cp >= 0x2a700 && cp <= 0x2b73f) ||
    (cp >= 0x2b740 && cp <= 0x2b81f) ||
    (cp >= 0x2b820 && cp <= 0x2ceaf) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0x2f800 && cp <= 0x2fa1f)
  );
}

function isPunctuation(ch: string): boolean {
  const cp = ch.codePointAt(0)!;
  if (
    (cp >= 33 && cp <= 47) ||
    (cp >= 58 && cp <= 64) ||
    (cp >= 91 && cp <= 96) ||
    (cp >= 123 && cp <= 126)
  ) {
    return true;
  }
  return /\p{P}|\p{S}/u.test(ch);
}

function isControl(ch: string): boolean {
  if (ch === "\t" || ch === "\n" || ch === "\r") return false;
  return /\p{Cc}|\p{Cf}/u.test(ch);
}

function isWhitespace(ch: string): boolean {
  if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") return true;
  return /\p{Zs}/u.test(ch);
}

class BertWordPieceTokenizer {
  private readonly vocab: Map<string, number>;
  private readonly unkId: number;
  readonly clsId: number;
  readonly sepId: number;
  readonly padId: number;

  constructor(vocabText: string) {
    this.vocab = new Map();
    const lines = vocabText.split("\n");
    for (let i = 0; i < lines.length; i++) {
      // vocab.txt is one token per line; the line index IS the token id.
      const tok = lines[i].replace(/\r$/, "");
      if (tok.length === 0 && i === lines.length - 1) continue; // trailing newline
      this.vocab.set(tok, i);
    }
    const need = (t: string) => {
      const id = this.vocab.get(t);
      if (id === undefined) throw new Error(`vocab.txt missing required token '${t}'`);
      return id;
    };
    this.unkId = need("[UNK]");
    this.clsId = need("[CLS]");
    this.sepId = need("[SEP]");
    this.padId = need("[PAD]");
  }

  private cleanText(text: string): string {
    let out = "";
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      if (cp === 0 || cp === 0xfffd || isControl(ch)) continue;
      out += isWhitespace(ch) ? " " : ch;
    }
    return out;
  }

  /** Add whitespace around CJK chars so each becomes its own basic token. */
  private padChineseChars(text: string): string {
    let out = "";
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      out += isChineseChar(cp) ? ` ${ch} ` : ch;
    }
    return out;
  }

  private stripAccentsLower(token: string): string {
    // do_lower_case=true, strip_accents unset → lowercase then drop combining marks.
    return token.toLowerCase().normalize("NFD").replace(/\p{Mn}/gu, "");
  }

  private splitOnPunctuation(token: string): string[] {
    const chars = Array.from(token);
    const out: string[] = [];
    let cur = "";
    for (const ch of chars) {
      if (isPunctuation(ch)) {
        if (cur) out.push(cur);
        out.push(ch);
        cur = "";
      } else {
        cur += ch;
      }
    }
    if (cur) out.push(cur);
    return out;
  }

  private basicTokenize(text: string): string[] {
    const cleaned = this.padChineseChars(this.cleanText(text));
    const whitespaceTokens = cleaned.split(/\s+/).filter(Boolean);
    const out: string[] = [];
    for (const wt of whitespaceTokens) {
      const stripped = this.stripAccentsLower(wt);
      for (const piece of this.splitOnPunctuation(stripped)) out.push(piece);
    }
    return out;
  }

  private wordpiece(token: string): number[] {
    const chars = Array.from(token);
    if (chars.length > MAX_INPUT_CHARS_PER_WORD) return [this.unkId];
    const ids: number[] = [];
    let start = 0;
    while (start < chars.length) {
      let end = chars.length;
      let curId: number | undefined;
      while (start < end) {
        let sub = chars.slice(start, end).join("");
        if (start > 0) sub = "##" + sub;
        const id = this.vocab.get(sub);
        if (id !== undefined) {
          curId = id;
          break;
        }
        end--;
      }
      if (curId === undefined) return [this.unkId]; // whole word is [UNK]
      ids.push(curId);
      start = end;
    }
    return ids;
  }

  /** Tokenize to input ids WITHOUT [CLS]/[SEP], truncated to `maxContent`. */
  encode(text: string, maxContent: number): number[] {
    const ids: number[] = [];
    for (const bt of this.basicTokenize(text)) {
      for (const id of this.wordpiece(bt)) {
        ids.push(id);
        if (ids.length >= maxContent) return ids;
      }
    }
    return ids;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EmbeddingService
// ─────────────────────────────────────────────────────────────────────────────

export class EmbeddingService {
  private static instance: EmbeddingService | null = null;

  private ort: typeof OrtType | null = null;
  private session: OrtType.InferenceSession | null = null;
  private tokenizer: BertWordPieceTokenizer | null = null;
  private initPromise: Promise<void> | null = null;
  private lastError: string | null = null;

  private constructor() {}

  static getInstance(): EmbeddingService {
    if (!EmbeddingService.instance) EmbeddingService.instance = new EmbeddingService();
    return EmbeddingService.instance;
  }

  /** Embedding dimensionality (fixed by the model). */
  get dimensions(): number {
    return EMBEDDING_CONFIG.dimensions;
  }

  /** True once the model + tokenizer are loaded and embeddings can be produced. */
  isReady(): boolean {
    return this.session !== null && this.tokenizer !== null;
  }

  /** Last initialization error, if the service is degraded. */
  get error(): string | null {
    return this.lastError;
  }

  /**
   * Idempotent, concurrency-safe initialization. Resolves the model files
   * (env → cache → one-time verified download), loads the WordPiece vocab, and
   * creates the ONNX session. Never throws — on failure the service stays
   * degraded (isReady() === false) and records `error`.
   */
  async init(): Promise<void> {
    if (this.isReady()) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.doInit().catch(err => {
      this.lastError = err instanceof Error ? err.message : String(err);
      log.warn("Embedding model unavailable — semantic features degraded", {
        error: this.lastError,
      });
      // Allow a later retry (e.g. after the packager seeds the model).
      this.initPromise = null;
    });
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    const dir = EMBEDDING_CONFIG.modelDir;
    const onnxPath = path.join(dir, EMBEDDING_CONFIG.onnxRelPath);
    const vocabPath = path.join(dir, EMBEDDING_CONFIG.vocabRelPath);

    await this.ensureModelPresent(onnxPath, vocabPath);

    const vocabText = await fsp.readFile(vocabPath, "utf-8");
    this.tokenizer = new BertWordPieceTokenizer(vocabText);

    if (!this.ort) {
      try {
        this.ort = (await import("onnxruntime-node")) as typeof OrtType;
      } catch {
        throw new Error("onnxruntime-node not available. Run: pnpm approve-builds");
      }
    }
    this.session = await this.ort.InferenceSession.create(onnxPath);
    this.lastError = null;
    log.info("Embedding model loaded", {
      model: EMBEDDING_CONFIG.modelId,
      dim: EMBEDDING_CONFIG.dimensions,
    });
  }

  /** Ensure the ONNX + vocab files exist locally, downloading once if allowed. */
  private async ensureModelPresent(onnxPath: string, vocabPath: string): Promise<void> {
    const haveOnnx = fs.existsSync(onnxPath);
    const haveVocab = fs.existsSync(vocabPath);
    if (haveOnnx && haveVocab) return;

    if (EMBEDDING_CONFIG.offlineOnly) {
      throw new Error(
        `Embedding model not found at ${EMBEDDING_CONFIG.modelDir} and ` +
          `OMNECOR_EMBED_OFFLINE=true — pre-seed the model directory.`
      );
    }

    await fsp.mkdir(path.dirname(onnxPath), { recursive: true });
    await fsp.mkdir(path.dirname(vocabPath), { recursive: true });

    const base = EMBEDDING_CONFIG.downloadBaseUrl.replace(/\/$/, "");
    if (!haveVocab) {
      await downloadFile(`${base}/${EMBEDDING_CONFIG.vocabRelPath}`, vocabPath);
    }
    if (!haveOnnx) {
      await downloadFile(
        `${base}/${EMBEDDING_CONFIG.onnxRelPath}`,
        onnxPath,
        EMBEDDING_CONFIG.onnxSha256
      );
    }
    log.info("Embedding model downloaded to cache", { dir: EMBEDDING_CONFIG.modelDir });
  }

  /**
   * Embed a batch of texts. Returns one normalized 384-dim vector per input,
   * in order. Empty/whitespace inputs yield a zero vector. Throws if the model
   * is not ready — callers that must degrade should check {@link isReady} first.
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!this.session || !this.ort || !this.tokenizer) {
      await this.init();
      if (!this.session || !this.ort || !this.tokenizer) {
        throw new Error(`Embedding model not ready: ${this.lastError ?? "unknown"}`);
      }
    }
    if (texts.length === 0) return [];

    const maxContent = EMBEDDING_CONFIG.maxSeqLength - 2; // reserve [CLS]/[SEP]
    const seqs = texts.map(t => {
      const content = this.tokenizer!.encode(t ?? "", maxContent);
      return [this.tokenizer!.clsId, ...content, this.tokenizer!.sepId];
    });

    const maxLen = Math.max(1, ...seqs.map(s => s.length));
    const batch = seqs.length;
    const ids = new BigInt64Array(batch * maxLen);
    const mask = new BigInt64Array(batch * maxLen);
    const types = new BigInt64Array(batch * maxLen); // all zeros

    for (let b = 0; b < batch; b++) {
      const seq = seqs[b];
      for (let i = 0; i < maxLen; i++) {
        const idx = b * maxLen + i;
        if (i < seq.length) {
          ids[idx] = BigInt(seq[i]);
          mask[idx] = 1n;
        } else {
          ids[idx] = BigInt(this.tokenizer!.padId);
          mask[idx] = 0n;
        }
      }
    }

    const dims = [batch, maxLen];
    const feeds: Record<string, OrtType.Tensor> = {
      input_ids: new this.ort.Tensor("int64", ids, dims),
      attention_mask: new this.ort.Tensor("int64", mask, dims),
      token_type_ids: new this.ort.Tensor("int64", types, dims),
    };

    const results = await this.session.run(feeds);
    const hidden = results.last_hidden_state ?? results[this.session.outputNames[0]];
    const data = hidden.data as Float32Array;
    const dim = EMBEDDING_CONFIG.dimensions;

    // Attention-masked mean pooling, then L2 normalize — per row.
    const out: number[][] = [];
    for (let b = 0; b < batch; b++) {
      const vec = new Array<number>(dim).fill(0);
      let count = 0;
      for (let i = 0; i < maxLen; i++) {
        if (mask[b * maxLen + i] === 0n) continue;
        count++;
        const rowOffset = (b * maxLen + i) * dim;
        for (let d = 0; d < dim; d++) vec[d] += data[rowOffset + d];
      }
      if (count > 0) for (let d = 0; d < dim; d++) vec[d] /= count;
      let norm = 0;
      for (let d = 0; d < dim; d++) norm += vec[d] * vec[d];
      norm = Math.sqrt(norm);
      if (norm > 0) for (let d = 0; d < dim; d++) vec[d] /= norm;
      out.push(vec);
    }
    return out;
  }

  /** Embed a single text → normalized 384-dim vector. */
  async embed(text: string): Promise<number[]> {
    const [v] = await this.embedBatch([text]);
    return v ?? new Array<number>(this.dimensions).fill(0);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Download helper (Node fetch + optional SHA-256 gate). Written atomically via
// a .part file so an interrupted download never leaves a corrupt model behind.
// ─────────────────────────────────────────────────────────────────────────────

async function downloadFile(url: string, dest: string, expectedSha256?: string): Promise<void> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) {
    throw new Error(`Download failed (${res.status}) for ${url}`);
  }
  const tmp = `${dest}.part`;
  const buf = Buffer.from(await res.arrayBuffer());
  if (expectedSha256) {
    const actual = crypto.createHash("sha256").update(buf).digest("hex");
    if (actual !== expectedSha256) {
      throw new Error(
        `Checksum mismatch for ${url}: expected ${expectedSha256}, got ${actual}`
      );
    }
  }
  await fsp.writeFile(tmp, buf);
  await fsp.rename(tmp, dest);
}
