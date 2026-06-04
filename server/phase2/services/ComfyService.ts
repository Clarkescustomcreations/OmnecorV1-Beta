import { ProcessManagerService } from "./ProcessManagerService.js";
import { apiFetch } from "../../_core/apiClient.js";

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
}
