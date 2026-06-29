import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import * as db from "../db.factory";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";
import { ENV } from "./env.js";
import crypto from "crypto";
import { exchangeCodeForToken, fetchUserProfile } from "../oauth/oauthClients.js";
import { getDb } from "../db.factory.js";
import { platformAccounts, oauthStates } from "../../drizzle/schema.js";
import { eq, lt } from "drizzle-orm";
import { SettingsService, getSetting } from "../phase2/services/SettingsService.js";

export const OAUTH_STATE_TTL = 10 * 60 * 1000; // 10 minutes

// Double-submit CSRF cookie for the generic social/cloud OAuth flow
// (`/api/oauth/callback/:platform`). The unguessable `state` is mirrored into an
// httpOnly cookie at initiation and re-checked at the callback so the redirect
// can only be completed by the same browser that started the flow.
export const SOCIAL_OAUTH_STATE_COOKIE = "social_oauth_state";

/**
 * Set the social-OAuth CSRF state cookie. Uses `sameSite: "lax"` (overriding the
 * session cookie's "strict") so the cookie is still sent on the top-level GET
 * navigation when the external provider redirects back to our callback — a
 * "strict" cookie would be withheld on that cross-site redirect and the flow
 * would always fail the CSRF check.
 */
export function setSocialOAuthStateCookie(req: Request, res: Response, state: string): void {
  res.cookie(SOCIAL_OAUTH_STATE_COOKIE, state, {
    ...getSessionCookieOptions(req),
    httpOnly: true,
    sameSite: "lax",
    maxAge: OAUTH_STATE_TTL,
  });
}

// Resolved session lifetime, used for both the JWT expiry and the cookie
// maxAge. Precedence: Settings → Security `sessionTimeout` (minutes) when set,
// then the sessionTtlMs() env var, else one year (local-first default).
// Computed per call so changing the slider takes effect on the next login.
function sessionTtlMs(): number {
  const minutes = getSetting<number>("sessionTimeout", 0);
  if (minutes && minutes > 0) return minutes * 60 * 1000;
  return ENV.sessionTtlMs ?? ONE_YEAR_MS;
}

// Treat a token as expired this many ms before its real expiry so an in-flight
// request never races the expiry boundary.
const TOKEN_EXPIRY_SKEW_MS = 60 * 1000;

/**
 * Returns true if a token whose expiry is `expiresAt` should be considered
 * expired (or expiring within the skew window) right now. A null/undefined
 * expiry is treated as "not known to be expired" (caller decides).
 */
export function isTokenExpired(expiresAt: Date | number | null | undefined): boolean {
  if (expiresAt == null) return false;
  const ms = typeof expiresAt === "number" ? expiresAt : expiresAt.getTime();
  return Number.isFinite(ms) && ms - TOKEN_EXPIRY_SKEW_MS <= Date.now();
}

/**
 * Perform an OAuth-authenticated request with automatic single-retry refresh.
 *
 * 1. If `expiresAt` indicates the token is expired, refresh BEFORE the call.
 * 2. Make the request with the (possibly refreshed) Bearer token.
 * 3. If the response is 401, refresh once and retry exactly one more time.
 *
 * `refresh` must return a fresh access token (or null when refresh is
 * impossible — e.g. no refresh token), in which case the original 401 is
 * returned to the caller. This bounds retries to a single attempt and ensures
 * a silently-expired token surfaces as a refreshed success or a real error,
 * never as a hung/silently-failing request.
 */
export async function fetchWithOAuthRetry(
  url: string,
  accessToken: string,
  refresh: () => Promise<string | null>,
  options: { expiresAt?: Date | number | null; init?: RequestInit; timeoutMs?: number } = {}
): Promise<globalThis.Response> {
  const { expiresAt, init = {}, timeoutMs = 30_000 } = options;

  let token = accessToken;
  if (isTokenExpired(expiresAt)) {
    const refreshed = await refresh().catch(() => null);
    if (refreshed) token = refreshed;
  }

  const doFetch = async (bearer: string): Promise<globalThis.Response> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: { ...(init.headers ?? {}), Authorization: `Bearer ${bearer}` },
      });
    } finally {
      clearTimeout(timer);
    }
  };

  let res = await doFetch(token);
  if (res.status === 401) {
    const refreshed = await refresh().catch(() => null);
    if (refreshed) {
      res = await doFetch(refreshed);
    }
  }
  return res;
}

