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
import { homedir, cpus as osCpus, totalmem, freemem } from "os";
import { execFile } from "child_process";
import { createHash, timingSafeEqual } from "crypto";
import { parse as parseCookieHeader } from "cookie";
import { ENV } from "../../_core/env.js";
import { sdk } from "../../_core/sdk.js";
import { COOKIE_NAME } from "../../../shared/const.js";
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
import { NotificationService } from "../../_core/NotificationService.js";
import type { OmnecorNotification } from "../../../shared/notifications.js";

// Lazy-load node-pty so the server starts even if the native binding isn't built
let ptyModule: typeof import("node-pty") | null = null;
async function getPty() {
  if (!ptyModule) {
    try { ptyModule = await import("node-pty"); } catch { ptyModule = null; }
  }
  return ptyModule;
}
import { SERVER_CONFIG } from "../config/index.js";
import { createLogger } from "../../_core/logger.js";
const log = createLogger("WebSocket");

/** True when a remote address is a loopback (localhost) peer. */
function isLoopbackAddress(addr: string | undefined): boolean {
  if (!addr) return false;
  // Normalise IPv4-mapped IPv6 (e.g. "::ffff:127.0.0.1") and bare forms.
  const a = addr.replace(/^::ffff:/, "");
  return a === "127.0.0.1" || a === "::1" || a === "localhost" || a.startsWith("127.");
}

/**
 * Constant-time comparison of two secrets. Both sides are SHA-256 hashed first
 * so the buffers are always equal length (timingSafeEqual throws on length
 * mismatch) and the comparison never leaks the secret's length.
 */
