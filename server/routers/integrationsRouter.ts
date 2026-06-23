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
import { router, protectedProcedure, externalServiceProcedure } from "../_core/trpc.js";
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
import type { FileTreeNode } from "./projectRouter.js";
import { getDb } from "../db.factory.js";
import { platformAccounts, neuralMaps } from "../../drizzle/schema.js";
import { and, desc, eq } from "drizzle-orm";
import { refreshOAuthToken } from "../oauth/oauthClients.js";
import { MemoryArchitectService } from "../phase2/services/MemoryArchitectService.js";
import { NotificationService } from "../_core/NotificationService.js";

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

/** One user's integrations, keyed by integration type. */
type UserBucket = Record<string, StoredEntry>;
/** The whole store, keyed by userId → UserBucket. */
type Store = Record<string, UserBucket>;

function readStore(): Store {
  try {
    if (!existsSync(INTEGRATIONS_PATH)) return {};
    return JSON.parse(readFileSync(INTEGRATIONS_PATH, "utf-8")) as Store;
  } catch {
    return {};
  }
}

/** A pre-userId (legacy, flat) entry has crypto fields at the top level. */
function isLegacyEntry(v: unknown): v is StoredEntry {
  return typeof v === "object" && v !== null && "ciphertext" in v;
}

/**
 * Returns the caller's bucket, isolating each user's tokens. Any legacy
 * top-level entries (written before per-user keying existed) are folded into
 * the first caller's bucket exactly once — correct for a local single-user
 * upgrade; a shared host starts clean so the ambiguous case never arises.
 * Mutates `store` in place; callers persist via writeStoreDirect on writes.
 */
