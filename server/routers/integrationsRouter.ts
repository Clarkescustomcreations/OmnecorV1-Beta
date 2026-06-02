/**
 * @file server/routers/integrationsRouter.ts
 * @description Omnecor — Third-Party Integrations Router
 *
 * Manages authentication tokens and live data sync for:
 *   - GitHub (Personal Access Tokens → /user, /user/repos)
 *   - Notion (Integration Tokens → /v1/search)
 *   - Slack (Bot Tokens → conversations.list, auth.test)
 *   - Google Drive (OAuth tokens → drive/v3/about, drive/v3/files)
 *
 * Tokens are stored in ~/.omnecor/integrations.json (never logged or returned raw).
 * All network calls are made server-side to avoid CORS issues and keep keys off
 * the client.
 */

import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc.js";
import { TRPCError } from "@trpc/server";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { createLogger } from "../_core/logger.js";
const log = createLogger("integrations");

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

const INTEGRATIONS_PATH = join(homedir(), ".omnecor", "integrations.json");

interface StoredToken {
  type: string;
  token: string;
  metadata?: Record<string, unknown>;
  connectedAt: string;
}

function readStore(): Record<string, StoredToken> {
  try {
    if (!existsSync(INTEGRATIONS_PATH)) return {};
    return JSON.parse(readFileSync(INTEGRATIONS_PATH, "utf-8")) as Record<string, StoredToken>;
  } catch {
    return {};
  }
}

function writeStore(data: Record<string, StoredToken>): void {
  const dir = join(homedir(), ".omnecor");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(INTEGRATIONS_PATH, JSON.stringify(data, null, 2), "utf-8");
}

// ---------------------------------------------------------------------------
// GitHub helpers
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
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `GitHub API error ${res.status}: ${body}` });
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Notion helpers
// ---------------------------------------------------------------------------

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
  if (!res.ok) {
    const body_text = await res.text().catch(() => "");
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Notion API error ${res.status}: ${body_text}` });
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Slack helpers
// ---------------------------------------------------------------------------

async function slackFetch(method: string, token: string, params: Record<string, string> = {}) {
  const query = new URLSearchParams({ ...params });
  const res = await fetch(`https://slack.com/api/${method}?${query}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Slack API error ${res.status}` });
  }
  const data = await res.json() as { ok: boolean; error?: string };
  if (!data.ok) throw new TRPCError({ code: "UNAUTHORIZED", message: `Slack error: ${data.error ?? "unknown"}` });
  return data;
}

// ---------------------------------------------------------------------------
// Google Drive helpers
// ---------------------------------------------------------------------------

async function gdriveFetch(path: string, token: string) {
  const res = await fetch(`https://www.googleapis.com/drive/v3${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 401) throw new TRPCError({ code: "UNAUTHORIZED", message: "Google Drive token invalid or expired." });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Google Drive API error ${res.status}: ${body}` });
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const INTEGRATION_TYPES = ["github", "notion", "slack", "google-drive"] as const;
type IntegrationType = typeof INTEGRATION_TYPES[number];

