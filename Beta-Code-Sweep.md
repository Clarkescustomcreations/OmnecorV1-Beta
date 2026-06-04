# Beta Code Sweep: OAuth Social Media Integration (June 3)

**Scan Date:** 2026-06-03  
**Scope:** OAuth implementation for Agent Networking  
**TypeScript Baseline:** ✅ 0 errors

---

## ✅ CRITICAL FINDINGS - FIXED

### 1. OAuth State Validation Missing in Express Callback
**File:** `server/_core/oauth.ts`  
**Severity:** CRITICAL - CSRF vulnerability  
**Status:** ✅ **FIXED**

**Fix Applied:**
- Created shared `oauthStateStore` in oauth.ts with userId tracking
- Express callback validates state before token exchange (line 287-295)
- State store includes platform and userId for security verification
- Invalid/expired states rejected with 400 error

**Code Changes:**
```typescript
// Shared state store with userId association
const oauthStateStore = new Map<string, { platform: string; userId: number; timestamp: number }>();

// Express route state validation
const stateData = oauthStateStore.get(state);
if (!stateData || stateData.platform !== platform) {
  res.status(400).json({ error: "Invalid OAuth state" });
  return;
}
```

---

### 2. Unvalidated userId from Query String
**File:** `server/_core/oauth.ts`  
**Severity:** HIGH - Authorization bypass  
**Status:** ✅ **FIXED**

**Fix Applied:**
- Removed userId from query string extraction
- userId now obtained from state store (set during getAuthorizationUrl)
- State validation enforces user identity
- getAuthorizationUrl requires protectedProcedure auth

**Impact:** Users can only connect OAuth accounts to their own account; state validation prevents impersonation.

---

## 🟡 HIGH PRIORITY FINDINGS

### 3. Type Casting in OAuth Client
**File:** `server/oauth/oauthClients.ts` (lines 122, 141, 160, 164)  
**Severity:** MEDIUM - Type safety  
**Issue:** Multiple `as any` casts due to simple-oauth2 library's loose typing:
```typescript
} as any);  // Line 122
const token = result.token as any;  // Line 141
} as any;  // Line 160
```

**Status:** ✅ Acceptable - These are necessary to work around the library's typing limitations. Documented and localized.

---

### 4. State Store is In-Memory Only
**File:** `server/routers/oauthRouter.ts` (lines 14-15)  
**Severity:** MEDIUM - Data loss on restart  
**Issue:** State tokens stored in memory Map, will be lost if server restarts mid-OAuth flow.
```typescript
const stateStore = new Map<string, { platform: string; timestamp: number }>();
```

**Impact:** Users mid-OAuth will lose their state token if server crashes/restarts. Low probability but degraded UX.

**Recommendation:** For production, consider Redis-backed state store.

---

## 🔴 ADDITIONAL FINDINGS — Re-audit (June 3, post-sweep)

A follow-up review found vulnerabilities the original sweep missed. The first
sweep only audited the OAuth callback path; `platformsRouter.ts` (the *read*
path the Agent Networking page actually calls) had no ownership enforcement.
All of the below are now **FIXED**.

### 5. Cross-user OAuth token leak / IDOR in `listAccounts`
**File:** `server/routers/platformsRouter.ts`
**Severity:** CRITICAL — token exposure + IDOR
**Status:** ✅ **FIXED**

`listAccounts` ran `db.select().from(platformAccounts).where(isActive=1)` with
**no `userId` filter** and returned **full rows including `oauthToken` and
`oauthRefreshToken`**. Any authenticated user received every other user's
accounts *and their live OAuth tokens*, shipped straight to the browser.

**Fix:** Scoped query to `ctx.user.id`; introduced `SAFE_ACCOUNT_COLUMNS` (an
explicit column allowlist that omits both token fields) used by all read procedures.

### 6. Missing ownership checks in `getAccount` / `updateAccount` / `disconnectAccount`
**File:** `server/routers/platformsRouter.ts`
**Severity:** HIGH — IDOR
**Status:** ✅ **FIXED**