function getBucket(store: Store, userId: string): UserBucket {
  const legacy: UserBucket = {};
  for (const [key, value] of Object.entries(store)) {
    if (isLegacyEntry(value)) {
      legacy[key] = value;
      delete store[key];
    }
  }
  const merged: UserBucket = { ...legacy, ...(store[userId] ?? {}) };
  store[userId] = merged;
  return merged;
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
  if (res.status === 403) throw new TRPCError({ code: "FORBIDDEN", message: "GitHub access forbidden — check token scopes or rate limit." });
  if (res.status === 404) throw new TRPCError({ code: "NOT_FOUND", message: `GitHub resource not found: ${path}` });
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
  if (res.status === 404) throw new TRPCError({ code: "NOT_FOUND", message: `Notion resource not found: ${path}` });
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
  if (res.status === 404) throw new TRPCError({ code: "NOT_FOUND", message: `Google Drive resource not found: ${path}` });
  if (!res.ok) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Google Drive API ${res.status}` });
  return res.json();
}

// ---------------------------------------------------------------------------
// Neural-map source ingestion — resolve a map root URI to real content nodes.
// Returns FileTreeNode[] (the exact shape getFileTree returns) so the client
// can run remote sources through fileTreeToNetwork like any local root.
// ---------------------------------------------------------------------------

/** Read the caller's decrypted token for an integration type, or throw. */
function getUserToken(userId: string, type: string): string {
  const store = readStore();
  const bucket = getBucket(store, userId);
  const entry = bucket[type];
  if (!entry) throw new TRPCError({ code: "NOT_FOUND", message: `${type} is not connected. Connect it in Settings → Integrations.` });
  return readToken(entry);
}

// ---------------------------------------------------------------------------
// OAuth-based integrations (Dropbox / OneDrive)
// Their tokens live in `platformAccounts` (populated by the one-click OAuth
// flow), NOT the paste-token store above. The map reads through to that store
// so OAuth refresh stays the single source of truth.
// ---------------------------------------------------------------------------

/** Integration types connected via the OAuth flow rather than a pasted token. */
const OAUTH_INTEGRATION_TYPES = new Set<string>(["dropbox", "onedrive"]);

/** Most-recent active `platformAccounts` row for (user, platform), or null. */
async function getOAuthAccount(userId: number, platform: string) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(platformAccounts)
    .where(and(
      eq(platformAccounts.userId, userId),
      eq(platformAccounts.platform, platform),
      eq(platformAccounts.isActive, 1),
    ))
    .orderBy(desc(platformAccounts.id))
    .limit(1);
  return rows[0] ?? null;
}

/** List the Dropbox account root (shallow). Surfaces a 401 status so the caller
 *  can refresh + retry, mirroring the gmailRouter pattern. */
async function listDropbox(token: string): Promise<{ status: number; nodes: FileTreeNode[] }> {
  const res = await fetch("https://api.dropboxapi.com/2/files/list_folder", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ path: "", limit: 100 }),
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 401) return { status: 401, nodes: [] };
  if (!res.ok) throw new TRPCError({ code: "BAD_GATEWAY", message: `Dropbox list failed (${res.status})` });
  const data = await res.json() as {
    entries?: Array<{ [".tag"]: string; name: string; id: string; size?: number; server_modified?: string }>;
  };
  const nodes: FileTreeNode[] = (data.entries ?? []).map(e => {
    const isFolder = e[".tag"] === "folder";
    return {
      name: e.name,
      path: `dropbox/${e.id}`,
      relativePath: e.id,
      type: isFolder ? ("directory" as const) : ("file" as const),
      size: e.size,
      modifiedAt: e.server_modified,
      ...(isFolder ? { children: [] } : {}),
    };
  });
  return { status: res.status, nodes };
}

/** List the OneDrive account root (shallow). */
async function listOnedrive(token: string): Promise<{ status: number; nodes: FileTreeNode[] }> {
  const res = await fetch(
    "https://graph.microsoft.com/v1.0/me/drive/root/children?$select=id,name,size,folder,file,lastModifiedDateTime&$top=100",
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) },
  );
  if (res.status === 401) return { status: 401, nodes: [] };
  if (!res.ok) throw new TRPCError({ code: "BAD_GATEWAY", message: `OneDrive list failed (${res.status})` });
  const data = await res.json() as {
    value?: Array<{ id: string; name: string; size?: number; folder?: unknown; file?: unknown; lastModifiedDateTime?: string }>;
  };
  const nodes: FileTreeNode[] = (data.value ?? []).map(e => {
    const isFolder = !!e.folder;
    return {
      name: e.name,
      path: `onedrive/${e.id}`,
      relativePath: e.id,
      type: isFolder ? ("directory" as const) : ("file" as const),
      size: e.size,
      modifiedAt: e.lastModifiedDateTime,
      ...(isFolder ? { children: [] } : {}),
    };
  });
  return { status: res.status, nodes };
}

/** Resolve an OAuth integration's content with one refresh-on-401 retry,
 *  persisting the rotated token (same pattern as gmailRouter). */
async function fetchOAuthIntegrationItems(userId: number, platform: string): Promise<FileTreeNode[]> {
  const account = await getOAuthAccount(userId, platform);
  if (!account) {
    throw new TRPCError({ code: "NOT_FOUND", message: `${platform} is not connected. Connect it via OAuth in Settings → Integrations.` });
  }
  const lister = platform === "dropbox" ? listDropbox : listOnedrive;
  let result = await lister(account.oauthToken);

  if (result.status === 401 && account.oauthRefreshToken) {
    log.info(`${platform} token expired, refreshing`);
    const refreshed = await refreshOAuthToken(platform, account.oauthRefreshToken);
    if (refreshed.access_token) {
      const db = await getDb();
      await db.update(platformAccounts).set({
        oauthToken: refreshed.access_token,
        oauthRefreshToken: refreshed.refresh_token || account.oauthRefreshToken,
        tokenExpiresAt: refreshed.expires_in
          ? new Date(Date.now() + refreshed.expires_in * 1000)
          : account.tokenExpiresAt,
      }).where(eq(platformAccounts.id, account.id));
      result = await lister(refreshed.access_token);
    }
  }

  if (result.status === 401) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: `${platform} token expired — reconnect it in Settings → Integrations.` });
  }
  return result.nodes;
}

/** Build a nested FileTreeNode[] from GitHub's flat recursive git-tree. */
function buildGithubFileTree(
  entries: Array<{ path: string; type: "blob" | "tree"; size?: number }>,
): FileTreeNode[] {
  const root: FileTreeNode = { name: "", path: "", relativePath: "", type: "directory", children: [] };
  const dirMap = new Map<string, FileTreeNode>([["", root]]);

  const ensureDir = (dirPath: string): FileTreeNode => {
    const existing = dirMap.get(dirPath);
    if (existing) return existing;
    const slash = dirPath.lastIndexOf("/");
    const parent = ensureDir(slash === -1 ? "" : dirPath.slice(0, slash));
    const name = slash === -1 ? dirPath : dirPath.slice(slash + 1);
    const node: FileTreeNode = { name, path: dirPath, relativePath: dirPath, type: "directory", children: [] };
    parent.children!.push(node);
    dirMap.set(dirPath, node);
    return node;
  };

  for (const e of entries) {
    if (e.type === "tree") {
      ensureDir(e.path);
    } else {
      const slash = e.path.lastIndexOf("/");
      const parent = ensureDir(slash === -1 ? "" : e.path.slice(0, slash));
      const name = slash === -1 ? e.path : e.path.slice(slash + 1);
      const dot = name.lastIndexOf(".");
      parent.children!.push({
        name,
        path: e.path,
        relativePath: e.path,
        type: "file",
        size: e.size,
        extension: dot > 0 ? name.slice(dot + 1) : undefined,
      });
    }
  }
  return root.children ?? [];
}

/** Fetch a GitHub repo's file tree (default branch, recursive, capped). */
async function fetchGithubTree(owner: string, repo: string, token: string): Promise<FileTreeNode[]> {
  const info = await githubFetch(`/repos/${owner}/${repo}`, token) as { default_branch?: string };
  const branch = info.default_branch || "main";
  const tree = await githubFetch(`/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`, token) as {
    tree?: Array<{ path: string; type: "blob" | "tree"; size?: number }>;
  };
  return buildGithubFileTree((tree.tree ?? []).slice(0, 1500));
}

/** List a connected integration's content items as flat FileTreeNode leaves. */
async function fetchIntegrationItems(type: string, token: string): Promise<FileTreeNode[]> {
  if (type === "notion") {
    const res = await notionFetch("/search", token, { page_size: 50 }) as {
      results: Array<{
        id: string;
        title?: Array<{ plain_text?: string }>;
        properties?: Record<string, { type?: string; title?: Array<{ plain_text?: string }> }>;
      }>;
    };
    return res.results.map((obj, i) => {
      let title = obj.title?.[0]?.plain_text;
      if (!title && obj.properties) {
        for (const p of Object.values(obj.properties)) {
          if (p?.type === "title" && p.title?.[0]?.plain_text) { title = p.title[0].plain_text; break; }
        }
      }
      return { name: title || `Notion item ${i + 1}`, path: `notion/${obj.id}`, relativePath: obj.id, type: "file" as const };
    });
  }

  if (type === "slack") {
    const data = await slackFetch("conversations.list", token, { limit: "100", types: "public_channel,private_channel" }) as {
      channels?: Array<{ id: string; name: string }>;
    };
    return (data.channels ?? []).map(c => ({ name: `#${c.name}`, path: `slack/${c.id}`, relativePath: c.id, type: "file" as const }));
  }

  if (type === "google-drive") {
    const res = await gdriveFetch("/files?pageSize=100&orderBy=modifiedTime desc&fields=files(id,name,mimeType,size,modifiedTime)", token) as {
      files?: Array<{ id: string; name: string; mimeType: string; size?: string; modifiedTime?: string }>;
    };
    return (res.files ?? []).map(f => {
      const isFolder = f.mimeType === "application/vnd.google-apps.folder";
      return {
        name: f.name,
        path: `gdrive/${f.id}`,
        relativePath: f.id,
        type: isFolder ? ("directory" as const) : ("file" as const),
        size: f.size ? Number(f.size) : undefined,
        modifiedAt: f.modifiedTime,
        ...(isFolder ? { children: [] } : {}),
      };
    });
  }

  if (type === "outlook") {
    const msgs = await fetch(
      "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$top=40&$select=id,subject,receivedDateTime",
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) },
    ).then(r => r.json()) as { value?: Array<{ id: string; subject?: string; receivedDateTime?: string }> };
    return (msgs.value ?? []).map(m => ({
      name: m.subject || "(no subject)", path: `outlook/${m.id}`, relativePath: m.id, type: "file" as const, modifiedAt: m.receivedDateTime,
    }));
  }

  if (type === "gmail") {
    const list = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=25",
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) },
    ).then(r => r.json()) as { messages?: Array<{ id: string }> };
    const ids = (list.messages ?? []).slice(0, 25).map(m => m.id);
    const out: FileTreeNode[] = [];
    for (const id of ids) {
      try {
        const msg = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=Subject`,
          { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) },
        ).then(r => r.json()) as { payload?: { headers?: Array<{ name: string; value: string }> } };
        const subject = msg.payload?.headers?.find(h => h.name === "Subject")?.value ?? "(no subject)";
        out.push({ name: subject, path: `gmail/${id}`, relativePath: id, type: "file" });
      } catch {
        // skip individual message errors
      }
    }
    return out;
  }

  // dropbox / onedrive / generic have no ingestion adapter yet — and can't hold a
  // token anyway (connect() has no branch for them), so getUserToken already threw.
  throw new TRPCError({ code: "NOT_IMPLEMENTED", message: `Map ingestion for "${type}" is not available yet.` });
}

// ---------------------------------------------------------------------------
// Remote-source CONTENT ingestion — turn a source URI into real text documents
// for the VectorDB feed (map RAG). Listing (fetchSourceTree) gives structure;
// this layer fetches the actual bodies so semantic search is over content, not
// just file names. Generic pipeline downstream (MemoryArchitect chunk/redact/
// embed); only the per-adapter "given an item, get its text" differs here.
//
// Hard bounds keep a single index run from hammering an external API or
// blowing up memory; per-item failures are skipped, never fatal.
// ---------------------------------------------------------------------------

/** A resolved document ready for the VectorDB feed. */
export interface SourceDocument {
  /** Stable, source-relative identity (e.g. repo path or `notion/<id>`). */
  path: string;
  /** The text body to embed. */
  text: string;
  /** Node kind — always "file" for content docs. */
  type: string;
}

const CONTENT_MAX_ITEMS = 400;                 // max files/docs fetched per source
const CONTENT_MAX_BYTES_PER_ITEM = 100_000;    // skip/clip bodies larger than ~100 KB
const CONTENT_MAX_TOTAL_BYTES = 8_000_000;     // ~8 MB ceiling per source per run
const CONTENT_CONCURRENCY = 5;                 // parallel content fetches

/** Extensions whose bodies are worth embedding (text/code). Mirrors the
 *  KnowledgeBase ingestible set; binaries are skipped. */
const TEXT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "mdx", "rst", "py", "ts", "tsx", "js", "jsx", "mjs", "cjs",
  "json", "jsonc", "yaml", "yml", "toml", "cfg", "ini", "env", "html", "htm", "css",
  "scss", "sass", "less", "rs", "go", "java", "kt", "kts", "c", "cc", "cpp", "h", "hpp",
  "cs", "sh", "bash", "zsh", "fish", "sql", "graphql", "gql", "proto", "r", "lua", "rb",
  "php", "swift", "scala", "clj", "ex", "exs", "vue", "svelte", "xml", "csv", "tsv", "log",
]);

export function hasTextExtension(name: string): boolean {
  const dot = name.lastIndexOf(".");
  if (dot < 0) {
    // Extensionless but commonly-text filenames worth indexing.
    const base = name.toLowerCase();
    return base === "dockerfile" || base === "makefile" || base === "readme" || base === "license";
  }
  return TEXT_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** Run an async mapper over items with bounded concurrency, preserving order. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) break;
      results[idx] = await fn(items[idx], idx);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}

/** Clip a body to the per-item ceiling so one huge file can't dominate. */
function clip(text: string): string {
  return text.length > CONTENT_MAX_BYTES_PER_ITEM ? text.slice(0, CONTENT_MAX_BYTES_PER_ITEM) : text;
}

/** A running total guard — returns false once the per-source byte ceiling is hit. */
function makeByteBudget() {
  let used = 0;
  return {
    take(text: string): boolean {
      if (used >= CONTENT_MAX_TOTAL_BYTES) return false;
      used += text.length;
      return true;
    },
  };
}

/** Strip HTML to rough plain text for email/rich bodies. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Percent-encode each path segment for the GitHub contents API. */
export function encodeGithubPath(p: string): string {
  return p.split("/").map(encodeURIComponent).join("/");
}

// ── GitHub ──────────────────────────────────────────────────────────────────

/** GET a single file's decoded UTF-8 content via the contents API, with one
 *  backoff retry on secondary-rate-limit (403/429). Returns null on any miss. */
async function githubGetContent(owner: string, repo: string, p: string, branch: string, token: string): Promise<string | null> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${encodeGithubPath(p)}?ref=${encodeURIComponent(branch)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "Omnecor/1.0",
        },
        signal: AbortSignal.timeout(15_000),
      },
    );
    if ((res.status === 403 || res.status === 429) && attempt < 2) {
      const retryAfter = Number(res.headers.get("retry-after")) || 2 ** attempt;
      await sleep(retryAfter * 1000);
      continue;
    }
    if (!res.ok) return null;
    const data = await res.json() as { content?: string; encoding?: string };
    if (!data.content) return null;
    return Buffer.from(data.content, (data.encoding as BufferEncoding) || "base64").toString("utf-8");
  }
}

async function fetchGithubDocuments(owner: string, repo: string, token: string): Promise<SourceDocument[]> {
  const info = await githubFetch(`/repos/${owner}/${repo}`, token) as { default_branch?: string };
  const branch = info.default_branch || "main";
  const tree = await githubFetch(`/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`, token) as {
    tree?: Array<{ path: string; type: "blob" | "tree"; size?: number }>;
  };
  const files = (tree.tree ?? [])
    .filter(e => e.type === "blob" && hasTextExtension(e.path) && (e.size ?? 0) <= CONTENT_MAX_BYTES_PER_ITEM)
    .slice(0, CONTENT_MAX_ITEMS);

  const budget = makeByteBudget();
  const docs = await mapWithConcurrency(files, CONTENT_CONCURRENCY, async (f) => {
    try {
      const text = await githubGetContent(owner, repo, f.path, branch, token);
      if (!text || !text.trim() || !budget.take(text)) return null;
      return { path: f.path, text: clip(text), type: "file" } as SourceDocument;
    } catch { return null; }
  });
  return docs.filter((d): d is SourceDocument => d !== null);
}

// ── Notion ──────────────────────────────────────────────────────────────────

/** Flatten a page's top-level blocks into plain text. */
export function extractNotionText(blocks: Array<Record<string, any>>): string {
  const lines: string[] = [];
  for (const b of blocks) {
    const type = b.type as string | undefined;
    const node = type ? b[type] : undefined;
    const rich = node?.rich_text as Array<{ plain_text?: string }> | undefined;
    if (Array.isArray(rich)) {
      const line = rich.map(r => r.plain_text ?? "").join("");
      if (line.trim()) lines.push(line);
    }
  }
  return lines.join("\n");
}

async function fetchNotionDocuments(token: string): Promise<SourceDocument[]> {
  const res = await notionFetch("/search", token, { page_size: 50 }) as {
    results: Array<{ id: string; title?: Array<{ plain_text?: string }>; properties?: Record<string, any> }>;
  };
  const pages = (res.results ?? []).slice(0, CONTENT_MAX_ITEMS);
  const budget = makeByteBudget();
  const docs = await mapWithConcurrency(pages, CONTENT_CONCURRENCY, async (pg) => {
    try {
      let title = pg.title?.[0]?.plain_text;
      if (!title && pg.properties) {
        for (const prop of Object.values(pg.properties)) {
          if (prop?.type === "title" && prop.title?.[0]?.plain_text) { title = prop.title[0].plain_text; break; }
        }
      }
      const children = await notionFetch(`/blocks/${pg.id}/children?page_size=100`, token) as {
        results?: Array<Record<string, any>>;
      };
      const body = extractNotionText(children.results ?? []);
      const text = `${title ?? "Untitled"}\n\n${body}`.trim();
      if (!body.trim() || !budget.take(text)) return null;
      return { path: `notion/${pg.id}`, text: clip(text), type: "file" } as SourceDocument;
    } catch { return null; }
  });
  return docs.filter((d): d is SourceDocument => d !== null);
}

// ── Slack ───────────────────────────────────────────────────────────────────

async function fetchSlackDocuments(token: string): Promise<SourceDocument[]> {
  const data = await slackFetch("conversations.list", token, { limit: "100", types: "public_channel,private_channel" }) as {
    channels?: Array<{ id: string; name: string }>;
  };
  const channels = (data.channels ?? []).slice(0, CONTENT_MAX_ITEMS);
  const budget = makeByteBudget();
  const docs = await mapWithConcurrency(channels, CONTENT_CONCURRENCY, async (c) => {
    try {
      const hist = await slackFetch("conversations.history", token, { channel: c.id, limit: "50" }) as {
        messages?: Array<{ text?: string }>;
      };
      const body = (hist.messages ?? []).map(m => m.text ?? "").filter(Boolean).join("\n");
      const text = `#${c.name}\n\n${body}`.trim();
      if (!body.trim() || !budget.take(text)) return null;
      return { path: `slack/${c.id}`, text: clip(text), type: "file" } as SourceDocument;
    } catch { return null; }
  });
  return docs.filter((d): d is SourceDocument => d !== null);
}

