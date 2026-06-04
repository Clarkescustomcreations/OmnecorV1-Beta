/**
 * ElevenLabsService — cloud TTS using ElevenLabs API
 * Uses native fetch (no npm deps needed).
 * Respects ENV.elevenLabsApiKey.
 */
import { ENV } from "../../_core/env.js";
import { apiFetch } from "../../_core/apiClient.js";

export interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category: string;
  description?: string;
  preview_url?: string;
}

export interface SynthesisOptions {
  voiceId: string;
  text: string;
  modelId?: string;      // defaults to "eleven_multilingual_v2"
  stability?: number;    // 0.0–1.0, default 0.5
  similarityBoost?: number; // 0.0–1.0, default 0.75
  style?: number;        // 0.0–1.0, default 0.0
  speakerBoost?: boolean; // default true
}

export interface SynthesisResult {
  audioBuffer: Buffer;
  mimeType: "audio/mpeg";
  voiceId: string;
  characterCount: number;
}

export class ElevenLabsService {
  private static instance: ElevenLabsService | null = null;
  private readonly baseUrl = "https://api.elevenlabs.io/v1";

  private constructor() {}

  public static getInstance(): ElevenLabsService {
    if (!ElevenLabsService.instance) {
      ElevenLabsService.instance = new ElevenLabsService();
    }
    return ElevenLabsService.instance;
  }

  private get apiKey(): string {
    return ENV.elevenLabsApiKey;
  }

  private assertConfigured(): void {
    if (!this.apiKey) {
      throw new Error("ELEVENLABS_API_KEY is not configured. Add it to your .env file.");
    }
  }

  async listVoices(): Promise<ElevenLabsVoice[]> {
    this.assertConfigured();
    const data = await apiFetch<{ voices: ElevenLabsVoice[] }>(
      `${this.baseUrl}/voices`,
      { headers: { "xi-api-key": this.apiKey } },
      { label: "ElevenLabs.listVoices" }
    );
    return data.voices ?? [];
  }

  async synthesize(opts: SynthesisOptions): Promise<SynthesisResult> {
    this.assertConfigured();
    const modelId = opts.modelId ?? "eleven_multilingual_v2";
    const body = {
      text: opts.text,
      model_id: modelId,
      voice_settings: {
        stability: opts.stability ?? 0.5,
        similarity_boost: opts.similarityBoost ?? 0.75,
        style: opts.style ?? 0.0,
        use_speaker_boost: opts.speakerBoost ?? true,
      },
    };

    // synthesis returns audio/mpeg — handle manually for the binary response
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/text-to-speech/${opts.voiceId}`, {
        method: "POST",
        headers: {
          "xi-api-key": this.apiKey,
          "Content-Type": "application/json",
          "Accept": "audio/mpeg",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`[ElevenLabs.synthesize] network error: ${msg}`);
    }

    if (!res.ok) {
      throw new Error(`[ElevenLabs.synthesize] HTTP ${res.status} ${res.statusText}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    return {
      audioBuffer: Buffer.from(arrayBuffer),
      mimeType: "audio/mpeg",
      voiceId: opts.voiceId,
      characterCount: opts.text.length,
    };
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }
}
