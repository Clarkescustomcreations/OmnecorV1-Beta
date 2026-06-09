/**
 * @file routers/voiceRouter.ts
 * @description Omnecor — Voice Services tRPC Router
 *
 * Exposes tRPC endpoints for:
 *  - Health checking Whisper and TTS microservices
 *  - Transcribing audio files via Whisper
 *  - Synthesizing speech via XTTS-v2 voice cloning
 *
 * Architecture Notes:
 *  - All voice operations delegate to VoiceService (proxy layer)
 *  - File paths are validated at the router level before forwarding
 *  - Audio file uploads are handled via the Express multipart middleware
 *    (not tRPC), then the file path is passed to the tRPC procedure
 *  - Errors from Python microservices are normalized into tRPC errors
 *
 * UNIFIED: This router now imports from the main _core/trpc.ts stack,
 * using the unified TrpcContext that provides both auth and services.
 */

import { z } from "zod";
import { router, publicProcedure, cloudProcedure } from "../_core/trpc.js";
import { TRPCError } from "@trpc/server";
import { validatePath } from "../_core/security.js";
import { ElevenLabsService } from "../phase2/services/ElevenLabsService.js";

// ---------------------------------------------------------------------------
// Input Schemas (Zod validation)
// ---------------------------------------------------------------------------

const transcribeInputSchema = z.object({
  /** Absolute path to the audio file on the server filesystem */
  audioFilePath: z.string().min(1, "Audio file path is required"),
  /** Original filename for MIME type detection */
  filename: z.string().optional(),
});

const synthesizeInputSchema = z.object({
  /** Text to synthesize (max 4000 chars, matching TTS server limit) */
  text: z.string().min(1).max(4000, "Text exceeds 4000 character limit"),
  /** Absolute path to the speaker reference WAV file */
  speakerWavPath: z.string().min(1, "Speaker WAV path is required"),
  /** BCP-47 language code */
  language: z.string().default("en"),
});

const rvcConvertInputSchema = z.object({
  audioFilePath: z.string().min(1),
  modelPath: z.string().min(1),
  pitchShift: z.number().min(-24).max(24).default(0),
});

const rvcListModelsInputSchema = z.object({
  modelsDir: z.string().min(1),
});