// ── Google Drive ──────────────────────────────────────────────────────────────

/** Resolve a Drive file's text: export Google-native docs to text, download
 *  text MIME types directly, skip binaries. */
async function downloadGdriveText(
  file: { id: string; name: string; mimeType: string }, token: string,
): Promise<string | null> {
  const auth = { Authorization: `Bearer ${token}` };
  let url: string | null = null;
  if (file.mimeType.startsWith("application/vnd.google-apps.")) {
    const exportType =
      file.mimeType === "application/vnd.google-apps.spreadsheet" ? "text/csv" :
      file.mimeType === "application/vnd.google-apps.document" ||
      file.mimeType === "application/vnd.google-apps.presentation" ? "text/plain" : null;
    if (!exportType) return null; // forms, drawings, folders, etc. — nothing to embed
    url = `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=${encodeURIComponent(exportType)}`;
  } else if (file.mimeType.startsWith("text/") || file.mimeType === "application/json" || hasTextExtension(file.name)) {
    url = `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`;
  } else {
    return null;
  }
  const res = await fetch(url, { headers: auth, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) return null;
  return clip(await res.text());
}

async function fetchGdriveDocuments(token: string): Promise<SourceDocument[]> {
  const res = await gdriveFetch(
    "/files?pageSize=200&orderBy=modifiedTime desc&fields=files(id,name,mimeType,size)&q=" +
      encodeURIComponent("trashed = false"),
    token,
  ) as { files?: Array<{ id: string; name: string; mimeType: string; size?: string }> };
  const files = (res.files ?? [])
    .filter(f => f.mimeType !== "application/vnd.google-apps.folder")
    .slice(0, CONTENT_MAX_ITEMS);
  const budget = makeByteBudget();
  const docs = await mapWithConcurrency(files, CONTENT_CONCURRENCY, async (f) => {
    try {
      const body = await downloadGdriveText(f, token);
      const text = body ? `${f.name}\n\n${body}`.trim() : "";
      if (!text || !budget.take(text)) return null;
      return { path: `gdrive/${f.id}`, text: clip(text), type: "file" } as SourceDocument;
    } catch { return null; }
  });
  return docs.filter((d): d is SourceDocument => d !== null);
}

// ── Gmail / Outlook ───────────────────────────────────────────────────────────

/** Recursively pull the first text/plain (or text/html) body from a Gmail payload. */
export function extractGmailBody(payload: any): string {
  if (!payload) return "";
  const decode = (data?: string) => data ? Buffer.from(data, "base64url").toString("utf-8") : "";
  if (payload.mimeType === "text/plain" && payload.body?.data) return decode(payload.body.data);
  if (payload.mimeType === "text/html" && payload.body?.data) return htmlToText(decode(payload.body.data));
  for (const part of payload.parts ?? []) {
    const found = extractGmailBody(part);
    if (found) return found;
  }
  return "";
}

async function fetchGmailDocuments(token: string): Promise<SourceDocument[]> {
  const auth = { Authorization: `Bearer ${token}` };
  const list = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=50",
    { headers: auth, signal: AbortSignal.timeout(10_000) },
  ).then(r => r.json()) as { messages?: Array<{ id: string }> };
  const ids = (list.messages ?? []).slice(0, Math.min(CONTENT_MAX_ITEMS, 50)).map(m => m.id);
  const budget = makeByteBudget();
  const docs = await mapWithConcurrency(ids, CONTENT_CONCURRENCY, async (id) => {
    try {
      const msg = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
        { headers: auth, signal: AbortSignal.timeout(15_000) },
      ).then(r => r.json()) as { snippet?: string; payload?: any };
      const subject = (msg.payload?.headers ?? []).find((h: any) => h.name === "Subject")?.value ?? "(no subject)";
      const body = extractGmailBody(msg.payload) || msg.snippet || "";
      const text = `${subject}\n\n${body}`.trim();
      if (!body.trim() || !budget.take(text)) return null;
      return { path: `gmail/${id}`, text: clip(text), type: "file" } as SourceDocument;
    } catch { return null; }
  });
  return docs.filter((d): d is SourceDocument => d !== null);
}

