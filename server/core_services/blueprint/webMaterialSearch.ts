/**
 * Blueprint Studio — live web search for material prices / availability /
 * specialty items. Cloud-gated by the caller (sovereign users never reach
 * this). Uses DuckDuckGo's HTML endpoint — keyless, so it works for every
 * install without a search-API subscription (the Omnecor "no required
 * subscriptions" rule). Results are leads for the user to verify, never a
 * source of mechanical properties (those come from the built-in catalog).
 */
export interface WebMaterialResult {
  title: string;
  url: string;
  snippet: string;
}

const SEARCH_TIMEOUT_MS = 15_000;

export async function searchMaterialsWeb(query: string, limit = 8): Promise<WebMaterialResult[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  try {
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        Accept: "text/html",
      },
    });
    if (!res.ok) throw new Error(`Search request failed with HTTP ${res.status}`);
    const html = await res.text();
    return parseDuckDuckGoHtml(html, limit);
  } finally {
    clearTimeout(timer);
  }
}

/** Exported for tests. */
export function parseDuckDuckGoHtml(html: string, limit: number): WebMaterialResult[] {
  const results: WebMaterialResult[] = [];
  // Result anchors: <a rel="nofollow" class="result__a" href="...">Title</a>
  // Snippets:       <a class="result__snippet" ...>text</a>
  const linkRe = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetRe = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
  const links: { url: string; title: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) && links.length < limit * 2) {
    links.push({ url: decodeDdgUrl(m[1]), title: stripTags(m[2]) });
  }
  const snippets: string[] = [];
  while ((m = snippetRe.exec(html)) && snippets.length < limit * 2) {
    snippets.push(stripTags(m[1]));
  }
  for (let i = 0; i < links.length && results.length < limit; i++) {
    if (!links[i].url.startsWith("http")) continue;
    results.push({ title: links[i].title, url: links[i].url, snippet: snippets[i] ?? "" });
  }
  return results;
}

/** DDG wraps result URLs as //duckduckgo.com/l/?uddg=<encoded>&rut=… */
function decodeDdgUrl(href: string): string {
  const match = href.match(/uddg=([^&]+)/);
  if (match) {
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return href;
    }
  }
  return href;
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}
