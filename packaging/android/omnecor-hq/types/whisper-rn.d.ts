/**
 * Ambient module shim for whisper.rn's bare root specifier.
 *
 * whisper.rn 0.6.0's package.json "exports" map only declares subpaths ("./*")
 * with no "." root entry, so under moduleResolution:"bundler" TypeScript cannot
 * resolve `import ... from "whisper.rn"`. Metro is redirected to the package's
 * CommonJS entry in metro.config.js; this declaration gives the type-checker the
 * matching (minimal) surface we use. Keep in sync with whisper.rn's real API.
 */
declare module "whisper.rn" {
  export interface TranscribeOptions {
    /** Whisper language code, e.g. "en". */
    language?: string;
    [key: string]: unknown;
  }

  export interface TranscribeResult {
    /** Full transcribed text. */
    result: string;
    [key: string]: unknown;
  }

  export interface WhisperContext {
    transcribe(
      audioPath: string,
      options?: TranscribeOptions,
    ): { stop: () => void; promise: Promise<TranscribeResult> };
    release(): Promise<void>;
  }

  export function initWhisper(params: { filePath: string }): Promise<WhisperContext>;
}
