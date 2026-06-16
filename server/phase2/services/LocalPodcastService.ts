/**
 * @file services/LocalPodcastService.ts
 * @description Omnecor — Local Podcast & Dialogue Orchestrator
 *
 * Spawns podcast_engine.py, passes the full config via stdin, and resolves
 * with the structured PodcastResult the engine writes to stdout as JSON.
 * Falls back to a stub result if the Python bridge is unavailable.
 */

import { spawn } from "child_process";
import { v4 as uuidv4 } from "uuid";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { createLogger } from "../../_core/logger.js";
import { PYTHON_SCRIPTS } from "../config/index.js";

const log = createLogger("PodcastEngine");

export interface DialogueTurn {
  speakerId: string;
  text: string;
  emotion?: string;
  referenceWav?: string;
}

export interface PodcastConfig {
  title: string;
  turns: DialogueTurn[];
  outputPath?: string;
  useRVC?: boolean;
}

export interface PodcastResult {
  jobId: string;
  audioPath: string;
  /** HTTP URL the client can stream/download the master mix from (range-capable). */
  audioUrl: string;
  duration: number;
  segments: { speaker: string; text: string; path?: string; audioUrl?: string | null }[];
}

const PODCAST_ENGINE_TIMEOUT_MS = 10 * 60 * 1000; // 10 min max for long podcasts

function _stubResult(jobId: string, tempDir: string, config: PodcastConfig): PodcastResult {
  return {
    jobId,
    audioPath: path.join(tempDir, "podcast.wav"),
    audioUrl: `/media/podcast/${jobId}`,
    duration: config.turns.length * 15,
    segments: config.turns.map(turn => ({
      speaker: turn.speakerId,
      text: turn.text,
      audioUrl: null,
    })),
  };
}

async function callPodcastEngine(
  jobId: string,
  tempDir: string,
  config: PodcastConfig,
): Promise<PodcastResult> {
  return new Promise((resolve, reject) => {
    const bridgePath = "server/python_bridges/podcast_engine.py";
    const child = spawn(PYTHON_SCRIPTS.pythonBin, [bridgePath], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`podcast_engine.py timed out after ${PODCAST_ENGINE_TIMEOUT_MS / 1000}s`));
    }, PODCAST_ENGINE_TIMEOUT_MS);

    child.on("close", (code: number | null) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`podcast_engine.py exited with code ${code}: ${stderr.slice(0, 500)}`));
        return;
      }
      try {
        const raw = stdout.trim();
        const parsed = JSON.parse(raw) as PodcastResult;
        resolve({ ...parsed, jobId });
      } catch {
        reject(new Error(`Failed to parse podcast_engine output: ${stdout.slice(0, 500)}`));
      }
    });

    child.on("error", (err: Error) => {
      clearTimeout(timer);
      reject(err);
    });

    const payload = JSON.stringify({
      ...config,
      jobId,
      temp_dir: tempDir,
    });
    child.stdin.write(payload);
    child.stdin.end();
  });
}

export class LocalPodcastService {
  private static instance: LocalPodcastService | null = null;

  private constructor() {}

  public static getInstance(): LocalPodcastService {
    if (!LocalPodcastService.instance) {
      LocalPodcastService.instance = new LocalPodcastService();
    }
    return LocalPodcastService.instance;
  }

  async generatePodcast(config: PodcastConfig): Promise<PodcastResult> {
    const jobId = uuidv4();
    const tempDir = path.join(os.homedir(), ".omnecor", "podcasts", jobId);
    await fs.mkdir(tempDir, { recursive: true });

    log.info("Initiating podcast synthesis", { title: config.title, turns: config.turns.length });

    try {
      const result = await callPodcastEngine(jobId, tempDir, config);
      log.info("Podcast generated", { jobId, audioPath: result.audioPath, duration: result.duration });
      // Always expose the range-capable HTTP URL keyed by jobId, regardless of
      // the absolute path the engine reported.
      return { ...result, audioUrl: `/media/podcast/${jobId}` };
    } catch (err) {
      log.warn("podcast_engine.py unavailable, returning stub", { err: (err as Error).message });
      return _stubResult(jobId, tempDir, config);
    }
  }

  /**
   * Low-latency sentence-level streaming backed by the TTS HTTP server.
   * Yields audio buffers per sentence — callers can pipe directly to a WebSocket.
   */
  async *streamDialogue(turn: DialogueTurn): AsyncGenerator<Buffer> {
    const sentences = turn.text.split(/(?<=[.!?])\s+/).filter(s => s.trim());
    const ttsBase = process.env.TTS_SERVER_URL ?? "http://127.0.0.1:8002";

    for (const sentence of sentences) {
      try {
        const resp = await fetch(`${ttsBase}/synthesize`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: sentence,
            speaker_wav_path: turn.referenceWav ?? "default.wav",
            language: "en",
            engine: turn.referenceWav ? "xtts" : "kokoro",
            ...(turn.emotion && turn.emotion !== "neutral" ? { emotion: turn.emotion } : {}),
          }),
        });
        if (!resp.ok) continue;
        const buf = await resp.arrayBuffer();
        yield Buffer.from(buf);
      } catch {
        // TTS server unreachable for this sentence — skip
      }
    }
  }
}