const elevenLabsSynthesizeSchema = z.object({
  voiceId: z.string().min(1).max(128),
  text: z.string().min(1).max(5000),
  modelId: z.string().optional(),
  stability: z.number().min(0).max(1).optional(),
  similarityBoost: z.number().min(0).max(1).optional(),
  style: z.number().min(0).max(1).optional(),
  speakerBoost: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Router Definition
// ---------------------------------------------------------------------------

export const voiceRouter = router({
  /**
   * Check health of all voice microservices.
   * Returns the status of Whisper, TTS, and RVC servers.
   */
  healthCheck: publicProcedure.query(async ({ ctx }) => {
    const results = await ctx.services.voice.checkAllHealth();
    return {
      whisper: results[0],
      tts: results[1],
      rvc: results[2],
      allHealthy: results.every(r => r.isHealthy),
    };
  }),

  /**
   * Check Whisper server health specifically.
   */
  // UI-LOGIC-AUDIT: This feature is not yet accessible from the GUI.
  // SUGGESTION: Add a button or interaction box in the UI to trigger this logic.
  whisperHealth: publicProcedure.query(async ({ ctx }) => {
    return ctx.services.voice.checkWhisperHealth();
  }),

  /**
   * Check TTS server health specifically.
   */
  // UI-LOGIC-AUDIT: This feature is not yet accessible from the GUI.
  // SUGGESTION: Add a button or interaction box in the UI to trigger this logic.
  ttsHealth: publicProcedure.query(async ({ ctx }) => {
    return ctx.services.voice.checkTTSHealth();
  }),

  /**
   * Check RVC server health specifically.
   */
  // UI-LOGIC-AUDIT: This feature is not yet accessible from the GUI.
  // SUGGESTION: Add a button or interaction box in the UI to trigger this logic.
  rvcHealth: publicProcedure.query(async ({ ctx }) => {
    return ctx.services.voice.checkRVCHealth();
  }),

  /**
   * List available RVC models in a directory.
   */
  listRvcModels: publicProcedure
    .input(rvcListModelsInputSchema)
    .query(async ({ ctx, input }) => {
      const models = await ctx.services.voice.listRVCModels(input.modelsDir);
      return {
        success: true,
        modelsDir: input.modelsDir,
        count: models.length,
        models,
      };
    }),

  /**
   * Convert voice using RVC model.
   */
  // UI-LOGIC-AUDIT: This feature is not yet accessible from the GUI.
  // SUGGESTION: Add a button or interaction box in the UI to trigger this logic.
  convertVoice: publicProcedure
    .input(rvcConvertInputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await ctx.services.voice.convertVoice(input);
        return {
          success: true,
          data: result,
        };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: (error as Error).message,
        });
      }
    }),

  /**
   * Transcribe an audio file using the Whisper server.
   *
   * The audio file must already exist on the server filesystem.
   * For browser uploads, use the Express multipart endpoint first,
   * then pass the saved file path to this procedure.
   *
   * Returns full transcription with word-level timestamps.
   */
  // UI-LOGIC-AUDIT: This feature is not yet accessible from the GUI.
  // SUGGESTION: Add a button or interaction box in the UI to trigger this logic.
  transcribe: publicProcedure
    .input(transcribeInputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const validatedPath = await validatePath(input.audioFilePath);
        const result = await ctx.services.voice.transcribe({
          audioFilePath: validatedPath,
          filename: input.filename,
        });

        return {
          success: true,
          data: result,
        };
      } catch (error) {
        const message = (error as Error).message;

        if (
          message.includes("not found") ||
          message.includes("Security Violation")
        ) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message,
          });
        }
        if (message.includes("unreachable")) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "Whisper server is not running. Start it with: uvicorn whisper_server:app --port 8001",
          });
        }

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Transcription failed: ${message}`,
        });
      }
    }),

  /**
   * Synthesize speech using voice cloning via the TTS server.
   *
   * Requires a reference WAV file (3-30s of clean speech) for voice cloning.
   * Returns the path to the generated audio file.
   */
  synthesize: publicProcedure
    .input(synthesizeInputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const validatedPath = await validatePath(input.speakerWavPath);
        const result = await ctx.services.voice.synthesize({
          text: input.text,
          speakerWavPath: validatedPath,
          language: input.language,
        });

        return {
          success: true,
          data: {
            outputPath: result.outputPath || null,
            hasAudioBuffer: !!result.audioBuffer,
            contentType: result.contentType,
          },
        };
      } catch (error) {
        const message = (error as Error).message;

        if (
          message.includes("not found") ||
          message.includes("Security Violation")
        ) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message,
          });
        }
        if (message.includes("unreachable")) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "TTS server is not running. Start it with: uvicorn tts_server:app --port 8002",
          });
        }
        if (message.includes(".wav")) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message,
          });
        }

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Synthesis failed: ${message}`,
        });
      }
    }),

  // ---------------------------------------------------------------------------
  // ElevenLabs Cloud TTS
  // ---------------------------------------------------------------------------

  /**
   * Check whether ELEVENLABS_API_KEY is configured.
   */
  elevenLabsStatus: cloudProcedure.query(() => {
    return { configured: ElevenLabsService.getInstance().isConfigured() };
  }),

  /**
   * List available ElevenLabs voices for the configured account.
   */
  listElevenLabsVoices: cloudProcedure.query(async () => {
    const svc = ElevenLabsService.getInstance();
    if (!svc.isConfigured()) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "ELEVENLABS_API_KEY not configured." });
    }
    const voices = await svc.listVoices();
    return { voices };
  }),

  /**
   * Synthesize speech via ElevenLabs cloud TTS.
   * Returns base64-encoded MP3 audio for the client to play.
   */
  synthesizeElevenLabs: cloudProcedure
    .input(elevenLabsSynthesizeSchema)
    .mutation(async ({ input }) => {
      const svc = ElevenLabsService.getInstance();
      if (!svc.isConfigured()) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "ELEVENLABS_API_KEY not configured." });
      }
      const result = await svc.synthesize(input);
      // Return base64 audio for the client to play
      return {
        audioBase64: result.audioBuffer.toString("base64"),
        mimeType: result.mimeType,
        characterCount: result.characterCount,
      };
    }),
});