async function fetchOutlookDocuments(token: string): Promise<SourceDocument[]> {
  const auth = { Authorization: `Bearer ${token}` };
  const list = await fetch(
    "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$top=50&$select=id,subject,body,bodyPreview",
    { headers: auth, signal: AbortSignal.timeout(15_000) },
  ).then(r => r.json()) as {
    value?: Array<{ id: string; subject?: string; body?: { contentType?: string; content?: string }; bodyPreview?: string }>;
  };
  const msgs = (list.value ?? []).slice(0, CONTENT_MAX_ITEMS);
  const budget = makeByteBudget();
  const docs: SourceDocument[] = [];
  for (const m of msgs) {
    const raw = m.body?.content ?? m.bodyPreview ?? "";
    const body = m.body?.contentType === "html" ? htmlToText(raw) : raw.trim();
    const text = `${m.subject ?? "(no subject)"}\n\n${body}`.trim();
    if (!body.trim() || !budget.take(text)) continue;
    docs.push({ path: `outlook/${m.id}`, text: clip(text), type: "file" });
  }
  return docs;
}

// ── Dropbox / OneDrive (OAuth) ────────────────────────────────────────────────

/** Bounded recursive Dropbox listing → text-file content downloads. */
async function fetchDropboxDocuments(token: string): Promise<SourceDocument[]> {
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  type Entry = { [".tag"]: string; name: string; id: string; path_lower?: string; size?: number };
  const files: Entry[] = [];
  let body: any = { path: "", recursive: true, limit: 1000 };
  let url = "https://api.dropboxapi.com/2/files/list_folder";
  for (let page = 0; page < 5 && files.length < CONTENT_MAX_ITEMS; page++) {
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
    if (!res.ok) break;
    const data = await res.json() as { entries?: Entry[]; cursor?: string; has_more?: boolean };
    for (const e of data.entries ?? []) {
      if (e[".tag"] === "file" && hasTextExtension(e.name) && (e.size ?? 0) <= CONTENT_MAX_BYTES_PER_ITEM) files.push(e);
    }
    if (!data.has_more || !data.cursor) break;
    url = "https://api.dropboxapi.com/2/files/list_folder/continue";
    body = { cursor: data.cursor };
  }
  const budget = makeByteBudget();
  const docs = await mapWithConcurrency(files.slice(0, CONTENT_MAX_ITEMS), CONTENT_CONCURRENCY, async (f) => {
    try {
      const res = await fetch("https://content.dropboxapi.com/2/files/download", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Dropbox-API-Arg": JSON.stringify({ path: f.path_lower || f.id }) },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return null;
      const text = await res.text();
      if (!text.trim() || !budget.take(text)) return null;
      return { path: `dropbox/${f.id}`, text: clip(text), type: "file" } as SourceDocument;
    } catch { return null; }
  });
  return docs.filter((d): d is SourceDocument => d !== null);
}

/** Bounded BFS of the OneDrive tree → text-file content downloads. */
async function fetchOnedriveDocuments(token: string): Promise<SourceDocument[]> {
  const auth = { Authorization: `Bearer ${token}` };
  type Item = { id: string; name: string; size?: number; folder?: unknown; file?: unknown };
  const files: Item[] = [];
  const folderQueue: string[] = ["root"];
  let listings = 0;
  while (folderQueue.length > 0 && files.length < CONTENT_MAX_ITEMS && listings < 40) {
    const folderId = folderQueue.shift()!;
    listings++;
    const seg = folderId === "root" ? "root" : `items/${folderId}`;
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/me/drive/${seg}/children?$select=id,name,size,folder,file&$top=200`,
      { headers: auth, signal: AbortSignal.timeout(15_000) },
    );
    if (!res.ok) continue;
    const data = await res.json() as { value?: Item[] };
    for (const it of data.value ?? []) {
      if (it.folder) folderQueue.push(it.id);
      else if (it.file && hasTextExtension(it.name) && (it.size ?? 0) <= CONTENT_MAX_BYTES_PER_ITEM) files.push(it);
    }
  }
  const budget = makeByteBudget();
  const docs = await mapWithConcurrency(files.slice(0, CONTENT_MAX_ITEMS), CONTENT_CONCURRENCY, async (f) => {
    try {
      const res = await fetch(`https://graph.microsoft.com/v1.0/me/drive/items/${f.id}/content`, {
        headers: auth, signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return null;
      const text = await res.text();
      if (!text.trim() || !budget.take(text)) return null;
      return { path: `onedrive/${f.id}`, text: clip(text), type: "file" } as SourceDocument;
    } catch { return null; }
  });
  return docs.filter((d): d is SourceDocument => d !== null);
}

