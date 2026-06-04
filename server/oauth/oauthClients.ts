import { AuthorizationCode } from "simple-oauth2";

interface OAuthConfig {
  client: {
    id: string;
    secret: string;
  };
  auth: {
    tokenHost: string;
    tokenPath: string;
    authorizePath: string;
  };
  options?: {
    authorizationMethod?: "body" | "header";
  };
}

const OAUTH_CONFIGS: Record<string, OAuthConfig> = {
  twitter: {
    client: {
      id: process.env.TWITTER_CLIENT_ID || "",
      secret: process.env.TWITTER_CLIENT_SECRET || "",
    },
    auth: {
      tokenHost: "https://api.twitter.com",
      tokenPath: "/2/oauth2/token",
      authorizePath: "https://twitter.com/i/oauth2/authorize",
    },
    options: {
      authorizationMethod: "body",
    },
  },
  linkedin: {
    client: {
      id: process.env.LINKEDIN_CLIENT_ID || "",
      secret: process.env.LINKEDIN_CLIENT_SECRET || "",
    },
    auth: {
      tokenHost: "https://www.linkedin.com",
      tokenPath: "/oauth/v2/accessToken",
      authorizePath: "https://www.linkedin.com/oauth/v2/authorization",
    },
  },
  instagram: {
    client: {
      id: process.env.INSTAGRAM_CLIENT_ID || "",
      secret: process.env.INSTAGRAM_CLIENT_SECRET || "",
    },
    auth: {
      tokenHost: "https://api.instagram.com",
      tokenPath: "/oauth/access_token",
      authorizePath: "https://api.instagram.com/oauth/authorize",
    },
  },
  tiktok: {
    client: {
      id: process.env.TIKTOK_CLIENT_ID || "",
      secret: process.env.TIKTOK_CLIENT_SECRET || "",
    },
    auth: {
      tokenHost: "https://open.tiktokapis.com",
      tokenPath: "/v1/oauth/token",
      authorizePath: "https://www.tiktok.com/v2/oauth/authorize",
    },
  },
  facebook: {
    client: {
      id: process.env.FACEBOOK_CLIENT_ID || "",
      secret: process.env.FACEBOOK_CLIENT_SECRET || "",
    },
    auth: {
      tokenHost: "https://www.facebook.com",
      tokenPath: "/v18.0/oauth/access_token",
      authorizePath: "https://www.facebook.com/v18.0/dialog/oauth",
    },
  },
  youtube: {
    client: {
      id: process.env.YOUTUBE_CLIENT_ID || "",
      secret: process.env.YOUTUBE_CLIENT_SECRET || "",
    },
    auth: {
      tokenHost: "https://oauth2.googleapis.com",
      tokenPath: "/token",
      authorizePath: "https://accounts.google.com/o/oauth2/v2/auth",
    },
  },
};

export function getOAuthClient(platform: string) {
  const config = OAUTH_CONFIGS[platform.toLowerCase()];
  if (!config) throw new Error(`Unsupported platform: ${platform}`);
  if (!config.client.id || !config.client.secret) {
    throw new Error(`Missing OAuth credentials for ${platform}`);
  }

  return new AuthorizationCode(config);
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
  const redirectUri = `${process.env.PUBLIC_URL || "http://localhost:5173"}/api/oauth/callback/${platform}`;

  const scopes = getPlatformScopes(platform);

  // PKCE: providers that support it (e.g. Twitter requires it) will use the
  // S256 challenge; providers that don't simply ignore the extra params.
  const url = client.authorizeURL({
    redirect_uri: redirectUri,
    scope: scopes,
    state,
    ...(codeChallenge && {
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    }),
  } as any);

  return url;
}

export async function exchangeCodeForToken(
  platform: string,
  code: string,
  callbackUrl: string,
  codeVerifier?: string
): Promise<OAuthTokenResponse> {
  const client = getOAuthClient(platform);
  const redirectUri = `${process.env.PUBLIC_URL || "http://localhost:5173"}/api/oauth/callback/${platform}`;

  const tokenParams: any = {
    code,
    redirect_uri: redirectUri,
    ...(codeVerifier && { code_verifier: codeVerifier }),
  };

  const result = await client.getToken(tokenParams);
  const token = result.token as any;

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
  } as any;

  const result = await client.createToken(token);
  const refreshedToken = await result.refresh();
  const refreshedTokenData = refreshedToken.token as any;

  return {
    access_token: refreshedTokenData.access_token || "",
    refresh_token: refreshedTokenData.refresh_token || refreshToken,
    token_type: refreshedTokenData.token_type || "Bearer",
    expires_in: refreshedTokenData.expires_in,
  };
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
  };

  return scopeMap[platform.toLowerCase()] || [];
}

export async function fetchUserProfile(
  platform: string,
  accessToken: string
): Promise<Record<string, unknown>> {
  const config = OAUTH_CONFIGS[platform.toLowerCase()];
  if (!config) throw new Error(`Unsupported platform: ${platform}`);

  const endpoints: Record<string, string> = {
    twitter: "https://api.twitter.com/2/users/me",
    linkedin: "https://api.linkedin.com/v2/me",
    instagram: "https://graph.instagram.com/me",
    tiktok: "https://open.tiktokapis.com/v1/user/info/",
    facebook: "https://graph.facebook.com/me",
    youtube: "https://www.googleapis.com/youtube/v3/channels?part=snippet",
  };

  const endpoint = endpoints[platform.toLowerCase()];
  if (!endpoint) throw new Error(`No endpoint for ${platform}`);

  const response = await fetch(endpoint, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) throw new Error(`Failed to fetch profile from ${platform}`);
  return response.json();
}
