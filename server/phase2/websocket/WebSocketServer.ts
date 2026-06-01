/**
 * @file websocket/WebSocketServer.ts
 * @description Omnecor — WebSocket Server for Real-Time State Synchronization
 *
 * Provides bidirectional real-time communication between the backend and
 * the Neural Node-Tree UI. This server handles:
 *
 *  - File system events → Neural Node-Tree graph updates
 *  - Training progress → Live training dashboard
 *  - Hardware job progress → Flash/render status panels
 *  - Loop detection alerts → Agent monitoring UI
 *
 * Architecture Notes:
 *  - Uses the `ws` library for WebSocket server implementation
 *  - Supports channel-based subscriptions (clients subscribe to specific topics)
 *  - Channels include: "files:{projectId}", "training:{jobId}", "hardware:{jobId}"
 *  - Messages follow a typed protocol with JSON payloads
 *  - Heartbeat mechanism detects and cleans up dead connections
 *  - Integrates with FileSystemWatcherService and ProcessManagerService events
 *
 * Protocol:
 *  Client → Server:
 *    { type: "subscribe", channel: "files:proj_abc" }
 *    { type: "unsubscribe", channel: "files:proj_abc" }
 *    { type: "ping" }
 *
 *  Server → Client:
 *    { type: "fileEvent", channel: "files:proj_abc", data: { ... } }
 *    { type: "trainingProgress", channel: "training:job_xyz", data: { ... } }
 *    { type: "lifecycle", channel: "training:job_xyz", data: { ... } }
 *    { type: "pong" }
 *    { type: "error", message: "..." }
 */

import { WebSocketServer as WSServer, WebSocket } from "ws";
import { IncomingMessage, Server as HttpServer } from "http";
import { v4 as uuidv4 } from "uuid";
import {
  FileSystemWatcherService,
  FileEvent,
} from "../services/FileSystemWatcherService.js";
import {
  ProcessManagerService,
  ProcessProgressEvent,
  ProcessLifecycleEvent,
} from "../services/ProcessManagerService.js";
import { HashTrackerService } from "../services/HashTrackerService.js";
import { VoiceService, VoiceEventData } from "../services/VoiceService.js";
import { HITLApprovalService } from "../services/HITLApprovalService.js";
import { AgentService } from "../services/AgentService.js";
import { SERVER_CONFIG } from "../config/index.js";
import { createLogger } from "../../_core/logger.js";
const log = createLogger("WebSocket");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** WebSocket message from client to server */
interface ClientMessage {
  type: "subscribe" | "unsubscribe" | "ping" | "getState";
  channel?: string;
  data?: any;
}

/** WebSocket message from server to client */
interface ServerMessage {
  type:
    | "fileEvent"
    | "trainingProgress"
    | "lifecycle"
    | "loopDetected"
    | "pong"
    | "error"
    | "subscribed"
    | "unsubscribed"
    | "state"
    | "actionPending";
  channel?: string;
  data?: any;
  timestamp?: string;
}

/** Extended WebSocket with metadata */
interface OmnecorSocket extends WebSocket {
  id: string;
  subscriptions: Set<string>;
  isAlive: boolean;
  connectedAt: string;
}

// ---------------------------------------------------------------------------
// Server Implementation
// ---------------------------------------------------------------------------

/**
 * OmnecorWebSocketServer — Real-time communication hub for the Neural Node-Tree UI.
 *
 * Bridges backend service events to connected frontend clients using a
 * channel-based pub/sub model.
 *
 * @example
 * ```ts
 * const wsServer = new OmnecorWebSocketServer(httpServer);
 *
 * // Server automatically wires up to FileSystemWatcher and ProcessManager
 * // events and broadcasts them to subscribed clients.
 *
 * // Client-side:
 * // ws.send(JSON.stringify({ type: "subscribe", channel: "files:proj_abc" }))
 * // → receives file events for project "proj_abc"
 * ```
 */
export class OmnecorWebSocketServer {
  private wss: WSServer;
  private clients: Map<string, OmnecorSocket> = new Map();
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private fileWatcher: FileSystemWatcherService;
  private processManager: ProcessManagerService;
  private hashTracker: HashTrackerService;
  private voiceService: VoiceService;
  private hitlService: HITLApprovalService;
  private agentService: AgentService;

