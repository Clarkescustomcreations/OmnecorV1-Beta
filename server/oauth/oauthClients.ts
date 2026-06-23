import { AuthorizationCode } from "simple-oauth2";
import { SettingsService } from "../phase2/services/SettingsService.js";

interface OAuthEndpoints {
  auth: {
    tokenHost: string;
    tokenPath: string;
    authorizePath: string;
  };
  options?: {
    authorizationMethod?: "body" | "header";
  };
}

// Static authorization-server endpoints per provider. Client credentials are
// resolved separately and lazily (see resolveCredentials) so that both env vars
// AND the in-app Settings/credentials wizard work — and changes are picked up
// without a server restart.
const OAUTH_ENDPOINTS: Record<string, OAuthEndpoints> = {
  twitter: {
    auth: {
      tokenHost: "https://api.twitter.com",
      tokenPath: "/2/oauth2/token",
      authorizePath: "https://twitter.com/i/oauth2/authorize",
    },
    options: { authorizationMethod: "body" },
  },
  linkedin: {
    auth: {
      tokenHost: "https://www.linkedin.com",
      tokenPath: "/oauth/v2/accessToken",
      authorizePath: "https://www.linkedin.com/oauth/v2/authorization",
    },
  },
  instagram: {
    auth: {
      tokenHost: "https://api.instagram.com",
      tokenPath: "/oauth/access_token",
      authorizePath: "https://api.instagram.com/oauth/authorize",
    },
  },
  tiktok: {
    auth: {
      tokenHost: "https://open.tiktokapis.com",
      tokenPath: "/v1/oauth/token",
      authorizePath: "https://www.tiktok.com/v2/oauth/authorize",
    },
  },
  facebook: {
    auth: {
      tokenHost: "https://www.facebook.com",
      tokenPath: "/v18.0/oauth/access_token",
      authorizePath: "https://www.facebook.com/v18.0/dialog/oauth",
    },
  },
  youtube: {
    auth: {
      tokenHost: "https://oauth2.googleapis.com",
      tokenPath: "/token",
      authorizePath: "https://accounts.google.com/o/oauth2/v2/auth",
    },
  },
  // ---- Google Gmail (send) ----
  // Uses the same Google OAuth endpoints as Drive/YouTube; a single Google Cloud
  // OAuth client can serve all three (just add the gmail.send scope + this
  // redirect URI in the console). Powers gmailRouter.sendEmail.
  gmail: {
    auth: {
      tokenHost: "https://oauth2.googleapis.com",
      tokenPath: "/token",
      authorizePath: "https://accounts.google.com/o/oauth2/v2/auth",
    },
  },
  // ---- Cloud storage providers ----
  google_drive: {
    auth: {
      tokenHost: "https://oauth2.googleapis.com",
      tokenPath: "/token",
      authorizePath: "https://accounts.google.com/o/oauth2/v2/auth",
    },
  },
  dropbox: {
    auth: {
      tokenHost: "https://api.dropboxapi.com",
      tokenPath: "/oauth2/token",
      authorizePath: "https://www.dropbox.com/oauth2/authorize",
    },
  },
  onedrive: {
    auth: {
      tokenHost: "https://login.microsoftonline.com",
      tokenPath: "/common/oauth2/v2.0/token",
      authorizePath: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    },
  },
};

// Maps each provider to its SettingsService key + env-var fallback for the
// client id/secret. getSecret() reads ~/.omnecor/settings.json first (the
// in-app Settings wizard, mtime-cached so edits are live) and falls back to the
// env var — the same precedence AiProviderService uses for AI keys.
const PROVIDER_CREDENTIALS: Record<
  string,
  { idKey: string; secretKey: string; idEnv: string; secretEnv: string }
> = {
  twitter: { idKey: "twitterClientId", secretKey: "twitterClientSecret", idEnv: "TWITTER_CLIENT_ID", secretEnv: "TWITTER_CLIENT_SECRET" },
  linkedin: { idKey: "linkedinClientId", secretKey: "linkedinClientSecret", idEnv: "LINKEDIN_CLIENT_ID", secretEnv: "LINKEDIN_CLIENT_SECRET" },
  instagram: { idKey: "instagramClientId", secretKey: "instagramClientSecret", idEnv: "INSTAGRAM_CLIENT_ID", secretEnv: "INSTAGRAM_CLIENT_SECRET" },
  tiktok: { idKey: "tiktokClientId", secretKey: "tiktokClientSecret", idEnv: "TIKTOK_CLIENT_ID", secretEnv: "TIKTOK_CLIENT_SECRET" },
  facebook: { idKey: "facebookClientId", secretKey: "facebookClientSecret", idEnv: "FACEBOOK_CLIENT_ID", secretEnv: "FACEBOOK_CLIENT_SECRET" },
  youtube: { idKey: "youtubeClientId", secretKey: "youtubeClientSecret", idEnv: "YOUTUBE_CLIENT_ID", secretEnv: "YOUTUBE_CLIENT_SECRET" },
  gmail: { idKey: "gmailClientId", secretKey: "gmailClientSecret", idEnv: "GMAIL_CLIENT_ID", secretEnv: "GMAIL_CLIENT_SECRET" },
  google_drive: { idKey: "googleDriveClientId", secretKey: "googleDriveClientSecret", idEnv: "GOOGLE_DRIVE_CLIENT_ID", secretEnv: "GOOGLE_DRIVE_CLIENT_SECRET" },
  dropbox: { idKey: "dropboxClientId", secretKey: "dropboxClientSecret", idEnv: "DROPBOX_CLIENT_ID", secretEnv: "DROPBOX_CLIENT_SECRET" },
  onedrive: { idKey: "oneDriveClientId", secretKey: "oneDriveClientSecret", idEnv: "ONEDRIVE_CLIENT_ID", secretEnv: "ONEDRIVE_CLIENT_SECRET" },
};