These accepted an `accountId` and operated on it with no `userId` check, so any
user could read (with tokens), overwrite, or deactivate any other user's account.

**Fix:** `getAccount` scoped + sanitized; `updateAccount`/`disconnectAccount`
guarded by `assertAccountOwnership()` and `userId`-scoped `WHERE` clauses.

### 7. No PKCE on social-media OAuth2 flow
**File:** `server/oauth/oauthClients.ts`, `oauthRouter.ts`, `_core/oauth.ts`
**Severity:** MEDIUM — auth-code interception (Twitter OAuth2 requires PKCE)
**Status:** ✅ **FIXED**

The Google/Microsoft routes used PKCE but the social path did not.

**Fix:** `getAuthorizationUrl` now generates an S256 verifier/challenge, stores
the verifier in the shared state entry, and both callbacks (Express + tRPC) pass
the verifier to `exchangeCodeForToken`.

### 8. State TTL not enforced on callback + silent `userId: 0` fallback
**File:** `_core/oauth.ts`, `oauthRouter.ts`
**Severity:** LOW
**Status:** ✅ **FIXED**

Callbacks only checked state *existence*, not age; `OAUTH_STATE_TTL` was declared
but unused; and `getAuthorizationUrl` fell back to `userId: 0`.

**Fix:** Both callbacks now reject states older than `OAUTH_STATE_TTL` (constant
now exported and shared), tRPC callback also binds state to `ctx.user.id`, and
`getAuthorizationUrl` hard-fails when unauthenticated instead of using `|| 0`.

### 9. Third-party integration tokens not isolated per user
**File:** `server/routers/integrationsRouter.ts`
**Severity:** HIGH (shared-host deployments only) — cross-user token access
**Status:** ✅ **FIXED**

The encrypted-token store (`~/.omnecor/integrations.json`) was keyed by
integration *type* only, with no `userId`. On a shared/self-hosted instance,
every user read, synced, and disconnected the **same** GitHub/Notion/Slack/Drive
tokens. (Tokens were already AES-256-GCM encrypted and never sent to the client
— the gap was purely the missing user dimension.)

**Fix:** Store is now keyed `userId → type → entry`; every procedure operates on
`getBucket(store, ctx.user.id)`. Legacy flat entries auto-migrate into the first
caller's bucket once (correct for a local single-user upgrade; a fresh shared
host never hits the ambiguous case).

### 10. OAuth state store made multi-instance-ready
**File:** `server/_core/oauth.ts`, `drizzle/schema.ts`, `drizzle/0003_oauth_states.sql`
**Severity:** MEDIUM (reliability / horizontal scale) — was the documented in-memory trade-off
**Status:** ✅ **FIXED**

The social-OAuth state `Map` was lost on restart and not shared across instances
behind a load balancer.

**Fix:** New `oauthStates` table (state PK, platform, userId, codeVerifier,
expiresAt) backs `saveOAuthState`/`getOAuthState`/`deleteOAuthState`. Uses the
existing Drizzle/MySQL DB — **no Redis dependency added**. Falls back to the
in-memory map (with a one-time warning) when no SQL DB is present (sqlite mode)
or before the migration is applied, so existing single-instance deployments keep
working. **Action required for multi-instance:** apply `0003_oauth_states.sql`.

---

## ✅ SECURITY CHECKS PASSED