function secretsMatch(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** WebSocket message from client to server */
interface ClientMessage {
  type: "subscribe" | "unsubscribe" | "ping" | "getState" | "pty:spawn" | "pty:input" | "pty:resize" | "pty:kill" | "chat:toTerminal" | "mobile_node_register" | "mobile_node_heartbeat" | "mobile_inference_response";
  channel?: string;
  data?: any;
  // mobile node registration fields (sent at top level, not nested in data)
  nodeId?: string;
  nodeName?: string;
  capabilities?: { modelLoaded: boolean; modelPath?: string; contextLength?: number };
  ommeshSecret?: string;
  stats?: { totalRequests: number; totalTokens: number; tokensPerSecond: number };
  modelLoaded?: boolean;
  requestId?: string;
  token?: string;
  done?: boolean;
  error?: string;
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
    | "actionPending"
    | "notification"
    | "pty:output"
    | "pty:ready"
    | "pty:exit"
    | "terminal:toChatOutput"
    | "systemMetrics";
  channel?: string;
  data?: any;
  timestamp?: string;
}

/** Active PTY session keyed by clientId */
interface PtySession {
  proc: import("node-pty").IPty;
  sessionId: string;
}

/** Extended WebSocket with metadata */
interface OmnecorSocket extends WebSocket {
  id: string;
  subscriptions: Set<string>;
  isAlive: boolean;
  connectedAt: string;
  ptySession?: PtySession;
  mobileNodeId?: string;
  /**
   * Whether the connection is authenticated. Set at upgrade time from the
   * session cookie (or loopback/zero-login). Unauthenticated connections may
   * ONLY send `mobile_node_register` and must complete it successfully before
   * any other message type or channel subscription is processed.
   */
  authenticated: boolean;
  /** Remote address captured at connection time (for loopback checks). */
  remoteAddress?: string;
}

/** Registered mobile OMMESH node info */
interface MobileNodeInfo {
  ws: OmnecorSocket;
  nodeId: string;
  nodeName: string;
  capabilities: { modelLoaded: boolean; modelPath?: string; contextLength?: number };
  lastSeen: number;
  stats: { totalRequests: number; totalTokens: number; tokensPerSecond: number };
}

/** Pending inference keyed by requestId */
interface PendingInference {
  nodeId: string;
  onToken: (token: string, done: boolean) => void;
  reject: (err: Error) => void;
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
  private mobileNodes: Map<string, MobileNodeInfo> = new Map();
  private pendingInferences: Map<string, PendingInference> = new Map();
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private telemetryInterval: ReturnType<typeof setInterval> | null = null;
  private prevCpuTimes: ReturnType<typeof osCpus> | null = null;
  private gpuCache: { usedGb: number; totalGb: number; percent: number; name: string } | null = null;
  private gpuCacheExpiry = 0;
  private fileWatcher: FileSystemWatcherService;
  private processManager: ProcessManagerService;
  private hashTracker: HashTrackerService;
  private voiceService: VoiceService;
  private hitlService: HITLApprovalService;
  private agentService: AgentService;
  private notificationService: NotificationService;

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
    this.notificationService = NotificationService.getInstance();

    // Wire up connection handling
    this.wss.on("connection", (ws, req) => {
      this.handleConnection(ws as OmnecorSocket, req).catch(err => {
        log.error("Error handling WebSocket connection", err);
        try { (ws as OmnecorSocket).close(1011, "Internal error"); } catch { /* ignore */ }
      });
    });

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
  private async handleConnection(ws: OmnecorSocket, req: IncomingMessage): Promise<void> {
    // Assign metadata to the socket
    ws.id = uuidv4();
    ws.subscriptions = new Set();
    ws.isAlive = true;
    ws.connectedAt = new Date().toISOString();
    ws.remoteAddress = req.socket.remoteAddress ?? undefined;

    // ── Connection authentication ────────────────────────────────────────────
    // Verify the session cookie (browser SPA) at upgrade time. Connections are
    // marked authenticated when: ZERO_LOGIN_MODE is on, the peer is loopback, or
    // a valid session cookie is present. Otherwise the connection is allowed
    // ONLY so the mobile APK can authenticate via mobile_node_register — but
    // only when OMMESH_SECRET is configured; such connections are marked
    // unauthenticated and may send nothing but mobile_node_register until it
    // succeeds.
    ws.authenticated = await this.resolveAuth(req);
    if (!ws.authenticated && !process.env.OMMESH_SECRET) {
      // No session, not loopback/zero-login, and no mesh secret to authenticate
      // a mobile node against — reject (fail-closed).
      try {
        ws.send(JSON.stringify({ type: "error", data: { message: "Unauthorized: no valid session and OMMESH_SECRET not configured" } }));
      } catch { /* ignore */ }
      ws.close(4401, "Unauthorized");
      log.warn("WebSocket connection rejected — unauthenticated and no OMMESH_SECRET", { id: ws.id, ip: ws.remoteAddress });
      return;
    }

    this.clients.set(ws.id, ws);

    log.info("Client connected", { id: ws.id, ip: req.socket.remoteAddress, authenticated: ws.authenticated, total: this.clients.size });

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
      this.killPtySession(ws);
      if (ws.mobileNodeId) {
        this.removeMobileNode(ws.mobileNodeId);
      }
      this.clients.delete(ws.id);
      log.info("Client disconnected", { id: ws.id, total: this.clients.size });
    });

    // Handle errors
    ws.on("error", err => {
      console.error(`[Omnecor WS] Client error: id="${ws.id}"`, err.message);
      this.clients.delete(ws.id);
    });
  }

  /**
   * Resolve whether an upgrade request is authenticated. True when zero-login
   * mode is enabled, the peer is loopback, or a valid session token is
   * presented via the session cookie (browser SPA), an
   * `Authorization: Bearer` header, or a `?token=` query parameter (the mobile
   * APK uses the latter two — React Native WebSockets don't reliably attach
   * cookies on every platform). Mirrors the session verification used by the
   * tRPC context.
   */
  private async resolveAuth(req: IncomingMessage): Promise<boolean> {
    if (ENV.zeroLoginMode) return true;
    if (isLoopbackAddress(req.socket.remoteAddress ?? undefined)) return true;

    const candidates: string[] = [];

    try {
      const cookieHeader = req.headers.cookie;
      if (cookieHeader) {
        const sessionCookie = parseCookieHeader(cookieHeader)[COOKIE_NAME];
        if (sessionCookie) candidates.push(sessionCookie);
      }

      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith("Bearer ")) {
        candidates.push(authHeader.slice("Bearer ".length));
      }

      const url = new URL(req.url ?? "/", "http://localhost");
      const queryToken = url.searchParams.get("token");
      if (queryToken) candidates.push(queryToken);

      for (const token of candidates) {
        const session = await sdk.verifySession(token);
        if (session != null) return true;
      }
    } catch {
      /* fall through to unauthenticated */
    }
    return false;
  }

  /** Process a message from a client */
  private handleClientMessage(ws: OmnecorSocket, message: ClientMessage): void {
    // Unauthenticated connections (LAN mobile nodes that have not yet completed
    // registration) may ONLY send mobile_node_register. Everything else —
    // subscriptions, PTY, getState, etc. — is refused until the connection is
    // authenticated by a successful registration.
    if (!ws.authenticated && message.type !== "mobile_node_register") {
      this.sendToClient(ws, {
        type: "error",
        data: { message: "Unauthorized: complete mobile_node_register before sending other messages" },
      });
      return;
    }

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

      // ── PTY Shell Sessions ────────────────────────────────────────────────
      case "pty:spawn":
        this.handlePtySpawn(ws, message.data).catch(err =>
          this.sendToClient(ws, { type: "error", data: { message: String(err) } })
        );
        break;

      case "pty:input":
        if (ws.ptySession && message.data?.input !== undefined) {
          ws.ptySession.proc.write(message.data.input as string);
        }
        break;

      case "pty:resize":
        if (ws.ptySession && message.data) {
          const { cols, rows } = message.data as { cols: number; rows: number };
          ws.ptySession.proc.resize(cols, rows);
        }
        break;

      case "pty:kill":
        this.killPtySession(ws);
        break;

      // ── Chat ↔ Terminal Bridge ────────────────────────────────────────────
      case "chat:toTerminal":
        // AI/chat sends a command to this client's PTY
        if (ws.ptySession && message.data?.input) {
          ws.ptySession.proc.write((message.data.input as string) + "\r");
        }
        break;

      // ── Mobile OMMESH Node Registration ──────────────────────────────────
      case "mobile_node_register": {
        const secret = process.env.OMMESH_SECRET;
        // Loopback and zero-login connections are already trusted (set at
        // upgrade); everything else MUST present a matching OMMESH_SECRET.
        const preTrusted = isLoopbackAddress(ws.remoteAddress) || ENV.zeroLoginMode;
        if (secret) {
          // Constant-time comparison; rejects when the secret is missing too.
          if (!message.ommeshSecret || !secretsMatch(message.ommeshSecret, secret)) {
            ws.send(JSON.stringify({ type: "mobile_node_ack", accepted: false, reason: "Invalid OMMESH_SECRET" }));
            log.warn("Mobile node rejected — bad secret", { id: ws.id });
            break;
          }
        } else if (!preTrusted) {
          // Fail-closed: no secret configured and the node is not loopback /
          // zero-login → reject rather than accept open registration.
          ws.send(JSON.stringify({ type: "mobile_node_ack", accepted: false, reason: "OMMESH_SECRET is not configured on the server — remote node registration is disabled" }));
          log.warn("Mobile node rejected — OMMESH_SECRET not set and node is not loopback/zero-login", { id: ws.id, ip: ws.remoteAddress });
          break;
        }

        const nodeId = message.nodeId;
        if (!nodeId) {
          ws.send(JSON.stringify({ type: "mobile_node_ack", accepted: false, reason: "Missing nodeId" }));
          break;
        }

        // Registration succeeded — the connection is now authenticated and may
        // send other message types.
        ws.authenticated = true;
        ws.mobileNodeId = nodeId;
        this.mobileNodes.set(nodeId, {
          ws,
          nodeId,
          nodeName: message.nodeName ?? nodeId,
          capabilities: message.capabilities ?? { modelLoaded: false },
          lastSeen: Date.now(),
          stats: { totalRequests: 0, totalTokens: 0, tokensPerSecond: 0 },
        });

        ws.send(JSON.stringify({ type: "mobile_node_ack", accepted: true }));
        log.info("Mobile OMMESH node registered", { nodeId, nodeName: message.nodeName, capabilities: message.capabilities });
        break;
      }

      // ── Mobile Node Heartbeat ─────────────────────────────────────────────
      case "mobile_node_heartbeat": {
        const nodeId = message.nodeId;
        if (!nodeId) break;
        const node = this.mobileNodes.get(nodeId);
        if (!node) break;
        node.lastSeen = Date.now();
        if (message.stats) node.stats = message.stats;
        if (typeof message.modelLoaded === "boolean") node.capabilities.modelLoaded = message.modelLoaded;
        break;
      }

      // ── Mobile Inference Response (streaming token) ───────────────────────
      case "mobile_inference_response": {
        const { requestId, token, done, error } = message;
        if (!requestId) break;
        const pending = this.pendingInferences.get(requestId);
        if (!pending) break;
        if (error) {
          this.pendingInferences.delete(requestId);
          pending.reject(new Error(error));
          break;
        }
        pending.onToken(token ?? "", done ?? false);
        if (done) {
          this.pendingInferences.delete(requestId);
        }
        break;
      }

      default:
        this.sendToClient(ws, {
          type: "error",
          data: { message: `Unknown message type: ${message.type}` },
        });
    }
  }

  private async handlePtySpawn(ws: OmnecorSocket, data: any): Promise<void> {
    const pty = await getPty();
    if (!pty) {
      this.sendToClient(ws, { type: "error", data: { message: "PTY (node-pty) native binding not available on this server." } });
      return;
    }

    // Kill any existing session first
    this.killPtySession(ws);

    const shell = (data?.shell as string) || process.env.SHELL || (process.platform === "win32" ? "powershell.exe" : "bash");
    const cwd = (data?.cwd as string) || homedir();
    const cols = (data?.cols as number) || 80;
    const rows = (data?.rows as number) || 24;
    const sessionId = uuidv4();

    const proc = pty.spawn(shell, [], {
      name: "xterm-256color",
      cols,
      rows,
      cwd,
      env: { ...process.env as Record<string, string>, TERM: "xterm-256color", COLORTERM: "truecolor" },
    });

    ws.ptySession = { proc, sessionId };

    proc.onData(data => {
      if (ws.readyState === WebSocket.OPEN) {
        this.sendToClient(ws, { type: "pty:output", data: { output: data, sessionId } });
      }
    });

    proc.onExit(({ exitCode, signal }) => {
      if (ws.readyState === WebSocket.OPEN) {
        this.sendToClient(ws, { type: "pty:exit", data: { exitCode, signal, sessionId } });
      }
      ws.ptySession = undefined;
    });

    this.sendToClient(ws, { type: "pty:ready", data: { sessionId, shell, cwd } });
  }

  private killPtySession(ws: OmnecorSocket): void {
    if (ws.ptySession) {
      try { ws.ptySession.proc.kill(); } catch {}
      ws.ptySession = undefined;
    }
  }

  /** Remove a mobile node and fail all its pending inferences */
  private removeMobileNode(nodeId: string): void {
    this.mobileNodes.delete(nodeId);
    log.info("Mobile OMMESH node removed", { nodeId });

    // Reject all pending inferences that were routed to the disconnecting node
    for (const [requestId, pending] of this.pendingInferences) {
      if (pending.nodeId === nodeId) {
        pending.reject(new Error("Mobile node disconnected"));
        this.pendingInferences.delete(requestId);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Service Event Wiring
  // -------------------------------------------------------------------------

  /** Wire up all backend service events to WebSocket broadcasts */
  private wireServiceEvents(): void {
    // --- Unified Notifications → "notifications" channel ---
    // Any notification raised anywhere in the process is pushed to every client
    // subscribed to the Notifications feed (main GUI + Android APK).
    this.notificationService.on("notification", (notification: OmnecorNotification) => {
      this.broadcastToChannel("notifications", {
        type: "notification",
        channel: "notifications",
        data: notification,
        timestamp: notification.createdAt,
      });
    });

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
      // Task completion / failure → notification feed.
      const state = event.state;
      if (state === "completed" || state === "failed") {
        const label = event.label || event.type || "Background task";
        this.notificationService.notify({
          kind: "task",
          title: state === "completed" ? "Task completed" : "Task failed",
          body:
            state === "completed"
              ? `${label} finished successfully.`
              : `${label} failed${event.error ? `: ${event.error}` : "."}`,
          data: { jobId: event.jobId, type: event.type, state },
        });
      }

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

      // Surface as a notification so the user is alerted even when off the HITL view.
      this.notificationService.notify({
        kind: "hitl",
        title: "Approval needed",
        body: `${event?.toolName ?? "An agent action"} is waiting for your approval.`,
        href: "/notifications",
        data: { actionId: event?.id },
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
    const origin = info.origin || info.req.headers.origin || "";

    // No Origin header (e.g. native/non-browser clients) — allow.
    if (!origin) {
      return true;
    }

    // Electron desktop app: frontend loads via app://omnecor/ (custom privileged
    // scheme). Treat it as a trusted local origin.
    if (origin.startsWith("app://omnecor")) {
      return true;
    }

    // Parse the Origin and validate the hostname by *exact* match. Substring
    // checks like origin.includes("localhost") are bypassable via hostnames
    // such as "attacker.com-localhost.evil.com".
    let hostname: string;
    try {
      hostname = new URL(origin).hostname;
    } catch {
      return false;
    }

    const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);
    if (LOCAL_HOSTNAMES.has(hostname)) {
      return true;
    }

    // Check against configured CORS origins by exact origin match.
    return SERVER_CONFIG.corsOrigins.some(allowed => {
      try {
        return new URL(allowed).origin === new URL(origin).origin;
      } catch {
        return allowed === origin;
      }
    });
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // Mobile OMMESH Node Public API
  // -------------------------------------------------------------------------

  /** Returns all currently registered mobile OMMESH nodes */
  getMobileNodes(): MobileNodeInfo[] {
    return Array.from(this.mobileNodes.values());
  }

  /** Returns true if at least one mobile node has a model loaded */
  hasMobileWorker(): boolean {
    for (const node of this.mobileNodes.values()) {
      if (node.capabilities.modelLoaded) return true;
    }
    return false;
  }

  /**
   * Route an inference request to the first available mobile worker.
   * Resolves with the full response string when the mobile node finishes.
   * Optional `onToken` receives streaming tokens as they arrive.
   */
  routeInferenceToMobile(
    prompt: string,
    opts?: { maxTokens?: number; onToken?: (t: string, done: boolean) => void },
  ): Promise<string> {
    // Find first node with a model loaded
    let target: MobileNodeInfo | undefined;
    for (const node of this.mobileNodes.values()) {
      if (node.capabilities.modelLoaded) {
        target = node;
        break;
      }
    }

    if (!target) {
      return Promise.reject(new Error("No mobile worker available"));
    }

    const requestId = crypto.randomUUID();
    const node = target;

    return new Promise<string>((resolve, reject) => {
      let accumulated = "";

      const onToken = (token: string, done: boolean): void => {
        accumulated += token;
        opts?.onToken?.(token, done);
        if (done) {
          resolve(accumulated);
        }
      };

      this.pendingInferences.set(requestId, { nodeId: node.nodeId, onToken, reject });

      // Send inference request to the mobile node
      const msg = JSON.stringify({
        type: "mobile_inference_request",
        requestId,
        prompt,
        ...(opts?.maxTokens !== undefined ? { maxTokens: opts.maxTokens } : {}),
      });
      node.ws.send(msg);

      // 120-second timeout
      const timer = setTimeout(() => {
        if (this.pendingInferences.has(requestId)) {
          this.pendingInferences.delete(requestId);
          reject(new Error("Mobile inference timed out after 120 seconds"));
        }
      }, 120_000);

      // Clear timeout if promise settles
      const originalResolve = resolve;
      const originalReject = reject;
      void originalResolve; void originalReject; // already captured via closure above
      // Attach cleanup to the promise chain externally is tricky; instead we
      // clear inside onToken (done path) and the reject path above by deleting
      // from pendingInferences. Clear the timer when the entry is gone.
      const clearTimer = (): void => clearTimeout(timer);
      // Wrap to ensure timer cleanup regardless of resolution path
      const entry = this.pendingInferences.get(requestId)!;
      const originalOnToken = entry.onToken;
      const originalEntryReject = entry.reject;
      entry.onToken = (t: string, d: boolean): void => { originalOnToken(t, d); if (d) clearTimer(); };
      entry.reject = (err: Error): void => { clearTimer(); originalEntryReject(err); };
    });
  }

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

  /** Start pushing system metrics (CPU / RAM / GPU) to the system:metrics channel every 2 s */
  startTelemetryPush(): void {
    this.prevCpuTimes = osCpus();
    this.telemetryInterval = setInterval(() => {
      const cpu = this.calcCpuPercent();
      const ram = this.calcRamMetrics();
      const payload: Record<string, unknown> = { cpu, ram };
      const now = Date.now();
      if (this.gpuCache && now < this.gpuCacheExpiry) {
        payload.gpu = this.gpuCache;
        this.broadcastToChannel("system:metrics", { type: "systemMetrics", data: payload });
      } else {
        this.fetchGpuMetrics().then(gpu => {
          this.gpuCache = gpu;
          this.gpuCacheExpiry = Date.now() + 5000;
          payload.gpu = gpu;
          this.broadcastToChannel("system:metrics", { type: "systemMetrics", data: payload });
        }).catch(() => {
          this.broadcastToChannel("system:metrics", { type: "systemMetrics", data: payload });
        });
      }
    }, 2000);
  }

  private calcCpuPercent(): number {
    const current = osCpus();
    if (!this.prevCpuTimes || this.prevCpuTimes.length !== current.length) {
      this.prevCpuTimes = current;
      return 0;
    }
    let totalIdle = 0;
    let totalTick = 0;
    for (let i = 0; i < current.length; i++) {
      const prev = this.prevCpuTimes[i].times;
      const cur = current[i].times;
      const idle = cur.idle - prev.idle;
      const total = (cur.user - prev.user) + (cur.nice - prev.nice) +
                    (cur.sys - prev.sys) + idle + (cur.irq - prev.irq);
      totalIdle += idle;
      totalTick += total;
    }
    this.prevCpuTimes = current;
    return totalTick > 0 ? Math.round((1 - totalIdle / totalTick) * 100) : 0;
  }

  private calcRamMetrics(): { usedGb: number; totalGb: number; percent: number } {
    const total = totalmem();
    const free = freemem();
    const used = total - free;
    return {
      usedGb: Math.round((used / 1e9) * 10) / 10,
      totalGb: Math.round((total / 1e9) * 10) / 10,
      percent: Math.round((used / total) * 100),
    };
  }

  private fetchGpuMetrics(): Promise<{ usedGb: number; totalGb: number; percent: number; name: string } | null> {
    return new Promise(resolve => {
      execFile(
        "nvidia-smi",
        ["--query-gpu=name,memory.used,memory.total", "--format=csv,noheader,nounits"],
        { timeout: 3000 },
        (err, stdout) => {
          if (err || !stdout.trim()) { resolve(null); return; }
          const parts = stdout.trim().split(",").map(s => s.trim());
          if (parts.length < 3) { resolve(null); return; }
          const name = parts[0];
          const usedMb = parseFloat(parts[1]);
          const totalMb = parseFloat(parts[2]);
          if (isNaN(usedMb) || isNaN(totalMb) || totalMb === 0) { resolve(null); return; }
          resolve({
            name,
            usedGb: Math.round((usedMb / 1024) * 10) / 10,
            totalGb: Math.round((totalMb / 1024) * 10) / 10,
            percent: Math.round((usedMb / totalMb) * 100),
          });
        },
      );
    });
  }

  /** Gracefully shut down the WebSocket server */
  async shutdown(): Promise<void> {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    if (this.telemetryInterval) {
      clearInterval(this.telemetryInterval);
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
