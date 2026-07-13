import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "events";

// ── Mocks ──────────────────────────────────────────────────────────────────
const { envMock } = vi.hoisted(() => ({
  envMock: {
    localLlmAutoStart: true,
    localLlmPort: "8014",
    localLlmModelPath: "",
    localLlmBin: "llama-server",
    localLlmCtxSize: "4096",
    localLlmGpuLayers: "999",
  },
}));
vi.mock("../../../_core/env.js", () => ({ ENV: envMock }));

const { pathsMock } = vi.hoisted(() => ({ pathsMock: { models: "/fake/models" } }));
vi.mock("../../../_core/paths.js", () => ({ PATHS: pathsMock }));

vi.mock("../../../_core/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

// ModelIndexService — the source of hostable models (Phase 8).
const { indexMock } = vi.hoisted(() => {
  const state = { models: [] as Array<{ id: string; name: string; path: string; sizeBytes: number; source: string }> };
  return {
    indexMock: {
      state,
      list: vi.fn(() => state.models),
      refresh: vi.fn(async () => state.models),
      resolve: vi.fn((idOrPath: string) =>
        state.models.find((m) => m.id === idOrPath || m.path === idOrPath || m.name === idOrPath) ?? null,
      ),
    },
  };
});
vi.mock("../ModelIndexService.js", () => ({ ModelIndexService: { getInstance: () => indexMock } }));

// GPU telemetry — drives per-model n-gpu-layers fitting.
const { telemetryMock } = vi.hoisted(() => ({
  telemetryMock: { collectGpuTelemetry: vi.fn(async () => ({ vram: 0, utilization: 0, temperature: 0 })) },
}));
vi.mock("../../../ommesh/core/HostTelemetry.js", () => ({ collectGpuTelemetry: telemetryMock.collectGpuTelemetry }));

// SettingsService — persists the last-loaded model.
const { settingsMock } = vi.hoisted(() => ({ settingsMock: { getSetting: vi.fn(() => ""), setSetting: vi.fn() } }));
vi.mock("../SettingsService.js", () => ({ getSetting: settingsMock.getSetting, setSetting: settingsMock.setSetting }));

const { execFileMock, spawnMock } = vi.hoisted(() => ({
  execFileMock: vi.fn((...args: any[]) => {
    const cb = args[args.length - 1];
    if (typeof cb === "function") cb(Object.assign(new Error("not found"), { code: "ENOENT" }));
  }),
  spawnMock: vi.fn(),
}));
vi.mock("child_process", () => ({ spawn: spawnMock, execFile: execFileMock, ChildProcess: class {} }));

const { fsMock } = vi.hoisted(() => ({
  fsMock: {
    existsSync: vi.fn(() => false),
    readdirSync: vi.fn(() => []),
    statSync: vi.fn(() => ({ isDirectory: () => false, mtimeMs: 0, size: 0 })),
  },
}));
vi.mock("fs", () => fsMock);

function makeFakeProc() {
  const proc: any = new EventEmitter();
  proc.pid = 4242;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.killed = false;
  proc.kill = vi.fn((_sig: string) => {
    proc.killed = true;
    setTimeout(() => proc.emit("close", 0, "SIGTERM"), 0);
  });
  return proc;
}

function model(over: { id: string } & Partial<{ name: string; path: string; sizeBytes: number; source: string }>) {
  return { name: over.id, path: `/fake/models/${over.id}`, sizeBytes: 1_000_000_000, source: "models-dir", ...over };
}

/** Make execFile resolve --version (binary found). */
function binaryFound() {
  execFileMock.mockImplementation((...args: any[]) => {
    const cb = args[args.length - 1];
    if (typeof cb === "function") cb(null, { stdout: "llama-server v1", stderr: "" });
  });
}

describe("LocalLlmRuntimeService", () => {
  let LocalLlmRuntimeService: typeof import("../LocalLlmRuntimeService.js").LocalLlmRuntimeService;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    envMock.localLlmAutoStart = true;
    envMock.localLlmPort = "8014";
    envMock.localLlmModelPath = "";
    envMock.localLlmBin = "llama-server";
    envMock.localLlmGpuLayers = "999";
    indexMock.state.models = [];
    settingsMock.getSetting.mockReturnValue("");
    fsMock.existsSync.mockReturnValue(false);
    execFileMock.mockImplementation((...args: any[]) => {
      const cb = args[args.length - 1];
      if (typeof cb === "function") cb(Object.assign(new Error("not found"), { code: "ENOENT" }));
    });
    ({ LocalLlmRuntimeService } = await import("../LocalLlmRuntimeService.js"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does nothing when LOCAL_LLM_AUTO_START=false", async () => {
    envMock.localLlmAutoStart = false;
    const svc = LocalLlmRuntimeService.getInstance();
    await svc.start();
    expect(spawnMock).not.toHaveBeenCalled();
    expect(svc.isReady()).toBe(false);
    expect(svc.isAvailable()).toBe(false);
  });

  it("stays offline (never spawns) and unavailable when no llama-server binary is found", async () => {
    indexMock.state.models = [model({ id: "m.gguf" })];
    const svc = LocalLlmRuntimeService.getInstance();
    await svc.start();
    expect(spawnMock).not.toHaveBeenCalled();
    expect(svc.isReady()).toBe(false);
    expect(svc.isAvailable()).toBe(false);
  });

  it("is available (can host on demand) when the binary exists but no model is indexed", async () => {
    binaryFound();
    indexMock.state.models = []; // nothing to auto-load
    const svc = LocalLlmRuntimeService.getInstance();
    await svc.start();
    expect(spawnMock).not.toHaveBeenCalled();
    expect(svc.isReady()).toBe(false);
    expect(svc.isAvailable()).toBe(true); // key Phase-8 change: hostable, just idle
  });

  it("stays available but warms nothing at boot when no model is persisted", async () => {
    binaryFound();
    indexMock.state.models = [
      model({ id: "small.gguf", sizeBytes: 1_000_000_000 }),
      model({ id: "big.gguf", sizeBytes: 8_000_000_000 }),
    ];
    settingsMock.getSetting.mockReturnValue(""); // nothing persisted
    const svc = LocalLlmRuntimeService.getInstance();
    await svc.start();
    // Hostable (lists all models) but doesn't guess-and-pin one in VRAM.
    expect(svc.isAvailable()).toBe(true);
    expect(spawnMock).not.toHaveBeenCalled();
    expect(svc.getLoadedModelId()).toBeNull();
  });

  it("boots the persisted last-loaded model and becomes ready on /health 200", async () => {
    binaryFound();
    settingsMock.getSetting.mockReturnValue("small.gguf");
    indexMock.state.models = [
      model({ id: "small.gguf", sizeBytes: 1_000_000_000 }),
      model({ id: "big.gguf", sizeBytes: 8_000_000_000 }),
    ];
    spawnMock.mockReturnValue(makeFakeProc());
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true } as Response)));
    vi.useFakeTimers();

    const svc = LocalLlmRuntimeService.getInstance();
    const p = svc.start();
    await vi.advanceTimersByTimeAsync(1100);
    await p;

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock.mock.calls[0][1]).toEqual(
      expect.arrayContaining(["--model", "/fake/models/small.gguf", "--n-gpu-layers", "999"]),
    );
    expect(svc.isReady()).toBe(true);
    expect(svc.getLoadedModelId()).toBe("small.gguf");
    expect(settingsMock.setSetting).toHaveBeenCalledWith("localLlmLastModel", "small.gguf");
  });

  it("ensureModelLoaded hot-swaps: stops the current model and spawns the requested one", async () => {
    binaryFound();
    settingsMock.getSetting.mockReturnValue("a.gguf"); // boots a.gguf
    indexMock.state.models = [
      model({ id: "a.gguf", sizeBytes: 8_000_000_000 }),
      model({ id: "b.gguf", sizeBytes: 1_000_000_000 }),
    ];
    const procA = makeFakeProc();
    const procB = makeFakeProc();
    spawnMock.mockReturnValueOnce(procA).mockReturnValueOnce(procB);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true } as Response)));
    vi.useFakeTimers();

    const svc = LocalLlmRuntimeService.getInstance();
    const start = svc.start();
    await vi.advanceTimersByTimeAsync(1100);
    await start;
    expect(svc.getLoadedModelId()).toBe("a.gguf");

    const swap = svc.ensureModelLoaded("b.gguf");
    await vi.advanceTimersByTimeAsync(20); // procA stop() close fires
    await vi.advanceTimersByTimeAsync(1100); // procB health poll
    expect(await swap).toBe(true);

    expect(spawnMock).toHaveBeenCalledTimes(2);
    expect(procA.kill).toHaveBeenCalledWith("SIGTERM");
    expect(spawnMock.mock.calls[1][1]).toEqual(expect.arrayContaining(["--model", "/fake/models/b.gguf"]));
    expect(svc.getLoadedModelId()).toBe("b.gguf");
  });

  it("ensureModelLoaded is a no-op when the requested model is already loaded", async () => {
    binaryFound();
    settingsMock.getSetting.mockReturnValue("a.gguf"); // boots a.gguf
    indexMock.state.models = [model({ id: "a.gguf" })];
    spawnMock.mockReturnValue(makeFakeProc());
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true } as Response)));
    vi.useFakeTimers();

    const svc = LocalLlmRuntimeService.getInstance();
    const start = svc.start();
    await vi.advanceTimersByTimeAsync(1100);
    await start;
    expect(spawnMock).toHaveBeenCalledTimes(1);

    expect(await svc.ensureModelLoaded("a.gguf")).toBe(true);
    expect(spawnMock).toHaveBeenCalledTimes(1); // no second spawn
  });

  it("ensureModelLoaded throws for an unindexed model instead of silently serving the loaded one", async () => {
    binaryFound();
    settingsMock.getSetting.mockReturnValue("a.gguf"); // boots a.gguf
    indexMock.state.models = [model({ id: "a.gguf" })];
    spawnMock.mockReturnValue(makeFakeProc());
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true } as Response)));
    vi.useFakeTimers();

    const svc = LocalLlmRuntimeService.getInstance();
    const start = svc.start();
    await vi.advanceTimersByTimeAsync(1100);
    await start;
    expect(svc.getLoadedModelId()).toBe("a.gguf");

    // "ghost.gguf" isn't in the index → must reject, NOT serve the warm a.gguf.
    await expect(svc.ensureModelLoaded("ghost.gguf")).rejects.toThrow(/not in the local index/);
    expect(svc.getLoadedModelId()).toBe("a.gguf"); // loaded model untouched
    expect(spawnMock).toHaveBeenCalledTimes(1); // no second spawn
  });

  describe("_computeGpuLayers (VRAM fitting)", () => {
    it("honors an explicit numeric LOCAL_LLM_GPU_LAYERS without querying the GPU", async () => {
      envMock.localLlmGpuLayers = "50";
      const svc = LocalLlmRuntimeService.getInstance() as any;
      expect(await svc._computeGpuLayers(8_000_000_000)).toBe("50");
      expect(telemetryMock.collectGpuTelemetry).not.toHaveBeenCalled();
    });

    it("auto: puts the whole model on the GPU when it fits", async () => {
      envMock.localLlmGpuLayers = "auto";
      telemetryMock.collectGpuTelemetry.mockResolvedValue({ vram: 8000, utilization: 0, temperature: 0 });
      const svc = LocalLlmRuntimeService.getInstance() as any;
      // 2 GB model, ~6.2 GB budget → fits → all layers.
      expect(await svc._computeGpuLayers(2 * 1024 ** 3)).toBe("999");
    });

    it("auto: partially offloads a model larger than the VRAM budget", async () => {
      envMock.localLlmGpuLayers = "auto";
      telemetryMock.collectGpuTelemetry.mockResolvedValue({ vram: 8000, utilization: 0, temperature: 0 });
      const svc = LocalLlmRuntimeService.getInstance() as any;
      // 16 GB model, budget = 8000*0.9 - 1024 = 6176 MB → floor(99 * 6176/16384) = 37.
      expect(await svc._computeGpuLayers(16 * 1024 ** 3)).toBe("37");
    });

    it("auto: falls back to CPU-only (0 layers) with no GPU", async () => {
      envMock.localLlmGpuLayers = "auto";
      telemetryMock.collectGpuTelemetry.mockResolvedValue({ vram: 0, utilization: 0, temperature: 0 });
      const svc = LocalLlmRuntimeService.getInstance() as any;
      expect(await svc._computeGpuLayers(2 * 1024 ** 3)).toBe("0");
    });
  });

  it("stop() sends SIGTERM and resolves once the process exits", async () => {
    binaryFound();
    settingsMock.getSetting.mockReturnValue("m.gguf");
    indexMock.state.models = [model({ id: "m.gguf" })];
    const proc = makeFakeProc();
    spawnMock.mockReturnValue(proc);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true } as Response)));
    vi.useFakeTimers();

    const svc = LocalLlmRuntimeService.getInstance();
    const startPromise = svc.start();
    await vi.advanceTimersByTimeAsync(1100);
    await startPromise;

    const stopPromise = svc.stop();
    await vi.advanceTimersByTimeAsync(10);
    await stopPromise;

    expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
    expect(svc.isReady()).toBe(false);
  });

  it("auto-restarts after an abnormal crash and becomes ready again", async () => {
    binaryFound();
    settingsMock.getSetting.mockReturnValue("m.gguf");
    indexMock.state.models = [model({ id: "m.gguf" })];
    const proc1 = makeFakeProc();
    const proc2 = makeFakeProc();
    spawnMock.mockReturnValueOnce(proc1).mockReturnValueOnce(proc2);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true } as Response)));
    vi.useFakeTimers();

    const svc = LocalLlmRuntimeService.getInstance();
    const startPromise = svc.start();
    await vi.advanceTimersByTimeAsync(1100);
    await startPromise;
    expect(svc.isReady()).toBe(true);
    expect(spawnMock).toHaveBeenCalledTimes(1);

    proc1.emit("close", 1, null);
    expect(svc.isReady()).toBe(false);

    await vi.advanceTimersByTimeAsync(2000); // first restart backoff
    expect(spawnMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1100); // new process health poll
    expect(svc.isReady()).toBe(true);
  });

  it("does not restart past the max-restarts ceiling", async () => {
    // Isolate the ceiling logic from the spawn/health dance: stub _spawn to a
    // fast no-op so each serialized respawn resolves immediately.
    vi.useFakeTimers();
    const svc = LocalLlmRuntimeService.getInstance() as any;
    svc._binPath = "llama-server";
    svc._modelPath = "/fake/models/model.gguf";
    const spawnStub = vi.fn(async () => {});
    svc._spawn = spawnStub;

    for (let i = 1; i <= 5; i++) {
      svc._proc = null; // the crashed process has exited
      svc._handleCrash();
      await vi.advanceTimersByTimeAsync(2000 * i);
    }
    expect(spawnStub).toHaveBeenCalledTimes(5);

    // One more crash past the ceiling must NOT schedule another respawn.
    svc._proc = null;
    svc._handleCrash();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(spawnStub).toHaveBeenCalledTimes(5);
  });
});
