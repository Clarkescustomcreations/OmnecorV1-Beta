export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
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
  valetRouterUrl: process.env.VALET_ROUTER_URL ?? "http://127.0.0.1:8010",
  agenticOsApiKey: process.env.AGENTICOS_API_KEY ?? "",
  pcbwayApiKey: process.env.PCBWAY_API_KEY ?? "",
  pcbwayPartnerId: process.env.PCBWAY_PARTNER_ID ?? "",
  openArtApiKey: process.env.OPENART_API_KEY ?? "",
  updateCheckRepo: process.env.UPDATE_CHECK_REPO ?? "Omnecor/omnecor-hmci",
};

// Startup validation — halt early on critical misconfigurations rather than
// silently using insecure defaults (e.g. empty JWT secret → session forgery).
if (process.env.NODE_ENV === "production") {
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
