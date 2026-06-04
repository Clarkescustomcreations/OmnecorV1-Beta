/**
 * Omnecor smoke driver — launches a headless Chromium against the running
 * production server and takes screenshots.
 *
 * Usage:
 *   node .claude/skills/run-omnecor/driver.mjs
 *
 * Env overrides:
 *   OMNECOR_URL   base URL (default: http://localhost:3000)
 *   SHOT_DIR      screenshot output dir (default: /tmp/omnecor-shots)
 */
import { execSync } from "child_process";
import fs, { existsSync } from "fs";
import path, { join } from "path";
import { tmpdir, homedir } from "os";

// Try to import playwright from npm package or common locations
let chromium;
try {
  const pw = await import("playwright-core");
  chromium = pw.chromium;
} catch {
  try {
    const pw = await import("playwright");
    chromium = pw.chromium;
  } catch {
    throw new Error("playwright or playwright-core not found. Run: npm install -g playwright");
  }
}

const BASE_URL = process.env.OMNECOR_URL ?? "http://localhost:3000";
const SHOT_DIR = process.env.SHOT_DIR ?? join(tmpdir(), "omnecor-shots");

// Cross-platform Playwright cache path detection
function findChromiumPlaywrightDir() {
  const candidates = process.platform === "win32"
    ? [join(process.env.LOCALAPPDATA || "", "ms-playwright")]
    : process.platform === "darwin"
    ? [join(homedir(), "Library", "Caches", "ms-playwright")]
    : [join(homedir(), ".cache", "ms-playwright")];

  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  return null;
}

// Resolve Chromium: prefer CHROMIUM env var, then search the Playwright cache,
// then fall back to any system chrome/chromium binary.
function findChromium() {
  if (process.env.CHROMIUM) return process.env.CHROMIUM;
  try {
    const playwrightDir = findChromiumPlaywrightDir();
    if (playwrightDir) {
      // Walk one level deep to find a chrome/chrome.exe binary
      const chromeName = process.platform === "win32" ? "chrome.exe" : "chrome";
      for (const entry of fs.readdirSync(playwrightDir)) {
        const candidate = join(playwrightDir, entry, "chrome-" + (process.platform === "win32" ? "win" : process.platform === "darwin" ? "mac" : "linux"), chromeName);
        if (existsSync(candidate)) return candidate;
        // Also try a flat path inside the versioned dir
        const flat = join(playwrightDir, entry, chromeName);
        if (existsSync(flat)) return flat;
      }
    }
  } catch { /* ignore */ }
  if (process.platform === "win32") {
    for (const bin of ["chrome.exe", "chromium.exe"]) {
      try { return execSync(`where ${bin}`, { encoding: "utf8" }).trim().split("\n")[0]; } catch { /* ignore */ }
    }
  } else {
    for (const bin of ["chromium-browser", "chromium", "google-chrome"]) {
      try { return execSync(`which ${bin}`, { encoding: "utf8" }).trim(); } catch { /* ignore */ }
    }
  }
  throw new Error("No Chromium binary found. Set CHROMIUM env var or install chromium.");
}
const CHROMIUM = findChromium();

fs.mkdirSync(SHOT_DIR, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROMIUM,
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  headless: true,
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const errors = [];
page.on("console", msg => { if (msg.type() === "error") errors.push(msg.text()); });

const shot = async (name) => {
  const p = path.join(SHOT_DIR, `${name}.png`);
  await page.screenshot({ path: p });
  console.log(`screenshot → ${p}`);
  return p;
};

// Home page
await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(3000);
await shot("01-home");

// Chat page
await page.goto(`${BASE_URL}/chat`, { waitUntil: "domcontentloaded", timeout: 20000 });
await page.waitForTimeout(3000);
await shot("02-chat");

// Model Hub
await page.goto(`${BASE_URL}/model-hub`, { waitUntil: "domcontentloaded", timeout: 20000 });
await page.waitForTimeout(2500);
await shot("03-model-hub");

if (errors.length) {
  // Filter expected WS errors (no external services in local dev)
  const real = errors.filter(e =>
    !e.includes("WebSocket") && !e.includes("401") && !e.includes("Please login")
  );
  if (real.length) console.warn("console errors:", real.slice(0, 5));
}

await browser.close();
console.log(`done — shots in ${SHOT_DIR}`);
