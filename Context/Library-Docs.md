# Omnecor — Library & Tool Integration Guide

This document defines how to utilize the library dependencies, database drivers, browser automation utilities, and Model Context Protocol (MCP) servers within the Omnecor V1-Beta environment.

---

## 🔌 1. Model Context Protocol (MCP) Standards

Omnecor leverages active Model Context Protocol (MCP) servers to offload complex system, database, and browser interactions to secure, standardized interfaces. 

> [!IMPORTANT]
> **AI DIRECTIVE:** Before creating custom Python scripts, installing NPM scrapers, or executing raw shell commands for a task, you **must** check if a corresponding MCP server is configured and use its tools.

The active MCP directory is located at `/home/linux/AI/mcp-servers/`. The full set of configured MCP servers and their tool surfaces:

| MCP Server | Tool prefix | Use it for | Key tools |
| :--- | :--- | :--- | :--- |
| **`puppeteer`** | `mcp__puppeteer__*` | **All** browser automation, scraping, form interaction, and screenshots. Do not install playwright/puppeteer NPM modules. | `puppeteer_navigate`, `puppeteer_click`, `puppeteer_fill`, `puppeteer_select`, `puppeteer_hover`, `puppeteer_evaluate`, `puppeteer_screenshot` |
| **`chrome-devtools`** | `mcp__chrome-devtools__*` | Deep page debugging, performance traces, Lighthouse audits, network/console inspection, device emulation. Prefer over puppeteer when you need DevTools-grade diagnostics. | `navigate_page`, `new_page`, `click`, `fill`, `fill_form`, `evaluate_script`, `take_snapshot`, `take_screenshot`, `list_network_requests`, `get_network_request`, `list_console_messages`, `performance_start_trace`/`performance_stop_trace`, `performance_analyze_insight`, `lighthouse_audit`, `emulate`, `resize_page`, `take_heapsnapshot` |
| **`sqlite`** | `mcp__sqlite__*` | Read, inspect, query, or back up the local libSQL/SQLite database. Read-only inspection should go here, not raw shell `sqlite3`. | `list_tables`, `describe_table`, `read_query`, `write_query`, `create_table`, `append_insight` |
| **`filesystem`** | `mcp__filesystem__*` | Read, write, search, and list project directory trees outside the standard file tools when bulk/tree operations help. | `read_text_file`, `read_media_file`, `read_multiple_files`, `write_file`, `edit_file`, `create_directory`, `list_directory`, `list_directory_with_sizes`, `directory_tree`, `move_file`, `search_files`, `get_file_info`, `list_allowed_directories` |
| **`git`** | `mcp__git__*` | Inspect and manipulate repository state — status, diffs, log, branch/checkout, staged commits. | `git_status`, `git_diff`, `git_diff_staged`, `git_diff_unstaged`, `git_log`, `git_show`, `git_add`, `git_reset`, `git_commit`, `git_branch`, `git_checkout`, `git_create_branch` |
| **`docker-mcp`** | `mcp__docker__*` | Control sandboxed runner containers and read their logs. | `create-container`, `deploy-compose`, `list-containers`, `get-logs` |
| **`memory`** | `mcp__memory__*` | Persistent knowledge-graph store (entities/relations/observations) for cross-session facts. | `create_entities`, `create_relations`, `add_observations`, `delete_entities`, `delete_relations`, `delete_observations`, `read_graph`, `search_nodes`, `open_nodes` |
| **`sequential-thinking`** | `mcp__sequential-thinking__*` | Structured multi-step reasoning for hard, branching problems. | `sequentialthinking` |
| **`fetch`** | `mcp__fetch__*` | Fetch a single URL's contents when full browser automation is overkill. | `fetch` |
| **`ide`** | `mcp__ide__*` | Pull live language-server diagnostics and execute code in the active IDE/Jupyter kernel. | `getDiagnostics`, `executeCode` |

> [!NOTE]
> Tool schemas for MCP servers are **deferred** — only the names load by default. Fetch a schema with `ToolSearch` (e.g. `select:mcp__puppeteer__puppeteer_navigate`) before the first call in a session, or the call fails with `InputValidationError`.

---

## 🗄️ 2. Database Integration (Drizzle ORM & libSQL)

