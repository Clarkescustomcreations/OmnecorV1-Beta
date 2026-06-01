import { TRPCError } from "@trpc/server";
import { ENV } from "../../_core/env.js";

export interface OpenArtGenerateResult {
  imageUrl: string;
  prompt: string;
  model: string;
  width: number;
  height: number;
}

export class OpenArtService {
  private static instance: OpenArtService | null = null;

  static getInstance(): OpenArtService {
    if (!OpenArtService.instance) OpenArtService.instance = new OpenArtService();
    return OpenArtService.instance;
  }

  isConfigured(): boolean {
    return !!ENV.openArtApiKey;
  }

  async generate(prompt: string, model: string, width: number, height: number): Promise<OpenArtGenerateResult> {
    if (!this.isConfigured()) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "OpenArt API key not configured. Set OPENART_API_KEY." });
    }
    const resp = await fetch("https://openart.ai/api/v1/image_request", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${ENV.openArtApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt, model, width, height, num_images: 1 }),
      signal: AbortSignal.timeout(60000),
    });
    if (!resp.ok) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `OpenArt API error: ${resp.status}` });
    }
    const data = await resp.json() as { images?: Array<{ url: string }> };
    const imageUrl = data.images?.[0]?.url ?? "";
    return { imageUrl, prompt, model, width, height };
  }
}