export const integrationsRouter = router({

  /** Return all configured integrations (status + sanitized account info, no raw tokens). */
  getIntegrations: protectedProcedure.query(async () => {
    const store = readStore();
    return INTEGRATION_TYPES.map(type => {
      const stored = store[type];
      return {
        type,
        isConnected: !!stored,
        connectedAt: stored?.connectedAt ?? null,
        metadata: stored?.metadata ?? null,
      };
    });
  }),

  /** Connect an integration by storing and validating a token. */
  connect: protectedProcedure
    .input(z.object({
      type: z.enum(INTEGRATION_TYPES),
      token: z.string().min(1).max(512),
    }))
    .mutation(async ({ input }) => {
      const store = readStore();
      let metadata: Record<string, unknown> = {};

      if (input.type === "github") {
        const user = await githubFetch("/user", input.token) as {
          login: string; name: string; email: string; avatar_url: string; id: number;
        };
        metadata = { username: user.login, name: user.name, email: user.email, avatarUrl: user.avatar_url };

      } else if (input.type === "notion") {
        const me = await notionFetch("/users/me", input.token) as {
          name: string; type: string; bot?: { owner?: { user?: { name: string; person?: { email: string } } } };
        };
        const ownerName = me.bot?.owner?.user?.name ?? me.name ?? "Notion User";
        const ownerEmail = me.bot?.owner?.user?.person?.email ?? null;
        metadata = { username: ownerName, email: ownerEmail };

      } else if (input.type === "slack") {
        const auth = await slackFetch("auth.test", input.token) as {
          user_id: string; user: string; team: string; team_id: string;
        };
        metadata = { username: auth.user, userId: auth.user_id, team: auth.team, teamId: auth.team_id };

      } else if (input.type === "google-drive") {
        const about = await gdriveFetch("/about?fields=user,storageQuota", input.token) as {
          user?: { displayName: string; emailAddress: string };
          storageQuota?: { limit: string; usage: string };
        };
        metadata = {
          username: about.user?.displayName ?? "Drive User",
          email: about.user?.emailAddress ?? null,
          storageTotal: about.storageQuota?.limit ? Number(about.storageQuota.limit) : null,
          storageUsed: about.storageQuota?.usage ? Number(about.storageQuota.usage) : null,
        };
      }

      store[input.type] = {
        type: input.type,
        token: input.token,
        metadata,
        connectedAt: new Date().toISOString(),
      };
      writeStore(store);
      log.info(`[Integrations] Connected ${input.type} for user ${JSON.stringify(metadata.username ?? "")}`);
      return { success: true, metadata };
    }),

  /** Disconnect (remove stored token). */
  disconnect: protectedProcedure
    .input(z.object({ type: z.enum(INTEGRATION_TYPES) }))
    .mutation(({ input }) => {
      const store = readStore();
      delete store[input.type];
      writeStore(store);
      log.info(`[Integrations] Disconnected ${input.type}`);
      return { success: true };
    }),

  /** Sync live data from the connected service. */
  sync: protectedProcedure
    .input(z.object({ type: z.enum(INTEGRATION_TYPES) }))
    .mutation(async ({ input }) => {
      const store = readStore();
      const stored = store[input.type];
      if (!stored) {
        throw new TRPCError({ code: "NOT_FOUND", message: `${input.type} is not connected.` });
      }

      let syncData: Record<string, unknown> = {};

      if (input.type === "github") {
        const repos = await githubFetch("/user/repos?per_page=30&sort=pushed", stored.token) as Array<{
          id: number; name: string; html_url: string; description: string | null;
          private: boolean; pushed_at: string;
        }>;
        syncData = {
          repositories: repos.map(r => ({
            id: r.id,
            name: r.name,
            url: r.html_url,
            description: r.description,
            isPrivate: r.private,
            lastPushed: r.pushed_at,
          })),
          repoCount: repos.length,
        };

      } else if (input.type === "notion") {
        const results = await notionFetch("/search", stored.token, {
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
        const channels = await slackFetch("conversations.list", stored.token, { limit: "20", types: "public_channel,private_channel" }) as {
          channels: Array<{ id: string; name: string; is_private: boolean }>;
        };
        syncData = {
          channels: channels.channels.map(c => ({ id: c.id, name: c.name, isPrivate: c.is_private })),
          channelCount: channels.channels.length,
        };

      } else if (input.type === "google-drive") {
        const about = await gdriveFetch("/about?fields=storageQuota", stored.token) as {
          storageQuota?: { limit: string; usage: string };
        };
        syncData = {
          storageTotal: about.storageQuota?.limit ? Number(about.storageQuota.limit) : null,
          storageUsed: about.storageQuota?.usage ? Number(about.storageQuota.usage) : null,
        };
      }

      // Update metadata with fresh sync data
      store[input.type] = {
        ...stored,
        metadata: { ...stored.metadata, ...syncData, lastSynced: new Date().toISOString() },
      };
      writeStore(store);
      return { success: true, type: input.type, data: syncData };
    }),

  /** Update settings for a connected integration. */
  updateSettings: protectedProcedure
    .input(z.object({
      type: z.enum(INTEGRATION_TYPES),
      settings: z.record(z.string(), z.unknown()),
    }))
    .mutation(({ input }) => {
      const store = readStore();
      const stored = store[input.type];
      if (!stored) {
        throw new TRPCError({ code: "NOT_FOUND", message: `${input.type} is not connected.` });
      }
      store[input.type] = {
        ...stored,
        metadata: { ...stored.metadata, settings: input.settings },
      };
      writeStore(store);
      return { success: true };
    }),
});
