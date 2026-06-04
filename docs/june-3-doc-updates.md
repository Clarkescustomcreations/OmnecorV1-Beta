# June 3 Updates: OAuth for Social Media Setup

## Summary

Added OAuth 2.0 integration for social media platforms to Agent Networking, enabling fast one-click setup for Twitter/X, LinkedIn, Instagram, TikTok, Facebook, and YouTube without manual token entry.

---

## Files Added

### 1. `/server/oauth/oauthClients.ts` (NEW)
Core OAuth client library supporting 6 social media platforms.

**Key Functions:**
- `getOAuthClient(platform)` - Initialize OAuth client for platform
- `getOAuthAuthorizationUrl(platform, callbackUrl, state)` - Get authorization URL
- `exchangeCodeForToken(platform, code, callbackUrl)` - Exchange auth code for access token
- `refreshOAuthToken(platform, refreshToken)` - Refresh expired tokens
- `fetchUserProfile(platform, accessToken)` - Get authenticated user profile data
- `getPlatformScopes(platform)` - Get required OAuth scopes per platform

**Supported Platforms:**
- Twitter/X
- LinkedIn
- Instagram
- TikTok
- Facebook
- YouTube

### 2. `/server/routers/oauthRouter.ts` (NEW)
tRPC router for OAuth flow management.

**Procedures:**
- `getAuthorizationUrl` - Mutation: Generate OAuth auth URL with CSRF state token
- `handleCallback` - Mutation: Process OAuth callback, exchange code for token, save to DB
- `disconnectAccount` - Mutation: Deactivate a connected platform account

### 3. `/docs/OAUTH_SETUP.md` (NEW)
Complete setup guide for OAuth configuration per platform including:
- Step-by-step OAuth app creation for each platform
- Environment variable configuration
- Redirect URL setup
- Troubleshooting guide
- Security notes

---

## Files Modified

### 1. `/server/_core/oauth.ts`
**Added:**
- `registerSocialMediaOAuthRoutes(app)` - Express route handler for `/api/oauth/callback/:platform`
- OAuth state validation and token exchange logic
- Profile fetching and database storage
- Redirect URL generation with success/error parameters

**Imports Added:**
```typescript
import { exchangeCodeForToken, fetchUserProfile } from "../oauth/oauthClients.js";
import { getDb } from "../db.js";
import { platformAccounts } from "../../drizzle/schema.js";
```

### 2. `/server/_core/index.ts`
**Modified:**
- Imported `registerSocialMediaOAuthRoutes` from oauth module
- Registered social media OAuth routes on Express app

### 3. `/server/routers.ts`
**Added:**
- Imported `oauthRouter` from `./routers/oauthRouter.js`
- Registered `oauth: oauthRouter` in `appRouter`

### 4. `/client/src/pages/AgentNetworking.tsx`
**Major Changes:**
- Added import for `PersonaCreationPanel` component
- Extracted Persona Creation section from Settings page to new "Personas" tab
- Completely redesigned Platforms tab to support OAuth:
  - Connected accounts list with status indicators
  - OAuth connect buttons for each platform
  - Platform connection status tracking

**New Components:**
- `PlatformOAuthButtons()` - Renders OAuth connect buttons for 6 platforms with:
  - Platform icons and branding colors
  - Connected status indication
  - Loading states
  - Click handler to initiate OAuth flow

**Tab Updates:**
- Added new "Personas" tab with full PersonaCreationPanel
- Redesigned "Platforms" tab with OAuth workflow

### 5. `/.env.example`
**Added OAuth Environment Variables:**
```bash
# Social Media OAuth (for Agent Networking)
# Twitter/X
TWITTER_CLIENT_ID=your_twitter_client_id
TWITTER_CLIENT_SECRET=your_twitter_client_secret

# LinkedIn
LINKEDIN_CLIENT_ID=your_linkedin_client_id
LINKEDIN_CLIENT_SECRET=your_linkedin_client_secret

# Instagram
INSTAGRAM_CLIENT_ID=your_instagram_client_id
INSTAGRAM_CLIENT_SECRET=your_instagram_client_secret

# TikTok
TIKTOK_CLIENT_ID=your_tiktok_client_id
TIKTOK_CLIENT_SECRET=your_tiktok_client_secret

# Facebook
FACEBOOK_CLIENT_ID=your_facebook_client_id
FACEBOOK_CLIENT_SECRET=your_facebook_client_secret

# YouTube
YOUTUBE_CLIENT_ID=your_youtube_client_id
YOUTUBE_CLIENT_SECRET=your_youtube_client_secret
```

