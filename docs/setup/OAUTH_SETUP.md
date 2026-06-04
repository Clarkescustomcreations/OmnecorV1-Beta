# Social Media OAuth Setup Guide

This guide explains how to set up OAuth for social media platforms in Agent Networking.

## Overview

Agent Networking supports OAuth 2.0 integration with major social media platforms for fast, secure setup without manual token entry.

**Supported Platforms:**
- Twitter/X
- LinkedIn
- Instagram
- TikTok
- Facebook
- YouTube

## Callback URL Quick Reference

| Platform | Callback URL (Development) | Callback URL (Production) |
|---|---|---|
| Twitter/X | `http://localhost:3000/api/oauth/callback/twitter` | `https://yourdomain.com/api/oauth/callback/twitter` |
| LinkedIn | `http://localhost:3000/api/oauth/callback/linkedin` | `https://yourdomain.com/api/oauth/callback/linkedin` |
| Instagram | `http://localhost:3000/api/oauth/callback/instagram` | `https://yourdomain.com/api/oauth/callback/instagram` |
| TikTok | `http://localhost:3000/api/oauth/callback/tiktok` | `https://yourdomain.com/api/oauth/callback/tiktok` |
| Facebook | `http://localhost:3000/api/oauth/callback/facebook` | `https://yourdomain.com/api/oauth/callback/facebook` |
| YouTube | `http://localhost:3000/api/oauth/callback/youtube` | `https://yourdomain.com/api/oauth/callback/youtube` |

## Setup Steps

### 1. Create OAuth Applications

For each platform you want to connect, follow the platform-specific instructions below.

## Platform-Specific Setup

### Twitter/X OAuth Setup