/**
 * Resolve a neural-map source URI to real text documents for the VectorDB feed.
 * Mirrors fetchSourceTree's URI dispatch but returns CONTENT, not just labels.
 * Reuses the same encrypted token store / OAuth refresh as the listing path.
 */
async function resolveSourceDocuments(uri: string, userId: number): Promise<SourceDocument[]> {
  if (uri.startsWith("github://")) {
    const slug = uri.slice("github://".length).replace(/\.git$/, "");
    const [owner, repo] = slug.split("/");
    if (!owner || !repo) throw new TRPCError({ code: "BAD_REQUEST", message: `Invalid GitHub source: ${uri}` });
    return fetchGithubDocuments(owner, repo, getUserToken(String(userId), "github"));
  }

  if (uri.startsWith("integration://")) {
    const type = uri.slice("integration://".length);
    if (OAUTH_INTEGRATION_TYPES.has(type)) {
      // Resolve (refreshing if near-expiry) the OAuth token via the same
      // platformAccounts store the listing path uses, then fetch content.
      const token = await resolveOAuthToken(userId, type);
      return type === "dropbox" ? fetchDropboxDocuments(token) : fetchOnedriveDocuments(token);
    }
    const token = getUserToken(String(userId), type);
    switch (type) {
      case "notion": return fetchNotionDocuments(token);
      case "slack": return fetchSlackDocuments(token);
      case "google-drive": return fetchGdriveDocuments(token);
      case "gmail": return fetchGmailDocuments(token);
      case "outlook": return fetchOutlookDocuments(token);
      default:
        throw new TRPCError({ code: "NOT_IMPLEMENTED", message: `Content ingestion for "${type}" is not available.` });
    }
  }

  throw new TRPCError({ code: "BAD_REQUEST", message: `Unsupported source URI: ${uri}` });
}