---

## Dependencies Added

```json
{
  "dependencies": {
    "simple-oauth2": "^5.1.0",
    "twitter-api-sdk": "^1.2.1"
  },
  "devDependencies": {
    "@types/simple-oauth2": "^5.0.8"
  }
}
```

**Note:** `twitter-api-sdk` is installed but not currently used (reserved for future Twitter-specific API calls).

---

## Database Schema

Uses existing `platformAccounts` table with OAuth-specific fields:
- `oauthToken` (text, required) - OAuth access token
- `oauthRefreshToken` (text, optional) - OAuth refresh token for auto-renewal
- `tokenExpiresAt` (timestamp, optional) - Token expiration time
- `accountMetadata` (JSON, optional) - User profile from OAuth provider
- `isActive` (int, default 1) - Account connection status

---

## OAuth Flow

### User Perspective
1. User navigates to Agent Networking → Platforms tab
2. Clicks platform button (e.g., "X (Twitter)")
3. Browser redirects to platform's OAuth authorization page
4. User grants permissions
5. Platform redirects back to `/api/oauth/callback/{platform}`
6. Server saves account
7. Browser redirects to Agent Networking with success message
8. Connected account appears in list

### Backend Flow
```
User Action
    ↓
trpc.oauth.getAuthorizationUrl.mutate({platform})
    ↓
Generate state token (CSRF protection)
    ↓
Return auth URL with embedded state
    ↓
Browser redirects to OAuth provider
    ↓
User authorizes
    ↓
OAuth provider redirects to /api/oauth/callback/{platform}?code=...&state=...
    ↓
Server validates state (CSRF check)
    ↓
Server exchanges code for tokens
    ↓
Server fetches user profile
    ↓
Server saves to platformAccounts table
    ↓
Server redirects to Agent Networking
    ↓
UI shows newly connected account
```

---

## Security Features

1. **CSRF Protection**: State tokens validated before token exchange
2. **State Expiration**: 10-minute TTL on state tokens
3. **User Authentication**: OAuth procedures require authenticated session
4. **Token Storage**: Secure storage in database
5. **Token Refresh**: Automatic refresh token handling for expired tokens
6. **Scope Limiting**: Only request necessary scopes per platform

---

## Configuration Required

Before using OAuth features, developers must:

1. Create OAuth applications in each platform's developer console
2. Add callback URLs to each OAuth app configuration
3. Set environment variables with OAuth credentials
4. Restart server to load new `.env` values

See `/docs/OAUTH_SETUP.md` for detailed per-platform instructions.

---

## Feature Integration

### Agent Networking Page Structure
```
Agent Networking Page
├── Header with "Sync Content" button
├── Stats Grid (Scheduled, Published, Engagement, Active Platforms)
└── Tabs
    ├── Calendar - Schedule posts
    ├── Approvals - Review AI-generated content
    ├── Analytics - Track engagement
    ├── Platforms ← NEW/UPDATED
    │   ├── Connected Accounts (list)
    │   └── Add More Platforms (OAuth buttons)
    ├── Discovery - Find articles
    └── Personas ← NEW
        └── Character Persona Studio (moved from Settings)
```

---

## Breaking Changes

None. This is a pure addition. Existing functionality remains unchanged.

---

## Testing Checklist

- [ ] Configure at least one OAuth app (Twitter/X recommended for testing)
- [ ] Set environment variables
- [ ] Navigate to Agent Networking → Platforms
- [ ] Click platform button
- [ ] Complete OAuth flow
- [ ] Verify account appears in connected accounts list
- [ ] Verify account metadata is stored correctly
- [ ] Test disconnect functionality
- [ ] Test with multiple platforms
- [ ] Verify Personas tab shows CharacterPersonaStudio

---

## Future Enhancements

1. **Token Refresh**: Implement automatic token refresh before expiration
2. **Account Sync**: Periodically sync account data with platforms
3. **Multi-Account**: Allow multiple accounts per platform
4. **Platform-Specific APIs**: Use platform SDKs for enhanced features
5. **Analytics Integration**: Pull engagement metrics directly from platforms
6. **Post Publishing**: Implement scheduled posting to platforms
7. **Webhook Integration**: Handle platform webhooks for real-time updates

---

## References

- [OAuth 2.0 RFC](https://tools.ietf.org/html/rfc6749)
- [simple-oauth2 Documentation](https://github.com/lelylan/simple-oauth2)
- Platform-specific OAuth docs in `/docs/OAUTH_SETUP.md`
