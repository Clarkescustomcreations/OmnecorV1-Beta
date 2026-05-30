import axios from "axios";
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

/**
 * ScraperService
 * Provides web scraping capabilities for RAG and information retrieval.
 * Simplified implementation based on reference crawler.
 */
export class ScraperService {
  private static instance: ScraperService | null = null;

  private constructor() {}

  public static getInstance(): ScraperService {
    if (!ScraperService.instance) {
      ScraperService.instance = new ScraperService();
    }
    return ScraperService.instance;
  }

  /**
   * Scrape a single URL
   */
  async scrape(url: string): Promise<ScrapeResult> {
    try {
      log.info(`Scraping URL: ${url}`);
      const response = await axios.get(url, {
        headers: {
          "User-Agent": "Omnecor/1.0 (AI Workstation; +https://omnecor.ai)",
        },
        timeout: 10000,
      });

      const html = response.data;
      const titleMatch = html.match(/<title>(.*?)<\/title>/i);
      const title = titleMatch ? titleMatch[1] : url;

      // Basic text extraction (placeholder for a real parser like cheerio)
      const content = html.replace(/<[^>]*>?/gm, " ").replace(/\s+/g, " ").trim();

      return {
        url,
        title,
        content,
        success: true,
      };
    } catch (error: any) {
      log.error(`Failed to scrape ${url}: ${error.message}`);
      return {
        url,
        title: "",
        content: "",
        success: false,
        error: error.message,
      };
    }
  }
}
