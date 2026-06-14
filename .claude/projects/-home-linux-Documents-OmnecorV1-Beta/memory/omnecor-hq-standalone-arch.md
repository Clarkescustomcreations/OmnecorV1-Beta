---
name: omnecor-hq-standalone-arch
description: Omnecor HQ mobile — standalone-first startup, local account+PC auth sync, chat persistence/sync, and integrations, added 2026-06-13
metadata:
  type: project
---

Major rework so the Omnecor HQ app (`packaging/android/omnecor-hq/`) loads and is usable with NO PC connection (user reported it "started dead" when the PC was unreachable). See [[omnecor-hq-app-intent]].

**Startup (app/_layout.tsx):** on mount it `loadServerConfig()` + `loadAccount()` (both offline-safe), starts `startConnectionMonitor()`, and renders `<SetupFlow>` until onboarded, else the tabs. Root cause of the old dead/disconnected feel: `loadServerConfig()` was only ever called in settings.tsx, so the in-memory PC config was empty on every launch.

**New mobile modules (lib/_core/):**
- `connection.ts` + `hooks/use-connection.ts` — periodic `/health` probe; pub/sub `{configured, online, checking}`. `components/connection-banner.tsx` renders a "No PC connection" bar; injected into `ScreenContainer` for all tabs (prop `hideConnectionBanner`).
- `account.ts` — local-first account. `createLocalAccount({username, password?})` (auto-generates a strong password via nanoid when only a username is given, stored in SecureStore), `skipOnboarding()`, `syncAccountToPc()` (no double login: calls desktop `/api/auth/local/exists` then register or login; stores returned bearer token). `components/setup-flow.tsx` is the first-run screen (Google/Microsoft via PC OAuth url, local account, or Skip).
- `chat-store.ts` — AsyncStorage persistence of chat sessions (key `omnecor_chats`; timestamps stored ISO, revived to Date in index.tsx).
- `chat-sync.ts` — pushes local chats to the desktop when online; wired in _layout's connection subscriber (after account sync).
- `ai-chat.ts` — shared one-shot `askAi()` (resolves provider via ai.getProviders, calls ai.chat). Used by viewer + integrations.
- `integrations.ts` — bridge to desktop `integrationsRouter` (reuse, not reimplement): list/connect/sync/disconnect + `analyzeSource()` (sync then askAi). Surfaced in a Settings "Connected Sources" section (GitHub/Gmail/Outlook).

**Desktop changes:**
- `server/_core/oauth.ts` — `/api/auth/local/register` & `/login` now ALSO return `{ sessionToken, name }` in the body so the mobile Bearer client can establish a session (cookie still set for web).
- `server/routers/mobileSyncRouter.ts` (registered as `mobileSync`) — `push` (stores synced mobile chat in an in-memory ring buffer + emits a `mobile-chat` Notification), `list`, `addToProject` (materializes the conversation as a real chat session under a project via createChatSession/addChatMessage). Added `"mobile-chat"` to `NotificationKind` in `shared/notifications.ts`.

**Second on-device engine added 2026-06-13:** `lib/_core/mediapipe-inference.ts` wraps the native `LlmInferenceModule` from `react-native-llm-mediapipe` (`com.google.mediapipe:tasks-genai`) to run LiteRT `.task`/.bin/.litertlm models (Google AI Edge Gallery format) by local path — alongside llama.rn (GGUF). Lazy native access (`isMediapipeAvailable()`), so the JS still runs if the lib isn't built in. Import via `model-download.ts` `importTaskModelFromDevice()` + `listLocalTask()`; Settings has a "LiteRT models (.task)" subsection. Android sandboxing blocks auto-reading Edge Gallery's private files → user shares/exports the `.task` into the app, then imports via picker (no code edits). NOTE: `react-native-llm-mediapipe@0.5.0` is an old-arch NativeModule tested on RN 0.73 — verify it keeps building on RN 0.81 new-arch after upgrades.

**Done 2026-06-13 (this session, follow-up batch):** desktop auto-linking — `mobileSyncRouter.push` now matches chat text against project + neural-map names and auto-links (notification shows it). Richer `integrations.sync` — GitHub top-repo README preview, Gmail/Outlook recent message subjects+snippets/bodyPreview (so `analyzeSource` feeds real content). Share-target — added `expo-share-intent@5.1.1` (+ config plugin `androidIntentFilters: ["*/*"]`); `app/_layout.tsx` `useShareIntent` → `importSharedModelFile()` copies a shared `.gguf`/`.task` into the models dir (Edge Gallery "Share → Omnecor HQ" works without the document picker). Podcast — re-added episode-length tiers + AI "Generate Script" (desktop parity), dropped the dead duration/quality controls.

**Still TODO (next pass):** "direct-from-phone" OAuth for email/GitHub (currently reuse-via-PC token only — needs Google/Azure client IDs + expo-auth-session); streaming podcast progress (currently jumps to 100%).
