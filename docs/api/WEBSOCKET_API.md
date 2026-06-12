# Omnecor WebSocket API Documentation

Omnecor leverages WebSockets for real-time, bi-directional communication between the frontend and backend. This enables dynamic updates, live progress tracking, and interactive experiences that are crucial for an AI workstation. This document outlines the WebSocket API, its purpose, and common message formats.

## 1. Overview

The WebSocket server is integrated into the main Express HTTP server and is accessible at the `/ws` endpoint. It allows for efficient, low-latency communication, especially for events that require immediate propagation to the client without constant polling.

### 1.1. Key Use Cases

-   **Neural Node-Tree Updates**: Real-time synchronization of changes within the Neural Brain Map.
-   **AI Training Progress**: Live updates on the status and progress of AI model training jobs.
-   **Hardware Job Status**: Streaming status updates from long-running hardware integration tasks (e.g., Blender renders, ESPTool flashes).
-   **Chat Messages**: Real-time delivery of AI responses and user inputs in the chat interface.
-   **System Notifications**: Broadcasting general system events or alerts.

## 2. Connection

Clients connect to the WebSocket server at the `/ws` endpoint of the Omnecor instance. For example, if Omnecor is running on `http://localhost:3000`, the WebSocket endpoint would be `ws://localhost:3000/ws`.

### 2.1. Authentication

The upgrade request must carry a valid session credential, supplied one of three ways:

1. **Session cookie** — the browser SPA sends it automatically.
2. **`Authorization: Bearer <token>` header** — for clients that can set upgrade headers.
3. **`?token=<session-token>` query parameter** — used by the mobile APK, whose React Native WebSockets don't reliably attach cookies (`ws://<pc-ip>:3000/ws?token=...`).

Connections are also accepted without a credential when the peer is loopback (127.0.0.1/::1) or `ZERO_LOGIN_MODE` is enabled. Otherwise, an unauthenticated connection is only permitted when `OMMESH_SECRET` is configured, and it may send **only** a `mobile_node_register` message (authenticated by the shared secret, compared in constant time) — every other message type and channel subscription is refused until registration succeeds. Unauthenticated connections with no `OMMESH_SECRET` configured are closed with code `4401`.

```typescript
const socket = new WebSocket("ws://localhost:3000/ws");

socket.onopen = () => {
  console.log("WebSocket connection established.");
};

socket.onmessage = (event) => {
  const message = JSON.parse(event.data);
  console.log("Received message:", message);
  // Handle different message types
};

socket.onclose = () => {
  console.log("WebSocket connection closed.");
};

socket.onerror = (error) => {
  console.error("WebSocket error:", error);
};
```

## 3. Message Format

All messages exchanged over the WebSocket connection are JSON objects. While specific message structures vary by event type, they generally follow a common pattern, including a `type` field to identify the event and a `payload` field containing the relevant data.

```json
{
  "type": "<EVENT_TYPE>",
  "payload": { /* event-specific data */ }
}
```

## 4. Common Event Types

### 4.1. `neuralMapUpdate`

-   **Description**: Sent when there are changes to the Neural Brain Map (e.g., node creation, deletion, property updates, edge changes).
-   **Payload Example**:

    ```json
    {
      "type": "neuralMapUpdate",
      "payload": {
        "nodes": [
          { "id": "node-1", "data": { "label": "New Node" }, "position": { "x": 100, "y": 50 } }
        ],
        "edges": [
          { "id": "edge-1", "source": "node-1", "target": "node-2" }
        ]
      }
    }
    ```

### 4.2. `trainingProgress`

-   **Description**: Provides real-time updates on the progress of an AI model training job.
-   **Payload Example**:

    ```json
    {
      "type": "trainingProgress",
      "payload": {
        "jobId": "train-123",
        "epoch": 5,
        "totalEpochs": 10,
        "loss": 0.123,
        "accuracy": 0.98,
        "status": "in_progress"
      }
    }
    ```

### 4.3. `hardwareJobStatus`

-   **Description**: Streams status updates from hardware integration tasks (e.g., Blender rendering, ESPTool flashing).
-   **Payload Example**:

    ```json
    {
      "type": "hardwareJobStatus",
      "payload": {
        "jobId": "blender-render-456",
        "progress": 75,
        "message": "Rendering frame 150/200",
        "status": "running"
      }
    }
    ```

### 4.4. `chatMessage`

