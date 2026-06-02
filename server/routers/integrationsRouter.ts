/**
 * @file server/routers/integrationsRouter.ts
 * @description Omnecor — Third-Party Integrations Router
 *
 * Stores integration tokens encrypted at rest using AES-256-GCM.
 * Key is derived from JWT_SECRET (same secret used for session cookies).
 * Concurrent mutations are serialized through a write lock to prevent
 * read-modify-write races on the backing store.
 *
 * Supported services:
 *   GitHub   – Personal Access Token → GET /user, GET /user/repos
 *   Notion   – Internal Integration Token → POST /v1/search
 *   Slack    – Bot OAuth Token → auth.test, conversations.list
 *   Google Drive – OAuth Access Token → GET /drive/v3/about
 */

import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc.js";
import { TRPCError } from "@trpc/server";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "crypto";
import { ENV } from "../_core/env.js";
import { createLogger } from "../_core/logger.js";

const log = createLogger("integrations");

// ---------------------------------------------------------------------------
// Encryption — AES-256-GCM, key derived from JWT_SECRET
// ---------------------------------------------------------------------------

function deriveKey(): Buffer {
  const secret = ENV.cookieSecret || "omnecor-local-dev-fallback-key-change-me";
  return createHash("sha256").update(secret).digest();
}

function encryptToken(plaintext: string): { ciphertext: string; iv: string; tag: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

function decryptToken(ciphertext: string, iv: string, tag: string): string {
  const decipher = createDecipheriv("aes-256-gcm", deriveKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

// ---------------------------------------------------------------------------
// Store — ~/.omnecor/integrations.json  (tokens encrypted, metadata plain)
// ---------------------------------------------------------------------------

const INTEGRATIONS_PATH = join(homedir(), ".omnecor", "integrations.json");

interface StoredEntry {
  type: string;
  /** AES-256-GCM ciphertext (base64) */
  ciphertext: string;
  iv: string;
  tag: string;
  metadata: Record<string, unknown>;
  connectedAt: string;
}

type Store = Record<string, StoredEntry>;

function readStore(): Store {
  try {
    if (!existsSync(INTEGRATIONS_PATH)) return {};
    return JSON.parse(readFileSync(INTEGRATIONS_PATH, "utf-8")) as Store;
  } catch {
    return {};
  }
}

function writeStoreDirect(data: Store): void {
  const dir = join(homedir(), ".omnecor");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(INTEGRATIONS_PATH, JSON.stringify(data, null, 2), { encoding: "utf-8", mode: 0o600 });
}

// Serialise all writes through a promise queue so concurrent mutations never
// interleave their read-modify-write cycles.
let _writeLock: Promise<void> = Promise.resolve();

async function withLock<T>(fn: () => Promise<T> | T): Promise<T> {
  let release!: () => void;
  const acquired = new Promise<void>(r => { release = r; });
  const prev = _writeLock;
  _writeLock = acquired;
  await prev; // wait for previous holder
  try {
    return await fn();
  } finally {
    release();
  }
}

// Convenience: read the plain token from a stored entry
function readToken(entry: StoredEntry): string {
  return decryptToken(entry.ciphertext, entry.iv, entry.tag);
}

// ---------------------------------------------------------------------------
// External API helpers
// ---------------------------------------------------------------------------

async function githubFetch(path: string, token: string) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "Omnecor/1.0",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 401) throw new TRPCError({ code: "UNAUTHORIZED", message: "GitHub token invalid or expired." });
  if (!res.ok) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `GitHub API ${res.status}` });
  return res.json();
}

async function notionFetch(path: string, token: string, body?: unknown) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 401) throw new TRPCError({ code: "UNAUTHORIZED", message: "Notion token invalid or expired." });
  if (!res.ok) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Notion API ${res.status}` });
  return res.json();
}

async function slackFetch(method: string, token: string, params: Record<string, string> = {}) {
  const res = await fetch(`https://slack.com/api/${method}?${new URLSearchParams(params)}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Slack HTTP ${res.status}` });
  const data = await res.json() as { ok: boolean; error?: string };
  if (!data.ok) throw new TRPCError({ code: "UNAUTHORIZED", message: `Slack: ${data.error ?? "unknown error"}` });
  return data;
}

async function gdriveFetch(path: string, token: string) {
  const res = await fetch(`https://www.googleapis.com/drive/v3${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 401) throw new TRPCError({ code: "UNAUTHORIZED", message: "Google Drive token invalid or expired." });
  if (!res.ok) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Google Drive API ${res.status}` });
  return res.json();
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const INTEGRATION_TYPES = ["github", "notion", "slack", "google-drive"] as const;
type IntegrationType = typeof INTEGRATION_TYPES[number];

