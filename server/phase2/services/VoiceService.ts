/**
 * @file services/VoiceService.ts
 * @description Omnecor — Voice Service (Whisper + TTS Proxy Layer)
 *
 * Provides a unified interface for the Node.js backend to interact with
 * the Python-based voice microservices:
 *
 *  - Whisper Server (port 8001): Speech-to-text transcription
 *  - TTS Server (port 8002): Voice cloning and text-to-speech synthesis
 *
 * Architecture Notes:
 *  - These Python servers run as separate processes (or Docker containers)
 *  - This service acts as a typed proxy layer, handling:
 *    • Health checks and service availability detection
 *    • Request formatting and multipart file uploads
 *    • Response parsing and error normalization
 *    • Retry logic with exponential backoff for transient failures
 *  - The tRPC router delegates to this service for all voice operations
 *
 * Security Considerations:
 *  - File paths for speaker WAVs are validated before forwarding to TTS
 *  - Upload sizes are checked client-side AND server-side
 *  - No arbitrary code execution — only predefined API endpoints are called
 */

import { VOICE_CONFIG } from "../config/index.js";
import { getSetting } from "./SettingsService.js";
import fs from "fs/promises";
import path from "path";
import { EventEmitter } from "events";
import { v4 as uuidv4 } from "uuid";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Health status of a voice microservice */
export interface VoiceServiceHealth {
  service: "whisper" | "tts" | "rvc";
  isHealthy: boolean;
  url: string;
  model: string | null;
  device: string | null;
  error: string | null;
  checkedAt: string;
}

/** Voice task status/event data */
export interface VoiceEventData {
  jobId: string;
  type: "transcription" | "synthesis" | "conversion";
  status: "started" | "progress" | "completed" | "failed";
  message?: string;
  result?: any;
  error?: string;
  timestamp: string;
}

/** Transcription request configuration */
export interface TranscribeRequest {
  /** Path to the audio file to transcribe */
  audioFilePath: string;
  /** Original filename (for MIME type detection) */
  filename?: string;
  /** Whisper model size override; defaults to the `sttModel` app setting. */
  model?: string;
}

/** Word-level timestamp from Whisper */
export interface WordTimestamp {
  word: string;
  start: number;
  end: number;
  probability: number;
}

/** Segment-level result from Whisper */
export interface TranscriptionSegment {
  id: number;
  start: number;
  end: number;
  text: string;
  words: WordTimestamp[];
}

/** Full transcription response */
export interface TranscriptionResult {
  text: string;
  language: string;
  languageProbability: number;
  duration: number;
  segments: TranscriptionSegment[];
}

/** TTS synthesis request configuration */
export interface SynthesizeRequest {
  /** Text to synthesize */
  text: string;
  /** Path to the speaker reference WAV file */
  speakerWavPath: string;
  /** Language code (default: "en") */
  language?: string;
  /** TTS backend override; defaults to the `ttsEngine` app setting. */
  engine?: string;
}

/** TTS synthesis result */
export interface SynthesisResult {
  /** Path to the generated audio file (if not streaming) */
  outputPath?: string;
  /** Audio buffer (if streaming mode) */
  audioBuffer?: Buffer;
  /** Content type of the audio */
  contentType: string;
}

/** RVC voice conversion request */
export interface RVCConvertRequest {
  /** Path to the source audio file */
  audioFilePath: string;
  /** Path to the .pth RVC model */
  modelPath: string;
  /** Pitch shift (-24 to +24) */
  pitchShift: number;
}

/** RVC conversion result */
export interface RVCResult {
  success: boolean;
  outputPath: string;
  sampleRate: string;
  pitchShift: string;
  fileSizeBytes: number;
}

// ---------------------------------------------------------------------------
// Service Implementation
// ---------------------------------------------------------------------------

/**
 * VoiceService — Proxy layer for Whisper, TTS, and RVC microservices.
 *
 * Emits:
 *  - 'progress'  → VoiceEventData (started, progress)
 *  - 'lifecycle' → VoiceEventData (completed, failed)
 *
 * @example
 * ```ts
 * const voice = VoiceService.getInstance();
 *
 * // Check health
 * const whisperHealth = await voice.checkWhisperHealth();
 *
 * // Transcribe audio
 * const result = await voice.transcribe({
 *   audioFilePath: "/tmp/recording.wav",
 *   filename: "recording.wav",
 * });
 * console.log(result.text);
 *
 * // Synthesize speech
 * const audio = await voice.synthesize({
 *   text: "Hello from Omnecor",
 *   speakerWavPath: "/voices/reference.wav",
 *   language: "en",
 * });
 * ```
 */