/** Resolve a provider's client id/secret from the Settings file, then env. */
function resolveCredentials(platform: string): { id: string; secret: string } {
  const map = PROVIDER_CREDENTIALS[platform.toLowerCase()];
  if (!map) throw new Error(`Unsupported platform: ${platform}`);
  const settings = SettingsService.getInstance();
  return {
    id: settings.getSecret(map.idKey, process.env[map.idEnv]),
    secret: settings.getSecret(map.secretKey, process.env[map.secretEnv]),
  };
}

/** True when both client id and secret are configured (env or Settings). */
export function isPlatformConfigured(platform: string): boolean {
  try {
    const { id, secret } = resolveCredentials(platform);
    return Boolean(id && secret);
  } catch {
    return false;
  }
}

/** All providers that support the authorization-code flow. */
export function listOAuthPlatforms(): string[] {
  return Object.keys(PROVIDER_CREDENTIALS);
}

export function getOAuthClient(platform: string) {
  const endpoints = OAUTH_ENDPOINTS[platform.toLowerCase()];
  if (!endpoints) throw new Error(`Unsupported platform: ${platform}`);
  const { id, secret } = resolveCredentials(platform);
  if (!id || !secret) {
    throw new Error(`Missing OAuth credentials for ${platform}`);
  }

  return new AuthorizationCode({
    client: { id, secret },
    auth: endpoints.auth,
    ...(endpoints.options ? { options: endpoints.options } : {}),
  });
}

/**
 * Single source of truth for the OAuth callback URL the provider redirects the
 * browser back to. `PUBLIC_URL` wins when set (web deployments behind a domain);
 * otherwise it derives from the actual listen port so the packaged desktop app —
 * whose backend listens on :37291, never localhost:5173 — lines up correctly.
 * The operator must register this exact URI with each provider.
 */
export function getRedirectUri(platform: string): string {
  const port = process.env.OMNECOR_PORT || process.env.PORT || "3000";
  const base = process.env.PUBLIC_URL || `http://localhost:${port}`;
  return `${base}/api/oauth/callback/${platform.toLowerCase()}`;
}

export interface OAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in?: number;
}

export async function getOAuthAuthorizationUrl(
  platform: string,
  callbackUrl: string,
  state: string,
  codeChallenge?: string
): Promise<string> {
  const client = getOAuthClient(platform);
  const redirectUri = getRedirectUri(platform);

  const scopes = getPlatformScopes(platform);

  // PKCE: providers that support it (e.g. Twitter requires it) will use the
  // S256 challenge; providers that don't simply ignore the extra params.
  const url = client.authorizeURL({
    redirect_uri: redirectUri,
    scope: scopes,
    state,
    ...getProviderExtraAuthParams(platform),
    ...(codeChallenge && {
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    }),
  } as Parameters<AuthorizationCode["authorizeURL"]>[0] & Record<string, unknown>);

  return url;
}

interface RawToken {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  [key: string]: unknown;
}

export async function exchangeCodeForToken(
  platform: string,
  code: string,
  callbackUrl: string,
  codeVerifier?: string
): Promise<OAuthTokenResponse> {
  const client = getOAuthClient(platform);
  const redirectUri = getRedirectUri(platform);

  const tokenParams: Parameters<AuthorizationCode["getToken"]>[0] & Record<string, unknown> = {
    code,
    redirect_uri: redirectUri,
    ...(codeVerifier && { code_verifier: codeVerifier }),
  };

  const result = await client.getToken(tokenParams);
  const token = result.token as RawToken;

  return {
    access_token: token.access_token || "",
    refresh_token: token.refresh_token,
    token_type: token.token_type || "Bearer",
    expires_in: token.expires_in,
  };
}

export async function refreshOAuthToken(
  platform: string,
  refreshToken: string
): Promise<OAuthTokenResponse> {
  const client = getOAuthClient(platform);

  const token = {
    access_token: "",
    refresh_token: refreshToken,
  } as Parameters<AuthorizationCode["createToken"]>[0];

  const result = await client.createToken(token);
  const refreshedToken = await result.refresh();
  const refreshedTokenData = refreshedToken.token as RawToken;

  return {
    access_token: refreshedTokenData.access_token || "",
    refresh_token: refreshedTokenData.refresh_token || refreshToken,
    token_type: refreshedTokenData.token_type || "Bearer",
    expires_in: refreshedTokenData.expires_in,
  };
}