/** A valid, fresh OAuth access token for an OAuth integration (refresh-on-need),
 *  reusing the platformAccounts store. Throws if not connected / unrefreshable. */
async function resolveOAuthToken(userId: number, platform: string): Promise<string> {
  const account = await getOAuthAccount(userId, platform);
  if (!account) throw new TRPCError({ code: "NOT_FOUND", message: `${platform} is not connected.` });
  // If the stored token is still valid, use it; otherwise refresh.
  const expired = account.tokenExpiresAt ? account.tokenExpiresAt.getTime() <= Date.now() + 60_000 : false;
  if (!expired) return account.oauthToken;
  if (!account.oauthRefreshToken) return account.oauthToken;
  const refreshed = await refreshOAuthToken(platform, account.oauthRefreshToken);
  if (!refreshed.access_token) return account.oauthToken;
  const db = await getDb();
  await db.update(platformAccounts).set({
    oauthToken: refreshed.access_token,
    oauthRefreshToken: refreshed.refresh_token || account.oauthRefreshToken,
    tokenExpiresAt: refreshed.expires_in ? new Date(Date.now() + refreshed.expires_in * 1000) : account.tokenExpiresAt,
  }).where(eq(platformAccounts.id, account.id));
  return refreshed.access_token;
}

// ---------------------------------------------------------------------------
// Index-job tracking — a detached run per map, polled by the client for
// progress. Kept in-memory: a fresh process simply has no in-flight jobs.
// ---------------------------------------------------------------------------

interface IndexedSourceResult {
  uri: string;
  ok: boolean;
  items: number;
  chunks: number;
  error?: string;
}

interface MapIndexStatus {
  mapId: string;
  state: "running" | "done" | "error";
  startedAt: string;
  finishedAt: string | null;
  totalSources: number;
  completedSources: number;
  totalChunks: number;
  sources: IndexedSourceResult[];
  error: string | null;
}

const indexJobs = new Map<string, MapIndexStatus>();

const isRemoteRoot = (r: string) => r.startsWith("github://") || r.startsWith("integration://");

/** Run the (detached) index of every remote root of a map into its collection. */
async function runMapIndexJob(mapId: string, userId: number, remoteRoots: string[]): Promise<void> {
  const status = indexJobs.get(mapId)!;
  const memory = MemoryArchitectService.getInstance();
  await memory.init().catch(() => {});

  for (const uri of remoteRoots) {
    const result: IndexedSourceResult = { uri, ok: false, items: 0, chunks: 0 };
    try {
      const sourceType = uri.startsWith("github://") ? "github" : uri.slice("integration://".length);
      const docs = await resolveSourceDocuments(uri, userId);
      const { items, chunks } = await memory.reindexRemoteSource(mapId, uri, sourceType, docs);
      result.ok = true;
      result.items = items;
      result.chunks = chunks;
      status.totalChunks += chunks;
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err);
      log.warn(`Map index: source failed`, { mapId, uri, error: result.error });
    }
    status.sources.push(result);
    status.completedSources++;
  }

  status.state = status.sources.every(s => s.ok) ? "done" : (status.sources.some(s => s.ok) ? "done" : "error");
  status.finishedAt = new Date().toISOString();

  const okCount = status.sources.filter(s => s.ok).length;
  NotificationService.getInstance().notify({
    kind: "system",
    title: "Map indexing complete",
    body: `Indexed ${okCount}/${status.totalSources} source${status.totalSources === 1 ? "" : "s"} · ${status.totalChunks} chunks into the map's knowledge base.`,
    href: "/brain-map",
    data: { mapId, totalChunks: status.totalChunks },
  });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const INTEGRATION_TYPES = ["outlook", "gmail", "github", "notion", "slack", "google-drive", "dropbox", "onedrive", "generic"] as const;
type IntegrationType = typeof INTEGRATION_TYPES[number];

