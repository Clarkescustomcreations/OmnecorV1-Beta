/**
 * Route-level tests for `podcastRouter`.
 *
 * Drives the real `appRouter.createCaller` against an in-memory libSQL DB so the
 * server-backed episode-history persistence (insert + idempotent upsert by
 * jobId), the per-user IDOR scoping on deleteEpisode, and the Sovereign-mode
 * gate on generateScript all execute for real. `LocalPodcastService` (the local
 * TTS engine) is mocked — no audio is synthesized. The `streamTurn` subscription
 * is covered indirectly by the service's own tests; createCaller cannot drive a
 * tRPC subscription, so it is not exercised here.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";

const h = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("../db.factory.js", async importActual => {
  const actual = await importActual<typeof import("../db.factory.js")>();
  return { ...actual, getDb: async () => h.db };
});

vi.mock("../core_services/services/AuditLogService.js", () => ({
  AuditLogService: {
    getInstance: () => ({ log: vi.fn().mockResolvedValue(undefined) }),
  },
}));

const podcastSvc = vi.hoisted(() => ({
  generatePodcast: vi.fn(),
  streamDialogue: vi.fn(),
}));
vi.mock("../core_services/services/LocalPodcastService.js", () => ({
  LocalPodcastService: { getInstance: () => podcastSvc },
}));

import { appRouter } from "../routers.js";
import { podcastEpisodes } from "../../drizzle/schema.js";
import { createTestDb, seedUser, makeContext, type TestDb } from "./_helpers/trpcHarness.js";
import type { Db } from "../db.js";

type Caller = ReturnType<typeof appRouter.createCaller>;
let store: TestDb;
let db: Db;

const oneTurn = [{ speakerId: "Alex", text: "Hello there." }];

beforeEach(async () => {
  store = await createTestDb();
  db = store.db;
  h.db = db;
  podcastSvc.generatePodcast.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("podcast — auth boundary", () => {
  it("rejects unauthenticated listEpisodes", async () => {
    const caller = appRouter.createCaller(makeContext(null, db));
    await expect(caller.podcast.listEpisodes()).rejects.toThrow(TRPCError);
  });
});

describe("podcast.generate — episode history persistence", () => {
  it("persists an episode on a successful master mix and lists it back", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const jobId = randomUUID();
    podcastSvc.generatePodcast.mockResolvedValue({
      jobId,
      audioUrl: "/podcasts/master.wav",
      segments: [{}, {}],
      duration: 65.4,
    });

    const res = await caller.podcast.generate({ title: "My Episode", turns: oneTurn });
    expect(res.jobId).toBe(jobId);

    const list = await caller.podcast.listEpisodes();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: jobId,
      title: "My Episode",
      audioUrl: "/podcasts/master.wav",
      segmentCount: 2,
      durationSeconds: 65, // rounded
    });
  });

  it("upserts by jobId — re-generating the same job updates instead of duplicating", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const jobId = randomUUID();
    podcastSvc.generatePodcast.mockResolvedValue({
      jobId,
      audioUrl: "/podcasts/master.wav",
      segments: [{}],
      duration: 10,
    });

    await caller.podcast.generate({ title: "First", turns: oneTurn });
    await caller.podcast.generate({ title: "Second", turns: oneTurn });

    const list = await caller.podcast.listEpisodes();
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe("Second");
  });

  it("does not persist when no master audio was produced", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    podcastSvc.generatePodcast.mockResolvedValue({ audioUrl: undefined, segments: [] });

    await caller.podcast.generate({ title: "Failed Mix", turns: oneTurn });
    expect(await caller.podcast.listEpisodes()).toHaveLength(0);
  });
});

describe("podcast.deleteEpisode — per-user IDOR scoping", () => {
  it("refuses to delete another user's episode and leaves the row intact", async () => {
    const alice = await seedUser(db, { openId: "a", email: "a@x.com" });
    const bob = await seedUser(db, { openId: "b", email: "b@x.com" });
    await db.insert(podcastEpisodes).values({
      id: "ep-bob",
      userId: bob.id,
      title: "Bob's secret",
      audioUrl: "/podcasts/bob.wav",
    });

    const aliceCaller = appRouter.createCaller(makeContext(alice, db));
    await expect(
      aliceCaller.podcast.deleteEpisode({ id: "ep-bob" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const rows = await db.select().from(podcastEpisodes);
    expect(rows).toHaveLength(1);
  });

  it("deletes the caller's own episode", async () => {
    const user = await seedUser(db);
    await db.insert(podcastEpisodes).values({
      id: "ep-mine",
      userId: user.id,
      title: "Mine",
      audioUrl: "/podcasts/mine.wav",
    });
    const caller = appRouter.createCaller(makeContext(user, db));
    expect(await caller.podcast.deleteEpisode({ id: "ep-mine" })).toEqual({ id: "ep-mine" });
    expect(await db.select().from(podcastEpisodes)).toHaveLength(0);
  });
});

describe("podcast.generateScript — Sovereign-mode gate", () => {
  function withAi(user: Parameters<typeof makeContext>[0], chatResult = "[]") {
    const aiProvider = { chat: vi.fn().mockResolvedValue(chatResult) };
    return { caller: appRouter.createCaller(makeContext(user, db, { aiProvider })), aiProvider };
  }

  it("blocks a sovereign user defaulting to the openai provider", async () => {
    const user = await seedUser(db, { executionMode: "sovereign" });
    const { caller, aiProvider } = withAi(user);
    await expect(
      caller.podcast.generateScript({ topic: "AI safety" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(aiProvider.chat).not.toHaveBeenCalled();
  });

  it("lets a sovereign user generate with a local provider", async () => {
    const user = await seedUser(db, { executionMode: "sovereign" });
    const { caller, aiProvider } = withAi(user, "[{\"speakerId\":\"Alex\",\"text\":\"hi\"}]");
    const res = await caller.podcast.generateScript({ topic: "AI safety", providerId: "ollama" });
    expect(res).toEqual({ content: "[{\"speakerId\":\"Alex\",\"text\":\"hi\"}]" });
    expect(aiProvider.chat).toHaveBeenCalledOnce();
  });

  it("generates a script for a scrapper user via the default cloud provider", async () => {
    const user = await seedUser(db, { executionMode: "scrapper" });
    const { caller, aiProvider } = withAi(user, "script text");
    const res = await caller.podcast.generateScript({ topic: "Robotics", format: "text" });
    expect(res).toEqual({ content: "script text" });
    expect(aiProvider.chat).toHaveBeenCalledOnce();
  });
});