Omnecor standardizes on a unified **libSQL / SQLite** database dialect. The database client configuration resides in [db.ts](file:///home/linux/Documents/OmnecorV1-Beta/server/db.ts) and is exported by the factory at [db.factory.ts](file:///home/linux/Documents/OmnecorV1-Beta/server/db.factory.ts).

### 2.1 Accessing the Client
All database operations must call the asynchronous getter `getDb()` to retrieve the connection instance:
```typescript
import { getDb } from "../db.factory.js";
import { users } from "../../drizzle/schema.js";
import { eq } from "drizzle-orm";

const db = await getDb();
const activeUser = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
```

### 2.2 Common CRUD Patterns

#### Inserting Records (Always use `.returning({ id: ... })`):
```typescript
import { getDb } from "../db.factory.js";
import { chatSessions } from "../../drizzle/schema.js";

const db = await getDb();
const [newSession] = await db.insert(chatSessions)
  .values({
    id: crypto.randomUUID(),
    projectId: input.projectId,
    title: input.title,
    providerId: input.providerId,
    modelId: input.modelId,
  })
  .returning({ id: chatSessions.id });
```

#### SQLite-Compatible Upserts (`.onConflictDoUpdate`):
```typescript
import { getDb } from "../db.factory.js";
import { users } from "../../drizzle/schema.js";

const db = await getDb();
await db.insert(users)
  .values({
    openId: user.openId,
    name: user.name,
    role: "user",
  })
  .onConflictDoUpdate({
    target: users.openId,
    set: {
      name: user.name,
      lastSignedIn: new Date(),
    }
  });
```

---

## 🌐 3. Browser Automation Guide (Puppeteer MCP)

Since `puppeteer` is not a dependency in [package.json](file:///home/linux/Documents/OmnecorV1-Beta/package.json), browser-based workflows (e.g., scraping, visual screenshots, and interaction testing) must route through the **Puppeteer MCP server**.

### 3.1 Common MCP Browser Actions
When performing browser activities:
1.  **Initialize Viewport:** Use the `puppeteer_navigate` tool to open the target URL.
2.  **Evaluate Elements:** Use `puppeteer_click` and `puppeteer_fill` to navigate forms.
3.  **Inspect State:** Use `puppeteer_screenshot` to verify page layouts or capture error panels visually.

---

## 📦 4. Monorepo Dependency Matrix

The table below outlines package versions across the project's sub-environments:

| Library / Tool | Web Client & Server (Root) | Desktop Shell (Electron App) | Mobile App (Android Client) | Audit Status & Conflicts |
| :--- | :--- | :--- | :--- | :--- |
| **React** | `^19.2.1` | `^19.2.1` | `19.1.0` | ✅ **Aligned.** Electron upgraded to React 19. Minor patch drift on mobile (`19.1.0` vs `19.2.1`) is non-breaking. |
| **Tailwind CSS** | `^4.1.14` | `^4.1.14` | `^3.4.17` | 🟡 **Styling Drift.** Web & Electron utilize Tailwind CSS v4. Mobile utilizes Tailwind CSS v3 + NativeWind v4 (which does not support OKLCH variables). Static hex fallbacks applied in `theme.config.js` (Feature 18). |
| **tRPC Client** | `^11.8.0` | *N/A* | `^11.8.0` | ✅ **Aligned.** Mobile tRPC downgraded to match backend `^11.8.0`. |

### 4.1 Dependency Status
*   ✅ **Electron React:** Upgraded to `^19.2.1` — aligned with root project.
*   ✅ **tRPC Client:** Android app downgraded to `^11.8.0` — aligned with backend.
*   🟡 **Color Token Fallbacks (ongoing):** Mobile is on Tailwind v3 + NativeWind v4. Static hex fallbacks in [theme.config.js](file:///home/linux/Documents/OmnecorV1-Beta/packaging/android/omnecor-hq/theme.config.js) approximate the OKLCH values in [Globals.css](file:///home/linux/Documents/OmnecorV1-Beta/client/src/Globals.css). Full Tailwind v4 / NativeWind v5 upgrade is a future improvement.

---

## 🧩 5. Required Skills & MCP Tools — by Project Area

This is the binding map of **which skills and MCP tools are required to work on each part of the
project**. The full skill descriptions live in `AGENTS.md` — this section says *where each one is
mandatory*. Cross-cutting workflow skills (`architect`, `review`, `recover`, `imprint`,
`remember`, `code-sweep`) apply everywhere per `AGENTS.md` and are not repeated here.

> [!IMPORTANT]
> **AI DIRECTIVE:** Do **not** start work in any area below without first loading its **Required
> skills**. If an area lists a **Required MCP** tool, route the operation through it instead of raw
> shell/NPM. Only invoke skills that appear in the live session list — never guess a name.

| # | Project Area | Paths / Trigger | Required skills (load first) | Required MCP |
| :-- | :--- | :--- | :--- | :--- |
| A | **DB schema, queries & migrations** | `drizzle/schema.ts`, `server/db.ts`, `server/db.factory.ts`, any `getDb()` query, `pnpm build:push` | `api-database-drizzle`, `drizzle-orm-patterns`, `drizzle-best-practices`, `drizzle-queries`, `drizzle-orm-expert` | `sqlite` (inspect/backup the live DB; never raw `sqlite3`) |
| B | **tRPC routers & API procedures** | `server/routers/*`, `server/core_services/routers/*`, `server/_core/trpc.ts`, `server/routers.ts` | `trpc-router`, `trpc-patterns`, `react-query-setup` (client wiring) | — |
| C | **Input validation (all `z.*` schemas)** | Any procedure input, form schema, env/config parsing | `zod-validation-expert`, `zod-validation-utilities`, `form-validation-with-zod` | — |
| D | **React pages & components** | `client/src/**` pages/components, `App.tsx` lazy routes | `react`, `react-patterns`; `react-flow-node-ts` for `SchematicEditor`/ReactFlow nodes; `transformers-js` only for in-browser ML | — |
| E | **Styling & design tokens** | Any `.tsx` className, `client/src/Globals.css` (with `Context/UI-Tokens.md` + `UI-Rules.md`) | `tailwind-css-patterns`, `tailwind-best-practices` | — |
| F | **Client/global state** | `client/src/lib/store/app.store.ts`, any Zustand store | `zustand`, `zustand-typescript`, `zustand-store-ts`, `zustand-middleware`, `zustand-advanced-patterns`, `state-management` | — |
| G | **Build & dev server** | `vite.config.ts`, dev/build pipeline, path aliases, HMR | `vite`, `vite-patterns`, `vite-development` | — |
| H | **Auth, sessions & OAuth** | `server/_core/security.ts`, `oauth.ts`, auth routers, JWT/session cookie code | `api-authentication` (JWT, sessions, API keys, security headers), `oauth-expert` (OAuth 2.0 / OIDC flows, PKCE, token refresh/management), `oauth` (redirect-URI config + portless/local-dev `redirect_uri_mismatch` fixes), `google` + `microsoft` (provider sign-in + local OIDC emulation for tests) | — |
| I | **Mobile APK** | `packaging/android/omnecor-hq/**` | `react-native-expo`, `expo-modules`, `expo-router`, `expo-config`, `expo-tailwind-setup`; `expo-build`/`expo-dev-client`/`expo-deployment`/`expo-updates` for build/ship; `better-auth-expo`/`auth0-expo`/`clerk-expo-patterns` for mobile auth; `upgrading-expo`/`upgrading-react-native` for version bumps | — |
| J | **Electron desktop** | `packaging/electron-app/**` | `electron-node-upgrade` (Node/toolchain bumps), `finish-electron-security` (security finish on a build PC), `better-auth-electron` (desktop auth IPC) | — |
| K | **Browser automation & UI verification** | Scraping, screenshots, rendering, "does the page work" checks | `run-omnecor`, `verify` (drive the running app) | `puppeteer` (default automation); `chrome-devtools` (perf traces, Lighthouse, network/console debugging) |
| L | **Claude / Anthropic provider code** | `aiRouter`, AI provider services, model IDs, prompts, tool-use, caching | `claude-api` (read before touching any Claude/Anthropic-shaped code) | — |
| M | **Building new MCP servers** | `/home/linux/AI/mcp-servers/**`, new tool/resource definitions | `mcp-server-patterns` | — |
| N | **Tests** | `**/__tests__/**`, Vitest configs | `testing` (Vitest v4 dual-config, mocks, Zustand store tests) | — |
| O | **Node debugging & repo health** | Crash/hang triage, fresh-clone/CI setup checks | `node-inspect-debugger`, `repo-healthcheck-node`, `update-node-version` | `ide` (live LSP `getDiagnostics`) |
| P | **Git operations** | status, diffs, branch/commit inspection | — | `git` (prefer over raw `git` shell for inspection) |
| Q | **Sandboxed container runners** | spinning up / logging runner containers | — | `docker-mcp` |
| R | **Cross-session knowledge graph** | persisting entities/relations/facts beyond `memory.md` | — | `memory` |
| S | **Hard multi-step reasoning** | branching architectural/debug problems | — | `sequential-thinking` |
| T | **Third-party service integrations** | social/publishing pipeline, calendar/meeting/Drive features, any router calling a Google/Microsoft/Zoom API | `google` (Gmail, Calendar, Drive, userinfo), `microsoft` (Graph `/me`, Entra ID), `zoom-oauth` + `zoom-rest-api` (meetings, users, webinars, recordings, reports) | — |
| U | **Microsoft Entra agent identity** | agent OAuth / Blueprint / `fmi_path` token exchange, agent OBO, cross-tenant agent auth | `entra-agent-id` | — |
| V | **Cinematic video / media generation** | `falRouter` (port 8004), OpenMontage video pipeline, trailer/teaser/clip generation | `seedance-2-0` (ByteDance Seedance 2.0 via fal.ai `seedance_video` — multi-shot, native audio, camera control, reference-conditioned) | — |

> [!IMPORTANT]
> **`cloudProcedure` is mandatory** for areas T and V — every Google/Microsoft/Zoom/Seedance call
> hits an external API and must be blocked in Sovereign mode (see `AGENTS.md` → tRPC tiers).

> [!NOTE]
> Skills for stacks Omnecor does **not** use — ClickHouse (`clickhouse-js-node-*`, `sql-expert`,
> `sql-generator`), Cloudflare D1 / Neon Drizzle variants (`drizzle-orm-d1`, `d1-drizzle-schema`,
> `neon-drizzle`), `wallet-apis`, `arcgis-authentication`, `openiddict-authorization` — are
> intentionally **not** assigned to any area. Do not load them: Omnecor standardizes on
> libSQL/SQLite (see §2) and the auth/integration stack in areas H, T, U, V.

---

## 🧠 6. Core Service Integration APIs (ChromaDB, Honcho, Voice)

### 6.1 ChromaDB Semantic Vector Store (`VectorDBService`)
ChromaDB handles project knowledge base embeddings and semantic query retrieval.
*   **Access Pattern:** Access the singleton service via the tRPC context container (`ctx.services.vectorDB`).
*   **Ingesting Documents:**
    ```typescript
    await ctx.services.vectorDB.addDocuments("omnecor_proj_123", [
      { id: "file_hash_1", text: "File code content...", metadata: { path: "/src/index.ts" } }
    ]);
    ```
*   **Semantic Query Search:**
    ```typescript
    const results = await ctx.services.vectorDB.semanticSearch(
      "omnecor_proj_123", 
      "auth query handler", 
      5 // Result limit
    );
    ```

### 6.2 Honcho AI Memory Layer (`honchoService`)
Honcho stores persistent session memory and facts to inject into system prompts.
*   **Access Pattern:** Import the direct service instance:
    ```typescript
    import { honchoService } from "../phase2/services/HonchoService.js";
    ```
*   **Operations:**
    *   `addMessage(openId, sessionId, role, content)`: Appends messages to the memory session.
    *   `addFact(openId, content)`: Saves persistent `/btw` facts.
    *   `getFacts(openId, limit)`: Resolves list of facts to load into chat contexts.

### 6.3 Voice & Audio Synthesis (`VoiceService`)
Orchestrates audio pipelines (Whisper, Kokoro, XTTS-v2, and RVC).
*   **Access Pattern:** Access via `ctx.services.voice`.
*   **Sub-Operations:**
    *   `transcribe(filePath)`: Returns transcript string using Whisper (port 8001).
    *   `synthesize(text, profile)`: Generates synthesized audio using Kokoro/XTTS-v2 (port 8002).
    *   `convertVoice(inputPath, modelName)`: Morph synthesized audio using RVC models (port 8003).