-   **Description**: Delivers new chat messages or AI responses in real-time.
-   **Payload Example**:

    ```json
    {
      "type": "chatMessage",
      "payload": {
        "sessionId": "chat-abc",
        "messageId": "msg-xyz",
        "role": "assistant",
        "content": "Hello! How can I assist you today?",
        "timestamp": "2026-05-30T12:34:56Z"
      }
    }
    ```

### 4.5. `systemNotification`

-   **Description**: General system notifications or alerts.
-   **Payload Example**:

    ```json
    {
      "type": "systemNotification",
      "payload": {
        "level": "info",
        "message": "New Omnecor update available!",
        "timestamp": "2026-05-30T12:35:00Z"
      }
    }
    ```

### 4.6. `budget:spend`

-   **Description**: Emitted by `WalletService` immediately after each AI API call completes and a `spend_log` entry is written. Allows the UI to update spend meters in real-time without polling.
-   **Payload Example**:

    ```json
    {
      "type": "budget:spend",
      "payload": {
        "projectId": "proj-123",
        "provider": "anthropic",
        "modelId": "claude-sonnet-4-6",
        "promptTokens": 1024,
        "completionTokens": 256,
        "estimatedCostMicrocents": 34500,
        "budgetUsedPercent": 42,
        "budgetStatus": "ok"
      }
    }
    ```

    `budgetStatus` values: `"ok"` | `"alert"` (threshold reached) | `"hard_limit"` (budget exhausted, cloud calls blocked, auto-downgrade to Ollama active).

### 4.7. `security:injection_attempt`

-   **Description**: Emitted by `PromptSanitizer` (inside `SecurityService`) when a prompt injection pattern is detected and blocked. Delivered only to sessions with `role = 'admin'` or `role = 'owner'`.
-   **Payload Example**:

    ```json
    {
      "type": "security:injection_attempt",
      "payload": {
        "sessionId": "chat-abc",
        "threatLevel": "high",
        "pattern": "ignore_previous_instructions",
        "blockedContent": "[REDACTED]",
        "timestamp": "2026-06-01T10:22:11Z"
      }
    }
    ```

### 4.8. `mesh:node_joined`

-   **Description**: Emitted when a new OMMESH node is discovered on the LAN via mDNS. Allows the UI to update the mesh topology view in real-time.
-   **Payload Example**:

    ```json
    {
      "type": "mesh:node_joined",
      "payload": {
        "nodeId": "omnecor-workstation-b",
        "host": "192.168.1.42",
        "port": 7777,
        "vram": 24576,
        "modelsAvailable": ["llama3:70b", "mistral:7b"],
        "timestamp": "2026-06-01T09:15:00Z"
      }
    }
    ```

### 4.9. `mesh:node_left`

-   **Description**: Emitted when an OMMESH node becomes unreachable (mDNS goodbye packet or missed heartbeat). The node is removed from the active routing pool.
-   **Payload Example**:

    ```json
    {
      "type": "mesh:node_left",
      "payload": {
        "nodeId": "omnecor-workstation-b",
        "reason": "heartbeat_timeout",
        "timestamp": "2026-06-01T11:30:00Z"
      }
    }
    ```

### 4.10. `training:<jobId>`

-   **Description**: Emitted by the Valet Router during local model training (LoRA fine-tuning). Carries real-time progress metrics including epoch, step, and loss for dataset generation and training phases.
-   **Payload Example**:

    ```json
    {
      "type": "training:job-abc-123",
      "payload": {
        "jobId": "job-abc-123",
        "phase": "dataset",
        "step": 450,
        "totalSteps": 1000,
        "loss": 0.245,
        "eta": "2m 30s",
        "status": "in_progress"
      }
    }
    ```

    During the training phase (LoRA fine-tuning), the payload may include:

    ```json
    {
      "type": "training:job-abc-123",
      "payload": {
        "jobId": "job-abc-123",
        "phase": "training",
        "epoch": 2,
        "totalEpochs": 3,
        "step": 150,
        "totalSteps": 300,
        "loss": 0.112,
        "status": "in_progress"
      }
    }
    ```

## 5. Client-Side Handling

The frontend uses the `useOmnecorSocket.ts` hook (`client/src/hooks/`) to manage the WebSocket connection and dispatch incoming messages to the appropriate state managers (e.g., Zustand stores, React Contexts). This ensures that the UI is always up-to-date with the latest backend events.

## 6. Security

While WebSockets provide real-time communication, security is handled at the HTTP layer during the initial connection handshake and through backend services. Sensitive data transmitted over WebSockets should be encrypted where necessary, and access control is enforced by the `SecurityService`.