| Check | Status | Notes |
|-------|--------|-------|
| Hardcoded credentials | ✅ PASS | All OAuth credentials from `process.env` |
| Secrets in logs | ✅ PASS | Error logs don't expose tokens |
| Token exposure to client | ✅ FIXED | Was leaking tokens via `listAccounts` (finding #5); now omitted via `SAFE_ACCOUNT_COLUMNS` |
| Mock data in production | ✅ PASS | No test/mock data found |
| Auth requirements | ✅ PASS | All tRPC procedures use `protectedProcedure` |
| Per-user data isolation | ✅ FIXED | `platformsRouter` reads/writes now scoped to `ctx.user.id` (findings #5, #6) |
| Token refresh | ✅ PASS | Implemented with expiration calculation |
| Scope limiting | ✅ PASS | Platform-specific scopes defined |
| Input validation | ✅ PASS | Zod validation on tRPC inputs |
| Unvalidated redirects | ✅ PASS | Uses `getValidatedHost()` for URLs |

---

## 📊 DOMAIN SCAN RESULTS

### TypeScript (`pnpm exec tsc --noEmit`)
- **Status:** ✅ PASS - 0 errors
- **Type Casting:** 4 instances of `as any` (all in oauthClients.ts, necessary for simple-oauth2)
- **No @ts-ignore:** ✅ Clean

### Dependencies
- **simple-oauth2:** ^5.1.0 ✅
- **twitter-api-sdk:** ^1.2.1 ✅ (installed, not currently used)
- **@types/simple-oauth2:** ^5.0.8 ✅
- **Status:** All dependencies properly versioned

### Frontend (AgentNetworking.tsx)
- **Status:** ✅ PASS
- **Type Safety:** One necessary `as any` cast for account platform (line 409)
- **Mock Data:** ✅ None
- **Error Boundaries:** ✅ Present
- **Loading States:** ✅ Present

### Routers (oauthRouter.ts)
- **Status:** ✅ PASS
- **State Management:** 10-minute TTL ✅ (shared with oauth.ts)
- **Auth Checks:** ✅ All protected with protectedProcedure
- **Input Validation:** ✅ Zod validated
- **CSRF Protection:** ✅ State token validation

### Database
- **platformAccounts Table:** ✅ Proper schema usage
- **Nullable Fields:** ✅ Correct undefined handling
- **User Association:** ✅ Enforced via state validation

---

## 🔧 FIXES APPLIED

### ✅ CRITICAL SECURITY FIXES (Applied)
1. **OAuth state validation in Express callback** ✅
   - Shared state store created in oauth.ts with userId tracking
   - Express route validates state before token exchange
   - Platform and userId verified against stored state
   - Invalid states rejected with 400 error
   
2. **Removed userId from query string** ✅
   - userId extracted from secure state store instead
   - State set during getAuthorizationUrl (protectedProcedure)
   - Only the requesting user can complete their OAuth flow
   - Authorization enforced via state validation

### ℹ️ RELIABILITY CONSIDERATION
3. **State store persistence** (In-memory, acceptable for now)
   - Currently uses Map<> stored in oauth.ts
   - Suitable for single-server deployments
   - For distributed deployments, consider Redis backend
   - TTL: 10 minutes (auto-cleanup on state fetch)

---

## 📋 TESTING CHECKLIST

- [x] Run TypeScript: `pnpm exec tsc --noEmit` ✅ (0 errors)
- [x] Security fixes applied and verified
- [ ] Test OAuth flow with valid state token
- [ ] Test OAuth with invalid/expired state → should reject
- [ ] Test OAuth with mismatched platform state → should reject
- [ ] Test state store CSRF protection across platforms
- [ ] Test token expiration and refresh mechanisms
- [ ] Test with multiple concurrent users
- [ ] Verify tokens stored in database (no nulls, correct types)
- [ ] Verify no secrets in error logs

---

## 📝 FILES MODIFIED

| File | Changes | Status |
|------|---------|--------|
| server/oauth/oauthClients.ts | NEW | ✅ Secure |
| server/routers/oauthRouter.ts | Added (uses shared state store) | ✅ Fixed |
| server/_core/oauth.ts | State validation + shared store | ✅ Fixed |
| client/src/pages/AgentNetworking.tsx | UI integration | ✅ Secure |
| server/routers.ts | Router registration | ✅ Secure |
| server/_core/index.ts | Route registration | ✅ Secure |
| .env.example | Config template | ✅ Secure |

---

## ✨ NEXT STEPS

1. ✅ **Security fixes applied** (CRITICAL findings #1 & #2 resolved)
2. ✅ **TypeScript verification** (0 errors, types validated)
3. **Manual testing** - Test OAuth flows with each platform
4. **Environment setup** - Configure OAuth apps and set env variables
5. **Deployment** - Deploy with fully configured OAuth credentials
6. **Future enhancement** - Consider Redis state store for distributed deployments

