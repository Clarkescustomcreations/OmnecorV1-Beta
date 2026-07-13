/**
 * Subscription-level tests for `blueprint.agentStream`.
 *
 * `ChatAgentRunner` is mocked to yield scripted events (no real provider), and
 * the CAD/FEA status probes are stubbed so nothing spawns openscad/python. What
 * this proves — beyond the toolset tests in blueprintRouter.test.ts — is the
 * stream orchestration the router owns: the user turn is persisted before
 * streaming, the assistant turn is persisted on `done` only when non-empty,
 * empty-content history is filtered out of the messages handed to the runner,
 * and a non-owner is rejected before anything is written.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("../db.factory.js", async (importActual) => {
  const actual = await importActual<typeof import("../db.factory.js")>();
  return { ...actual, getDb: async () => h.db };
});
vi.mock("../core_services/services/AuditLogService.js", () => ({
  AuditLogService: { getInstance: () => ({ log: vi.fn().mockResolvedValue(undefined) }) },
}));
// Avoid the real openscad --version / python import probes.
vi.mock("../core_services/blueprint/BlueprintCadService.js", () => ({
  BlueprintCadService: {
    getInstance: () => ({ getEngineStatus: async () => ({ jscad: { available: true }, openscad: { available: false, path: "openscad" } }) }),
  },
}));
vi.mock("../core_services/blueprint/BlueprintFeaService.js", () => ({
  BlueprintFeaService: { getInstance: () => ({ checkAvailability: async () => ({ available: false }) }) },
}));
// Scripted agent loop.
const runnerRunMock = vi.hoisted(() => vi.fn());
vi.mock("../core_services/services/ChatAgentRunner.js", () => ({
  ChatAgentRunner: class {
    run = runnerRunMock;
  },
}));

import { appRouter } from "../routers.js";
import { blueprintMessages, blueprintPlans } from "../../drizzle/schema.js";
import { asc, eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { createTestDb, seedUser, makeContext, type TestDb } from "./_helpers/trpcHarness.js";
import type { Db } from "../db.js";

type Caller = ReturnType<typeof appRouter.createCaller>;

let store: TestDb;
let db: Db;
let alice: Awaited<ReturnType<typeof seedUser>>;
let bob: Awaited<ReturnType<typeof seedUser>>;
let asAlice: Caller;
let asBob: Caller;

beforeEach(async () => {
  store = await createTestDb();
  db = store.db;
  h.db = db;
  alice = await seedUser(db, { name: "Alice" });
  bob = await seedUser(db, { name: "Bob", email: "bob@example.com" });
  asAlice = appRouter.createCaller(makeContext(alice, db));
  asBob = appRouter.createCaller(makeContext(bob, db));
  runnerRunMock.mockReset();
});

async function createPlan(userId: number) {
  const id = uuidv4();
  await db.insert(blueprintPlans).values({
    id,
    userId,
    title: "Welding table",
    brief: "",
    category: "metal_fab",
    units: "imperial",
    cadEngine: "jscad",
    status: "draft",
  });
  return id;
}

/** Drive a tRPC subscription to completion (or error). */
function drive(sub: { subscribe: (o: { next: () => void; error: () => void; complete: () => void }) => unknown }) {
  return new Promise<void>((resolve) => {
    sub.subscribe({ next: () => {}, error: () => resolve(), complete: () => resolve() });
  });
}

describe("blueprint.agentStream", () => {
  it("persists the user turn + a non-empty assistant turn and filters empty history", async () => {
    const planId = await createPlan(alice.id);
    // Prior history: a real user turn plus a poisoned empty assistant turn.
    await db.insert(blueprintMessages).values({ id: uuidv4(), planId, role: "user", content: "earlier question" });
    await db.insert(blueprintMessages).values({ id: uuidv4(), planId, role: "assistant", content: "" });

    runnerRunMock.mockImplementation(async function* () {
      yield {
        type: "done",
        content: "Here is the plan",
        blocks: [{ id: "b1", type: "text", text: "Here is the plan" }],
        totalTokens: 42,
      };
    });

    const sub = await asAlice.blueprint.agentStream({ planId, providerId: "ollama", modelId: "qwen2.5:7b", message: "new question" });
    await drive(sub);

    const msgs = await db.select().from(blueprintMessages).where(eq(blueprintMessages.planId, planId)).orderBy(asc(blueprintMessages.createdAt));
    const contents = msgs.map((m) => `${m.role}:${m.content}`);
    expect(contents).toContain("user:new question");
    const asstNew = msgs.find((m) => m.role === "assistant" && m.content === "Here is the plan");
    expect(asstNew).toBeDefined();
    expect((asstNew!.blocks as { type: string }[])[0].type).toBe("text");
    expect(asstNew!.tokenCount).toBe(42);

    // The runner got the filtered history — the empty assistant row was dropped.
    const passed = runnerRunMock.mock.calls[0]![0] as { input: { messages: { role: string; content: string }[] } };
    expect(passed.input.messages).toEqual([
      { role: "user", content: "earlier question" },
      { role: "user", content: "new question" },
    ]);
  });

  it("does not persist an empty assistant turn (whitespace content + no blocks)", async () => {
    const planId = await createPlan(alice.id);
    runnerRunMock.mockImplementation(async function* () {
      yield { type: "done", content: "   ", blocks: [], totalTokens: 0 };
    });
    const sub = await asAlice.blueprint.agentStream({ planId, providerId: "ollama", modelId: "m", message: "hi" });
    await drive(sub);
    const msgs = await db.select().from(blueprintMessages).where(eq(blueprintMessages.planId, planId));
    expect(msgs).toHaveLength(1); // the user turn only
    expect(msgs[0].role).toBe("user");
  });

  it("errors and writes nothing for a plan the caller doesn't own", async () => {
    const planId = await createPlan(alice.id);
    runnerRunMock.mockImplementation(async function* () {
      yield { type: "done", content: "x", blocks: [] };
    });
    const sub = await asBob.blueprint.agentStream({ planId, providerId: "ollama", modelId: "m", message: "hijack" });
    let errored = false;
    await new Promise<void>((resolve) => {
      sub.subscribe({ next: () => {}, error: () => { errored = true; resolve(); }, complete: () => resolve() });
    });
    expect(errored).toBe(true);
    expect(runnerRunMock).not.toHaveBeenCalled();
    expect(await db.select().from(blueprintMessages).where(eq(blueprintMessages.planId, planId))).toHaveLength(0);
  });
});
