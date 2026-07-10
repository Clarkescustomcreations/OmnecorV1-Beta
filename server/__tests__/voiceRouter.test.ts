/**
 * Batch I — route-level tests for `voiceRouter` (Python voice bridges + cloud TTS).
 *
 * The voice bridges (Whisper :8001 / TTS :8002 / RVC :8003) are proxied through
 * `ctx.services.voice`, which is stubbed here — so the **bridge-offline
 * degradation** (the router's error → tRPC-code mapping) is exercised without any
 * Python process:
 *   - "unreachable" → PRECONDITION_FAILED (bridge down),
 *   - "not found" / "Security Violation" → NOT_FOUND,
 *   - ".wav" → BAD_REQUEST, else INTERNAL_SERVER_ERROR.
 * Plus the ElevenLabs cloud TTS Sovereign gate + not-configured guard.
 * `validatePath` is stubbed to a pass-through (path traversal is covered by
 * pathTraversal.test.ts).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { TRPCError } from "@trpc/server";

vi.mock("../core_services/services/AuditLogService.js", () => ({
  AuditLogService: {
    getInstance: () => ({ log: vi.fn().mockResolvedValue(undefined) }),
  },
}));

vi.mock("../_core/security.js", async importActual => {
  const actual = await importActual<Record<string, unknown>>();
  return { ...actual, validatePath: vi.fn(async (p: string) => p) };
});

const elSvc = vi.hoisted(() => ({
  isConfigured: vi.fn(),
  listVoices: vi.fn(),
  synthesize: vi.fn(),
}));
vi.mock("../core_services/services/ElevenLabsService.js", () => ({
  ElevenLabsService: { getInstance: () => elSvc },
}));

import { appRouter } from "../routers.js";
import { makeContext } from "./_helpers/trpcHarness.js";
import type { Db } from "../db.js";
import type { User } from "../../drizzle/schema.js";

type Caller = ReturnType<typeof appRouter.createCaller>;

function makeUser(executionMode: User["executionMode"] = "scrapper"): User {
  return {
    id: 1, openId: "u1", email: "u@x.com", name: "U", loginMethod: "manus",
    passwordHash: null, role: "user", executionMode,
    createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
  } as User;
}

function voiceStub() {
  return {
    checkAllHealth: vi.fn(),
    checkWhisperHealth: vi.fn(),
    checkTTSHealth: vi.fn(),
    checkRVCHealth: vi.fn(),
    listRVCModels: vi.fn(),
    transcribe: vi.fn(),
    synthesize: vi.fn(),
  };
}

function mkCaller(user: User | null) {
  const voice = voiceStub();
  const c: Caller = appRouter.createCaller(makeContext(user, {} as Db, { voice }));
  return { caller: c, voice };
}

beforeEach(() => {
  elSvc.isConfigured.mockReset();
  elSvc.listVoices.mockReset();
  elSvc.synthesize.mockReset();
});

describe("voice — auth boundary", () => {
  it("rejects unauthenticated healthCheck", async () => {
    const { caller } = mkCaller(null);
    await expect(caller.voice.healthCheck()).rejects.toThrow(TRPCError);
  });
});

describe("voice health checks", () => {
  it("aggregates the three bridge healths and computes allHealthy", async () => {
    const { caller, voice } = mkCaller(makeUser());
    voice.checkAllHealth.mockResolvedValue([
      { isHealthy: true, service: "whisper" },
      { isHealthy: true, service: "tts" },
      { isHealthy: false, service: "rvc" },
    ]);
    const res = await caller.voice.healthCheck();
    expect(res.whisper.isHealthy).toBe(true);
    expect(res.rvc.isHealthy).toBe(false);
    expect(res.allHealthy).toBe(false);
  });

  it("delegates the per-bridge health queries", async () => {
    const { caller, voice } = mkCaller(makeUser());
    voice.checkWhisperHealth.mockResolvedValue({ isHealthy: false });
    expect(await caller.voice.whisperHealth()).toEqual({ isHealthy: false });
    expect(voice.checkWhisperHealth).toHaveBeenCalledOnce();
  });
});

describe("voice.listRvcModels", () => {
  it("returns the models the RVC bridge reports", async () => {
    const { caller, voice } = mkCaller(makeUser());
    voice.listRVCModels.mockResolvedValue(["speaker_a.pth", "speaker_b.pth"]);
    const res = await caller.voice.listRvcModels({ modelsDir: "/data/rvc" });
    expect(res).toMatchObject({ success: true, count: 2 });
    expect(res.models).toHaveLength(2);
  });
});

describe("voice.transcribe — bridge-offline degradation", () => {
  it("maps an unreachable Whisper bridge to PRECONDITION_FAILED", async () => {
    const { caller, voice } = mkCaller(makeUser());
    voice.transcribe.mockRejectedValue(new Error("Whisper server unreachable"));
    await expect(
      caller.voice.transcribe({ audioFilePath: "/data/a.wav" })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("maps a missing file to NOT_FOUND", async () => {
    const { caller, voice } = mkCaller(makeUser());
    voice.transcribe.mockRejectedValue(new Error("audio file not found"));
    await expect(
      caller.voice.transcribe({ audioFilePath: "/data/missing.wav" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("returns the transcript when the bridge is up", async () => {
    const { caller, voice } = mkCaller(makeUser());
    voice.transcribe.mockResolvedValue({ text: "hello world" });
    const res = await caller.voice.transcribe({ audioFilePath: "/data/a.wav", filename: "a.wav" });
    expect(res).toEqual({ success: true, data: { text: "hello world" } });
    expect(voice.transcribe.mock.calls[0]?.[0]).toMatchObject({ audioFilePath: "/data/a.wav", filename: "a.wav" });
  });
});

describe("voice.synthesize — bridge-offline degradation", () => {
  it("maps an unreachable TTS bridge to PRECONDITION_FAILED", async () => {
    const { caller, voice } = mkCaller(makeUser());
    voice.synthesize.mockRejectedValue(new Error("TTS server unreachable"));
    await expect(
      caller.voice.synthesize({ text: "hi", speakerWavPath: "/data/spk.wav" })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("maps a non-.wav speaker reference to BAD_REQUEST", async () => {
    const { caller, voice } = mkCaller(makeUser());
    voice.synthesize.mockRejectedValue(new Error("speaker reference must be a .wav file"));
    await expect(
      caller.voice.synthesize({ text: "hi", speakerWavPath: "/data/spk.mp3" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("returns the synthesized output metadata on success (no raw buffer leaked)", async () => {
    const { caller, voice } = mkCaller(makeUser());
    voice.synthesize.mockResolvedValue({ outputPath: "/out/o.wav", audioBuffer: Buffer.from("x"), contentType: "audio/wav" });
    const res = await caller.voice.synthesize({ text: "hi", speakerWavPath: "/data/spk.wav" });
    expect(res).toEqual({ success: true, data: { outputPath: "/out/o.wav", hasAudioBuffer: true, contentType: "audio/wav" } });
    expect(JSON.stringify(res)).not.toContain("audioBuffer");
  });
});

describe("voice — ElevenLabs cloud TTS (cloudProcedure)", () => {
  it("blocks a sovereign user on elevenLabsStatus", async () => {
    const { caller } = mkCaller(makeUser("sovereign"));
    await expect(caller.voice.elevenLabsStatus()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("reports configuration state for a non-sovereign user", async () => {
    elSvc.isConfigured.mockReturnValue(true);
    const { caller } = mkCaller(makeUser("scrapper"));
    expect(await caller.voice.elevenLabsStatus()).toEqual({ configured: true });
  });

  it("listElevenLabsVoices fails PRECONDITION_FAILED when the key is absent", async () => {
    elSvc.isConfigured.mockReturnValue(false);
    const { caller } = mkCaller(makeUser("scrapper"));
    await expect(caller.voice.listElevenLabsVoices()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("synthesizeElevenLabs is blocked for a sovereign user", async () => {
    const { caller } = mkCaller(makeUser("sovereign"));
    await expect(
      caller.voice.synthesizeElevenLabs({ voiceId: "v1", text: "hello" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
