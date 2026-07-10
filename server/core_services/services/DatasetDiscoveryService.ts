import fs from "fs/promises";
import path from "path";
import axios from "axios";
import * as cheerio from "cheerio";
import { getDb } from "../../db.factory.js";
import { discoveredDatasetItems } from "../../../drizzle/schema.js";
import { validatePath } from "../../_core/security.js";
import { ScraperService } from "./ScraperService.js";
import { createLogger } from "../../_core/logger.js";

const log = createLogger("DatasetDiscovery");

async function getFilesRecursively(
  dir: string,
  allowedExtensions = [".ts", ".tsx", ".js", ".jsx", ".py", ".md", ".txt", ".json", ".html", ".css"]
): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const res = path.resolve(dir, entry.name);
      if (entry.name.startsWith(".") || /node_modules|\.git|dist|\.next|__pycache__/.test(res)) {
        continue;
      }
      if (entry.isDirectory()) {
        files.push(...(await getFilesRecursively(res, allowedExtensions)));
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        if (allowedExtensions.includes(ext)) {
          files.push(res);
        }
      }
    }
    return files;
  } catch (error) {
    log.error(`Failed to read directory ${dir}: ${(error as Error).message}`);
    return [];
  }
}

function segmentText(text: string, chunkSize = 2500): string[] {
  const chunks: string[] = [];
  let current = 0;
  while (current < text.length) {
    let next = current + chunkSize;
    if (next < text.length) {
      const searchWindow = text.slice(next - 400, next);
      const boundaryIndex = searchWindow.lastIndexOf("\n\n");
      if (boundaryIndex !== -1) {
        next = next - 400 + boundaryIndex + 2;
      } else {
        const spaceIndex = searchWindow.lastIndexOf(" ");
        if (spaceIndex !== -1) {
          next = next - 400 + spaceIndex + 1;
        }
      }
    }
    const chunk = text.slice(current, next).trim();
    if (chunk.length > 100) {
      chunks.push(chunk);
    }
    current = next;
  }
  return chunks;
}

export class DatasetDiscoveryService {
  private static instance: DatasetDiscoveryService | null = null;

  static getInstance(): DatasetDiscoveryService {
    if (!DatasetDiscoveryService.instance) {
      DatasetDiscoveryService.instance = new DatasetDiscoveryService();
    }
    return DatasetDiscoveryService.instance;
  }

  /**
   * Scan local directory and ingest text chunks.
   */
  async discoverLocal(projectId: string | null, dirPath: string, limit = 50): Promise<number> {
    const resolved = await validatePath(dirPath);
    log.info(`Discovering local dataset items in: ${resolved}`);

    const files = await getFilesRecursively(resolved);
    const db = await getDb();
    let totalAdded = 0;

    for (const file of files) {
      if (totalAdded >= limit) break;
      try {
        const text = await fs.readFile(file, "utf-8");
        const segments = segmentText(text);
        
        for (const segment of segments) {
          if (totalAdded >= limit) break;
          await db.insert(discoveredDatasetItems).values({
            projectId,
            sourceType: "local",
            sourceName: path.basename(file),
            content: segment,
            isProcessed: 0,
          });
          totalAdded++;
        }
      } catch (err) {
        log.warn(`Failed to process local file ${file}: ${(err as Error).message}`);
      }
    }

    return totalAdded;
  }

  /**
   * Perform a DuckDuckGo HTML search and scrape top page results.
   */
  async discoverOnline(projectId: string | null, query: string, limit = 5): Promise<number> {
    log.info(`Discovering online dataset items for query: "${query}"`);
    const db = await getDb();
    let totalAdded = 0;

    try {
      const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const response = await axios.get(searchUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
        },
        timeout: 15000,
      });

      const $ = cheerio.load(response.data);
      const urls: { title: string; url: string }[] = [];

      $(".result__title a").each((_, el) => {
        const title = $(el).text().trim();
        const rawUrl = $(el).attr("href");
        if (rawUrl) {
          let url = rawUrl;
          if (url.startsWith("//")) {
            url = "https:" + url;
          }
          if (url.includes("uddg=")) {
            try {
              const searchParams = new URL(url).searchParams;
              const uddg = searchParams.get("uddg");
              if (uddg) {
                url = uddg;
              }
            } catch {
              // Ignore malformed URL parsing
            }
          }
          if (url.startsWith("http")) {
            urls.push({ title, url });
          }
        }
      });

      const targetUrls = urls.slice(0, Math.min(limit, 10));
      log.info(`Found ${targetUrls.length} search candidate URLs to scrape`);

      const scraper = ScraperService.getInstance();

      for (const entry of targetUrls) {
        try {
          const result = await scraper.scrape(entry.url);
          if (result.success && result.content) {
            const segments = segmentText(result.content);
            for (const segment of segments) {
              await db.insert(discoveredDatasetItems).values({
                projectId,
                sourceType: "online_search",
                sourceName: `${entry.title} (${entry.url})`,
                content: segment,
                isProcessed: 0,
              });
              totalAdded++;
            }
          }
        } catch (err) {
          log.warn(`Failed to scrape search result ${entry.url}: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      log.error(`DuckDuckGo search failed: ${(err as Error).message}`);
    }

    return totalAdded;
  }
}
