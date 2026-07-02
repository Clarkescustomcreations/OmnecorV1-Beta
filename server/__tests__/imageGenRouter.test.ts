/**
 * Route-level integration tests for `imageGenRouter`.
 *
 * Covers: providers status query; the sovereign gate
 * (assertImageProviderAllowedInMode blocks fal/openart, allows local ComfyUI);
 * and generate delegation to ctx.services.comfy / ctx.services.fal. Cloud
 * services are stubbed; no real image generation.
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
    comfy: { queuePrompt: vi.fn().mockResolvedValue({ images: ["out.png"] }) },
    fal: { generateCharacter: vi.fn().mockResolvedValue("https://fal/img.png") },
  };
}

beforeEach(async () => {
  store = await createTestDb();
  db = store.db;
  h.db = db;
});

describe("imageGen.providers", () => {
  it("reports local always available + boolean cloud flags", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db, services()));
    const res = await caller.imageGen.providers();
    expect(res.local).toBe(true);
    expect(typeof res.fal).toBe("boolean");
    expect(typeof res.openart).toBe("boolean");
  });
});

describe("imageGen.generate — sovereign gate", () => {
  it("blocks fal for a sovereign user", async () => {
    const user = await seedUser(db, { executionMode: "sovereign" });
    const caller: Caller = appRouter.createCaller(makeContext(user, db, services()));
    await expect(
      caller.imageGen.generate({ prompt: "a cat", provider: "fal" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("blocks openart for a sovereign user", async () => {
    const user = await seedUser(db, { executionMode: "sovereign" });
    const caller: Caller = appRouter.createCaller(makeContext(user, db, services()));
    await expect(
      caller.imageGen.generate({ prompt: "a dog", provider: "openart" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("allows local ComfyUI for a sovereign user", async () => {
    const user = await seedUser(db, { executionMode: "sovereign" });
    const svc = services();
    const caller: Caller = appRouter.createCaller(makeContext(user, db, svc));
    const res = await caller.imageGen.generate({ prompt: "a fox", provider: "local" });
    expect(res.model).toBe("comfyui");
    expect(svc.comfy.queuePrompt).toHaveBeenCalledOnce();
    expect(res.comfyResult).toEqual({ images: ["out.png"] });
  });
});

describe("imageGen.generate — delegation (non-sovereign)", () => {
  it("delegates fal to ctx.services.fal.generateCharacter", async () => {
    const user = await seedUser(db, { executionMode: "scrapper" });
    const svc = services();
    const caller: Caller = appRouter.createCaller(makeContext(user, db, svc));
    const res = await caller.imageGen.generate({ prompt: "hero", provider: "fal" });
    expect(svc.fal.generateCharacter).toHaveBeenCalledWith("hero");
    expect(res.imageUrl).toBe("https://fal/img.png");
    expect(res.model).toBe("fal");
  });

  it("delegates local to ctx.services.comfy.queuePrompt with dimensions", async () => {
    const user = await seedUser(db, { executionMode: "scrapper" });
    const svc = services();
    const caller: Caller = appRouter.createCaller(makeContext(user, db, svc));
    await caller.imageGen.generate({ prompt: "scene", provider: "local", width: 768, height: 256 });
    expect(svc.comfy.queuePrompt).toHaveBeenCalledWith({ prompt: "scene", width: 768, height: 256 });
  });
});
