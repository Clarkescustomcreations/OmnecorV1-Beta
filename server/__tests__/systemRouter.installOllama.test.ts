/**
 * Route-level tests for `system.installOllama` (Linux branch) — kept separate
 * from systemRouter.test.ts because these mock `https` and `child_process`
 * wholesale, which would destabilize the shell-out-free tests there.
 *
 * Regression anchor (2026-07-03, Workflow-Matrix "Ollama auto-install"):
 * ollama.com now serves the install script behind a 307 → GitHub → 302 → CDN
 * redirect chain; the old helper only followed 301/302, so both the Linux and
 * Windows installs failed with "HTTP 307" on a clean machine. These tests pin
 * the fixed behavior: full 3xx-following (https-only, loop-capped), fail-fast
 * PRECONDITION_FAILED when a non-root server has no passwordless sudo (the
 * detached installer cannot answer a sudo prompt), and thrown TRPCErrors on
 * download failure (a resolved `{success:false}` renders as a green success
 * toast in SetupWizard).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";

type FakeResponse = { statusCode: number; headers?: Record<string, string>; body?: string };

const h = vi.hoisted(() => ({
  responses: [] as FakeResponse[],
  requestedUrls: [] as string[],
  spawnCalls: [] as Array<{ cmd: string; args: string[] }>,
  sudoChecks: 0,
  sudoOk: false,
  zstdMissing: false, // when true, both findExecutable paths (fs.access + `which`) report zstd absent
}));

// findExecutable checks absolute candidates via fs.access first, then `which`.
// Reject zstd's access() when we want to exercise the missing-zstd pre-flight;
// pass everything else (migrations, harness) through untouched.
vi.mock("fs/promises", async importActual => {
  const actual = await importActual<typeof import("fs/promises")>();
  const access = (p: unknown, ...rest: unknown[]) => {
    if (h.zstdMissing && String(p).includes("zstd")) return Promise.reject(new Error("ENOENT"));
    return (actual.access as (...a: unknown[]) => Promise<void>)(p, ...rest);
  };
  return { ...actual, default: { ...actual, access }, access };
});

// systemRouter does `import * as https from "https"` — serve canned responses.
vi.mock("https", () => {
  const get = (url: string, cb: (res: unknown) => void) => {
    h.requestedUrls.push(url);
    const desc = h.responses.shift() ?? { statusCode: 500 };
    const res = {
      statusCode: desc.statusCode,
      headers: desc.headers ?? {},
      resume: () => {},
      pipe: (dest: { end: (chunk: string) => void }) => {
        dest.end(desc.body ?? "");
        return dest;
      },
    };
    queueMicrotask(() => cb(res));
    const req = { on: () => req };
    return req;
  };
  return { get, default: { get } };
});

// spawn → recorded fake process; execFile("sudo", ["-n","true"]) → h.sudoOk.
vi.mock("child_process", async importActual => {
  const actual = await importActual<typeof import("child_process")>();
  return {
    ...actual,
    execFile: ((file: string, args: unknown, cb: unknown) => {
      const callback = (typeof args === "function" ? args : cb) as (err: Error | null, stdout: string, stderr: string) => void;
      if (file === "sudo") {
        h.sudoChecks++;
        callback(h.sudoOk ? null : new Error("sudo: a password is required"), "", "");
        return new EventEmitter();
      }
      // findExecutable's PATH fallback for zstd — force-fail when simulating absence.
      if (file === "which" && Array.isArray(args) && (args as string[])[0] === "zstd" && h.zstdMissing) {
        callback(new Error("zstd not found"), "", "");
        return new EventEmitter();
      }
      return (actual.execFile as (...a: unknown[]) => unknown)(file, args, cb);
    }) as typeof actual.execFile,
    spawn: ((cmd: string, args: string[]) => {
      h.spawnCalls.push({ cmd, args });
      const proc = new EventEmitter() as EventEmitter & { unref: () => void };
      proc.unref = () => {};
      return proc;
    }) as typeof actual.spawn,
  };
});

vi.mock("../core_services/services/AuditLogService.js", () => ({
  AuditLogService: {
    getInstance: () => ({ log: vi.fn().mockResolvedValue(undefined) }),
  },
}));

import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appRouter } from "../routers.js";
import { createTestDb, seedUser, makeContext } from "./_helpers/trpcHarness.js";
import type { Db } from "../db.js";
import type { User } from "../../drizzle/schema.js";

type Caller = ReturnType<typeof appRouter.createCaller>;
let db: Db;
let user: User;
let admin: User;

const SCRIPT_DEST = join(tmpdir(), "ollama-install.sh");
const OLLAMA_URL = "https://ollama.com/install.sh";

beforeEach(async () => {
  const store = await createTestDb();
  db = store.db;
  user = await seedUser(db);
  admin = await seedUser(db, { openId: "admin", email: "admin@x.com", role: "admin" });
  h.responses.length = 0;
  h.requestedUrls.length = 0;
  h.spawnCalls.length = 0;
  h.sudoChecks = 0;
  h.sudoOk = false;
  h.zstdMissing = false;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// The procedure branches on os.platform(); only the Linux branch is testable here.
describe.runIf(process.platform === "linux")("system.installOllama (Linux branch)", () => {
  const asRoot = () => vi.spyOn(process, "getuid").mockReturnValue(0);
  const asUser = () => vi.spyOn(process, "getuid").mockReturnValue(1000);

  it("forbids a non-admin", async () => {
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    await expect(caller.system.installOllama()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("fails fast with PRECONDITION_FAILED when non-root and passwordless sudo is unavailable", async () => {
    asUser();
    h.sudoOk = false;
    const caller: Caller = appRouter.createCaller(makeContext(admin, db));
    await expect(caller.system.installOllama()).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining("passwordless sudo"),
    });
    // Fail-fast: nothing downloaded, nothing spawned.
    expect(h.requestedUrls).toHaveLength(0);
    expect(h.spawnCalls).toHaveLength(0);
  });

  it("fails fast with PRECONDITION_FAILED when zstd (installer's extraction dep) is absent", async () => {
    asRoot();
    h.zstdMissing = true;
    const caller: Caller = appRouter.createCaller(makeContext(admin, db));
    await expect(caller.system.installOllama()).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining("zstd"),
    });
    // Pre-flight aborts before any download or spawn.
    expect(h.requestedUrls).toHaveLength(0);
    expect(h.spawnCalls).toHaveLength(0);
  });

  it("follows the live 307→302→200 redirect chain, writes the script, and spawns `sh` detached", async () => {
    asRoot();
    const body = "#!/bin/sh\necho fake-ollama-installer\n";
    h.responses.push(
      { statusCode: 307, headers: { location: "https://github.com/ollama/ollama/releases/latest/download/install.sh" } },
      { statusCode: 302, headers: { location: "https://release-assets.example.com/install.sh" } },
      { statusCode: 200, body },
    );
    const caller: Caller = appRouter.createCaller(makeContext(admin, db));
    const res = await caller.system.installOllama();
    expect(res.success).toBe(true);
    expect(h.requestedUrls).toEqual([
      OLLAMA_URL,
      "https://github.com/ollama/ollama/releases/latest/download/install.sh",
      "https://release-assets.example.com/install.sh",
    ]);
    expect(readFileSync(SCRIPT_DEST, "utf-8")).toBe(body);
    expect(h.spawnCalls).toEqual([{ cmd: "sh", args: [SCRIPT_DEST] }]);
    expect(h.sudoChecks).toBe(0); // root skips the sudo pre-flight
  });

  it("proceeds when non-root but passwordless sudo works", async () => {
    asUser();
    h.sudoOk = true;
    h.responses.push({ statusCode: 200, body: "#!/bin/sh\n" });
    const caller: Caller = appRouter.createCaller(makeContext(admin, db));
    const res = await caller.system.installOllama();
    expect(res.success).toBe(true);
    expect(h.sudoChecks).toBe(1);
    expect(h.spawnCalls).toHaveLength(1);
  });

  it("resolves relative redirect Locations against the current URL", async () => {
    asRoot();
    h.responses.push(
      { statusCode: 308, headers: { location: "/download/install.sh" } },
      { statusCode: 200, body: "ok" },
    );
    const caller: Caller = appRouter.createCaller(makeContext(admin, db));
    await caller.system.installOllama();
    expect(h.requestedUrls[1]).toBe("https://ollama.com/download/install.sh");
  });

  it("throws (not resolves) on a non-redirect error status so the UI shows an error toast", async () => {
    asRoot();
    h.responses.push({ statusCode: 404 });
    const caller: Caller = appRouter.createCaller(makeContext(admin, db));
    await expect(caller.system.installOllama()).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: expect.stringContaining("HTTP 404"),
    });
    expect(h.spawnCalls).toHaveLength(0);
  });

  it("rejects a redirect that downgrades to http://", async () => {
    asRoot();
    h.responses.push({ statusCode: 307, headers: { location: "http://evil.example.com/install.sh" } });
    const caller: Caller = appRouter.createCaller(makeContext(admin, db));
    await expect(caller.system.installOllama()).rejects.toMatchObject({
      message: expect.stringContaining("insecure redirect"),
    });
    expect(h.requestedUrls).toHaveLength(1); // never followed
  });

  it("caps redirect chains to prevent loops", async () => {
    asRoot();
    for (let i = 0; i < 12; i++) {
      h.responses.push({ statusCode: 307, headers: { location: OLLAMA_URL } });
    }
    const caller: Caller = appRouter.createCaller(makeContext(admin, db));
    await expect(caller.system.installOllama()).rejects.toMatchObject({
      message: expect.stringContaining("too many redirects"),
    });
  });
});
