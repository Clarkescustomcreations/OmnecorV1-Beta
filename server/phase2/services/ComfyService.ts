import { ProcessManagerService } from "./ProcessManagerService.js";

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
    this.comfyUrl = process.env.COMFYUI_URL || "http://127.0.0.1:8188";
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
    const response = await fetch(`${this.comfyUrl}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`ComfyUI error: ${error}`);
    }

    return response.json();
  }

  /**
   * Get the current queue status
   */
  async getQueue(): Promise<any> {
    const response = await fetch(`${this.comfyUrl}/queue`);
    return response.json();
  }

  /**
   * Get system information from ComfyUI
   */
  async getSystemStats(): Promise<any> {
    const response = await fetch(`${this.comfyUrl}/system_stats`);
    return response.json();
  }

  /**
   * Interrupt the current execution
   */
  async interrupt(): Promise<void> {
    await fetch(`${this.comfyUrl}/interrupt`, { method: "POST" });
  }

  /**
   * Clear the queue
   */
  async clearQueue(): Promise<void> {
    await fetch(`${this.comfyUrl}/queue`, {
      method: "POST",
      body: JSON.stringify({ clear: true }),
    });
  }
}