  constructor(httpServer: HttpServer) {
    // Create WebSocket server attached to the HTTP server (upgrade path)
    this.wss = new WSServer({
      server: httpServer,
      path: "/ws",
      // Verify origin for security (allow localhost and configured origins)
      verifyClient: (info: any) => this.verifyClient(info),
    });

    // Get service instances
    this.fileWatcher = FileSystemWatcherService.getInstance();
    this.processManager = ProcessManagerService.getInstance();
    this.hashTracker = HashTrackerService.getInstance();
    this.voiceService = VoiceService.getInstance();
    this.hitlService = HITLApprovalService.getInstance();
    this.agentService = AgentService.getInstance();

    // Wire up connection handling
    this.wss.on("connection", (ws, req) =>
      this.handleConnection(ws as OmnecorSocket, req)
    );

    // Wire up service event listeners
    this.wireServiceEvents();

    // Start heartbeat monitoring
    this.startHeartbeat();

    log.info("WebSocket server initialized at /ws");
  }

  // -------------------------------------------------------------------------
  // Connection Management
  // -------------------------------------------------------------------------

  /** Handle a new WebSocket connection */
  private handleConnection(ws: OmnecorSocket, req: IncomingMessage): void {
    // Assign metadata to the socket
    ws.id = uuidv4();
    ws.subscriptions = new Set();
    ws.isAlive = true;
    ws.connectedAt = new Date().toISOString();

    this.clients.set(ws.id, ws);

    log.info("Client connected", { id: ws.id, ip: req.socket.remoteAddress, total: this.clients.size });

    // Handle incoming messages
    ws.on("message", raw => {
      try {
        const message: ClientMessage = JSON.parse(raw.toString());
        this.handleClientMessage(ws, message);
      } catch (error) {
        this.sendToClient(ws, {
          type: "error",
          data: { message: "Invalid JSON message" },
        });
      }
    });

    // Handle pong responses for heartbeat
    ws.on("pong", () => {
      ws.isAlive = true;
    });

    // Handle disconnection
    ws.on("close", () => {
      this.clients.delete(ws.id);
      log.info("Client disconnected", { id: ws.id, total: this.clients.size });
    });

    // Handle errors
    ws.on("error", err => {
      console.error(`[Omnecor WS] Client error: id="${ws.id}"`, err.message);
      this.clients.delete(ws.id);
    });
  }

  /** Process a message from a client */
  private handleClientMessage(ws: OmnecorSocket, message: ClientMessage): void {
    switch (message.type) {
      case "subscribe":
        if (message.channel) {
          ws.subscriptions.add(message.channel);
          this.sendToClient(ws, {
            type: "subscribed",
            channel: message.channel,
            data: { subscribedChannels: Array.from(ws.subscriptions) },
          });
        }
        break;

      case "unsubscribe":
        if (message.channel) {
          ws.subscriptions.delete(message.channel);
          this.sendToClient(ws, {
            type: "unsubscribed",
            channel: message.channel,
          });
        }
        break;

      case "ping":
        this.sendToClient(ws, { type: "pong" });
        break;

      case "getState":
        // Return current state for the requested channel
        this.sendCurrentState(ws, message.channel);
        break;

      default:
        this.sendToClient(ws, {
          type: "error",
          data: { message: `Unknown message type: ${message.type}` },
        });
    }
  }

  // -------------------------------------------------------------------------
  // Service Event Wiring
  // -------------------------------------------------------------------------

