export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  // Session lifetime in milliseconds. Defaults to one year for local-first /
  // sovereign desktop installs (long-lived convenience). Network deployments
  // should set a short value (e.g. 604800000 = 7 days). Invalid/non-positive
  // values fall back to the default (resolved in sdk.ts against ONE_YEAR_MS).
  sessionTtlMs: (() => {
    const raw = Number(process.env.SESSION_TTL_MS);
    return Number.isFinite(raw) && raw > 0 ? raw : undefined;
  })(),
  databaseUrl: process.env.DATABASE_URL ?? "",
  // Database backend selection. "auto" (default) uses MySQL when DATABASE_URL is
  // set, otherwise falls back to the local SQLite store (Sovereign / offline
  // mode). "mysql" / "sqlite" force a specific backend.
  dbMode: (["auto", "mysql", "sqlite"].includes(process.env.OMNECOR_DB ?? "")
    ? process.env.OMNECOR_DB
    : "auto") as "auto" | "mysql" | "sqlite",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  ollamaUrl: process.env.OLLAMA_URL ?? "http://localhost:11434",
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  xaiApiKey: process.env.XAI_API_KEY ?? "",
  n8nUrl: process.env.N8N_URL ?? "http://localhost:5678",
  notionClientId: process.env.NOTION_CLIENT_ID ?? "",
  notionClientSecret: process.env.NOTION_CLIENT_SECRET ?? "",
  slackClientId: process.env.SLACK_CLIENT_ID ?? "",
  slackClientSecret: process.env.SLACK_CLIENT_SECRET ?? "",
  lithicApiKey: process.env.LITHIC_API_KEY ?? "",
  virtualCardProvider: process.env.VIRTUAL_CARD_PROVIDER ?? "lithic",
  sovereignMode: process.env.SOVEREIGN_MODE === "true",
  zeroLoginMode: process.env.ZERO_LOGIN_MODE === "true",
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  microsoftClientId: process.env.MICROSOFT_CLIENT_ID ?? "",
  microsoftClientSecret: process.env.MICROSOFT_CLIENT_SECRET ?? "",
  ollamaProxyToken: process.env.OLLAMA_PROXY_TOKEN ?? "",
  elevenLabsApiKey: process.env.ELEVENLABS_API_KEY ?? "",
  huggingfaceApiKey: process.env.HUGGINGFACE_API_KEY ?? "",
  falaiApiKey: process.env.FAL_API_KEY ?? "",
  valetRouterUrl: process.env.VALET_ROUTER_URL ?? "http://127.0.0.1:8010",
  agenticOsApiKey: process.env.AGENTICOS_API_KEY ?? "",
  pcbwayApiKey: process.env.PCBWAY_API_KEY ?? "",
  pcbwayPartnerId: process.env.PCBWAY_PARTNER_ID ?? "",
  openArtApiKey: process.env.OPENART_API_KEY ?? "",
  updateCheckRepo: process.env.UPDATE_CHECK_REPO ?? "Omnecor/omnecor-hmci",
  honchoApiKey: process.env.HONCHO_API_KEY ?? "",
  honchoAppName: process.env.HONCHO_APP_NAME ?? "omnecor",
  honchoEnvironment: (process.env.HONCHO_ENVIRONMENT ?? "demo") as "demo" | "local" | "production",
  valetAutoStart: process.env.VALET_AUTO_START !== "false",
  // Allowlist of Host header values accepted when building OAuth redirect URIs.
  // Prevents open-redirect / host-header injection. Defaults cover local-first.
  oauthAllowedHosts: (
    process.env.OAUTH_ALLOWED_HOSTS ||
    "localhost:3000,127.0.0.1:3000,localhost:5173,127.0.0.1:5173"
  )
    .split(",")
    .map(h => h.trim().toLowerCase())
    .filter(Boolean),
};

// Startup validation — halt early on critical misconfigurations rather than
// silently using insecure defaults (e.g. empty JWT secret → session forgery).
if (process.env.NODE_ENV === "production") {
  if (process.env.ZERO_LOGIN_MODE === "true") {
    throw new Error(
      "FATAL: ZERO_LOGIN_MODE=true is not permitted in production. It bypasses all authentication and exposes the workstation as a local admin to anyone on the network. Remove it before deploying."
    );
  }
  if (!ENV.cookieSecret) {
    throw new Error(
      "FATAL: JWT_SECRET must be set in production. An empty secret allows session cookie forgery."
    );
  }
  // Only fail hard when MySQL is explicitly requested but unconfigured. In
  // "auto" or "sqlite" mode a missing DATABASE_URL is a supported, persistent
  // configuration: the app uses the local SQLite store (see db.factory.ts).
  if (ENV.dbMode === "mysql" && !ENV.databaseUrl) {
    throw new Error(
      "FATAL: OMNECOR_DB=mysql but DATABASE_URL is not set. Provide a MySQL connection string or use OMNECOR_DB=sqlite."
    );
  }
  if (!ENV.databaseUrl) {
    console.warn(
      "[Database] DATABASE_URL not set — using local SQLite store (Sovereign mode)."
    );
  }
}
