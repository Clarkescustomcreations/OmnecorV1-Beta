import { ProcessManagerService } from "./ProcessManagerService.js";
import { PYTHON_SCRIPTS } from "../config/index.js";
import path from "path";

// FAL_LOCAL_PORT configures the local Fal AI bridge server port (default: 8004)
const FAL_LOCAL_PORT = process.env.FAL_LOCAL_PORT ?? "8004";
const FAL_BRIDGE_URL = `http://localhost:${FAL_LOCAL_PORT}`;

/**
 * FalApiService
 * Bridges the Node.js backend to the Python-based Fal AI bridge server.
 */
export class FalApiService {
  private static instance: FalApiService | null = null;
  private processManager: ProcessManagerService;

  private constructor() {
    this.processManager = ProcessManagerService.getInstance();
  }

  public static getInstance(): FalApiService {
    if (!FalApiService.instance) {
      FalApiService.instance = new FalApiService();
    }
    return FalApiService.instance;
  }

  async generateCharacter(prompt: string, loraPath?: string): Promise<string> {
    // This assumes the Python bridge is running as a FastAPI service
    // We would typically communicate with it via HTTP requests
    const response = await fetch(`${FAL_BRIDGE_URL}/flux-character`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, lora_path: loraPath }),
    });
    const data = await response.json();
    return data.result.image.url;
  }

  async generateVideo(imageUrl: string, prompt: string): Promise<string> {
    const response = await fetch(`${FAL_BRIDGE_URL}/minimax-video`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_url: imageUrl, prompt }),
    });
    const data = await response.json();
    return data.result.video.url;
  }
}
