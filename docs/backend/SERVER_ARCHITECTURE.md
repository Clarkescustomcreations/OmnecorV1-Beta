# Omnecor Backend Server Architecture

Omnecor's backend is a unified, Express.js-based server that acts as the central hub for all application logic, data management, and AI orchestration. This document details its architecture, key components, and how it interacts with other parts of the system.

## 1. Unified Server Design

The Omnecor backend consolidates various functionalities into a single Express server, eliminating the need for separate microservices for core operations. This design choice simplifies deployment, reduces operational overhead, and ensures tight integration between the frontend, internal services, and external AI/hardware integrations.

```mermaid
graph TD
    A[Client (Frontend)] -->|HTTP/WS| B(Express Server)
    B --> C(Middleware)
    B --> D(tRPC Routers)
    B --> E(WebSocket Server)
    D --> F(Internal Services)
    E --> F
    F --> G(Database)
    F --> H(File System)
    F --> I(OMMESH Network)
    F --> J(Process Manager Service)
    J --> K(Python Bridges)
    K --> L(External Tools/Hardware)
    F --> M(AI Model Hub)
    M --> N(Local AI Models)
    M --> O(Cloud AI APIs)
```

## 2. Core Components

### 2.1. Express.js Application (`server/_core/index.ts`)

This is the main entry point for the Omnecor backend. It initializes the Express application, configures middleware, sets up API routes, and manages the lifecycle of various services.

-   **Initialization**: Bootstraps the server, including the tRPC API, WebSocket server, and static file serving.
-   **Port Discovery**: Automatically finds an available port if the default (3000) is in use.
-   **Health Check**: Provides a `/health` endpoint for monitoring server status.
-   **Graceful Shutdown**: Handles `SIGINT` and `SIGTERM` signals to ensure a clean shutdown, terminating child processes and closing WebSocket connections.

### 2.2. Middleware

Express middleware is used to process requests before they reach the route handlers. Key middleware includes:

-   **Rate Limiting**: Implemented using `express-rate-limit` to protect against abuse and ensure server stability.
-   **Body Parsers**: `express.json()` and `express.urlencoded()` are configured with increased limits (e.g., `50mb`) to support large file uploads.
-   **Security Middleware**: Includes measures for CSRF protection and path traversal prevention, handled by the `SecurityService`.

### 2.3. tRPC API (`server/routers/`)

Omnecor utilizes tRPC for its API layer, providing end-to-end type safety between the frontend and backend. All tRPC endpoints are accessible under the `/api/trpc/` path.

-   **`appRouter`**: The root tRPC router that aggregates all sub-routers.
-   **Sub-Routers**: Organized by domain (e.g., `aiRouter.ts`, `projectRouter.ts`, `securityRouter.ts`, `blenderRouter.ts`, `kicadRouter.ts`, `ommesh.router.ts`, `voiceRouter.ts`). These define the API procedures for specific functionalities.
-   **`createContext`**: A factory function that creates the tRPC context for each request, providing access to singleton services and other request-scoped data.

### 2.4. WebSocket Server (`server/phase2/websocket/WebSocketServer.ts`)

Integrated into the same HTTP server as the Express application, the WebSocket server (`/ws`) enables real-time, bi-directional communication.

-   **Real-time Updates**: Used for broadcasting updates related to Neural Node-Tree changes, AI training progress, hardware job statuses, and chat messages.
-   **Event-Driven**: Services can emit events that are then broadcast to connected clients, ensuring the UI remains synchronized with backend processes.

### 2.5. Internal Services (`server/phase2/services/`)

These are singleton classes that encapsulate specific business logic and resource management. They are initialized at server startup and made available through the tRPC context.

-   **`SecurityService`**: Manages cryptographic operations, user authentication, and authorization.
-   **`VectorDBService`**: Handles semantic indexing and retrieval for the knowledge base (ChromaDB).
-   **`ProcessManagerService`**: Orchestrates and monitors external child processes, particularly for Python bridges.
-   **`MeshDiscoveryService`**: Part of OMMESH, responsible for discovering and managing other Omnecor nodes.
-   **`AiProviderService`**: Manages connections and routing to various local and cloud AI models.
-   **`FileSystemWatcherService`**: Monitors specified directories for changes.
-   **`MemoryArchitectService`**: Manages AI context and memory layers.
-   **`HITLApprovalService`**: Handles Human-In-The-Loop approval workflows.
-   **`HashTrackerService`**: Tracks content hashes for data integrity.

### 2.6. OMMESH Node (`server/ommesh/core/MeshNode.ts`)

The `MeshNode` is the core component of the OMMESH distributed mesh intelligence layer. It enables an Omnecor instance to participate in a network of other Omnecor nodes.

-   **Node Discovery**: Utilizes Bonjour for local network service discovery.
-   **Secure Communication**: Employs mTLS for secure, authenticated communication between nodes.
-   **Distributed Task Routing**: Facilitates the routing of AI inference requests and other tasks across the mesh based on resource availability.

### 2.7. Python Bridges (`server/python_bridges/`)

These are Python scripts that act as interfaces to specialized external tools and hardware. They are invoked and managed by the `ProcessManagerService`.

-   **`blender_bridge.py`**: Integrates with Blender for 3D tasks.
-   **`kicad_bridge.py`**: Integrates with KiCad for PCB design.
-   **`esptool_bridge.py`**: Interfaces with ESPTool for firmware flashing.
-   **`fal_bridge.py`**: Connects to Fal.ai services.
-   **`rvc_server.py`**: Handles Real-time Voice Cloning (RVC) services.

## 3. Data Persistence

-   **Database**: Omnecor uses Drizzle ORM for interacting with a MySQL/TiDB database. The database schema is defined in `drizzle/schema.ts` and managed through migrations.
-   **File System**: Local storage is extensively used for project files, AI model weights, configurations (`.env`), and log files. The `FileSystemWatcherService` monitors relevant directories.

## 4. Authentication and Authorization

-   **OAuth**: The backend includes routes for OAuth integration (`registerOAuthRoutes`), allowing for secure third-party authentication.
-   **Security Service**: The `SecurityService` is responsible for managing user sessions, permissions, and ensuring secure access to resources. It handles cryptographic operations and enforces security policies.
