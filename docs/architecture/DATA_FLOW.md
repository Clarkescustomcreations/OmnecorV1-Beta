# Omnecor Data Flow

Understanding the data flow within Omnecor is crucial for comprehending how its various components interact to deliver a unified AI workstation experience. This document outlines the primary paths and transformations of data as it moves through the system.

## 1. Overview of Data Paths

Data in Omnecor primarily flows between the Frontend, Backend, various internal Services, AI Models (both local and cloud-based), and the OMMESH network. Real-time updates and asynchronous operations are facilitated by WebSockets and dedicated service interactions.

```mermaid
graph LR
    A[User Interaction] --> B(Frontend UI)
    B -->|tRPC Requests| C(Backend Server)
    B -->|WebSocket Messages| C
    C -->|Service Calls| D(Internal Services)
    D -->|Database Operations| E(Drizzle ORM/Database)
    D -->|File System Access| F(Local Storage)
    D -->|AI Model Inference Requests| G(AI Model Hub)
    G -->|Local Models (Ollama, Llama.cpp)| F
    G -->|Cloud APIs| H(External AI Services)
    D -->|Hardware Bridge Commands| I(ProcessManagerService)
    I -->|Python Bridges| J(External Tools/Hardware)
    D -->|OMMESH Communication| K(OMMESH Network)
    K -->|Node Discovery/Routing| L(Other Omnecor Nodes)
    C -->|WebSocket Broadcasts| B
    D -->|Log/Diagnostic Output| F
```

## 2. Detailed Data Flow by Component

### 2.1. User Interaction to Frontend

-   **Input**: Users interact with the Omnecor UI through keyboard, mouse, and voice commands.
-   **Processing**: The React frontend captures these interactions, managing local UI state and preparing data for backend communication.
-   **Output**: Visual updates on the screen, and structured data sent to the backend via tRPC or WebSockets.

### 2.2. Frontend to Backend Communication

-   **tRPC Requests**: For synchronous data operations (e.g., fetching project details, saving configurations, initiating tasks), the frontend sends type-safe tRPC requests to the `/api/trpc` endpoint. These requests carry structured data (e.g., JSON payloads).
-   **WebSocket Messages**: For real-time updates (e.g., chat messages, Neural Node-Tree changes, training progress, hardware job status), the frontend establishes a WebSocket connection to `/ws`. Messages are typically JSON-formatted events.

### 2.3. Backend Processing and Service Orchestration

-   **Request Handling**: The Express.js server receives incoming tRPC requests and WebSocket messages. tRPC requests are routed to the appropriate backend routers and context factories.
-   **Service Invocation**: Backend routers and services (e.g., `AgentService`, `ProjectService`, `SecurityService`) process the incoming data. This often involves:
    -   **Database Interactions**: Reading from or writing to the Drizzle ORM-managed database (e.g., project metadata, user settings).
    -   **File System Operations**: Accessing local files for project assets, configurations, or storing AI-generated outputs.
    -   **AI Model Orchestration**: The `AiProviderService` routes AI inference requests to the `AI Model Hub`.
    -   **Process Management**: The `ProcessManagerService` spawns and manages child processes for hardware bridges (e.g., Blender, KiCad, ESPTool), streaming their outputs back to the backend.
    -   **OMMESH Interactions**: The `MeshDiscoveryService` and `RoutingEngine` handle communication with other Omnecor nodes for distributed tasks.
-   **Security**: The `SecurityService` applies authentication, authorization, and data encryption as data is processed or stored.

### 2.4. AI Model Data Flow

-   **Inference Requests**: The `AI Model Hub` receives requests from internal services, containing prompts, context, and model parameters.
-   **Local Models**: For local models (e.g., Ollama/Llama.cpp), requests are routed to the local inference server. Input data (e.g., text, embeddings) is processed, and results are returned to the `AI Model Hub`.
-   **Cloud APIs**: For cloud-based models (e.g., OpenAI, Anthropic), requests are sent to external API endpoints. API keys and credentials are securely managed by the `SecurityService`.
-   **Memory Layer**: The `VectorDBService` stores and retrieves embeddings for Retrieval-Augmented Generation (RAG), ensuring AI models have access to relevant context from local documents.
-   **Output**: AI-generated responses (text, images, code) are returned to the calling service or directly to the frontend via WebSockets.

### 2.5. OMMESH Data Flow

-   **Node Discovery**: Omnecor nodes broadcast their presence on the local network using Bonjour. The `MeshDiscoveryService` listens for and registers other nodes.
-   **Secure Communication**: All inter-node communication is secured via mTLS, ensuring data integrity and confidentiality.
-   **Distributed Inference**: When a task requires distributed processing, the `RoutingEngine` determines the optimal node based on available resources (e.g., VRAM) and routes the inference request. Input data is sent to the target node, processed, and results are returned to the originating node.

### 2.6. Backend to Frontend Updates

-   **WebSocket Broadcasts**: After processing, the backend broadcasts real-time updates and results back to connected frontend clients via WebSockets. This includes task progress, chat responses, and changes in the Neural Node-Tree.
-   **tRPC Responses**: Synchronous tRPC requests receive their responses directly, updating the UI state accordingly.

## 3. Data Persistence

-   **Database**: Structured data (e.g., user preferences, project configurations, task queues) is persisted in the database via Drizzle ORM.
-   **File System**: Unstructured data, such as project files, AI model weights, generated media, and log files, are stored directly on the local file system. The `FileSystemWatcherService` monitors changes to these files.
-   **Context Persistence**: The `MemoryArchitectService` and `VectorDBService` ensure that AI context and semantic memory are persistently stored and available across sessions.
