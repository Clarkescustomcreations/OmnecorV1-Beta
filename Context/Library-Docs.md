# Omnecor — Library & Tool Integration Guide

This document defines how to utilize the library dependencies, database drivers, browser automation utilities, and Model Context Protocol (MCP) servers within the Omnecor V1-Beta environment.

---

## 🔌 1. Model Context Protocol (MCP) Standards

Omnecor leverages active Model Context Protocol (MCP) servers to offload complex system, database, and browser interactions to secure, standardized interfaces. 

> [!IMPORTANT]
> **AI DIRECTIVE:** Before creating custom Python scripts, installing NPM scrapers, or executing raw shell commands for a task, you **must** check if a corresponding MCP server is configured and use its tools.

The active MCP directory is located at `/home/linux/AI/mcp-servers/`. The configured tools include:

*   **`puppeteer`**: Use this for **all** browser automation, scraping, web searches, and rendering tasks. Do not install playwright/puppeteer NPM modules.
*   **`sqlite`**: Use this to read, inspect, or backup the local SQLite database.
*   **`filesystem`**: Use this to read, write, or list project directory trees.
*   **`docker-mcp`**: Use this to control sandboxed runner containers.
*   **`git` / `github`**: Use for checking repository states and commits.

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
| **React** | `^19.2.1` | `^18.2.0` | `19.1.0` | 🔴 **React Version Mismatch.** Electron uses React 18; root and mobile use React 19. |
| **Tailwind CSS** | `^4.1.14` | `^4.1.14` | `^3.4.17` | 🟡 **Styling Drift.** Web & Electron utilize Tailwind CSS v4. Mobile utilizes Tailwind CSS v3 + NativeWind v4 (which does not support OKLCH variables). |
| **tRPC Client** | `^11.8.0` | *N/A* | `11.17.0` | 🔴 **Version Drift.** Mobile uses tRPC v11.17.0 while backend is on v11.8.0. |

### 4.1 Dependency Action Plan
*   **Align Electron React:** Upgrade [package.json (Electron)](file:///home/linux/Documents/OmnecorV1-Beta/packaging/electron-app/package.json) to React `^19.2.1` to match the root project.
*   **Align tRPC Client:** Downgrade the Android app tRPC dependencies to `11.8.0` to eliminate schema-definition mismatch logs.
*   **Color Token Fallbacks:** While mobile is on Tailwind v3, ensure colors mapped in [theme.config.js](file:///home/linux/Documents/OmnecorV1-Beta/packaging/android/omnecor-hq/theme.config.js) use solid hex colors that mimic the OKLCH values defined in [Globals.css](file:///home/linux/Documents/OmnecorV1-Beta/client/src/Globals.css).

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