1. Go to [developer.twitter.com](https://developer.twitter.com) and sign in.
2. Create a new project and app under **Developer Portal → Projects & Apps → New App**.
3. Set **App Permissions** to "Read and Write".
4. Under **User authentication settings**:
   - Enable OAuth 2.0
   - App type: **Web App**
   - Callback URL: `http://localhost:3000/api/oauth/callback/twitter` (development) or your production URL
   - Website URL: your site (or `http://localhost:3000` for dev)
5. Copy **Client ID** and **Client Secret** to `.env`:
   ```
   TWITTER_CLIENT_ID=your_client_id
   TWITTER_CLIENT_SECRET=your_client_secret
   ```

**Required Scopes:** `tweet.read`, `tweet.write`, `users.read`, `offline.access`

### LinkedIn OAuth Setup

1. Go to [linkedin.com/developers](https://linkedin.com/developers) and sign in.
2. Click **Create App** and fill in app details.
3. Under **Auth** tab → **OAuth 2.0 settings**:
   - Add Redirect URL: `http://localhost:3000/api/oauth/callback/linkedin` (development) or your production URL
4. Request these **Products**: "Share on LinkedIn", "Sign In with LinkedIn using OpenID Connect"
5. Copy **Client ID** and **Client Secret** to `.env`:
   ```
   LINKEDIN_CLIENT_ID=your_client_id
   LINKEDIN_CLIENT_SECRET=your_client_secret
   ```

**Required Scopes:** `r_liteprofile`, `r_emailaddress`, `w_member_social`

### Instagram OAuth Setup

Instagram OAuth is provided via the Facebook Developer platform.

1. Go to [developers.facebook.com](https://developers.facebook.com).
2. Create a new App → Select **Business** type.
3. Add **Instagram Basic Display** product.
4. Under Instagram Basic Display → **Basic Display**:
   - Add OAuth Redirect URI: `http://localhost:3000/api/oauth/callback/instagram` (development) or your production URL
5. Copy **Instagram App ID** and **Instagram App Secret** to `.env`:
   ```
   INSTAGRAM_CLIENT_ID=your_app_id
   INSTAGRAM_CLIENT_SECRET=your_app_secret
   ```

**Required Scopes:** `user_profile`, `user_media`

### TikTok OAuth Setup

1. Go to [developers.tiktok.com](https://developers.tiktok.com).
2. Create a new app under **My Apps → Create**.
3. Add the **Login Kit** and **Content Posting API** products.
4. Under **Login Kit → Redirect domain**:
   - Add: `localhost:3000` (development) or your production domain
5. Under **Login Kit → Redirect URI**:
   - Add: `http://localhost:3000/api/oauth/callback/tiktok` (development) or your production URL
6. Copy **Client Key** (= Client ID) and **Client Secret** to `.env`:
   ```
   TIKTOK_CLIENT_ID=your_client_key
   TIKTOK_CLIENT_SECRET=your_client_secret
   ```

**Required Scopes:** `user.info.basic`, `video.list`, `video.upload`

### Facebook OAuth Setup

1. Go to [Meta Developers](https://developers.facebook.com/).
2. Create or select an app → Select **Business** type if creating new.
3. Add **Facebook Login** product.
4. Under **Facebook Login → Settings**:
   - Add Valid OAuth Redirect URI: `http://localhost:3000/api/oauth/callback/facebook` (development) or your production URL
5. Copy **App ID** and **App Secret** to `.env`:
   ```
   FACEBOOK_CLIENT_ID=your_app_id
   FACEBOOK_CLIENT_SECRET=your_app_secret
   ```

**Required Scopes:** `pages_manage_posts`, `pages_read_engagement`, `public_profile`

### YouTube OAuth Setup

YouTube OAuth uses Google's OAuth 2.0 system.

1. Go to [console.cloud.google.com](https://console.cloud.google.com).
2. Create a new project (or use an existing one).
3. Enable the **YouTube Data API v3** under APIs & Services → Library.
4. Create OAuth credentials: APIs & Services → Credentials → Create Credentials → OAuth client ID.
   - Application type: **Web application**
   - Authorized redirect URI: `http://localhost:3000/api/oauth/callback/youtube` (development) or your production URL
5. Copy **Client ID** and **Client Secret** to `.env`:
   ```
   YOUTUBE_CLIENT_ID=your_client_id
   YOUTUBE_CLIENT_SECRET=your_client_secret
   ```

**Required Scopes:** `https://www.googleapis.com/auth/youtube.upload`, `https://www.googleapis.com/auth/youtube.readonly`

### 2. Configure Environment Variables

After setting up OAuth apps on each platform, add the credentials to your `.env` file. The specific variable names for each platform are shown in the platform-specific setup sections above.

### 3. Use in Agent Networking

Once configured:

1. Navigate to **Agent Networking** → **Platforms** tab
2. Click the platform button to connect (e.g., "X (Twitter)")
3. Complete the OAuth authorization flow
4. The account will automatically be saved and available for scheduling

## Architecture

### OAuth Flow

```
User clicks "Connect [Platform]"
    ↓
Client requests authorization URL (trpc.oauth.getAuthorizationUrl)
    ↓
User redirected to platform's OAuth server
    ↓
User authorizes app
    ↓
Platform redirects to /api/oauth/callback/{platform}
    ↓
Server exchanges code for token
    ↓
Server saves platform account to database
    ↓
Server redirects back to Agent Networking
    ↓
UI updates with connected account
```

### Database Storage

Platform accounts are stored in the `platformAccounts` table:
- `oauthToken`: OAuth access token
- `oauthRefreshToken`: OAuth refresh token (for token renewal)
- `tokenExpiresAt`: Token expiration timestamp
- `accountMetadata`: User profile data from OAuth provider

### Token Refresh

Tokens are automatically refreshed when they expire using the refresh token flow implemented in `refreshOAuthToken()`.

## Troubleshooting

### "OAuth state mismatch"
- State tokens expire after 10 minutes
- Clear browser cookies and try again
- Ensure your redirect URL exactly matches the configured URL

### "Missing OAuth credentials"
- Check that environment variables are set correctly
- Restart the server after changing `.env`
- Verify credentials are for the correct platform

### "Unauthorized" during redirect
- Ensure user is logged into Omnecor before connecting
- Check that `ctx.user.id` is properly set
- Verify session cookies are not expired

## Security Notes

- **State validation**: All OAuth flows validate CSRF state tokens
- **Token storage**: Tokens are stored in the database (encrypt in production)
- **HTTPS required**: Always use HTTPS in production for OAuth
- **Token expiration**: Refresh tokens are used to obtain new access tokens when originals expire
- **Scope limiting**: Only request necessary scopes for each platform

## API Reference

### trpc.oauth.getAuthorizationUrl

```typescript
// Request authorization URL
const { authUrl } = await trpc.oauth.getAuthorizationUrl.mutate({
  platform: "twitter" // or linkedin, instagram, tiktok, facebook, youtube
});

// Redirect user
window.location.href = authUrl;
```

### Callback Handler

```typescript
// Automatic: /api/oauth/callback/{platform}?code={code}&state={state}
// Redirects to /agent-networking after success
```

## Further Reading

- [OAuth 2.0 RFC](https://tools.ietf.org/html/rfc6749)
- [PKCE (Proof Key for Code Exchange)](https://tools.ietf.org/html/rfc7636)
- Individual platform OAuth documentation
