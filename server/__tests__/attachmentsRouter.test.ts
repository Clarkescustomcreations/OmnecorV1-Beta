/**
 * Route-level integration tests for `attachmentsRouter`.
 *
 * Security-focused: the extension allowlist must store dangerous/active-content
 * files as ".bin" so they can never be served/executed, while keeping known-safe
 * extensions. Also verifies the data-URL prefix is stripped and base64 is decoded
 * to disk faithfully, and the auth gate. Files written under cwd/uploads are
 * cleaned up after each test.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TRPCError } from "@trpc/server";

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

import fs from "node:fs/promises";
import { join } from "node:path";
import { appRouter } from "../routers.js";
import { createTestDb, seedUser, makeContext, type TestDb } from "./_helpers/trpcHarness.js";
import type { Db } from "../db.js";

type Caller = ReturnType<typeof appRouter.createCaller>;
let store: TestDb;
let db: Db;
const written: string[] = [];

// "hello" in base64
const HELLO_B64 = Buffer.from("hello").toString("base64");

function track(url: string): string {
  const p = join(process.cwd(), url);
  written.push(p);
  return p;
}

beforeEach(async () => {
  store = await createTestDb();
  db = store.db;
  h.db = db;
});

afterEach(async () => {
  await Promise.all(written.splice(0).map(p => fs.rm(p, { force: true })));
});

describe("auth boundary", () => {
  it("rejects unauthenticated uploadFile", async () => {
    const caller = appRouter.createCaller(makeContext(null, db));
    await expect(
      caller.attachments.uploadFile({ name: "a.txt", mimeType: "text/plain", dataUrl: HELLO_B64 })
    ).rejects.toThrow(TRPCError);
  });
});

describe("attachments.uploadFile — extension allowlist (security)", () => {
  it("keeps a known-safe extension (.png)", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const res = await caller.attachments.uploadFile({ name: "pic.png", mimeType: "image/png", dataUrl: HELLO_B64 });
    track(res.url);
    expect(res.url.endsWith(".png")).toBe(true);
    expect(res.filename).toBe("pic.png"); // original name preserved in metadata
  });

  it.each(["evil.exe", "run.sh", "icon.svg", "page.html", "macro.bat", "noextension"])(
    "stores dangerous/active-content or extensionless file %s as .bin",
    async (name) => {
      const user = await seedUser(db);
      const caller: Caller = appRouter.createCaller(makeContext(user, db));
      const res = await caller.attachments.uploadFile({ name, mimeType: "application/octet-stream", dataUrl: HELLO_B64 });
      track(res.url);
      expect(res.url.endsWith(".bin")).toBe(true);
    }
  );
});

describe("attachments.uploadFile — payload decoding", () => {
  it("strips the data-URL prefix and writes the decoded bytes", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const res = await caller.attachments.uploadFile({
      name: "note.txt",
      mimeType: "text/plain",
      dataUrl: `data:text/plain;base64,${HELLO_B64}`,
    });
    const path = track(res.url);
    const content = await fs.readFile(path, "utf-8");
    expect(content).toBe("hello");
  });
});