  /** Wire up all backend service events to WebSocket broadcasts */
  private wireServiceEvents(): void {
    // --- File System Events → Neural Node-Tree UI ---
    this.fileWatcher.on("fileEvent", (event: FileEvent) => {
      const channel = `files:${event.projectId}`;
      this.broadcastToChannel(channel, {
        type: "fileEvent",
        channel,
        data: event,
        timestamp: event.timestamp,
      });
    });

    // --- Training Progress Events ---
    this.processManager.on("progress", (event: ProcessProgressEvent) => {
      // Route progress to the correct channel based on process type
      if (event.type === "blender" || event.type === "esp_flash") {
        // Hardware jobs → hardware:{jobId} channel
        const hwChannel = `hardware:${event.jobId}`;
        this.broadcastToChannel(hwChannel, {
          type: "trainingProgress", // reuse type for consistency; frontend filters by channel
          channel: hwChannel,
          data: event,
          timestamp: event.timestamp,
        });

        // Also broadcast to "hardware:all" for the global hardware dashboard
        this.broadcastToChannel("hardware:all", {
          type: "trainingProgress",
          channel: "hardware:all",
          data: event,
          timestamp: event.timestamp,
        });
      } else {
        // Training jobs → training:{jobId} channel
        const channel = `training:${event.jobId}`;
        this.broadcastToChannel(channel, {
          type: "trainingProgress",
          channel,
          data: event,
          timestamp: event.timestamp,
        });

        // Also broadcast to the general "training:all" channel for dashboard
        this.broadcastToChannel("training:all", {
          type: "trainingProgress",
          channel: "training:all",
          data: event,
          timestamp: event.timestamp,
        });
      }
    });

    // --- Process Lifecycle Events ---
    this.processManager.on("lifecycle", (event: ProcessLifecycleEvent) => {
      if (event.type === "blender" || event.type === "esp_flash") {
        // Hardware lifecycle → hardware:{jobId} + hardware:all
        const hwChannel = `hardware:${event.jobId}`;
        this.broadcastToChannel(hwChannel, {
          type: "lifecycle",
          channel: hwChannel,
          data: event,
          timestamp: event.timestamp,
        });

        this.broadcastToChannel("hardware:all", {
          type: "lifecycle",
          channel: "hardware:all",
          data: event,
          timestamp: event.timestamp,
        });
      } else {
        // Training lifecycle → training:{jobId} + training:all
        const channel = `training:${event.jobId}`;
        this.broadcastToChannel(channel, {
          type: "lifecycle",
          channel,
          data: event,
          timestamp: event.timestamp,
        });

        this.broadcastToChannel("training:all", {
          type: "lifecycle",
          channel: "training:all",
          data: event,
          timestamp: event.timestamp,
        });
      }

      // Always broadcast lifecycle to hardware:all for global monitoring
      // (training jobs may also be of interest to the global dashboard)
      if (event.type !== "blender" && event.type !== "esp_flash") {
        this.broadcastToChannel("hardware:all", {
          type: "lifecycle",
          channel: "hardware:all",
          data: event,
          timestamp: event.timestamp,
        });
      }
    });

    // --- Loop Detection Alerts ---
    this.hashTracker.on("loopDetected", (event: any) => {
      this.broadcastToChannel("agent:loops", {
        type: "loopDetected",
        channel: "agent:loops",
        data: event,
        timestamp: event.timestamp,
      });
    });

    // --- Voice Service Events ---
    this.voiceService.on("progress", (event: VoiceEventData) => {
      const channel = `voice:${event.jobId}`;
      this.broadcastToChannel(channel, {
        type: "trainingProgress", // Reuse for simplicity or use new type
        channel,
        data: event,
        timestamp: event.timestamp,
      });
      this.broadcastToChannel("voice:all", {
        type: "trainingProgress",
        channel: "voice:all",
        data: event,
        timestamp: event.timestamp,
      });
    });

    this.voiceService.on("lifecycle", (event: VoiceEventData) => {
      const channel = `voice:${event.jobId}`;
      this.broadcastToChannel(channel, {
        type: "lifecycle",
        channel,
        data: event,
        timestamp: event.timestamp,
      });
      this.broadcastToChannel("voice:all", {
        type: "lifecycle",
        channel: "voice:all",
        data: event,
        timestamp: event.timestamp,
      });
    });

    // --- HITL Service Events ---
    this.hitlService.on("actionPending", (event: any) => {
      this.broadcastToChannel("hitl:pending", {
        type: "actionPending",
        channel: "hitl:pending",
        data: event,
        timestamp: event.timestamp,
      });
    });

    // --- Security: Injection Attempt Events ---
    this.agentService.on("security:injection_attempt", (data: { procedure: string; violations: string[] }) => {
      log.warn("Injection attempt broadcast to security:alerts", data);
      this.broadcastToChannel("security:alerts", {
        type: "loopDetected", // reuse closest existing type; channel disambiguates
        channel: "security:alerts",
        data: { event: "injection_attempt", ...data },
        timestamp: new Date().toISOString(),
      });
    });
  }

  // -------------------------------------------------------------------------
  // Broadcasting
  // -------------------------------------------------------------------------