export interface OAuthStateData {
  platform: string;
  userId: number;
  codeVerifier?: string;
  /** Creation time (ms). Reconstructed from expiresAt when read from the DB. */
  timestamp: number;
}

// In-memory fallback used when no SQL database is available (sqlite mode, or a
// MySQL deployment that hasn't run the oauthStates migration yet). When a DB is
// present, state lives there so the flow survives restarts and works across
// multiple instances behind a load balancer.
const memoryStore = new Map<string, OAuthStateData>();

let _warnedFallback = false;
function warnFallback(reason: unknown) {
  if (_warnedFallback) return;
  _warnedFallback = true;
  console.warn(
    "[OAuth] state store falling back to in-memory — run the oauthStates migration for multi-instance support:",
    reason instanceof Error ? reason.message : reason
  );
}

/** Persist a new OAuth state (CSRF nonce + optional PKCE verifier). */
export async function saveOAuthState(
  state: string,
  data: Omit<OAuthStateData, "timestamp">
): Promise<void> {
  // getDb() always returns a live instance; the try/catch falls back to the
  // in-memory store on any DB error.
  const db = await getDb();
  try {
    await db.insert(oauthStates).values({
      state,
      platform: data.platform,
      userId: data.userId,
      codeVerifier: data.codeVerifier ?? null,
      expiresAt: new Date(Date.now() + OAUTH_STATE_TTL),
    });
    // Opportunistic sweep of expired rows.
    await db.delete(oauthStates).where(lt(oauthStates.expiresAt, new Date()));
    return;
  } catch (error) {
    warnFallback(error);
  }
  memoryStore.set(state, { ...data, timestamp: Date.now() });
  for (const [key, value] of memoryStore.entries()) {
    if (Date.now() - value.timestamp > OAUTH_STATE_TTL) memoryStore.delete(key);
  }
}

/** Fetch a non-expired OAuth state, or undefined. Expired rows are pruned. */
export async function getOAuthState(state: string): Promise<OAuthStateData | undefined> {
  const db = await getDb();
  try {
    const rows = await db
      .select()
      .from(oauthStates)
      .where(eq(oauthStates.state, state))
      .limit(1);
    const row = rows[0];
    if (!row) return undefined;
    if (row.expiresAt.getTime() < Date.now()) {
      await db.delete(oauthStates).where(eq(oauthStates.state, state));
      return undefined;
    }
    return {
      platform: row.platform,
      userId: row.userId,
      codeVerifier: row.codeVerifier ?? undefined,
      timestamp: row.expiresAt.getTime() - OAUTH_STATE_TTL,
    };
  } catch (error) {
    warnFallback(error);
  }
  const data = memoryStore.get(state);
  if (!data) return undefined;
  if (Date.now() - data.timestamp > OAUTH_STATE_TTL) {
    memoryStore.delete(state);
    return undefined;
  }
  return data;
}

/** Delete an OAuth state (single-use consumption). */
export async function deleteOAuthState(state: string): Promise<void> {
  const db = await getDb();
  try {
    await db.delete(oauthStates).where(eq(oauthStates.state, state));
    return;
  } catch (error) {
    warnFallback(error);
  }
  memoryStore.delete(state);
}

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * Returns a Host header value that is safe to use when constructing OAuth
 * redirect URIs. The raw `req.get("host")` is attacker-controlled and must be
 * validated against an allowlist to prevent open-redirect / host-header
 * injection. Falls back to the first configured allowed host.
 */
function getValidatedHost(req: Request): string {
  const host = (req.get("host") ?? "").toLowerCase();
  if (host && ENV.oauthAllowedHosts.includes(host)) {
    return host;
  }
  return ENV.oauthAllowedHosts[0] ?? "localhost:3000";
}

