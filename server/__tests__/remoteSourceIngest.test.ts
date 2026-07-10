import { describe, it, expect } from "vitest";
import { sanitizeCollectionName } from "../core_services/services/VectorDBService.js";
import {
  hasTextExtension,
  htmlToText,
  extractGmailBody,
  extractNotionText,
  mapWithConcurrency,
  encodeGithubPath,
} from "../routers/integrationsRouter.js";

// ── The collection-naming seam ───────────────────────────────────────────────
// The whole point of the shared helper: every writer (local watcher, remote
// indexer) and the reader (MemoryArchitect) must derive the SAME name, or RAG
// reads an empty collection.
describe("sanitizeCollectionName", () => {
  it("is deterministic for a given id", () => {
    const id = "550e8400-e29b-41d4-a716-446655440000";
    expect(sanitizeCollectionName(id)).toBe(sanitizeCollectionName(id));
  });

  it("maps a hyphenated UUID to a single canonical underscored name", () => {
    expect(sanitizeCollectionName("550e8400-e29b-41d4-a716-446655440000")).toBe(
      "omnecor_550e8400_e29b_41d4_a716_446655440000",
    );
  });

  it("lower-cases and collapses runs of non-alphanumerics", () => {
    expect(sanitizeCollectionName("My Project--Name!!")).toBe("omnecor_my_project_name_");
  });

  it("keeps the omnecor_ prefix within Chroma's 63-char ceiling", () => {
    const long = "x".repeat(200);
    expect(sanitizeCollectionName(long).length).toBeLessThanOrEqual(63);
    expect(sanitizeCollectionName(long).startsWith("omnecor_")).toBe(true);
  });
});

describe("hasTextExtension", () => {
  it("accepts code/text files", () => {
    for (const f of ["src/index.ts", "a.md", "data.csv", "x.PY", "notes.txt", "config.yaml"]) {
      expect(hasTextExtension(f)).toBe(true);
    }
  });

  it("rejects binaries", () => {
    for (const f of ["logo.png", "clip.mp4", "archive.zip", "font.woff2", "photo.JPG"]) {
      expect(hasTextExtension(f)).toBe(false);
    }
  });

  it("accepts well-known extensionless text files", () => {
    expect(hasTextExtension("Dockerfile")).toBe(true);
    expect(hasTextExtension("README")).toBe(true);
    expect(hasTextExtension("LICENSE")).toBe(true);
    expect(hasTextExtension("randombinary")).toBe(false);
  });
});

describe("htmlToText", () => {
  it("strips tags and decodes common entities", () => {
    expect(htmlToText("<p>Hi&nbsp;<b>there</b> &amp; welcome</p>")).toBe("Hi there & welcome");
  });

  it("drops script/style content entirely", () => {
    const out = htmlToText("<style>.x{color:red}</style><p>Body</p><script>alert(1)</script>");
    expect(out).toBe("Body");
    expect(out).not.toContain("alert");
  });
});

describe("extractGmailBody", () => {
  const b64url = (s: string) => Buffer.from(s, "utf-8").toString("base64url");

  it("decodes a direct text/plain body", () => {
    expect(extractGmailBody({ mimeType: "text/plain", body: { data: b64url("Hello World") } })).toBe("Hello World");
  });

  it("recurses into multipart and prefers text/plain", () => {
    const payload = {
      mimeType: "multipart/alternative",
      parts: [
        { mimeType: "text/plain", body: { data: b64url("plain wins") } },
        { mimeType: "text/html", body: { data: b64url("<p>html loses</p>") } },
      ],
    };
    expect(extractGmailBody(payload)).toBe("plain wins");
  });

  it("converts an html-only body to text", () => {
    expect(extractGmailBody({ mimeType: "text/html", body: { data: b64url("<p>Hi <b>there</b></p>") } })).toBe("Hi there");
  });

  it("returns empty string when nothing is decodable", () => {
    expect(extractGmailBody({ mimeType: "image/png", body: {} })).toBe("");
  });
});

describe("extractNotionText", () => {
  it("flattens rich_text across block types, skipping empties", () => {
    const blocks = [
      { type: "heading_1", heading_1: { rich_text: [{ plain_text: "Title" }] } },
      { type: "paragraph", paragraph: { rich_text: [{ plain_text: "Line one" }] } },
      { type: "divider", divider: {} },
      { type: "paragraph", paragraph: { rich_text: [] } },
      { type: "bulleted_list_item", bulleted_list_item: { rich_text: [{ plain_text: "point" }] } },
    ];
    expect(extractNotionText(blocks)).toBe("Title\nLine one\npoint");
  });
});

describe("encodeGithubPath", () => {
  it("encodes each segment but preserves slashes", () => {
    expect(encodeGithubPath("src/some dir/a+b.ts")).toBe("src/some%20dir/a%2Bb.ts");
  });
});

describe("mapWithConcurrency", () => {
  it("preserves input order in results", async () => {
    const out = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
      await new Promise(r => setTimeout(r, (6 - n) * 3)); // later items resolve sooner
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50]);
  });

  it("never exceeds the concurrency limit", async () => {
    let active = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise(r => setTimeout(r, 5));
      active--;
      return 0;
    });
    expect(peak).toBeLessThanOrEqual(4);
  });

  it("runs every item exactly once", async () => {
    const seen = new Set<number>();
    await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async (n) => { seen.add(n); return n; });
    expect(seen.size).toBe(7);
  });
});