export const integrationsRouter = router({

  /** Return all configured integration statuses (no raw tokens ever leave the server). */
  getIntegrations: protectedProcedure.query(() => {
    const store = readStore();
    return INTEGRATION_TYPES.map(type => {
      const entry = store[type];
      return {
        type,
        isConnected: !!entry,
        connectedAt: entry?.connectedAt ?? null,
        metadata: entry?.metadata ?? null,
      };
    });
  }),

  /** Validate a token against the live service then store it encrypted. */
  connect: protectedProcedure
    .input(z.object({
      type: z.enum(INTEGRATION_TYPES),
      token: z.string().min(1).max(512),
    }))
    .mutation(({ input }) =>
      withLock(async () => {
        let metadata: Record<string, unknown> = {};

        if (input.type === "github") {
          const user = await githubFetch("/user", input.token) as {
            login: string; name?: string; email?: string; avatar_url?: string;
          };
          metadata = { username: user.login, name: user.name ?? null, email: user.email ?? null };

        } else if (input.type === "notion") {
          const me = await notionFetch("/users/me", input.token) as {
            name?: string;
            bot?: { owner?: { user?: { name?: string; person?: { email?: string } } } };
          };
          const ownerName = me.bot?.owner?.user?.name ?? me.name ?? "Notion User";
          const ownerEmail = me.bot?.owner?.user?.person?.email ?? null;
          metadata = { username: ownerName, email: ownerEmail };

        } else if (input.type === "slack") {
          const auth = await slackFetch("auth.test", input.token) as {
            user: string; user_id: string; team: string; team_id: string;
          };
          metadata = { username: auth.user, userId: auth.user_id, team: auth.team };

        } else if (input.type === "google-drive") {
          const about = await gdriveFetch("/about?fields=user,storageQuota", input.token) as {
            user?: { displayName?: string; emailAddress?: string };
            storageQuota?: { limit?: string; usage?: string };
          };
          metadata = {
            username: about.user?.displayName ?? "Drive User",
            email: about.user?.emailAddress ?? null,
            storageTotal: about.storageQuota?.limit ? Number(about.storageQuota.limit) : null,
            storageUsed: about.storageQuota?.usage ? Number(about.storageQuota.usage) : null,
          };
        }

        const { ciphertext, iv, tag } = encryptToken(input.token);
        const store = readStore();
        store[input.type] = { type: input.type, ciphertext, iv, tag, metadata, connectedAt: new Date().toISOString() };
        writeStoreDirect(store);
        log.info(`Connected ${input.type}: ${String(metadata.username ?? "")}`);
        return { success: true, metadata };
      })
    ),

  /** Remove a stored integration. */
  disconnect: protectedProcedure
    .input(z.object({ type: z.enum(INTEGRATION_TYPES) }))
    .mutation(({ input }) =>
      withLock(async () => {
        const store = readStore();
        delete store[input.type];
        writeStoreDirect(store);
        log.info(`Disconnected ${input.type}`);
        return { success: true };
      })
    ),

  /** Re-fetch live data from the connected service. */
  sync: protectedProcedure
    .input(z.object({ type: z.enum(INTEGRATION_TYPES) }))
    .mutation(({ input }) =>
      withLock(async () => {
        const store = readStore();
        const entry = store[input.type];
        if (!entry) throw new TRPCError({ code: "NOT_FOUND", message: `${input.type} is not connected.` });

        const token = readToken(entry);
        let syncData: Record<string, unknown> = {};

        if (input.type === "github") {
          const repos = await githubFetch("/user/repos?per_page=30&sort=pushed", token) as Array<{
            id: number; name: string; html_url: string; description: string | null;
            private: boolean; pushed_at: string;
          }>;
          syncData = {
            repositories: repos.map(r => ({
              id: r.id, name: r.name, url: r.html_url,
              description: r.description ?? null, isPrivate: r.private, lastPushed: r.pushed_at,
            })),
            repoCount: repos.length,
          };

        } else if (input.type === "notion") {
          const results = await notionFetch("/search", token, {
            filter: { property: "object", value: "database" },
            page_size: 20,
          }) as { results: Array<{ id: string; title?: Array<{ plain_text: string }>; icon?: { emoji?: string } }> };
          syncData = {
            databases: results.results.map(db => ({
              id: db.id,
              title: db.title?.[0]?.plain_text ?? "Untitled",
              icon: db.icon?.emoji ?? null,
            })),
            dbCount: results.results.length,
          };

        } else if (input.type === "slack") {
          const data = await slackFetch("conversations.list", token, { limit: "20", types: "public_channel,private_channel" }) as {
            channels: Array<{ id: string; name: string; is_private: boolean }>;
          };
          syncData = {
            channels: data.channels.map(c => ({ id: c.id, name: c.name, isPrivate: c.is_private })),
            channelCount: data.channels.length,
          };

        } else if (input.type === "google-drive") {
          const about = await gdriveFetch("/about?fields=storageQuota", token) as {
            storageQuota?: { limit?: string; usage?: string };
          };
          syncData = {
            storageTotal: about.storageQuota?.limit ? Number(about.storageQuota.limit) : null,
            storageUsed: about.storageQuota?.usage ? Number(about.storageQuota.usage) : null,
          };
        }

        store[input.type] = {
          ...entry,
          metadata: { ...entry.metadata, ...syncData, lastSynced: new Date().toISOString() },
        };
        writeStoreDirect(store);
        return { success: true, type: input.type, data: syncData };
      })
    ),

  /** Persist per-integration settings (non-sensitive config). */
  updateSettings: protectedProcedure
    .input(z.object({
      type: z.enum(INTEGRATION_TYPES),
      settings: z.record(z.string(), z.unknown()),
    }))
    .mutation(({ input }) =>
      withLock(async () => {
        const store = readStore();
        const entry = store[input.type];
        if (!entry) throw new TRPCError({ code: "NOT_FOUND", message: `${input.type} is not connected.` });
        store[input.type] = { ...entry, metadata: { ...entry.metadata, settings: input.settings } };
        writeStoreDirect(store);
        return { success: true };
      })
    ),
});