export const integrationsRouter = router({

  /** Return all configured integration statuses (no raw tokens ever leave the server). */
  // Pure local read — must stay protectedProcedure so sovereign-mode users can still
  // view connection status (a cloud/externalService procedure would throw FORBIDDEN here).
  getIntegrations: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });
    const store = readStore();
    const bucket = getBucket(store, String(ctx.user.id));

    // dropbox/onedrive connect via the OAuth flow → their connected state lives
    // in platformAccounts, not the paste-token store.
    const oauthConnected = new Map<string, { connectedAt: string | null; metadata: unknown }>();
    for (const platform of OAUTH_INTEGRATION_TYPES) {
      const account = await getOAuthAccount(Number(ctx.user.id), platform);
      if (account) {
        oauthConnected.set(platform, {
          connectedAt: account.createdAt ? account.createdAt.toISOString() : null,
          metadata: account.accountMetadata
            ?? (account.accountName ? { username: account.accountName } : null),
        });
      }
    }

    return INTEGRATION_TYPES.map(type => {
      if (OAUTH_INTEGRATION_TYPES.has(type)) {
        const oc = oauthConnected.get(type);
        return { type, isConnected: !!oc, connectedAt: oc?.connectedAt ?? null, metadata: oc?.metadata ?? null };
      }
      const entry = bucket[type];
      return {
        type,
        isConnected: !!entry,
        connectedAt: entry?.connectedAt ?? null,
        metadata: entry?.metadata ?? null,
      };
    });
  }),

  /** Validate a token against the live service then store it encrypted. */
  connect: externalServiceProcedure
    .input(z.object({
      type: z.enum(INTEGRATION_TYPES),
      token: z.string().min(1).max(512),
    }))
    .mutation(({ input, ctx }) =>
      withLock(async () => {
        if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });
        if (OAUTH_INTEGRATION_TYPES.has(input.type)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `${input.type} connects via OAuth — use the Connect button in Settings → Integrations, not a pasted token.`,
          });
        }
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
          const authResult = await slackFetch("auth.test", input.token);
          if (!authResult.ok) throw new TRPCError({ code: "UNAUTHORIZED", message: authResult.error ?? "Slack auth failed" });
          const auth = authResult as { ok: boolean; user: string; user_id: string; team: string; team_id: string };
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

        } else if (input.type === "outlook") {
          const me = await fetch("https://graph.microsoft.com/v1.0/me", {
            headers: { Authorization: `Bearer ${input.token}` },
          }).then(r => r.json()) as { displayName?: string; mail?: string; userPrincipalName?: string };
          metadata = {
            username: me.displayName ?? me.userPrincipalName ?? "Outlook User",
            email: me.mail ?? me.userPrincipalName ?? null,
          };

        } else if (input.type === "gmail") {
          const profile = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
            headers: { Authorization: `Bearer ${input.token}` },
          }).then(r => r.json()) as { emailAddress?: string; messagesTotal?: number };
          metadata = {
            username: profile.emailAddress ?? "Gmail User",
            email: profile.emailAddress ?? null,
            messagesTotal: profile.messagesTotal ?? null,
          };
        }

        const { ciphertext, iv, tag } = encryptToken(input.token);
        const store = readStore();
        const bucket = getBucket(store, String(ctx.user.id));
        bucket[input.type] = { type: input.type, ciphertext, iv, tag, metadata, connectedAt: new Date().toISOString() };
        writeStoreDirect(store);
        log.info(`Connected ${input.type}: ${String(metadata.username ?? "")}`);
        return { success: true, metadata };
      })
    ),

  /** Remove a stored integration. */
  disconnect: protectedProcedure
    .input(z.object({ type: z.enum(INTEGRATION_TYPES) }))
    .mutation(({ input, ctx }) =>
      withLock(async () => {
        if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });
        if (OAUTH_INTEGRATION_TYPES.has(input.type)) {
          // OAuth-based: deactivate the platformAccounts row instead of the
          // paste-token store (which never holds these).
          const db = await getDb();
          await db.update(platformAccounts)
            .set({ isActive: 0 })
            .where(and(
              eq(platformAccounts.userId, Number(ctx.user.id)),
              eq(platformAccounts.platform, input.type),
            ));
          log.info(`Disconnected ${input.type} (OAuth)`);
          return { success: true };
        }
        const store = readStore();
        const bucket = getBucket(store, String(ctx.user.id));
        delete bucket[input.type];
        writeStoreDirect(store);
        log.info(`Disconnected ${input.type}`);
        return { success: true };
      })
    ),

  /** Re-fetch live data from the connected service. */
  sync: externalServiceProcedure
    .input(z.object({ type: z.enum(INTEGRATION_TYPES) }))
    .mutation(({ input, ctx }) =>
      withLock(async () => {
        if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });
        const store = readStore();
        const bucket = getBucket(store, String(ctx.user.id));
        const entry = bucket[input.type];
        if (!entry) throw new TRPCError({ code: "NOT_FOUND", message: `${input.type} is not connected.` });

        const token = readToken(entry);
        let syncData: Record<string, unknown> = {};

        if (input.type === "github") {
          const ghUser = await githubFetch("/user", token) as { login: string };
          const owner = ghUser.login;
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
          // Enrich: fetch README of the most-recently-pushed repo
          const top = repos[0];
          if (top) {
            try {
              const readme = await githubFetch(`/repos/${owner}/${top.name}/readme`, token) as {
                content: string; encoding: string;
              };
              const preview = Buffer.from(readme.content, "base64").toString("utf-8").slice(0, 4000);
              (syncData as Record<string, unknown>).topRepoReadme = { repo: top.name, preview };
            } catch {
              // README missing or inaccessible — skip silently
            }
          }

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
          const listResult = await slackFetch("conversations.list", token, { limit: "20", types: "public_channel,private_channel" });
          if (!listResult.ok) throw new TRPCError({ code: "UNAUTHORIZED", message: listResult.error ?? "Slack conversations.list failed" });
          const data = listResult as { ok: boolean; channels: Array<{ id: string; name: string; is_private: boolean }> };
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

        } else if (input.type === "outlook") {
          const msgs = await fetch(
            "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$top=10&$select=id,subject,from,bodyPreview,receivedDateTime",
            { headers: { Authorization: `Bearer ${token}` } },
          ).then(r => r.json()) as {
            value?: Array<{
              id: string;
              subject: string;
              bodyPreview?: string;
              from?: { emailAddress?: { address?: string } };
            }>;
          };
          syncData = {
            recentCount: msgs.value?.length ?? 0,
            recentMessages: (msgs.value ?? []).map(m => ({
              subject: m.subject,
              from: m.from?.emailAddress?.address ?? null,
              snippet: m.bodyPreview ?? null,
            })),
            lastSynced: new Date().toISOString(),
          };

        } else if (input.type === "gmail") {
          const profile = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
            headers: { Authorization: `Bearer ${token}` },
          }).then(r => r.json()) as { emailAddress?: string; messagesTotal?: number; threadsTotal?: number };
          syncData = {
            messagesTotal: profile.messagesTotal ?? null,
            threadsTotal: profile.threadsTotal ?? null,
            lastSynced: new Date().toISOString(),
          };
          // Enrich: fetch subjects + snippets from recent messages
          try {
            const gmailHeaders = { Authorization: `Bearer ${token}` };
            const list = await fetch(
              "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=8",
              { headers: gmailHeaders },
            ).then(r => r.json()) as { messages?: Array<{ id: string }> };
            const ids = (list.messages ?? []).slice(0, 8).map(m => m.id);
            const recentMessages: Array<{ subject: string | null; from: string | null; snippet: string | null }> = [];
            for (const id of ids) {
              try {
                const msg = await fetch(
                  `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`,
                  { headers: gmailHeaders },
                ).then(r => r.json()) as {
                  snippet?: string;
                  payload?: { headers?: Array<{ name: string; value: string }> };
                };
                const hdrs = msg.payload?.headers ?? [];
                const subject = hdrs.find(h => h.name === "Subject")?.value ?? null;
                const from = hdrs.find(h => h.name === "From")?.value ?? null;
                recentMessages.push({ subject, from, snippet: msg.snippet ?? null });
              } catch {
                // skip individual message errors
              }
            }
            (syncData as Record<string, unknown>).recentMessages = recentMessages;
          } catch {
            // Gmail message list unavailable — skip silently
          }
        }

        bucket[input.type] = {
          ...entry,
          metadata: { ...entry.metadata, ...syncData, lastSynced: new Date().toISOString() },
        };
        writeStoreDirect(store);
        return { success: true, type: input.type, data: syncData };
      })
    ),

  /**
   * Resolve a neural-map source URI to real content nodes.
   *   github://owner/repo      → the repo's recursive file tree (default branch)
   *   integration://<type>     → the connected service's content listing
   * Returns FileTreeNode[] (same shape as project.getFileTree) so the client can
   * render remote sources as real expandable trees via fileTreeToNetwork.
   * externalServiceProcedure: hits external (non-AI) APIs → blocked in Sovereign
   * mode unless the operator enables "block AI providers only".
   */
  fetchSourceTree: externalServiceProcedure
    .input(z.object({ uri: z.string().min(1).max(512) }))
    .query(async ({ input, ctx }): Promise<FileTreeNode[]> => {
      if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });
      const userId = String(ctx.user.id);

      if (input.uri.startsWith("github://")) {
        const slug = input.uri.slice("github://".length).replace(/\.git$/, "");
        const [owner, repo] = slug.split("/");
        if (!owner || !repo) throw new TRPCError({ code: "BAD_REQUEST", message: `Invalid GitHub source: ${input.uri}` });
        return fetchGithubTree(owner, repo, getUserToken(userId, "github"));
      }

      if (input.uri.startsWith("integration://")) {
        const type = input.uri.slice("integration://".length);
        if (OAUTH_INTEGRATION_TYPES.has(type)) {
          return fetchOAuthIntegrationItems(Number(ctx.user.id), type);
        }
        return fetchIntegrationItems(type, getUserToken(userId, type));
      }

      throw new TRPCError({ code: "BAD_REQUEST", message: `Unsupported source URI: ${input.uri}` });
    }),

  /**
   * Feed a neural map's remote sources into its VectorDB collection so map RAG
   * over remote content becomes real. Verifies map ownership, honours the map's
   * `indexingEnabled` write-gate, then runs a DETACHED job (content fetch can be
   * slow) whose progress is polled via `getMapIndexStatus`. Returns immediately.
   * externalServiceProcedure: pulls from external (cloud) sources → Sovereign-gated.
   */
  indexMapSources: externalServiceProcedure
    .input(z.object({ mapId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });
      const userId = Number(ctx.user.id);

      const db = await getDb();
      const rows = await db.select().from(neuralMaps)
        .where(and(eq(neuralMaps.id, input.mapId), eq(neuralMaps.userId, ctx.user.id)))
        .limit(1);
      const map = rows[0];
      if (!map) throw new TRPCError({ code: "NOT_FOUND", message: "Map not found." });

      const settings = (map.settings ?? {}) as Record<string, unknown>;
      if (settings.indexingEnabled === false) {
        return { started: false, skipped: true, reason: "Indexing is disabled for this map.", status: indexJobs.get(input.mapId) ?? null };
      }

      const remoteRoots = (map.rootDirectories ?? []).filter(isRemoteRoot);
      if (remoteRoots.length === 0) {
        return { started: false, skipped: true, reason: "This map has no remote sources to index.", status: null };
      }

      const existing = indexJobs.get(input.mapId);
      if (existing?.state === "running") {
        return { started: false, alreadyRunning: true, status: existing };
      }

      const status: MapIndexStatus = {
        mapId: input.mapId,
        state: "running",
        startedAt: new Date().toISOString(),
        finishedAt: null,
        totalSources: remoteRoots.length,
        completedSources: 0,
        totalChunks: 0,
        sources: [],
        error: null,
      };
      indexJobs.set(input.mapId, status);

      // Detached — do not await; the client polls getMapIndexStatus.
      void runMapIndexJob(input.mapId, userId, remoteRoots).catch(err => {
        status.state = "error";
        status.error = err instanceof Error ? err.message : String(err);
        status.finishedAt = new Date().toISOString();
        log.warn("Map index job crashed", { mapId: input.mapId, error: status.error });
      });

      return { started: true, status };
    }),

  /** Poll the progress/result of a map's remote-source index run. Local read —
   *  protectedProcedure so it still works in Sovereign mode. */
  getMapIndexStatus: protectedProcedure
    .input(z.object({ mapId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });
      const db = await getDb();
      const rows = await db.select({ id: neuralMaps.id }).from(neuralMaps)
        .where(and(eq(neuralMaps.id, input.mapId), eq(neuralMaps.userId, ctx.user.id)))
        .limit(1);
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Map not found." });
      return indexJobs.get(input.mapId) ?? null;
    }),

  /** Persist per-integration settings (non-sensitive config). */
  updateSettings: externalServiceProcedure
    .input(z.object({
      type: z.enum(INTEGRATION_TYPES),
      settings: z.record(z.string(), z.unknown()),
    }))
    .mutation(({ input, ctx }) =>
      withLock(async () => {
        if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });
        const store = readStore();
        const bucket = getBucket(store, String(ctx.user.id));
        const entry = bucket[input.type];
        if (!entry) throw new TRPCError({ code: "NOT_FOUND", message: `${input.type} is not connected.` });
        bucket[input.type] = { ...entry, metadata: { ...entry.metadata, settings: input.settings } };
        writeStoreDirect(store);
        return { success: true };
      })
    ),
});
