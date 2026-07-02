/**
 * Route-level integration tests for `falRouter`.
 *
 * Covers the cloudProcedure sovereign gate (generateImage/Character/Video all
 * FORBIDDEN for sovereign users), delegation to ctx.services.fal, the
 * in-process gallery (generateImage → listImages), and INTERNAL_SERVER_ERROR
 * wrapping of a service failure. The fal service is stubbed; no real Fal.ai.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("../db.factory.js", async importActual => {
  const actual = await importActual<typeof import("../db.factory.js")>();
  return { ...actual, getDb: async () => h.db };
});

vi.mock("../phase2/services/AuditLogService.js", () => ({
  AuditLogService: {
    getInstance: () => ({ log: vi.fn().mockResolvedValue(undefined) }),
  },
}));

import { appRouter } from "../routers.js";
import { createTestDb, seedUser, makeContext, type TestDb } from "./_helpers/trpcHarness.js";
import type { Db } from "../db.js";

type Caller = ReturnType<typeof appRouter.createCaller>;
let store: TestDb;
let db: Db;

function services() {
  return {
    fal: {
      generateCharacter: vi.fn().mockResolvedValue("https://fal/char.png"),
      generateVideo: vi.fn().mockResolvedValue({ videoUrl: "https://fal/vid.mp4" }),
    },
  };
}

beforeEach(async () => {
  store = await createTestDb();
  db = store.db;
  h.db = db;
});

describe("fal — sovereign gate (cloudProcedure)", () => {
  it("blocks generateImage for a sovereign user", async () => {
    const user = await seedUser(db, { executionMode: "sovereign" });
    const caller: Caller = appRouter.createCaller(makeContext(user, db, services()));
    await expect(caller.fal.generateImage({ prompt: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("blocks generateCharacter + generateVideo for a sovereign user", async () => {
    const user = await seedUser(db, { executionMode: "sovereign" });
    const caller: Caller = appRouter.createCaller(makeContext(user, db, services()));
    await expect(caller.fal.generateCharacter({ prompt: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller.fal.generateVideo({ imageUrl: "u", prompt: "p" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("fal — delegation (non-sovereign)", () => {
  it("generateImage delegates to fal.generateCharacter and adds to the gallery", async () => {
    const user = await seedUser(db, { executionMode: "scrapper" });
    const svc = services();
    const caller: Caller = appRouter.createCaller(makeContext(user, db, svc));

    const img = await caller.fal.generateImage({ prompt: "a robot" });
    expect(svc.fal.generateCharacter).toHaveBeenCalledWith("a robot");
    expect(img.url).toBe("https://fal/char.png");
    expect(img.prompt).toBe("a robot");

    const gallery = await caller.fal.listImages();
    expect(gallery.some(g => g.id === img.id)).toBe(true);
  });

  it("generateCharacter forwards the optional loraPath", async () => {
    const user = await seedUser(db, { executionMode: "scrapper" });
    const svc = services();
    const caller: Caller = appRouter.createCaller(makeContext(user, db, svc));
    await caller.fal.generateCharacter({ prompt: "hero", loraPath: "/loras/x.safetensors" });
    expect(svc.fal.generateCharacter).toHaveBeenCalledWith("hero", "/loras/x.safetensors");
  });

  it("generateVideo delegates to fal.generateVideo", async () => {
    const user = await seedUser(db, { executionMode: "scrapper" });
    const svc = services();
    const caller: Caller = appRouter.createCaller(makeContext(user, db, svc));
    const res = await caller.fal.generateVideo({ imageUrl: "https://img", prompt: "wave" });
    expect(svc.fal.generateVideo).toHaveBeenCalledWith("https://img", "wave");
    expect(res).toEqual({ videoUrl: "https://fal/vid.mp4" });
  });

  it("wraps a fal service failure as INTERNAL_SERVER_ERROR", async () => {
    const user = await seedUser(db, { executionMode: "scrapper" });
    const svc = services();
    svc.fal.generateCharacter.mockRejectedValue(new Error("bridge down"));
    const caller: Caller = appRouter.createCaller(makeContext(user, db, svc));
    await expect(caller.fal.generateImage({ prompt: "x" })).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
});