export function registerOAuthRoutes(app: Express) {
  // Login route initiates the flow, generating the state and setting the cookie
  app.get("/api/oauth/login", (req: Request, res: Response) => {
    const state = crypto.randomBytes(32).toString("hex");
    const cookieOptions = getSessionCookieOptions(req);

    // Set state in a secure, HTTP-only cookie
    res.cookie("oauth_state", state, {
      ...cookieOptions,
      maxAge: 10 * 60 * 1000, // 10 minutes
      httpOnly: true,
      secure: true,
    });

    // Redirect to OAuth provider with state
    const redirectUri = `${req.protocol}://${getValidatedHost(req)}/api/oauth/callback`;
    const oauthUrl = new URL(`${ENV.oAuthServerUrl}/app-auth`);
    oauthUrl.searchParams.set("appId", ENV.appId);
    oauthUrl.searchParams.set("redirectUri", redirectUri);
    oauthUrl.searchParams.set("state", state);
    oauthUrl.searchParams.set("type", "signIn");

    res.redirect(302, oauthUrl.toString());
  });

  app.get("/api/oauth/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");
    const storedState = req.cookies?.oauth_state;

    // Validate state (CSRF protection)
    if (!code || !state || !storedState || state !== storedState) {
      res.status(400).json({ error: "Invalid state or code" });
      return;
    }

    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);

      if (!userInfo.openId) {
        res.status(400).json({ error: "openId missing from user info" });
        return;
      }

      await db.upsertUser({
        openId: userInfo.openId,
        name: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
        lastSignedIn: new Date(),
      });

      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
        expiresInMs: sessionTtlMs(),
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, {
        ...cookieOptions,
        maxAge: sessionTtlMs(),
      });

      // Clear state cookie
      res.clearCookie("oauth_state", cookieOptions);

      res.redirect(302, "/setup");
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });
}

// Resolve the Google OAuth endpoints. When GOOGLE_EMULATOR_URL is set (the
// `google` skill's local emulator) the auth/token/userinfo endpoints point at
// it; otherwise the real Google URLs are used. Emulator paths match the skill's
// documented URL mapping (/o/oauth2/v2/auth, /oauth2/token, /oauth2/v2/userinfo).
function googleEndpoints() {
  const base = ENV.googleEmulatorUrl;
  if (base) {
    return {
      auth: `${base}/o/oauth2/v2/auth`,
      token: `${base}/oauth2/token`,
      userinfo: `${base}/oauth2/v2/userinfo`,
    };
  }
  return {
    auth: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    userinfo: "https://www.googleapis.com/oauth2/v3/userinfo",
  };
}

// Resolve the Microsoft Entra ID endpoints. When MICROSOFT_EMULATOR_URL is set
// (the `microsoft` skill's local emulator) the authorize/token/Graph-me
// endpoints point at it; otherwise the real Microsoft URLs are used.
function microsoftEndpoints() {
  const base = ENV.microsoftEmulatorUrl;
  if (base) {
    return {
      auth: `${base}/oauth2/v2.0/authorize`,
      token: `${base}/oauth2/v2.0/token`,
      me: `${base}/v1.0/me`,
    };
  }
  return {
    // Real Microsoft v2.0 endpoints: the path is /common/oauth2/v2.0/<verb>
    // (NOT /common/v2.0/oauth2/<verb>, which 404s — the segments were swapped).
    auth: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    token: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    me: "https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName",
  };
}

