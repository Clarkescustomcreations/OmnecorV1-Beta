import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import { createLogger } from "../../_core/logger.js";
import crypto from "crypto";

// @ts-ignore - Stealth plugin type compatibility
chromium.use(stealth());

const log = createLogger("BirdClawService");

export interface DiscoveredArticleInput {
  title: string;
  url: string;
  urlHash: string;
  source: string;
  content: string | null;
  summary: string | null;
  publishedAt: Date | null;
}

export class BirdClawService {
  private static instance: BirdClawService | null = null;
  // Limit concurrent contexts
  private activeScrapes = 0;
  private readonly MAX_CONCURRENT = 3;

  static getInstance(): BirdClawService {
    if (!BirdClawService.instance) {
      BirdClawService.instance = new BirdClawService();
    }
    return BirdClawService.instance;
  }

  private hash(url: string): string {
    return crypto.createHash("sha256").update(url).digest("hex");
  }

  /**
   * Identifies if a URL should be handled by BirdClaw (social/JS-heavy platforms)
   */
  static isSocialUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      const socialDomains = ["x.com", "twitter.com", "linkedin.com", "reddit.com", "bsky.app"];
      return socialDomains.some(domain => parsed.hostname.endsWith(domain));
    } catch {
      return false;
    }
  }

  /**
   * Scrapes a social profile or feed URL using Playwright stealth
   */
  async scrapeFeed(url: string): Promise<DiscoveredArticleInput[]> {
    if (this.activeScrapes >= this.MAX_CONCURRENT) {
      log.warn(`Max concurrent scrapes reached, skipping ${url}`);
      return [];
    }
    
    this.activeScrapes++;
    const out: DiscoveredArticleInput[] = [];
    
    try {
      log.info(`Launching Playwright to scrape: ${url}`);
      const browser = await chromium.launch({
        headless: true,
        // Useful arguments for stealth and stability
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-blink-features=AutomationControlled",
        ]
      });

      const context = await browser.newContext({
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        viewport: { width: 1280, height: 720 },
      });

      const page = await context.newPage();
      
      // Generic timeout for network stability
      page.setDefaultTimeout(30000);

      // Navigate to the target URL
      await page.goto(url, { waitUntil: "domcontentloaded" });
      
      // Allow JS to execute and render the dynamic content
      await page.waitForTimeout(5000); // Simple wait for SPA rendering

      const parsedUrl = new URL(url);
      const sourceName = `Scraped: ${parsedUrl.hostname}`;

      // This is a generalized scraping approach. We extract basic text nodes
      // and prominent links from standard article/post containers.
      // Platforms like X and LinkedIn use <article> or specific dive structures.
      const elements = await page.$$("article, .post, [data-testid='tweet']");
      
      if (elements.length > 0) {
        for (const el of elements.slice(0, 15)) {
          const text = await el.innerText();
          if (!text || text.length < 10) continue;
          
          // Try to find a link to the specific post
          let postUrl = url;
          const links = await el.$$eval("a", anchors => anchors.map(a => a.href));
          // Filter for likely status/post links
          const statusLink = links.find(l => l.includes("/status/") || l.includes("/post/"));
          if (statusLink) postUrl = statusLink;
          
          const cleanText = text.trim();
          out.push({
            title: cleanText.slice(0, 80).split("\n")[0] + "...",
            url: postUrl,
            urlHash: this.hash(postUrl),
            source: sourceName,
            content: cleanText,
            summary: cleanText.slice(0, 200),
            publishedAt: new Date(),
          });
        }
      } else {
        // Fallback for non-standard structural sites (e.g., just grabbing the body text chunks)
        const title = await page.title();
        const bodyText = await page.innerText("body");
        out.push({
          title: title.slice(0, 200),
          url: url,
          urlHash: this.hash(url),
          source: sourceName,
          content: bodyText,
          summary: bodyText.slice(0, 200),
          publishedAt: new Date(),
        });
      }

      await browser.close();
      log.info(`Scraped ${out.length} items from ${url}`);
      return out;
    } catch (err) {
      log.error(`BirdClaw failed to scrape ${url}`, err);
      return [];
    } finally {
      this.activeScrapes--;
    }
  }
}