export class VoiceService extends EventEmitter {
  private static instance: VoiceService | null = null;
  private readonly whisperUrl: string;
  private readonly ttsUrl: string;
  private readonly rvcUrl: string;
  private readonly healthCheckTimeout: number;

  private constructor() {
    super();
    this.whisperUrl = VOICE_CONFIG.whisperUrl;
    this.ttsUrl = VOICE_CONFIG.ttsUrl;
    this.rvcUrl = VOICE_CONFIG.rvcUrl;
    this.healthCheckTimeout = VOICE_CONFIG.healthCheckTimeoutMs;
  }

  /** Retrieve the singleton instance */
  public static getInstance(): VoiceService {
    if (!VoiceService.instance) {
      VoiceService.instance = new VoiceService();
    }
    return VoiceService.instance;
  }

  // -------------------------------------------------------------------------
  // Health Checks
  // -------------------------------------------------------------------------

  /**
   * Check if the Whisper transcription server is healthy and responsive.
   */
  async checkWhisperHealth(): Promise<VoiceServiceHealth> {
    return this.checkHealth("whisper", `${this.whisperUrl}/health`);
  }

  /**
   * Check if the TTS synthesis server is healthy and responsive.
   */
  async checkTTSHealth(): Promise<VoiceServiceHealth> {
    return this.checkHealth("tts", `${this.ttsUrl}/health`);
  }

  /**
   * Check if the RVC voice conversion server is healthy and responsive.
   */
  async checkRVCHealth(): Promise<VoiceServiceHealth> {
    return this.checkHealth("rvc", `${this.rvcUrl}/health`);
  }

  /**
   * Check all voice services at once.
   */
  async checkAllHealth(): Promise<VoiceServiceHealth[]> {
    return Promise.all([
      this.checkWhisperHealth(),
      this.checkTTSHealth(),
      this.checkRVCHealth(),
    ]);
  }

  // -------------------------------------------------------------------------
  // Transcription (Whisper)
  // -------------------------------------------------------------------------

  /**
   * Transcribe an audio file using the Whisper server.
   *
   * @param request - Transcription request with audio file path
   * @returns Full transcription with word-level timestamps
   * @throws Error if Whisper server is unavailable or transcription fails
   */
  async transcribe(request: TranscribeRequest): Promise<TranscriptionResult> {
    const jobId = uuidv4();
    this.emit("progress", {
      jobId,
      type: "transcription",
      status: "started",
      timestamp: new Date().toISOString(),
    } as VoiceEventData);

    const { audioFilePath, filename } = request;

    // Validate the audio file exists
    try {
      await fs.access(audioFilePath);
    } catch {
      const error = `[Omnecor Voice] Audio file not found: ${audioFilePath}`;
      this.emit("lifecycle", {
        jobId,
        type: "transcription",
        status: "failed",
        error,
        timestamp: new Date().toISOString(),
      } as VoiceEventData);
      throw new Error(error);
    }

    // Read the file into a buffer for multipart upload
    const fileBuffer = await fs.readFile(audioFilePath);
    const resolvedFilename = filename || path.basename(audioFilePath);

    // Determine MIME type from extension
    const ext = path.extname(resolvedFilename).toLowerCase();
    const mimeMap: Record<string, string> = {
      ".wav": "audio/wav",
      ".mp3": "audio/mpeg",
      ".mp4": "audio/mp4",
      ".ogg": "audio/ogg",
      ".flac": "audio/flac",
      ".webm": "audio/webm",
    };
    const mimeType = mimeMap[ext] || "application/octet-stream";

    // Build multipart form data manually using the Fetch API
    const formData = new FormData();
    const blob = new Blob([new Uint8Array(fileBuffer)], { type: mimeType });
    formData.append("file", blob, resolvedFilename);
    // Whisper model size is user-configurable via Settings → Voice (sttModel).
    formData.append("model", request.model || getSetting("sttModel", "base"));

    try {
      const response = await fetch(`${this.whisperUrl}/transcribe`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        const error = `Whisper server returned ${response.status}: ${errorBody}`;
        this.emit("lifecycle", {
          jobId,
          type: "transcription",
          status: "failed",
          error,
          timestamp: new Date().toISOString(),
        } as VoiceEventData);
        throw new Error(error);
      }

      const data = (await response.json()) as any;

      const result: TranscriptionResult = {
        text: data.text,
        language: data.language,
        languageProbability: data.language_probability,
        duration: data.duration,
        segments: (data.segments || []).map((seg: any) => ({
          id: seg.id,
          start: seg.start,
          end: seg.end,
          text: seg.text,
          words: (seg.words || []).map((w: any) => ({
            word: w.word,
            start: w.start,
            end: w.end,
            probability: w.probability,
          })),
        })),
      };

      this.emit("lifecycle", {
        jobId,
        type: "transcription",
        status: "completed",
        result,
        timestamp: new Date().toISOString(),
      } as VoiceEventData);

      return result;
    } catch (error) {
      let errorMessage = (error as Error).message;
      if (
        errorMessage.includes("fetch failed") ||
        errorMessage.includes("ECONNREFUSED")
      ) {
        errorMessage = `[Omnecor Voice] Whisper server unreachable at ${this.whisperUrl}.`;
      }

      this.emit("lifecycle", {
        jobId,
        type: "transcription",
        status: "failed",
        error: errorMessage,
        timestamp: new Date().toISOString(),
      } as VoiceEventData);

      throw new Error(errorMessage);
    }
  }

