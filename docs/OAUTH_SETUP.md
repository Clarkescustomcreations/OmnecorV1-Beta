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

## Setup Steps

### 1. Create OAuth Applications

For each platform you want to connect, create an OAuth application in their developer console:

#### Twitter/X OAuth
1. Go to [Twitter Developer Portal](https://developer.twitter.com/en/dashboard)
2. Create a new app
3. Set Authorization settings:
   - Callback URL: `https://your-domain.com/api/oauth/callback/twitter`
   - Scopes: `tweet.read`, `tweet.write`, `users.read`
4. Copy Client ID and Secret

#### LinkedIn OAuth
1. Go to [LinkedIn Developers](https://www.linkedin.com/developers)
2. Create an app under your company
3. Set Authorized redirect URLs: `https://your-domain.com/api/oauth/callback/linkedin`
4. Request scopes: `w_member_social`, `r_liteprofile`
5. Copy Client ID and Secret

#### Instagram OAuth
1. Go to [Meta App Dashboard](https://developers.facebook.com/)
2. Create Business App
3. Add Instagram Graph API
4. Set redirect URL: `https://your-domain.com/api/oauth/callback/instagram`
5. Copy App ID and Secret

#### TikTok OAuth
1. Go to [TikTok Developer](https://developer.tiktok.com/)
2. Create Developer Account
3. Create Application
4. Set callback URL: `https://your-domain.com/api/oauth/callback/tiktok`
5. Copy Client Key and Secret

#### Facebook OAuth
1. Go to [Meta Developers](https://developers.facebook.com/)
2. Create or select app
3. Add Facebook Login product
4. Set Valid OAuth redirect URIs: `https://your-domain.com/api/oauth/callback/facebook`
5. Copy App ID and Secret

#### YouTube OAuth
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create new project
3. Enable YouTube Data API v3
4. Create OAuth 2.0 credentials (Web application)
5. Add redirect URI: `https://your-domain.com/api/oauth/callback/youtube`
6. Copy Client ID and Secret

### 2. Configure Environment Variables

Add the OAuth credentials to your `.env` file:

```bash
# Twitter/X
TWITTER_CLIENT_ID=your_client_id
TWITTER_CLIENT_SECRET=your_client_secret

# LinkedIn
LINKEDIN_CLIENT_ID=your_client_id
LINKEDIN_CLIENT_SECRET=your_client_secret

# Instagram
INSTAGRAM_CLIENT_ID=your_client_id
INSTAGRAM_CLIENT_SECRET=your_client_secret

# TikTok
TIKTOK_CLIENT_ID=your_client_id
TIKTOK_CLIENT_SECRET=your_client_secret

# Facebook
FACEBOOK_CLIENT_ID=your_client_id
FACEBOOK_CLIENT_SECRET=your_client_secret

# YouTube
YOUTUBE_CLIENT_ID=your_client_id
YOUTUBE_CLIENT_SECRET=your_client_secret
```

### 3. Update Redirect URLs

Make sure the OAuth callback URLs in each platform's developer dashboard match:
- Local development: `http://localhost:5173/api/oauth/callback/{platform}`
- Production: `https://your-domain.com/api/oauth/callback/{platform}`

### 4. Use in Agent Networking

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
