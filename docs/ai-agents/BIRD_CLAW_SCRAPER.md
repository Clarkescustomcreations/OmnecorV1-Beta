# Bird Claw Scraper (Agent Reach)

**Bird Claw** (`BirdClawService.ts`) is Omnecor's specialized Playwright-based scraper designed to fetch and render JavaScript-heavy web pages and social media platforms that defy standard `fetch` or `axios` HTTP requests.

## Architecture

Instead of relying on basic web scraping libraries or API endpoints (which are often rate-limited or deprecated), Bird Claw utilizes `playwright-core` bundled with `puppeteer-extra-plugin-stealth`. 

### Key Features
1. **Stealth Operation**: Bypasses basic bot-mitigation techniques (like Cloudflare or DataDome) natively, providing clean DOM reads for heavy single-page applications.
2. **No Bundled Binaries**: Uses `playwright-core` directly targeting the host's existing browser installation, avoiding the massive binary bloat of standard Playwright distributions and bypassing deployment binary issues.
3. **Transparent Pipeline**: Integrated directly into the `ArticleDiscoveryService`. When an agent requests URL curation (e.g., via Valet), if the URL points to a JS-heavy target, Bird Claw intercepts the request, spins up a headless stealth browser, renders the JS, and returns the computed text to the downstream AI model.

## Usage
Bird Claw is fully autonomous. When agents request information from external links via the `ArticleDiscoveryService`, Bird Claw handles the complex rendering implicitly. No additional configuration is required by the end user other than ensuring a valid chromium executable exists on the host machine.
