/**
 * ArticleDiscoveryService — real RSS/Atom feed ingestion.
 *
 * Replaces the previous shell where `discovery.fetchArticles` only re-read
 * existing rows. This actually fetches configured feeds, parses them with
 * rss-parser, de-duplicates by URL hash, and inserts new articles into
 * `discoveredArticles` so the curation pipeline has real input.
 *
 * Feed sources come from Settings (`discoveryFeeds: string[]`) or are passed
 * in directly; a small set of general tech/news feeds is used as a default so
 * the feature works out of the box.
 */
import crypto from "crypto";
import Parser from "rss-parser";
import { getDb } from "../../db.factory.js";
import { discoveredArticles } from "../../../drizzle/schema.js";
import { inArray } from "drizzle-orm";
import { getSetting } from "./SettingsService.js";
import { createLogger } from "../../_core/logger.js";

const log = createLogger("ArticleDiscovery");

// Sensible defaults so discovery returns results before the user configures
// their own feeds in Settings.
const DEFAULT_FEEDS = [
  "https://hnrss.org/frontpage",
  "https://www.theverge.com/rss/index.xml",
  "https://feeds.arstechnica.com/arstechnica/index",
  "https://techcrunch.com/feed/",
];

export interface DiscoveredArticleInput {
  title: string;
  url: string;
  urlHash: string;
  source: string;
  content: string | null;
  summary: string | null;
  publishedAt: Date | null;
}

export class ArticleDiscoveryService {
  private static instance: ArticleDiscoveryService | null = null;
  private parser = new Parser({ timeout: 15_000 });

  static getInstance(): ArticleDiscoveryService {
    if (!ArticleDiscoveryService.instance) ArticleDiscoveryService.instance = new ArticleDiscoveryService();
    return ArticleDiscoveryService.instance;
  }

  private hash(url: string): string {
    return crypto.createHash("sha256").update(url).digest("hex");
  }

  /** Resolve the feed list: explicit arg → Settings → built-in defaults. */
  private resolveFeeds(source?: string): string[] {
    if (source && /^https?:\/\//i.test(source)) return [source];
    const configured = getSetting<string[]>("discoveryFeeds", []);
    if (Array.isArray(configured) && configured.length > 0) return configured;
    return DEFAULT_FEEDS;
  }

  /** Fetch & parse one feed into normalized article inputs. */
  private async fetchFeed(feedUrl: string): Promise<DiscoveredArticleInput[]> {
    const feed = await this.parser.parseURL(feedUrl);
    const sourceName = feed.title?.slice(0, 100) || new URL(feedUrl).hostname;
    const items = feed.items ?? [];
    const out: DiscoveredArticleInput[] = [];
    for (const item of items) {
      const url = item.link?.trim();
      if (!url) continue;
      const content = item["content:encoded"] || item.content || null;
      out.push({
        title: (item.title || "Untitled").slice(0, 500),
        url: url.slice(0, 2048),
        urlHash: this.hash(url),
        source: sourceName,
        content: content ? String(content) : null,
        summary: item.contentSnippet ? String(item.contentSnippet).slice(0, 2000) : null,
        publishedAt: item.isoDate ? new Date(item.isoDate) : null,
      });
    }
    return out;
  }

  /**
   * Fetch all resolved feeds and insert new (unseen) articles.
   * Returns the rows that were actually added.
   */
  async discover(source?: string, limit = 50): Promise<DiscoveredArticleInput[]> {
    const db = await getDb();
    if (!db) {
      log.warn("Discovery skipped — database unavailable");
      return [];
    }

    const feeds = this.resolveFeeds(source);
    const parsed: DiscoveredArticleInput[] = [];
    for (const feedUrl of feeds) {
      try {
        parsed.push(...(await this.fetchFeed(feedUrl)));
      } catch (err) {
        log.warn(`Failed to fetch feed ${feedUrl}`, err instanceof Error ? err.message : err);
      }
    }

    if (parsed.length === 0) return [];

    // De-duplicate within this batch by hash, then against existing rows.
    const byHash = new Map<string, DiscoveredArticleInput>();
    for (const a of parsed) byHash.set(a.urlHash, a);
    const candidates = Array.from(byHash.values()).slice(0, Math.max(limit, 1) * 4);

    const existing = await db
      .select({ urlHash: discoveredArticles.urlHash })
      .from(discoveredArticles)
      .where(inArray(discoveredArticles.urlHash, candidates.map((c) => c.urlHash)));
    const seen = new Set(existing.map((e) => e.urlHash));

    const fresh = candidates.filter((c) => !seen.has(c.urlHash)).slice(0, limit);
    if (fresh.length === 0) return [];

    await db.insert(discoveredArticles).values(
      fresh.map((a) => ({
        title: a.title,
        url: a.url,
        urlHash: a.urlHash,
        source: a.source,
        content: a.content,
        summary: a.summary,
        publishedAt: a.publishedAt,
        isProcessed: 0,
      })),
    );

    log.info(`Discovered ${fresh.length} new article(s) from ${feeds.length} feed(s)`);
    return fresh;
  }
}