  /** Broadcast a message to all clients subscribed to a specific channel */
  private broadcastToChannel(channel: string, message: ServerMessage): void {
    const payload = JSON.stringify(message);

    for (const client of this.clients.values()) {
      if (
        client.subscriptions.has(channel) &&
        client.readyState === WebSocket.OPEN
      ) {
        client.send(payload);
      }
    }
  }

  /** Broadcast a message to ALL connected clients (for system-wide events) */
  public broadcastAll(messageOrType: ServerMessage | string, data?: unknown): void {
    let payload: string;
    if (typeof messageOrType === "string") {
      payload = JSON.stringify({ type: messageOrType, data, timestamp: new Date().toISOString() });
    } else {
      payload = JSON.stringify(messageOrType);
    }

    for (const client of this.clients.values()) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  /** Send a message to a specific client */
  private sendToClient(ws: OmnecorSocket, message: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  /** Send current state for a channel (used for initial sync) */
  private sendCurrentState(ws: OmnecorSocket, channel?: string): void {
    if (!channel) return;

    // For file channels, send the current file tree
    if (channel.startsWith("files:")) {
      const projectId = channel.replace("files:", "");
      this.fileWatcher
        .getFileTree(projectId)
        .then(files => {
          this.sendToClient(ws, {
            type: "state",
            channel,
            data: { projectId, files, count: files.length },
          });
        })
        .catch(() => {
          this.sendToClient(ws, {
            type: "error",
            data: {
              message: `No watcher registered for project: ${projectId}`,
            },
          });
        });
    }

    // For training channels, send current job status
    if (channel.startsWith("training:") && channel !== "training:all") {
      const jobId = channel.replace("training:", "");
      const status = this.processManager.getJobStatus(jobId);
      this.sendToClient(ws, {
        type: "state",
        channel,
        data: status || { error: "Job not found" },
      });
    }
  }

  // -------------------------------------------------------------------------
  // Heartbeat & Cleanup
  // -------------------------------------------------------------------------

  /** Start periodic heartbeat to detect dead connections */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      for (const [id, client] of this.clients) {
        if (!client.isAlive) {
          // Client didn't respond to last ping — terminate
          client.terminate();
          this.clients.delete(id);
          continue;
        }

        client.isAlive = false;
        client.ping();
      }
    }, 30000); // Check every 30 seconds
  }

  // -------------------------------------------------------------------------
  // Client Verification
  // -------------------------------------------------------------------------

  /** Verify WebSocket connection origin */
  private verifyClient(info: {
    origin: string;
    secure: boolean;
    req: IncomingMessage;
  }): boolean {
    // In development/local mode, allow all connections
    const origin = info.origin || info.req.headers.origin || "";

    // Allow localhost connections
    if (
      !origin ||
      origin.includes("localhost") ||
      origin.includes("127.0.0.1")
    ) {
      return true;
    }

    // Check against configured CORS origins
    return SERVER_CONFIG.corsOrigins.some(allowed =>
      origin.startsWith(allowed)
    );
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Get the number of connected clients */
  get clientCount(): number {
    return this.clients.size;
  }

  /** Get connection statistics */
  getStats(): {
    connectedClients: number;
    channels: Record<string, number>;
  } {
    const channels: Record<string, number> = {};

    for (const client of this.clients.values()) {
      for (const channel of client.subscriptions) {
        channels[channel] = (channels[channel] || 0) + 1;
      }
    }

    return {
      connectedClients: this.clients.size,
      channels,
    };
  }

  /** Gracefully shut down the WebSocket server */
  async shutdown(): Promise<void> {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    // Close all client connections
    for (const client of this.clients.values()) {
      client.close(1001, "Server shutting down");
    }
    this.clients.clear();

    // Close the server
    return new Promise(resolve => {
      this.wss.close(() => {
        log.info("WebSocket server shut down");
        resolve();
      });
    });
  }
}

// ---------------------------------------------------------------------------
// Module-level singleton reference — set by the server bootstrap
// ---------------------------------------------------------------------------

let _wsInstance: OmnecorWebSocketServer | null = null;

/** Called once from server bootstrap after construction. */
export function setWsInstance(instance: OmnecorWebSocketServer): void {
  _wsInstance = instance;
}

/** Returns the WebSocket server instance, or null if not yet initialized. */
export function getWsInstance(): OmnecorWebSocketServer | null {
  return _wsInstance;
}