export function registerGoogleOAuthRoutes(app: Express) {
  const pendingVerifiers = new Map<string, string>(); // state → code_verifier

  app.get("/api/oauth/google/login", (req: Request, res: Response) => {
    const clientId = SettingsService.getInstance().getSecret("googleClientId", ENV.googleClientId);
    if (!clientId) {
      res.status(404).json({ error: "Google OAuth not configured" });
      return;
    }
    const state = crypto.randomBytes(32).toString("hex");
    const codeVerifier = crypto.randomBytes(32).toString("base64url");
    const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
    pendingVerifiers.set(state, codeVerifier);
    setTimeout(() => pendingVerifiers.delete(state), 10 * 60 * 1000); // 10min TTL

    const cookieOptions = getSessionCookieOptions(req);
    res.cookie("google_oauth_state", state, { ...cookieOptions, maxAge: 10 * 60 * 1000, httpOnly: true });

    const redirectUri = `${req.protocol}://${getValidatedHost(req)}/api/oauth/google/callback`;
    const url = new URL(googleEndpoints().auth);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    res.redirect(302, url.toString());
  });

  app.get("/api/oauth/google/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");
    const storedState = req.cookies?.google_oauth_state;
    const codeVerifier = state ? pendingVerifiers.get(state) : undefined;

    if (!code || !state || !storedState || state !== storedState || !codeVerifier) {
      res.status(400).json({ error: "Invalid OAuth state" });
      return;
    }
    pendingVerifiers.delete(state);

    const clientId = SettingsService.getInstance().getSecret("googleClientId", ENV.googleClientId);
    const clientSecret = SettingsService.getInstance().getSecret("googleClientSecret", ENV.googleClientSecret);

    try {
      const redirectUri = `${req.protocol}://${getValidatedHost(req)}/api/oauth/google/callback`;
      const tokenRes = await fetch(googleEndpoints().token, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
          code_verifier: codeVerifier,
        }),
      });
      const tokenData = await tokenRes.json() as { access_token?: string; id_token?: string };
      if (!tokenData.access_token) throw new Error("No access token from Google");

      const userRes = await fetch(googleEndpoints().userinfo, {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      const userInfo = await userRes.json() as { sub?: string; name?: string; email?: string };
      if (!userInfo.sub) throw new Error("No sub from Google userinfo");

      const openId = `google:${userInfo.sub}`;
      await db.upsertUser({
        openId,
        name: userInfo.name ?? null,
        email: userInfo.email ?? null,
        loginMethod: "google",
        lastSignedIn: new Date(),
      });

      const sessionToken = await sdk.createSessionToken(openId, {
        name: userInfo.name ?? "",
        expiresInMs: sessionTtlMs(),
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: sessionTtlMs() });
      res.clearCookie("google_oauth_state", cookieOptions);
      res.redirect(302, "/setup");
    } catch (error) {
      console.error("[OAuth/Google] Callback failed", error);
      res.status(500).json({ error: "Google OAuth callback failed" });
    }
  });
}

