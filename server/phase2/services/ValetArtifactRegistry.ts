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

  /**
   * Seed the centralized app-data registry from the bundled/repo `current.json`
   * when the app-data copy is missing or still `pending`.
   *
   * The registry that the running server reads lives under the OS app-data dir
   * (`PATHS.valetRouter`), but the committed/bundled `current.json` ships inside
   * the repo (dev) or `resources/models/valet-router` (packaged installer).
   * Without this copy, a fresh machine never registers the trained model and the
   * router silently falls back to keyword routing. Returns true when it seeded.
   */
  static async seedFromRepoIfMissing(): Promise<boolean> {
    const existing = await this.read();
    if (existing.status === "ready" && existing.artifact_path) return false;

    // process.resourcesPath is Electron-only (absent from base Node types)
    const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string })
      .resourcesPath;

    const candidates: Array<{ src: string; modelBase: string }> = [
      // dev: launched from repo root
      {
        src: path.join(process.cwd(), "models", "valet-router", "current.json"),
        modelBase: path.join(process.cwd(), "models", "valet-router"),
      },
      // packaged electron: extraResources → <resources>/models/valet-router
      ...(resourcesPath
        ? [{
            src: path.join(resourcesPath, "models", "valet-router", "current.json"),
            modelBase: path.join(resourcesPath, "models", "valet-router"),
          }]
        : []),
      // fallback relative to the compiled backend bundle
      {
        src: path.resolve(__dirname, "../../../models/valet-router/current.json"),
        modelBase: path.resolve(__dirname, "../../../models/valet-router"),
      },
    ];

    for (const { src, modelBase } of candidates) {
      try {
        const raw = await fs.readFile(src, "utf-8");
        const record = JSON.parse(raw) as ArtifactRecord;
        if (record.status !== "ready") continue;
        if (path.resolve(src) === path.resolve(CURRENT_JSON)) return false;

        // Resolve a relative artifact_path to absolute using the model dir
        // so the Python inference server always receives a usable absolute path.
        if (record.artifact_path && !path.isAbsolute(record.artifact_path)) {
          record.artifact_path = path.resolve(modelBase, record.artifact_path);
        }

        await this.write(record);
        return true;
      } catch {
        /* try next candidate */
      }
    }
    return false;
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
