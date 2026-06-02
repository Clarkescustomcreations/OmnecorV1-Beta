import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import * as db from "../db.factory";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";
import { ENV } from "./env.js";
import crypto from "crypto";

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
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
    const redirectUri = `${req.protocol}://${req.get("host")}/api/oauth/callback`;
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
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, {
        ...cookieOptions,
        maxAge: ONE_YEAR_MS,
      });

      // Clear state cookie
      res.clearCookie("oauth_state", cookieOptions);

      res.redirect(302, "/");
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });
}

export function registerGoogleOAuthRoutes(app: Express) {
  const pendingVerifiers = new Map<string, string>(); // state → code_verifier

  app.get("/api/oauth/google/login", (req: Request, res: Response) => {
    if (!ENV.googleClientId) {
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

    const redirectUri = `${req.protocol}://${req.get("host")}/api/oauth/google/callback`;
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", ENV.googleClientId);
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

    try {
      const redirectUri = `${req.protocol}://${req.get("host")}/api/oauth/google/callback`;
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: ENV.googleClientId,
          client_secret: ENV.googleClientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
          code_verifier: codeVerifier,
        }),
      });
      const tokenData = await tokenRes.json() as { access_token?: string; id_token?: string };
      if (!tokenData.access_token) throw new Error("No access token from Google");

      const userRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
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
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      res.clearCookie("google_oauth_state", cookieOptions);
      res.redirect(302, "/");
    } catch (error) {
      console.error("[OAuth/Google] Callback failed", error);
      res.status(500).json({ error: "Google OAuth callback failed" });
    }
  });
}

export function registerMicrosoftOAuthRoutes(app: Express) {
  const pendingVerifiers = new Map<string, string>();

  app.get("/api/oauth/microsoft/login", (req: Request, res: Response) => {
    if (!ENV.microsoftClientId) {
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

    const redirectUri = `${req.protocol}://${req.get("host")}/api/oauth/microsoft/callback`;
    const url = new URL("https://login.microsoftonline.com/common/v2.0/oauth2/authorize");
    url.searchParams.set("client_id", ENV.microsoftClientId);
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

    try {
      const redirectUri = `${req.protocol}://${req.get("host")}/api/oauth/microsoft/callback`;
      const tokenRes = await fetch("https://login.microsoftonline.com/common/v2.0/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: ENV.microsoftClientId,
          client_secret: ENV.microsoftClientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
          code_verifier: codeVerifier,
        }),
      });
      const tokenData = await tokenRes.json() as { access_token?: string };
      if (!tokenData.access_token) throw new Error("No access token from Microsoft");

      const userRes = await fetch("https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName", {
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
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      res.clearCookie("ms_oauth_state", cookieOptions);
      res.redirect(302, "/");
    } catch (error) {
      console.error("[OAuth/Microsoft] Callback failed", error);
      res.status(500).json({ error: "Microsoft OAuth callback failed" });
    }
  });
}
