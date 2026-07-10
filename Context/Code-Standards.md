# Omnecor — Code Standards & Conventions

This document defines the strict coding guidelines, safety practices, and design patterns required for all development in the Omnecor V1-Beta repository. All code (Frontend, Backend, and Shared) must conform to these conventions to ensure safety, performance, and structure.

---

## 🎨 1. Frontend Standards (React 19 & TypeScript)

The client is a React 19 Single Page Application located under `/client/src/`.

### 1.1 Components & Exports
*   **Named Exports Only:** Do not use default exports for components. Export components as named functions:
    ```typescript
    // Correct
    export function ModelSelector({ activeId, onSelect }: Props) { ... }
    
    // Incorrect
    export default function ModelSelector() { ... }
    ```
*   **Props Typing:** Explicitly define an interface for props. Never use `any` or implicit typing:
    ```typescript
    interface Props {
      activeId: string;
      onSelect: (id: string) => void;
      disabled?: boolean;
    }
    ```
*   **UI Primitives:** Leverage standard Radix UI / Shadcn wrappers located under [components/ui/](file:///home/linux/Documents/OmnecorV1-Beta/client/src/components/ui/) (e.g., Button, Dialog, Select). Do not duplicate components.

### 1.2 State Management & Fetching
*   **Global State:** Use Zustand. Store files must be placed in [app.store.ts](file:///home/linux/Documents/OmnecorV1-Beta/client/src/lib/store/app.store.ts). Use Zustand only for transient shell state (e.g. sidebar open state, active notifications, active connection status).
*   **Query State:** Use tRPC + TanStack Query for all server data fetching.
    ```typescript
    // Correct query fetching
    const { data: health, isLoading } = trpc.system.health.useQuery();
    ```
*   **Local UI State:** Keep state as close to the leaf components as possible. Do not hoist state to global stores unnecessarily.

### 1.3 Routing & Error Boundaries
*   **Lazy Loading:** All page components in [App.tsx](file:///home/linux/Documents/OmnecorV1-Beta/client/src/App.tsx) must be loaded lazily using `React.lazy()` to reduce initial bundle weights.
*   **Error Isolation:** Wrap all lazy routes in `RouteBoundary` using the `withBoundary()` helper in [App.tsx](file:///home/linux/Documents/OmnecorV1-Beta/client/src/App.tsx) to isolate crashes and prevent them from bringing down the entire application.

---

## ⚙️ 2. Backend Standards (Node/Express & tRPC)

The backend is a single Node.js process exposing tRPC procedures, managed in [server/routers.ts](file:///home/linux/Documents/OmnecorV1-Beta/server/routers.ts).

### 2.1 Procedure Selection Rules
You must use the correct tRPC procedure tier defined in [trpc.ts](file:///home/linux/Documents/OmnecorV1-Beta/server/_core/trpc.ts):

*   `publicProcedure`: Use **only** for unauthenticated bootstrap features (e.g., initial system health verification, Setup Wizard credentials configuration).
*   `protectedProcedure`: Use for standard user actions. Automatically resolves session context and records a secure transaction footprint in `AuditLogService`.
*   `cloudProcedure`: **Mandatory** for any operation that invokes an external API (e.g. OpenAI, Anthropic, Fal rendering, RunPod compute). This automatically enforces air-gapped sandboxing when the user is configured in `sovereign` execution mode.
*   `adminProcedure` / `ownerProcedure`: Restrict to operations altering configuration tables, rotating mesh credentials, or deleting logs.

### 2.2 Singleton Services Pattern
*   All backend logic systems must run as managed singletons inside `/server/phase2/services/` (e.g., `ProcessManagerService`, `AiProviderService`, `VectorDBService`).
*   **Access via Context:** Access these services using the `ctx.services` context container in tRPC procedures instead of calling class static imports directly.
    ```typescript
    // Correct
    const result = await ctx.services.aiProvider.chat(input);
    
    // Incorrect
    const result = await AiProviderService.getInstance().chat(input);
    ```

### 2.3 Native Module Lazy-Loading
*   **Graceful Degradation:** Native C++ extensions (e.g., `node-pty`, `canvas`, `sqlite3` depending on bindings) must be lazy-loaded at runtime. This prevents the entire server from crashing during bootstrap if the native bindings fail to compile on a specific host environment.
    ```typescript
    // Correct: Lazy load native module
    let ptyModule: typeof import("node-pty") | null = null;
    async function getPty() {
      if (!ptyModule) {
        try { ptyModule = await import("node-pty"); } catch { ptyModule = null; }
      }
      return ptyModule;
    }
    ```

---

## 🗄️ 3. Database Standards (Drizzle ORM & libSQL)

The database utilizes the libSQL / SQLite engine configured in [schema.ts](file:///home/linux/Documents/OmnecorV1-Beta/drizzle/schema.ts).

### 3.1 SQLite Core Mapping Rules
Drizzle enums, timestamps, and JSON data must utilize standard SQLite mapping types:
*   **Enums:** Represent as `text({ enum: [...] })`.
*   **Timestamps:** Represent as `integer({ mode: "timestamp" })` to ensure automatic conversion to JavaScript `Date` objects.
*   **JSON:** Represent as `text({ mode: "json" })`.

### 3.2 Upsert & Return Blocks
*   **Upserts:** You must use SQLite-compatible `.onConflictDoUpdate(...)` syntax:
    ```typescript
    await db.insert(users)
      .values(payload)
      .onConflictDoUpdate({
        target: users.openId,
        set: { lastSignedIn: new Date() }
      });
    ```
*   **ID Retrieval:** Always return IDs using the `.returning({ id: users.id })` block. Do not rely on implicit return behaviors.
*   **MySQL Legacy Pattern Ban:** Never use `(result as any)[0]?.insertId` or parse row indices directly. This MySQL-only pattern fails under SQLite/libSQL, returning `id: 0`. Always refactor legacy instances to Drizzle `.returning()` arrays.


---

## 🔒 4. Security & Safety Standards

### 4.1 Safe Subprocess Execution (Prevention of RCE)
*   **Never use `child_process.exec`** with string interpolation templates to execute command shell statements. This is a severe Remote Code Execution (RCE) vulnerability.
*   **Mandatory Spawn:** Always use `child_process.spawn` or helpers passing arguments as a safe string array:
    ```typescript
    // Correct: Safe spawn argument array
    const child = spawn("xdg-open", [sanitizedPath]);
    
    // Incorrect: Vulnerable string interpolation shell execution
    exec(`xdg-open "${targetDir}"`); 
    ```

### 4.2 Path Safety
*   **Path Validation:** All user-supplied filesystem parameters must be passed through the `validatePath` security wrapper.
*   **No Hardcoded Paths:** Do not hardcode absolute paths. Centralize path management configurations under [paths.ts](file:///home/linux/Documents/OmnecorV1-Beta/server/_core/paths.ts).

### 4.3 Input Validation
*   **Zod Schema Enforcement:** Every query or mutation on the backend must utilize Zod schema verification for parameters:
    ```typescript
    .input(z.object({
      projectId: z.string().uuid(),
      content: z.string().max(4096),
    }))
    ```

### 4.4 Credentials Security & Storage
*   **Frontend / Web:** Never store plaintext credentials, API keys, or OMMESH secret tokens in `localStorage`, `sessionStorage`, or plain frontend state.
*   **Mobile (React Native):** Plaintext storage of sensitive API keys or OMMESH secret tokens in `@react-native-async-storage/async-storage` is explicitly forbidden.
*   **Expo SecureStore:** Always encrypt credentials on mobile using Expo's `SecureStore` (which leverages Android KeyStore/iOS Keychain).

---

## 🚫 5. Separation of Concerns (The Golden Rules)

To maintain a clean codebase, the following separation rules are absolute:

1.  **React Component Isolation:** Frontend views and hooks must *never* reference database models, call `getDb()`, or write direct database queries. Data operations belong exclusively on the backend.
2.  **Headless API Isolation:** Backend tRPC routers, service classes, and Python microservices must *never* import React DOM elements, couple to styling hooks, or run client UI code.
3.  **No Silent Mutations:** Any database transaction altering state must yield a return payload or broadcast a real-time event via the WebSocket Pub/Sub network to synchronize views.