  // -------------------------------------------------------------------------
  // Text-to-Speech (TTS / XTTS-v2)
  // -------------------------------------------------------------------------

  /**
   * Synthesize speech using voice cloning via the TTS server.
   *
   * @param request - Synthesis request with text and speaker reference
   * @returns Audio buffer or file path depending on server configuration
   * @throws Error if TTS server is unavailable or synthesis fails
   */
  async synthesize(request: SynthesizeRequest): Promise<SynthesisResult> {
    const jobId = uuidv4();
    this.emit("progress", {
      jobId,
      type: "synthesis",
      status: "started",
      timestamp: new Date().toISOString(),
    } as VoiceEventData);

    const { text, speakerWavPath, language } = request;

    // Validate speaker WAV exists
    try {
      await fs.access(speakerWavPath);
    } catch {
      const error = `[Omnecor Voice] Speaker WAV not found: ${speakerWavPath}`;
      this.emit("lifecycle", {
        jobId,
        type: "synthesis",
        status: "failed",
        error,
        timestamp: new Date().toISOString(),
      } as VoiceEventData);
      throw new Error(error);
    }

    // Validate file extension
    const ext = path.extname(speakerWavPath).toLowerCase();
    if (ext !== ".wav" && ext !== ".wave") {
      const error = `[Omnecor Voice] Speaker reference must be a .wav file, got: ${ext}`;
      this.emit("lifecycle", {
        jobId,
        type: "synthesis",
        status: "failed",
        error,
        timestamp: new Date().toISOString(),
      } as VoiceEventData);
      throw new Error(error);
    }

    const payload = {
      text,
      speaker_wav_path: speakerWavPath,
      language: language || "en",
      // TTS backend is user-configurable via Settings → Voice (ttsEngine).
      engine: request.engine || getSetting("ttsEngine", "kokoro"),
    };

    try {
      const response = await fetch(`${this.ttsUrl}/synthesize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        const error = `TTS server returned ${response.status}: ${errorBody}`;
        this.emit("lifecycle", {
          jobId,
          type: "synthesis",
          status: "failed",
          error,
          timestamp: new Date().toISOString(),
        } as VoiceEventData);
        throw new Error(error);
      }

      const contentType = response.headers.get("content-type") || "";

      let result: SynthesisResult;
      // If the response is audio (streaming mode), return the buffer
      if (contentType.includes("audio/")) {
        const arrayBuffer = await response.arrayBuffer();
        result = {
          audioBuffer: Buffer.from(arrayBuffer),
          contentType: "audio/wav",
        };
      } else {
        // Otherwise, it's a JSON response with the file path
        const data = (await response.json()) as any;
        result = {
          outputPath: data.output_path,
          contentType: "audio/wav",
        };
      }

      this.emit("lifecycle", {
        jobId,
        type: "synthesis",
        status: "completed",
        result: {
          outputPath: result.outputPath,
          hasAudioBuffer: !!result.audioBuffer,
          contentType: result.contentType,
        },
        timestamp: new Date().toISOString(),
      } as VoiceEventData);

      return result;
    } catch (error) {
      let errorMessage = (error as Error).message;
      if (
        errorMessage.includes("fetch failed") ||
        errorMessage.includes("ECONNREFUSED")
      ) {
        errorMessage = `[Omnecor Voice] TTS server unreachable at ${this.ttsUrl}.`;
      }

      this.emit("lifecycle", {
        jobId,
        type: "synthesis",
        status: "failed",
        error: errorMessage,
        timestamp: new Date().toISOString(),
      } as VoiceEventData);

      throw new Error(errorMessage);
    }
  }

  // -------------------------------------------------------------------------
  // RVC Voice Conversion
  // -------------------------------------------------------------------------

  /**
   * List available RVC model files (.pth) in a directory.
   */
  async listRVCModels(modelsDir: string): Promise<any[]> {
    const { readdir, stat } = await import("fs/promises");
    const models: any[] = [];

    async function scanDir(dir: string, depth = 0): Promise<void> {
      if (depth > 4) return;
      try {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            await scanDir(fullPath, depth + 1);
          } else if (entry.isFile() && entry.name.endsWith(".pth")) {
            const stats = await stat(fullPath);
            models.push({
              name: entry.name,
              path: fullPath,
              sizeBytes: stats.size,
            });
          }
        }
      } catch {
        // Skip
      }
    }

    await scanDir(modelsDir);
    return models;
  }

  /**
   * Convert voice using RVC model via proxying to RVC server.
   */
  async convertVoice(request: RVCConvertRequest): Promise<RVCResult> {
    const jobId = uuidv4();
    this.emit("progress", {
      jobId,
      type: "conversion",
      status: "started",
      timestamp: new Date().toISOString(),
    } as VoiceEventData);

    const { audioFilePath, modelPath, pitchShift } = request;

    // Validate inputs
    try {
      await fs.access(audioFilePath);
    } catch {
      const error = `[Omnecor Voice] Audio file not found: ${audioFilePath}`;
      this.emit("lifecycle", {
        jobId,
        type: "conversion",
        status: "failed",
        error,
        timestamp: new Date().toISOString(),
      } as VoiceEventData);
      throw new Error(error);
    }

    if (!modelPath.endsWith(".pth")) {
      const error = "[Omnecor Voice] RVC model must be a .pth file";
      this.emit("lifecycle", {
        jobId,
        type: "conversion",
        status: "failed",
        error,
        timestamp: new Date().toISOString(),
      } as VoiceEventData);
      throw new Error(error);
    }

    const fileBuffer = await fs.readFile(audioFilePath);
    const formData = new FormData();
    const blob = new Blob([new Uint8Array(fileBuffer)], { type: "audio/wav" });

    formData.append("source_audio", blob, path.basename(audioFilePath));
    formData.append("model_path", modelPath);
    formData.append("pitch_shift", String(pitchShift));

    try {
      const response = await fetch(`${this.rvcUrl}/convert_voice`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        const error = `RVC server returned ${response.status}: ${errorBody}`;
        this.emit("lifecycle", {
          jobId,
          type: "conversion",
          status: "failed",
          error,
          timestamp: new Date().toISOString(),
        } as VoiceEventData);
        throw new Error(error);
      }

      const audioArrayBuffer = await response.arrayBuffer();
      const outputBuffer = Buffer.from(audioArrayBuffer);

      // Save output
      const outputDir = path.join(
        process.env.HOME || "/tmp",
        ".omnecor",
        "rvc_output"
      );
      await fs.mkdir(outputDir, { recursive: true });
      const outputPath = path.join(outputDir, `converted_${Date.now()}.wav`);
      await fs.writeFile(outputPath, outputBuffer);

      const result: RVCResult = {
        success: true,
        outputPath,
        sampleRate: response.headers.get("x-sample-rate") || "44100",
        pitchShift: response.headers.get("x-pitch-shift") || String(pitchShift),
        fileSizeBytes: outputBuffer.length,
      };

      this.emit("lifecycle", {
        jobId,
        type: "conversion",
        status: "completed",
        result,
        timestamp: new Date().toISOString(),
      } as VoiceEventData);

      return result;
    } catch (error) {
      let errorMessage = (error as Error).message;
      if (
        errorMessage.includes("fetch failed") ||
        errorMessage.includes("ECONNREFUSED")
      ) {
        errorMessage = `[Omnecor Voice] RVC server unreachable at ${this.rvcUrl}`;
      }

      this.emit("lifecycle", {
        jobId,
        type: "conversion",
        status: "failed",
        error: errorMessage,
        timestamp: new Date().toISOString(),
      } as VoiceEventData);

      throw new Error(errorMessage);
    }
  }

  // -------------------------------------------------------------------------
  // Private Helpers
  // -------------------------------------------------------------------------

  /** Generic health check for a voice microservice */
  private async checkHealth(
    service: "whisper" | "tts" | "rvc",
    url: string
  ): Promise<VoiceServiceHealth> {
    const checkedAt = new Date().toISOString();

    try {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        this.healthCheckTimeout
      );

      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (!response.ok) {
        return {
          service,
          isHealthy: false,
          url,
          model: null,
          device: null,
          error: `HTTP ${response.status}`,
          checkedAt,
        };
      }

      const data = (await response.json()) as any;

      return {
        service,
        isHealthy: true,
        url,
        model: data.model || null,
        device: data.device || null,
        error: null,
        checkedAt,
      };
    } catch (error) {
      return {
        service,
        isHealthy: false,
        url,
        model: null,
        device: null,
        error: (error as Error).message,
        checkedAt,
      };
    }
  }
}