export function registerMicrosoftOAuthRoutes(app: Express) {
  const pendingVerifiers = new Map<string, string>();

  app.get("/api/oauth/microsoft/login", (req: Request, res: Response) => {
    const clientId = SettingsService.getInstance().getSecret("microsoftClientId", ENV.microsoftClientId);
    if (!clientId) {
      res.status(404).json({ error: "Microsoft OAuth not configured" });
      return;
    }
    const state = crypto.randomBytes(32).toString("hex");
    const codeVerifier = crypto.randomBytes(32).toString("base64url");
    const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
    pendingVerifiers.set(state, codeVerifier);
    setTimeout(() => pendingVerifiers.delete(state), 10 * 60 * 1000);

    const cookieOptions = getSessionCookieOptions(req);
    res.cookie("ms_oauth_state", state, { ...cookieOptions, maxAge: 10 * 60 * 1000, httpOnly: true });

    const redirectUri = `${req.protocol}://${getValidatedHost(req)}/api/oauth/microsoft/callback`;
    const url = new URL(microsoftEndpoints().auth);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    res.redirect(302, url.toString());
  });

  app.get("/api/oauth/microsoft/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");
    const storedState = req.cookies?.ms_oauth_state;
    const codeVerifier = state ? pendingVerifiers.get(state) : undefined;

    if (!code || !state || !storedState || state !== storedState || !codeVerifier) {
      res.status(400).json({ error: "Invalid OAuth state" });
      return;
    }
    pendingVerifiers.delete(state);

    const clientId = SettingsService.getInstance().getSecret("microsoftClientId", ENV.microsoftClientId);
    const clientSecret = SettingsService.getInstance().getSecret("microsoftClientSecret", ENV.microsoftClientSecret);

    try {
      const redirectUri = `${req.protocol}://${getValidatedHost(req)}/api/oauth/microsoft/callback`;
      const tokenRes = await fetch(microsoftEndpoints().token, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
          code_verifier: codeVerifier,
        }),
      });
      const tokenData = await tokenRes.json() as { access_token?: string };
      if (!tokenData.access_token) throw new Error("No access token from Microsoft");

      const userRes = await fetch(microsoftEndpoints().me, {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      const userInfo = await userRes.json() as { id?: string; displayName?: string; mail?: string; userPrincipalName?: string };
      if (!userInfo.id) throw new Error("No id from Microsoft Graph");

      const openId = `microsoft:${userInfo.id}`;
      await db.upsertUser({
        openId,
        name: userInfo.displayName ?? null,
        email: userInfo.mail ?? userInfo.userPrincipalName ?? null,
        loginMethod: "microsoft",
        lastSignedIn: new Date(),
      });

      const sessionToken = await sdk.createSessionToken(openId, {
        name: userInfo.displayName ?? "",
        expiresInMs: sessionTtlMs(),
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: sessionTtlMs() });
      res.clearCookie("ms_oauth_state", cookieOptions);
      res.redirect(302, "/setup");
    } catch (error) {
      console.error("[OAuth/Microsoft] Callback failed", error);
      res.status(500).json({ error: "Microsoft OAuth callback failed" });
    }
  });
}

export function registerSocialMediaOAuthRoutes(app: Express) {
  app.get("/api/oauth/callback/:platform", async (req: Request, res: Response) => {
    const { platform } = req.params;
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");
    const cookieState = req.cookies?.[SOCIAL_OAUTH_STATE_COOKIE];
    const cookieOptions = getSessionCookieOptions(req);

    if (!code || !state) {
      res.status(400).json({ error: "Missing code or state parameter" });
      return;
    }

    // CSRF: the state echoed back by the provider must match the httpOnly cookie
    // planted in this browser when the flow was initiated (double-submit). This
    // prevents an attacker from completing an OAuth account-link in a victim's
    // session with a pre-obtained code/state pair.
    if (!cookieState || cookieState !== state) {
      res.clearCookie(SOCIAL_OAUTH_STATE_COOKIE, cookieOptions);
      res.status(400).json({ error: "Invalid OAuth state" });
      return;
    }

    // Validate state and extract userId (server-side single-use state tracker)
    const stateData = await getOAuthState(state);
    if (
      !stateData ||
      stateData.platform !== platform ||
      Date.now() - stateData.timestamp > OAUTH_STATE_TTL
    ) {
      await deleteOAuthState(state);
      res.clearCookie(SOCIAL_OAUTH_STATE_COOKIE, cookieOptions);
      res.status(400).json({ error: "Invalid OAuth state" });
      return;
    }
    await deleteOAuthState(state);
    res.clearCookie(SOCIAL_OAUTH_STATE_COOKIE, cookieOptions);

    try {
      // Exchange code for token (PKCE verifier passed through when present)
      const tokenResponse = await exchangeCodeForToken(
        platform,
        code,
        "",
        stateData.codeVerifier
      );

      // Fetch user profile
      const profile = await fetchUserProfile(platform, tokenResponse.access_token);

      // Save to database (getDb() always returns a live connection)
      const dbInstance = await getDb();

      const accountName = (
        profile.name ||
        profile.username ||
        profile.login ||
        "Connected Account"
      ) as string;

      await dbInstance.insert(platformAccounts).values({
        userId: stateData.userId,
        platform,
        accountName,
        oauthToken: tokenResponse.access_token,
        oauthRefreshToken: tokenResponse.refresh_token || undefined,
        tokenExpiresAt: tokenResponse.expires_in
          ? new Date(Date.now() + tokenResponse.expires_in * 1000)
          : undefined,
        accountMetadata: profile,
        isActive: 1,
      });

      // Redirect back to Agent Networking with success message
      const redirectUrl = new URL(`${req.protocol}://${getValidatedHost(req)}`);
      redirectUrl.pathname = "/agent-networking";
      redirectUrl.searchParams.set("platform", platform);
      redirectUrl.searchParams.set("connected", "true");

      res.redirect(302, redirectUrl.toString());
    } catch (error) {
      console.error(`[OAuth/${platform}] Callback failed`, error);

      // Redirect back with error message
      const redirectUrl = new URL(`${req.protocol}://${getValidatedHost(req)}`);
      redirectUrl.pathname = "/agent-networking";
      redirectUrl.searchParams.set("platform", platform);
      redirectUrl.searchParams.set("error", "true");

      res.redirect(302, redirectUrl.toString());
    }
  });
}

