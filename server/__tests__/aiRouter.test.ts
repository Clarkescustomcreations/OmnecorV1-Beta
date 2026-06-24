/**
 * Route-level tests for `aiRouter`, focused on the boundaries a service-only
 * test can't reach:
 *   - the per-provider Sovereign-mode gate (the ONLY thing stopping an
 *     air-gapped user from tunnelling a cloud LLM call through `chat`, since
 *     these procedures are intentionally NOT `cloudProcedure`),
 *   - the Zod input contract, including the SSRF guard on `baseUrl`,
 *   - the `ommesh` (phone worker) precondition, and
 *   - provider discovery + loop-violation auditing.
 *
 * DB-CRUD procedures are covered at the persistence layer by chatRouter.test.ts;
 * here every dependency is mocked so the suite is hermetic.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";

// Mutable holder for the (mocked) WebSocket singleton so each test can simulate
// "no phone worker" (null) or an attached worker.
const wsHolder = vi.hoisted(() => ({ ws: null as unknown }));
const auditHolder = vi.hoisted(() => ({
  log: vi.fn().mockResolvedValue(undefined),
}));
const notifyHolder = vi.hoisted(() => ({ notify: vi.fn() }));

vi.mock("../phase2/websocket/WebSocketServer.js", async importActual => {
  const actual = await importActual<Record<string, unknown>>();
  return { ...actual, getWsInstance: () => wsHolder.ws };
});

vi.mock("../_core/NotificationService.js", () => ({
  NotificationService: { getInstance: () => ({ notify: notifyHolder.notify }) },
}));

// Audit middleware runs on every protectedProcedure; stub it so nothing touches
// the real file DB. `.log()` must return a promise — the middleware calls
// `.catch()` on it.
vi.mock("../phase2/services/AuditLogService.js", () => ({
  AuditLogService: { getInstance: () => ({ log: auditHolder.log }) },
}));

// Chat-persistence helpers used by aiRouter — mocked so ownership-scoping logic
// can be asserted at the router boundary without a real DB. Other db.factory
// exports are preserved.
const dbHelpers = vi.hoisted(() => ({
  getChatSession: vi.fn(),
  getChatSessions: vi.fn(),
  getChatMessages: vi.fn(),
  addChatMessage: vi.fn(),
  updateChatSession: vi.fn(),
}));
vi.mock("../db.factory.js", async importActual => {
  const actual = await importActual<Record<string, unknown>>();
  return { ...actual, ...dbHelpers };
});

import { appRouter } from "../routers.js";
import { makeContext } from "./_helpers/trpcHarness.js";
import type { Db } from "../db.js";
import type { User } from "../../drizzle/schema.js";

type Caller = ReturnType<typeof appRouter.createCaller>;

function makeUser(
  executionMode: User["executionMode"],
  role: User["role"] = "user"
): User {
  return {
    id: 1,
    openId: "owner-1",
    email: "u@example.com",
    name: "U",
    loginMethod: "manus",
    passwordHash: null,
    role,
    executionMode,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  } as User;
}

type AiServiceMocks = {
  chat: ReturnType<typeof vi.fn>;
  discoverOllamaModels: ReturnType<typeof vi.fn>;
  streamChat: ReturnType<typeof vi.fn>;
};

function caller(
  user: User | null,
  chatResult = "assistant reply"
): { caller: Caller; ai: AiServiceMocks } {
  const ai: AiServiceMocks = {
    chat: vi.fn().mockResolvedValue(chatResult),
    discoverOllamaModels: vi.fn().mockResolvedValue([{ name: "llama3" }]),
    streamChat: vi.fn(),
  };
  const services = {
    aiProvider: ai,
    memoryArchitect: { isOnline: () => false, consolidateEpisodic: vi.fn() },
    scraper: { scrape: vi.fn() },
    codingContext: { getContextSnippets: vi.fn() },
  };
  return {
    caller: appRouter.createCaller(makeContext(user, {} as Db, services)),
    ai,
  };
}

const baseChat = {
  modelId: "claude-opus-4-8",
  messages: [{ role: "user" as const, content: "hello" }],
};

beforeEach(() => {
  wsHolder.ws = null;
  auditHolder.log.mockClear();
  notifyHolder.notify.mockClear();
  for (const fn of Object.values(dbHelpers)) fn.mockReset();
});

describe("aiRouter.getProviders", () => {
  it("returns the built-in providers and no phone entry when no worker is attached", async () => {
    const { caller: c } = caller(makeUser("scrapper"));
    const providers = await c.ai.getProviders();
    const ids = providers.map(p => p.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "ollama",
        "openai",
        "anthropic",
        "gemini",
        "grok",
        "forge",
      ])
    );
    expect(ids).not.toContain("ommesh");
  });

  it("adds an 'ommesh' provider named after the phone when a mobile worker is present", async () => {
    wsHolder.ws = {
      hasMobileWorker: () => true,
      getMobileNodes: () => [
        { nodeName: "Pixel", capabilities: { modelLoaded: true } },
      ],
    };
    const { caller: c } = caller(makeUser("scrapper"));
    const providers = await c.ai.getProviders();
    expect(providers).toContainEqual({ id: "ommesh", name: "Phone — Pixel" });
  });
});

describe("aiRouter.discoverOllamaModels", () => {
  it("delegates to the AI provider service", async () => {
    const { caller: c, ai } = caller(makeUser("scrapper"));
    const result = await c.ai.discoverOllamaModels();
    expect(ai.discoverOllamaModels).toHaveBeenCalledOnce();
    expect(result).toEqual([{ name: "llama3" }]);
  });
});

describe("aiRouter.chat — Sovereign-mode provider gate", () => {
  it("blocks a sovereign user from a cloud provider (FORBIDDEN) and never calls the service", async () => {
    const { caller: c, ai } = caller(makeUser("sovereign"));
    await expect(
      c.ai.chat({ ...baseChat, providerId: "openai" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(ai.chat).not.toHaveBeenCalled();
  });

  it("allows a sovereign user to use a local provider (ollama)", async () => {
    const { caller: c, ai } = caller(makeUser("sovereign"), "local answer");
    const res = await c.ai.chat({ ...baseChat, providerId: "ollama" });
    expect(res).toEqual({ content: "local answer" });
    expect(ai.chat).toHaveBeenCalledOnce();
  });

  it("allows a non-sovereign (scrapper) user to use a cloud provider and notifies", async () => {
    const { caller: c, ai } = caller(makeUser("scrapper"), "cloud answer");
    const res = await c.ai.chat({ ...baseChat, providerId: "openai" });
    expect(res).toEqual({ content: "cloud answer" });
    expect(ai.chat).toHaveBeenCalledOnce();
    // Sends userId + executionMode through to the service (moe routing / spend).
    expect(ai.chat.mock.calls[0]?.[0]).toMatchObject({
      userId: 1,
      executionMode: "scrapper",
    });
    expect(notifyHolder.notify).toHaveBeenCalledOnce();
  });
});

describe("aiRouter.chat — ommesh phone routing", () => {
  it("fails with PRECONDITION_FAILED when no phone worker is attached", async () => {
    const { caller: c } = caller(makeUser("scrapper"));
    await expect(
      c.ai.chat({ ...baseChat, providerId: "ommesh" })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("routes inference to the phone when a worker is attached", async () => {
    const routeInferenceToMobile = vi.fn().mockResolvedValue("phone says hi");
    wsHolder.ws = { hasMobileWorker: () => true, routeInferenceToMobile };
    const { caller: c } = caller(makeUser("scrapper"));
    const res = await c.ai.chat({
      ...baseChat,
      providerId: "ommesh",
      maxTokens: 64,
    });
    expect(res).toEqual({ content: "phone says hi" });
    expect(routeInferenceToMobile).toHaveBeenCalledOnce();
  });
});

describe("aiRouter.chat — input contract (SSRF guard)", () => {
  it("rejects a baseUrl pointing at a private/loopback address", async () => {
    const { caller: c, ai } = caller(makeUser("scrapper"));
    for (const url of [
      "http://localhost:11434",
      "http://127.0.0.1:8080",
      "http://192.168.1.10",
      "http://169.254.169.254/latest/meta-data", // cloud metadata SSRF
    ]) {
      await expect(
        c.ai.chat({ ...baseChat, providerId: "custom", baseUrl: url })
      ).rejects.toBeInstanceOf(TRPCError);
    }
    expect(ai.chat).not.toHaveBeenCalled();
  });

  it("accepts a public baseUrl and forwards it to the service", async () => {
    const { caller: c, ai } = caller(makeUser("scrapper"));
    await c.ai.chat({
      ...baseChat,
      providerId: "custom",
      baseUrl: "https://api.example.com",
    });
    expect(ai.chat).toHaveBeenCalledOnce();
    expect(ai.chat.mock.calls[0]?.[0]).toMatchObject({
      baseUrl: "https://api.example.com",
    });
  });

  it("rejects an invalid provider id format", async () => {
    const { caller: c } = caller(makeUser("scrapper"));
    await expect(
      c.ai.chat({ ...baseChat, providerId: "bad id!" })
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it("rejects an empty message list", async () => {
    const { caller: c } = caller(makeUser("scrapper"));
    await expect(
      c.ai.chat({ providerId: "openai", modelId: "m", messages: [] })
    ).rejects.toBeInstanceOf(TRPCError);
  });
});

describe("aiRouter.saveMessage — input contract", () => {
  it("rejects a non-uuid sessionId before touching the database", async () => {
    const { caller: c } = caller(makeUser("scrapper"));
    await expect(
      c.ai.saveMessage({ sessionId: "not-a-uuid", role: "user", content: "x" })
    ).rejects.toBeInstanceOf(TRPCError);
  });
});

describe("aiRouter.reportLoopViolation", () => {
  it("writes a hitl:loop_detected audit event and reports logged", async () => {
    const { caller: c } = caller(makeUser("scrapper"));
    const sessionId = randomUUID();
    const res = await c.ai.reportLoopViolation({
      sessionId,
      hash: "abc123",
      consecutiveCount: 4,
      lastActions: [{ tool: "writeFile", args: { path: "/tmp/x" } }],
    });
    expect(res).toEqual({ logged: true });
    // The explicit audit call (separate from the middleware's own logging).
    const loopCall = auditHolder.log.mock.calls.find(
      c => (c[0] as { eventType?: string })?.eventType === "hitl:loop_detected"
    );
    expect(loopCall).toBeDefined();
    expect(loopCall?.[0]).toMatchObject({
      procedure: "ai.reportLoopViolation",
      actorId: 1,
      result: { status: "flagged", actionsCount: 1 },
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Per-user ownership scoping (IDOR regression guards).
//
// aiRouter's chat-persistence reads are NOT cloudProcedure and historically did
// no ownership check, so any authenticated user could read/append/summarize
// another user's session by UUID. These assert the fix: a session owned by user
// 2 is invisible/untouchable to user 1. ctx.user.id is always 1 here.
// ─────────────────────────────────────────────────────────────────────────────
describe("aiRouter — session ownership scoping", () => {
  const otherUsersSession = (id: string) => ({
    id,
    userId: 2, // owned by someone else
    projectId: "p",
    title: "secret",
    providerId: "openai",
    modelId: "m",
    systemPrompt: null,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  it("getSession returns null for a session the caller does not own (no leak)", async () => {
    const id = randomUUID();
    dbHelpers.getChatSession.mockResolvedValue(otherUsersSession(id));
    const { caller: c } = caller(makeUser("scrapper"));
    const res = await c.ai.getSession({ sessionId: id });
    expect(res).toBeNull();
    // Never even fetches the other user's messages.
    expect(dbHelpers.getChatMessages).not.toHaveBeenCalled();
  });

  it("getSession returns the session with messages for its owner", async () => {
    const id = randomUUID();
    dbHelpers.getChatSession.mockResolvedValue({
      ...otherUsersSession(id),
      userId: 1,
    });
    dbHelpers.getChatMessages.mockResolvedValue([{ id: "m1", content: "hi" }]);
    const { caller: c } = caller(makeUser("scrapper"));
    const res = await c.ai.getSession({ sessionId: id });
    expect(res?.messages).toHaveLength(1);
    expect(dbHelpers.getChatMessages).toHaveBeenCalledOnce();
  });

  it("getSessions filters out sessions owned by other users", async () => {
    const mine = {
      ...otherUsersSession(randomUUID()),
      userId: 1,
      title: "mine",
    };
    const theirs = otherUsersSession(randomUUID());
    dbHelpers.getChatSessions.mockResolvedValue([mine, theirs]);
    const { caller: c } = caller(makeUser("scrapper"));
    const res = await c.ai.getSessions({ projectId: "p" });
    expect(res).toHaveLength(1);
    expect(res[0]?.title).toBe("mine");
  });

  it("saveMessage rejects appending to a non-owned session and never writes", async () => {
    const id = randomUUID();
    dbHelpers.getChatSession.mockResolvedValue(otherUsersSession(id));
    const { caller: c } = caller(makeUser("scrapper"));
    await expect(
      c.ai.saveMessage({ sessionId: id, role: "user", content: "injected" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(dbHelpers.addChatMessage).not.toHaveBeenCalled();
  });

  it("saveMessage appends for the session owner", async () => {
    const id = randomUUID();
    dbHelpers.getChatSession.mockResolvedValue({
      ...otherUsersSession(id),
      userId: 1,
    });
    dbHelpers.addChatMessage.mockResolvedValue(undefined);
    dbHelpers.updateChatSession.mockResolvedValue(undefined);
    const { caller: c } = caller(makeUser("scrapper"));
    const res = await c.ai.saveMessage({
      sessionId: id,
      role: "user",
      content: "x",
    });
    expect(res.messageId).toBeTruthy();
    expect(dbHelpers.addChatMessage).toHaveBeenCalledOnce();
  });

  it("summarizeAndPruneSession refuses a non-owned session before calling the model", async () => {
    const id = randomUUID();
    dbHelpers.getChatSession.mockResolvedValue(otherUsersSession(id));
    const { caller: c, ai } = caller(makeUser("scrapper"));
    await expect(
      c.ai.summarizeAndPruneSession({
        sessionId: id,
        projectId: "p",
        providerId: "openai",
        modelId: "m",
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(ai.chat).not.toHaveBeenCalled();
    expect(dbHelpers.getChatMessages).not.toHaveBeenCalled();
  });
});
