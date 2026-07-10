/**
 * Batch I — voice bridge integration tests (real STT/TTS microservices).
 * =========================================================================
 * Drives the real `voice.transcribe` / `voice.synthesize` tRPC procedures
 * against the running Python microservices, following the ComfyUI auto-skip
 * pattern: the suite skips automatically when a service (or `espeak-ng`, used
 * to synthesize a known-text speech clip) is unavailable — safe to leave in the
 * normal `pnpm test` run.
 *
 * PREREQUISITES (to run live)
 * ---------------------------
 *   pip install -r requirements.txt   # faster-whisper, coqui-tts, torchaudio,
 *                                      # python-multipart, torch, soundfile …
 *   # STT (light, ~140MB base model):
 *   WHISPER_MODEL_SIZE=base WHISPER_DEVICE=cpu WHISPER_COMPUTE_TYPE=int8 \
 *     python server/core_services/python_scripts/whisper_server.py       # :8001
 *   # TTS (XTTS-v2, ~1.8GB first-run download):
 *   COQUI_TOS_AGREED=1 python server/core_services/python_scripts/tts_server.py  # :8002
 *
 * The audio file must live under an allowed dir (PATHS.data) — `voiceRouter`
 * runs every path through `validatePath` — so the clip is written there.
 *
 * ENV: WHISPER_SERVER_URL (default http://localhost:8001),
 *      TTS_SERVER_URL      (default http://localhost:8002)
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("../db.factory.js", async importActual => {
  const actual = await importActual<typeof import("../db.factory.js")>();
  return { ...actual, getDb: async () => h.db };
});
vi.mock("../core_services/services/AuditLogService.js", () => ({
  AuditLogService: { getInstance: () => ({ log: vi.fn().mockResolvedValue(undefined) }) },
}));

import { appRouter } from "../routers.js";
import { VoiceService } from "../core_services/services/VoiceService.js";
import { PATHS } from "../_core/paths.js";
import { createTestDb, seedUser, makeContext } from "./_helpers/trpcHarness.js";

const WHISPER_URL = process.env.WHISPER_SERVER_URL ?? "http://localhost:8001";
const TTS_URL = process.env.TTS_SERVER_URL ?? "http://localhost:8002";

const whisperUp = await fetch(`${WHISPER_URL}/health`).then(r => r.ok).catch(() => false);
const ttsUp = await fetch(`${TTS_URL}/health`).then(r => r.ok).catch(() => false);
const espeakOk = (() => {
  try { execFileSync("espeak-ng", ["--version"], { stdio: "ignore" }); return true; }
  catch { return false; }
})();

// Known-text speech clip, written under PATHS.data so validatePath accepts it.
const SPEECH_WAV = path.join(PATHS.data, "omnecor-voice-test-speech.wav");
function makeSpeechClip() {
  execFileSync("espeak-ng", ["testing one two three four five", "-s", "130", "-w", SPEECH_WAV]);
}

type Caller = ReturnType<typeof appRouter.createCaller>;
async function freshCaller(): Promise<Caller> {
  const { db } = await createTestDb();
  h.db = db;
  const user = await seedUser(db);
  return appRouter.createCaller(makeContext(user, db, { voice: VoiceService.getInstance() }));
}

describe.skipIf(!whisperUp || !espeakOk)("voice.transcribe — real whisper_server (faster-whisper)", () => {
  let caller: Caller;
  beforeAll(async () => {
    caller = await freshCaller();
    makeSpeechClip();
  });

  it("transcribes a known-text speech clip to matching text", async () => {
    const res = (await caller.voice.transcribe({
      audioFilePath: SPEECH_WAV,
      filename: "speech.wav",
    })) as { success: boolean; data: { text: string; language?: string } };

    expect(res.success).toBe(true);
    expect(res.data.text).toBeTruthy();
    // espeak said "testing one two three four five" → whisper returns e.g.
    // "Testing 1, 2, 3, 4, 5". Assert the recognizable content, tolerant of
    // digit-vs-word normalization.
    expect(res.data.text.toLowerCase()).toMatch(/test/);
    expect(res.data.text).toMatch(/\d|one|two|three|four|five/i);
    if (res.data.language) expect(res.data.language).toBe("en");
  }, 90_000);

  it("maps a missing audio file to NOT_FOUND", async () => {
    await expect(
      caller.voice.transcribe({ audioFilePath: path.join(PATHS.data, "does-not-exist.wav") }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe.skipIf(!ttsUp || !espeakOk)("voice.synthesize — real tts_server (XTTS-v2 voice clone)", () => {
  let caller: Caller;
  beforeAll(async () => {
    caller = await freshCaller();
    makeSpeechClip(); // reused as the speaker reference clip
  });

  it("synthesizes speech from text and returns audio", async () => {
    const res = (await caller.voice.synthesize({
      text: "Hello from Omnecor voice synthesis.",
      speakerWavPath: SPEECH_WAV,
      language: "en",
    })) as { success?: boolean; data?: { hasAudioBuffer?: boolean } };

    // The router returns hasAudioBuffer:true when the TTS server produced audio.
    const hasAudio =
      res?.data?.hasAudioBuffer ?? (res as { hasAudioBuffer?: boolean }).hasAudioBuffer;
    expect(hasAudio).toBe(true);
    // XTTS-v2 on CPU measures ~50s for this sentence on an otherwise-idle
    // machine; the parallel vitest workers of a full `pnpm test` run can more
    // than double that, so 120s flakes under load (same pattern as the scrypt
    // suite's 60s timeout).
  }, 300_000);
});
