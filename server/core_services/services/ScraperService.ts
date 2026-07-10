import axios from "axios";
import * as cheerio from "cheerio";
import TurndownService from "turndown";
import { createLogger } from "../../_core/logger.js";

const log = createLogger("ScraperService");

export interface ScrapeResult {
  url: string;
  title: string;
  content: string;
  markdown?: string;
  success: boolean;
  error?: string;
}

// Tags that never carry readable content and would otherwise leak raw JS/CSS,
// SVG path data, or hidden template markup into the RAG context. Stripped before
// any text or markdown extraction.
const NON_CONTENT_SELECTOR =
  "script, style, noscript, template, svg, canvas, iframe, object, embed, link, meta, head";

// Page-chrome selectors removed only when a clear main-content region exists, so
// navigation/cookie-banners/footers don't pollute the extracted article.
const BOILERPLATE_SELECTOR =
  "nav, header, footer, aside, form, [role='navigation'], [role='banner'], [role='search'], [aria-hidden='true']";

/**
 * ScraperService
 *
 * Fetches a URL and extracts clean, model-ready text (and markdown) for the RAG
 * pipeline. HTML is parsed with cheerio (htmlparser2) rather than a regex, so
 * scripts/styles, HTML entities, and malformed markup are handled correctly and
 * the AI never receives raw JS/CSS blobs as "context".
 */
export class ScraperService {
  private static instance: ScraperService | null = null;
  private readonly turndown: TurndownService;

  private constructor() {
    this.turndown = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
      bulletListMarker: "-",
    });
    // Drop anything non-textual that survives into the content root. (svg/canvas
    // are already removed by cheerio before turndown runs; these are belt-and-
    // suspenders for the HTML→markdown pass.)
    this.turndown.remove(["script", "style", "noscript", "template", "iframe"]);
  }

  public static getInstance(): ScraperService {
    if (!ScraperService.instance) {
      ScraperService.instance = new ScraperService();
    }
    return ScraperService.instance;
  }

  /**
   * Scrape a single URL into clean text + markdown.
   */
  async scrape(url: string): Promise<ScrapeResult> {
    try {
      log.info(`Scraping URL: ${url}`);
      const response = await axios.get<string>(url, {
        headers: {
          "User-Agent": "Omnecor/1.0 (AI Workstation; +https://omnecor.ai)",
          Accept: "text/html,application/xhtml+xml",
        },
        timeout: 10000,
        responseType: "text",
        maxContentLength: 10 * 1024 * 1024, // 10 MB cap — don't buffer huge responses
      });

      const html = typeof response.data === "string" ? response.data : String(response.data ?? "");
      const $ = cheerio.load(html);

      const title = this.extractTitle($, url);

      // Strip non-content nodes everywhere before extracting anything.
      $(NON_CONTENT_SELECTOR).remove();

      // Prefer a semantic main-content region; fall back to <body>. When a real
      // article root exists, also drop surrounding page chrome for cleaner RAG.
      let root = $("main").first();
      if (root.length === 0) root = $("article").first();
      if (root.length > 0) {
        root.find(BOILERPLATE_SELECTOR).remove();
      } else {
        // cheerio.load() always wraps parsed markup in <html><body>, so <body>
        // is the reliable full-document root.
        root = $("body").first();
      }

      // Convert the pristine region to markdown first, so headings/lists/links/
      // code structure is preserved for retrieval. Fall back to plain text on any
      // conversion error rather than failing the whole scrape.
      let markdown: string | undefined;
      const rootHtml = root.html();
      try {
        markdown = rootHtml ? this.turndown.turndown(rootHtml).trim() : "";
      } catch (err) {
        log.warn(`Markdown conversion failed for ${url}; using plain text`, err);
        markdown = undefined;
      }

      // Then flatten to plain text. Separate block-level elements so adjacent
      // ones (list items, table cells) don't concatenate into one run ("onetwo").
      root.find("br").replaceWith(" ");
      root
        .find("p, div, li, tr, section, article, blockquote, h1, h2, h3, h4, h5, h6, pre, td, th")
        .append(" ");
      const content = this.normalizeWhitespace(root.text());
      if (markdown === undefined) markdown = content;

      return { url, title, content, markdown, success: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      log.error(`Failed to scrape ${url}: ${message}`);
      return { url, title: "", content: "", success: false, error: message };
    }
  }

  /** Resolve a human title: <title> → og:title → first <h1> → the URL. */
  private extractTitle($: cheerio.CheerioAPI, url: string): string {
    const candidates = [
      $("head > title").first().text(),
      $('meta[property="og:title"]').attr("content") ?? "",
      $('meta[name="twitter:title"]').attr("content") ?? "",
      $("h1").first().text(),
    ];
    for (const c of candidates) {
      const t = this.normalizeWhitespace(c);
      if (t) return t;
    }
    return url;
  }

  /** Collapse all runs of whitespace (incl. newlines/tabs) to single spaces. */
  private normalizeWhitespace(text: string): string {
    return text.replace(/\s+/g, " ").trim();
  }
}
