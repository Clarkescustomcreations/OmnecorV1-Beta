import { ProcessManagerService } from "./ProcessManagerService.js";
import { apiFetch } from "../../_core/apiClient.js";
import { resilientFetch } from "../../_core/resilientFetch.js";
import { PATHS } from "../../_core/paths.js";
import fs from "fs/promises";
import path from "path";

/** A single file output emitted by a ComfyUI node (image, mesh, etc.). */
export interface ComfyOutputFile {
  filename: string;
  subfolder: string;
  type: string; // "output" | "temp" | "input"
}

/** A mesh persisted into the shared 3D model library. */
export interface SavedMesh {
  name: string;
  url: string;
  size: number;
}

// ComfyUI 3D nodes surface their results under a handful of different output
// keys depending on the pack (native SaveGLB → "gltfs"; 3D-Pack → "meshes"/
// "result"). Rather than hard-code one, we scan every array-valued output and
// keep the entries whose filename is a glTF binary/ascii mesh.
const MESH_EXT_RE = /\.(glb|gltf)$/i;

/**
 * ComfyService
 * Bridges the Node.js backend to the ComfyUI API.
 */
export class ComfyService {
  private static instance: ComfyService | null = null;
  private processManager: ProcessManagerService;
  private comfyUrl: string;

  private constructor() {
    this.processManager = ProcessManagerService.getInstance();
    // COMFYUI_URL takes precedence; COMFYUI_PORT allows changing just the port
    const port = process.env.COMFYUI_PORT ?? "8188";
    this.comfyUrl = process.env.COMFYUI_URL || `http://127.0.0.1:${port}`;
  }

  public static getInstance(): ComfyService {
    if (!ComfyService.instance) {
      ComfyService.instance = new ComfyService();
    }
    return ComfyService.instance;
  }

  /**
   * Queue a prompt to ComfyUI
   * @param prompt The workflow prompt object
   * @returns The prompt response (prompt_id)
   */
  async queuePrompt(prompt: any): Promise<any> {
    return apiFetch(
      `${this.comfyUrl}/prompt`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      },
      { label: "ComfyUI.queuePrompt" }
    );
  }

  /**
   * Get the current queue status
   */
  async getQueue(): Promise<any> {
    return apiFetch(`${this.comfyUrl}/queue`, {}, { label: "ComfyUI.getQueue" });
  }

  /**
   * Get system information from ComfyUI
   */
  async getSystemStats(): Promise<any> {
    return apiFetch(`${this.comfyUrl}/system_stats`, {}, { label: "ComfyUI.getSystemStats" });
  }

  /**
   * Interrupt the current execution
   */
  async interrupt(): Promise<void> {
    await apiFetch(
      `${this.comfyUrl}/interrupt`,
      { method: "POST" },
      { label: "ComfyUI.interrupt" }
    );
  }

  /**
   * Clear the queue
   */
  async clearQueue(): Promise<void> {
    await apiFetch(
      `${this.comfyUrl}/queue`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clear: true }),
      },
      { label: "ComfyUI.clearQueue" }
    );
  }

  /**
   * Fetch the execution history for a queued prompt. ComfyUI returns
   * `{ [promptId]: { outputs: { [nodeId]: { <key>: [{filename,subfolder,type}] } }, ... } }`
   * once the job completes; an empty object while it is still running.
   */
  async getHistory(promptId: string): Promise<Record<string, any>> {
    return apiFetch(
      `${this.comfyUrl}/history/${encodeURIComponent(promptId)}`,
      {},
      { label: "ComfyUI.getHistory" }
    );
  }

  /**
   * Scan a completed prompt's outputs for glTF/GLB mesh files. Returns the raw
   * ComfyUI file descriptors (filename/subfolder/type) so callers can download
   * them via {@link fetchOutputFile}. Empty array while the job is still
   * running or if it produced no meshes.
   */
  async listMeshOutputs(promptId: string): Promise<ComfyOutputFile[]> {
    const history = await this.getHistory(promptId);
    const job = history?.[promptId];
    const outputs = job?.outputs;
    if (!outputs || typeof outputs !== "object") return [];

    const meshes: ComfyOutputFile[] = [];
    for (const nodeOut of Object.values<any>(outputs)) {
      if (!nodeOut || typeof nodeOut !== "object") continue;
      for (const value of Object.values<any>(nodeOut)) {
        if (!Array.isArray(value)) continue;
        for (const entry of value) {
          if (
            entry &&
            typeof entry.filename === "string" &&
            MESH_EXT_RE.test(entry.filename)
          ) {
            meshes.push({
              filename: entry.filename,
              subfolder: typeof entry.subfolder === "string" ? entry.subfolder : "",
              type: typeof entry.type === "string" ? entry.type : "output",
            });
          }
        }
      }
    }
    return meshes;
  }

  /**
   * Download a single output file from ComfyUI's /view endpoint as raw bytes.
   */
  async fetchOutputFile(file: ComfyOutputFile): Promise<Buffer> {
    const qs = new URLSearchParams({
      filename: file.filename,
      subfolder: file.subfolder,
      type: file.type || "output",
    });
    const res = await resilientFetch(`${this.comfyUrl}/view?${qs.toString()}`, {
      timeoutMs: 60_000,
    });
    if (!res.ok) {
      throw new Error(`[ComfyUI.fetchOutputFile] HTTP ${res.status} for ${file.filename}`);
    }
    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
  }

  /**
   * Retrieve every mesh a completed ComfyUI prompt produced and persist it into
   * the shared 3D model library ({@link PATHS.models}) so the desktop + mobile
   * three.js viewers can load it via `/media/model/<name>`.
   *
   * Filenames are reduced to a safe basename and de-duplicated so a re-run can't
   * traverse out of the library or clobber an existing model.
   *
   * @returns the meshes saved (name/url/size); empty if the job produced none.
   */
  async saveMeshesToLibrary(promptId: string): Promise<SavedMesh[]> {
    const meshes = await this.listMeshOutputs(promptId);
    if (meshes.length === 0) return [];

    await fs.mkdir(PATHS.models, { recursive: true });

    const saved: SavedMesh[] = [];
    for (const mesh of meshes) {
      const bytes = await this.fetchOutputFile(mesh);
      // Reduce to a bare, extension-preserving basename to prevent traversal.
      const ext = path.extname(mesh.filename).toLowerCase();
      const base = path
        .basename(mesh.filename, path.extname(mesh.filename))
        .replace(/[^a-zA-Z0-9._-]/g, "_") || "comfy_mesh";
      let name = `${base}${ext}`;
      // De-duplicate against existing library entries so we never overwrite.
      let counter = 1;
      while (
        await fs
          .access(path.join(PATHS.models, name))
          .then(() => true)
          .catch(() => false)
      ) {
        name = `${base}_${counter++}${ext}`;
      }
      const dest = path.join(PATHS.models, name);
      await fs.writeFile(dest, bytes);
      saved.push({
        name,
        url: `/media/model/${encodeURIComponent(name)}`,
        size: bytes.length,
      });
    }
    return saved;
  }
}