/**
 * Provider-specific extra authorize params. Cloud providers need these to issue
 * a refresh token for long-lived file access:
 *  - Google: access_type=offline + prompt=consent
 *  - Microsoft (OneDrive): the offline_access scope (added in getPlatformScopes)
 */
function getProviderExtraAuthParams(platform: string): Record<string, string> {
  switch (platform.toLowerCase()) {
    // All Google flows need offline access + a forced consent to receive a
    // refresh token for long-lived API access.
    case "google_drive":
    case "youtube":
    case "gmail":
      return { access_type: "offline", prompt: "consent" };
    // Dropbox issues a refresh token ONLY when token_access_type=offline.
    // Without it the access token is short-lived (~4h) with no refresh token,
    // so the integration would silently break after expiry.
    case "dropbox":
      return { token_access_type: "offline" };
    default:
      return {};
  }
}

function getPlatformScopes(platform: string): string[] {
  const scopeMap: Record<string, string[]> = {
    twitter: [
      "tweet.read",
      "tweet.write",
      "tweet.moderate.write",
      "users.read",
    ],
    linkedin: [
      "r_liteprofile",
      "r_basicprofile",
      "w_member_social",
      "r_emailaddress",
    ],
    instagram: ["instagram_basic", "instagram_graph_user_profile"],
    tiktok: ["user.info.basic", "video.publish", "video.list"],
    facebook: [
      "pages_read_engagement",
      "pages_manage_posts",
      "pages_read_user_content",
    ],
    youtube: [
      "https://www.googleapis.com/auth/youtube.force-ssl",
      "https://www.googleapis.com/auth/youtube.upload",
    ],
    // Gmail send only — least-privilege scope for outbound mail + userinfo for
    // the connected account's display name/email.
    gmail: [
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile",
    ],
    // ---- Cloud storage providers ----
    google_drive: ["https://www.googleapis.com/auth/drive.file"],
    // files.metadata.read is REQUIRED for /2/files/list_folder (the neural-map
    // listing); files.content.read is for downloading file bodies (future
    // VectorDB ingestion). Listing fails with a missing-scope 401 without the
    // metadata scope.
    dropbox: ["files.metadata.read", "files.content.read"],
    // offline_access is required to receive a refresh token from Microsoft.
    onedrive: ["Files.Read.All", "offline_access"],
  };

  return scopeMap[platform.toLowerCase()] || [];
}

export async function fetchUserProfile(
  platform: string,
  accessToken: string
): Promise<Record<string, unknown>> {
  const key = platform.toLowerCase();
  if (!OAUTH_ENDPOINTS[key]) throw new Error(`Unsupported platform: ${platform}`);

  // Dropbox's account endpoint is POST-only and returns a different shape; map
  // it into the common { name } shape the callback handler expects.
  if (key === "dropbox") {
    const response = await fetch(
      "https://api.dropboxapi.com/2/users/get_current_account",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    if (!response.ok) throw new Error("Failed to fetch profile from dropbox");
    const data = (await response.json()) as {
      name?: { display_name?: string };
      email?: string;
    };
    return {
      name: data.name?.display_name ?? data.email ?? "Dropbox Account",
      ...data,
    };
  }

  const endpoints: Record<string, string> = {
    twitter: "https://api.twitter.com/2/users/me",
    linkedin: "https://api.linkedin.com/v2/me",
    instagram: "https://graph.instagram.com/me",
    tiktok: "https://open.tiktokapis.com/v1/user/info/",
    facebook: "https://graph.facebook.com/me",
    youtube: "https://www.googleapis.com/youtube/v3/channels?part=snippet",
    gmail: "https://www.googleapis.com/oauth2/v2/userinfo",
    // ---- Cloud storage providers ----
    google_drive:
      "https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress)",
    onedrive:
      "https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName",
  };

  const endpoint = endpoints[key];
  if (!endpoint) throw new Error(`No endpoint for ${platform}`);

  const response = await fetch(endpoint, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) throw new Error(`Failed to fetch profile from ${platform}`);
  const data = (await response.json()) as Record<string, unknown>;

  // Normalize provider-specific shapes to a common { name } the caller reads.
  if (key === "google_drive") {
    const user = (data as { user?: { displayName?: string; emailAddress?: string } }).user;
    return { name: user?.displayName ?? user?.emailAddress ?? "Google Drive Account", ...data };
  }
  if (key === "onedrive") {
    const od = data as { displayName?: string; mail?: string; userPrincipalName?: string };
    return {
      name: od.displayName ?? od.mail ?? od.userPrincipalName ?? "OneDrive Account",
      ...data,
    };
  }

  return data;
}
