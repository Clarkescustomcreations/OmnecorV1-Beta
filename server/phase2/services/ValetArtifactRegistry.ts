import fs from "fs/promises";
import path from "path";
import { createHash } from "crypto";
import { fileURLToPath } from "url";
import { PATHS } from "../../_core/paths.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolves to centralized application data directory
const REGISTRY_ROOT = PATHS.valetRouter;
const CURRENT_JSON = path.join(REGISTRY_ROOT, "current.json");

export interface ArtifactConfig {
  r?: number;
  lora_alpha?: number;
  epochs?: number;
  max_seq_length?: number;
  save_method?: string;
}

export interface ArtifactRecord {
  artifact_path: string | null;
  status: "pending" | "ready";
  base_model?: string;
  dataset_hash?: string;
  format?: "gguf" | "ollama" | "lora" | "merged_16bit" | "merged_4bit";
  gguf_file?: string;
  config?: ArtifactConfig;
  eval_scores?: Record<string, number>;
  git_sha?: string;
  created_at?: string;
  source?: "trained" | "github-release";
  note?: string;
}

export class ValetArtifactRegistry {
  static readonly registryRoot = REGISTRY_ROOT;
  static readonly currentJsonPath = CURRENT_JSON;

  static async read(): Promise<ArtifactRecord> {
    try {
      const raw = await fs.readFile(CURRENT_JSON, "utf-8");
      return JSON.parse(raw) as ArtifactRecord;
    } catch {
      return { artifact_path: null, status: "pending" };
    }
  }

  static async write(record: ArtifactRecord): Promise<void> {
    await fs.mkdir(REGISTRY_ROOT, { recursive: true });
    await fs.writeFile(CURRENT_JSON, JSON.stringify(record, null, 2) + "\n", "utf-8");
  }

  static async hashFile(filePath: string): Promise<string> {
    const buf = await fs.readFile(filePath);
    return createHash("sha256").update(buf).digest("hex");
  }

  /** Deterministic versioned artifact directory name: <slug>-<hash8>-<YYYYMMDD> */
  static versionedPath(baseTag: string, datasetHash: string): string {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const slug = baseTag
      .replace(/[^a-z0-9]+/gi, "-")
      .toLowerCase()
      .replace(/^-|-$/g, "");
    return path.join(REGISTRY_ROOT, `${slug}-${datasetHash.slice(0, 8)}-${date}`);
  }
}