// ---------------------------------------------------------------------------
// Local account auth (desktop / sovereign installs with no OAuth provider)
// ---------------------------------------------------------------------------
// Uses scrypt via Node's built-in crypto — no extra dependency needed.

function hashPassword(password: string, salt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derived) => {
      if (err) reject(err);
      else resolve(`${salt}:${derived.toString("hex")}`);
    });
  });
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt] = stored.split(":");
  if (!salt) return false;
  const hash = await hashPassword(password, salt);
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(stored));
}

export function registerLocalAuthRoutes(app: Express) {
  // POST /api/auth/local/register — create first local account (owner)
  app.post("/api/auth/local/register", async (req: Request, res: Response) => {
    const { name, password } = req.body as { name?: string; password?: string };
    if (!name || !password || password.length < 8) {
      res.status(400).json({ error: "Name and password (min 8 chars) required" });
      return;
    }

    // Only allow registration if no local accounts exist yet
    const existing = await db.getUserByOpenId("local:owner");
    if (existing) {
      res.status(409).json({ error: "Local account already exists" });
      return;
    }

    const salt = crypto.randomBytes(16).toString("hex");
    const passwordHash = await hashPassword(password, salt);
    const openId = "local:owner";

    await db.upsertUser({
      openId,
      name,
      email: null,
      loginMethod: "local",
      passwordHash,
      role: "owner",
      executionMode: "scrapper",
      lastSignedIn: new Date(),
    });

    const sessionToken = await sdk.createSessionToken(openId, {
      name,
      expiresInMs: sessionTtlMs(),
    });

    const cookieOptions = getSessionCookieOptions(req);
    res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: sessionTtlMs() });
    // Also return the token in the body so non-cookie clients (the Omnecor HQ
    // mobile app, which uses Authorization: Bearer) can establish a session.
    res.json({ ok: true, sessionToken, name });
  });

  // POST /api/auth/local/login — sign in with local account
  app.post("/api/auth/local/login", async (req: Request, res: Response) => {
    const { password } = req.body as { password?: string };
    if (!password) {
      res.status(400).json({ error: "Password required" });
      return;
    }

    const user = await db.getUserByOpenId("local:owner");
    if (!user?.passwordHash) {
      res.status(401).json({ error: "No local account configured" });
      return;
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "Incorrect password" });
      return;
    }

    await db.upsertUser({ openId: user.openId, lastSignedIn: new Date() });

    const sessionToken = await sdk.createSessionToken(user.openId, {
      name: user.name ?? "",
      expiresInMs: sessionTtlMs(),
    });

    const cookieOptions = getSessionCookieOptions(req);
    res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: sessionTtlMs() });
    // Return the token for non-cookie (mobile Bearer) clients too.
    res.json({ ok: true, sessionToken, name: user.name ?? "" });
  });

  // GET /api/auth/local/exists — check if a local account has been created
  app.get("/api/auth/local/exists", async (_req: Request, res: Response) => {
    const user = await db.getUserByOpenId("local:owner");
    res.json({ exists: !!user?.passwordHash });
  });
}
