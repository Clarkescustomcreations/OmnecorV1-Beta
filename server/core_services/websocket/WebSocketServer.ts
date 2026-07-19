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
import { secretsMatch } from "../../ommesh/crypto.js";
import { parse as parseCookieHeader } from "cookie";
import { ENV } from "../../_core/env.js";
import { sdk } from "../../_core/sdk.js";
import { CLOUD_PROVIDER_IDS, isSovereignMode } from "../../_core/sovereign.js";
import { applyWSSHandler } from "@trpc/server/adapters/ws";
import { appRouter } from "../../routers.js";
import { createContext } from "../../_core/context.js";
import { bridgeWsAuthToken, type WsAuthRequest } from "./wsAuthBridge.js";
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
import { AsyncJobService } from "../services/AsyncJobService.js";
import type { AsyncJobResultEvent } from "../services/AsyncJobService.js";
import { DelegationService } from "../services/DelegationService.js";
import { NotificationService } from "../../_core/NotificationService.js";
import type { OmnecorNotification } from "../../../shared/notifications.js";
import { meshNode } from "../../ommesh/core/MeshNode.js";
import { AgentMessengerStore } from "../../_core/AgentMessengerStore.js";
import { validatePath } from "../../_core/security.js";
import { PATHS } from "../../_core/paths.js";
import path from "path";
import fsSync from "fs";
import type { PtySpawnData, PtyInputData, PtyResizeData } from "../../../shared/types/terminal.types.js";


// Lazy-load node-pty so the server starts even if the native binding isn't built
let ptyModule: typeof import("node-pty") | null = null;
async function getPty() {
  if (!ptyModule) {
    try { ptyModule = await import("node-pty"); } catch { ptyModule = null; }
  }
  return ptyModule;
}

// Client-supplied `data.shell` must resolve to one of these known shells /
// interactive REPLs (matched by basename, case-insensitively). Without this an
// authorized caller could launch an ARBITRARY binary as the "shell" (e.g. a
// payload dropper). `python3`/`python`/`node` are here because the desktop
// terminal UI legitimately offers them as REPL "shells". Anything not on the
// list falls back to the platform default rather than being honoured verbatim.
const ALLOWED_PTY_SHELLS = new Set([
  "bash", "sh", "zsh", "fish", "dash",
  "powershell.exe", "pwsh.exe", "pwsh", "cmd.exe",
  "python3", "python", "node",
]);
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


function resolveBackend(data: Record<string, unknown>): { providerId: string; modelId: string } {
  const mc = (data?.modelConfig ?? {}) as Record<string, unknown>;
  const backend = typeof mc.backend === "string" ? mc.backend : "ollama";
  switch (backend) {
    case "api":
      return {
        providerId: (mc.apiProviderId as string) || "openai",
        modelId: (mc.apiModelId as string) || "gpt-4o-mini",
      };
    case "ommesh":
      return { providerId: "ommesh", modelId: "phone" };
    case "ollama":
    case "cloud_compute":
    default:
      return {
        providerId: "ollama",
        modelId: (mc.ollamaModel as string) || "llama3.2",
      };
  }
}

function buildSystemPrompt(p: any): string {
  const custom =
    typeof p.data?.agentSystemPrompt === "string" && p.data.agentSystemPrompt.trim()
      ? p.data.agentSystemPrompt.trim()
      : "";
  const base = [
    `You are "${p.name}", an always-on Omnecor agent (type: ${p.type}).`,
    "You are talking to your operator over the Agent Messenger — a direct chat",
    "separate from regular project chats. Keep your replies concise and conversational.",
    "Do NOT output markdown format or bullet points — output plain spoken sentences only.",
    "Since your reply will be read aloud via Text-to-Speech (TTS), avoid special characters.",
  ].join(" ");
  return custom ? `${base}\n\n${custom}` : base;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** WebSocket message from client to server */
interface ClientMessage {
  type:
    | "subscribe"
    | "unsubscribe"
    | "ping"
    | "getState"
    | "pty:spawn"
    | "pty:input"
    | "pty:resize"
    | "pty:kill"
    | "mobile_node_register"
    | "mobile_node_heartbeat"
    | "mobile_inference_response"
    | "voice:audio_input"
    | "voice:interrupt";
  channel?: string;
  data?: any;
  // mobile node registration fields (sent at top level, not nested in data)
  nodeId?: string;
  nodeName?: string;
  capabilities?: { modelLoaded: boolean; modelPath?: string; contextLength?: number };
  // The Omnecor HQ APK sends the shared mesh secret under `secret`; older docs
  // and some callers use `ommeshSecret`. Accept either (see secret check below).
  ommeshSecret?: string;
  secret?: string;
  stats?: { totalRequests: number; totalTokens: number; tokensPerSecond: number; modelLoaded?: boolean };
  modelLoaded?: boolean;
  requestId?: string;
  token?: string;
  /** The Omnecor HQ APK streams inference deltas under `content` (not `token`). */
  content?: string;
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
    | "systemMetrics"
    | "asyncJobResult"
    | "delegationEvent"
    | "voice:audio_chunk"
    | "voice:done";
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
  userId?: number;
  openId?: string;
  /**
   * Whether the connection is authenticated. Set at upgrade time from the
   * session cookie (or loopback/zero-login). Unauthenticated connections may
   * ONLY send `mobile_node_register` and must complete it successfully before
   * any other message type or channel subscription is processed.
   */
  authenticated: boolean;
  /**
   * Effective role of the connection, resolved at auth time. Mirrors the
   * role cap `sdk.authenticateRequest` applies on the HTTP/tRPC path:
   *   - loopback / zero-login → "owner" / "admin" (trusted local operator)
   *   - a session token carrying a `deviceId` (paired phone) → capped to "device"
   *   - a `mobile_node_register` (OMMESH_SECRET) connection → "device"
   * PTY shell spawning is restricted to "admin"/"owner" so a paired device,
   * a mesh node, or a low-privilege user account can never open a host shell —
   * EXCEPT a device the owner has explicitly enabled for terminal (see
   * `deviceId` + `accountRole` and `isPtyAuthorized`).
   */
  role?: "user" | "admin" | "owner" | "device";
  /**
   * The paired device's id, taken from the SERVER-SIGNED session JWT (never a
   * client claim), when this connection authenticated with a device token.
   * Absent for browser/loopback/mesh connections. Keys the per-device terminal
   * opt-in lookup.
   */
  deviceId?: string;
  /**
   * The underlying account's real role BEFORE the device-role cap. A phone
   * paired to the owner has `role: "device"` but `accountRole: "owner"`; used
   * so terminal access can require a privileged owning account.
   */
  accountRole?: "user" | "admin" | "owner";
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
interface ActiveVoiceSession {
  aborted: boolean;
  abortController?: AbortController;
}

export class OmnecorWebSocketServer {
  private wss: WSServer;
  private clients: Map<string, OmnecorSocket> = new Map();
  private mobileNodes: Map<string, MobileNodeInfo> = new Map();
  private pendingInferences: Map<string, PendingInference> = new Map();
  private activeVoiceSessions: Map<string, ActiveVoiceSession> = new Map();
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
    // Use noServer + manual upgrade routing instead of `{ server, path }`. Bound
    // directly to the shared HTTP server, `ws` aborts (HTTP 400) EVERY upgrade
    // whose path isn't "/ws" — including the Vite dev-server HMR client's socket,
    // which then logs "WebSocket closed without opened." on every page load. With
    // noServer we claim only "/ws" and leave all other upgrades for their own
    // listener (the Vite HMR socket in dev). Origin/security is unchanged:
    // `verifyClient` still runs inside `handleUpgrade`.
    this.wss = new WSServer({
      noServer: true,
      // Verify origin for security (allow localhost and configured origins)
      verifyClient: (info: any) => this.verifyClient(info),
    });

    httpServer.on("upgrade", (req, socket, head) => {
      let pathname: string;
      try {
        pathname = new URL(req.url ?? "/", "http://localhost").pathname;
      } catch {
        return; // malformed request-target — leave the socket for other listeners
      }
      if (pathname !== "/ws") return; // e.g. the Vite HMR socket ("/") in dev
      this.wss.handleUpgrade(req, socket, head, (ws) => {
        this.wss.emit("connection", ws, req);
      });
    });

    // Attach tRPC WebSocket handler
    applyWSSHandler({
      wss: this.wss,
      router: appRouter,
      createContext: async (opts) => {
        // Mobile clients (Omnecor HQ APK) authenticate the WebSocket with a
        // `?token=` query parameter — RN WebSockets can't attach the session
        // cookie. Promote it to an Authorization header so the shared auth path
        // (`sdk.authenticateRequest`, cookie/Bearer only) picks it up; otherwise
        // a mobile tRPC subscription connects but resolves no user. See
        // `bridgeWsAuthToken` — guarded so cookie/Bearer callers are untouched.
        bridgeWsAuthToken(opts.req as WsAuthRequest);
        return createContext(opts as any);
      },
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
    ws.authenticated = await this.resolveAuth(req, ws);
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
  private async resolveAuth(req: IncomingMessage, ws: OmnecorSocket): Promise<boolean> {
    const { getUserByOpenId } = await import("../../db.factory.js");
    if (ENV.zeroLoginMode) {
      const user = await getUserByOpenId("local-zero-login");
      if (user) {
        ws.userId = user.id;
        ws.openId = user.openId;
      }
      // Zero-login is a local admin surface.
      ws.role = (user?.role as OmnecorSocket["role"]) ?? "admin";
      return true;
    }
    if (isLoopbackAddress(req.socket.remoteAddress ?? undefined)) {
      const user = await getUserByOpenId("local:owner");
      if (user) {
        ws.userId = user.id;
        ws.openId = user.openId;
      }
      // The loopback peer is the local desktop operator — trusted for PTY.
      ws.role = (user?.role as OmnecorSocket["role"]) ?? "owner";
      return true;
    }

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
        if (session != null) {
          const user = await getUserByOpenId(session.openId);
          if (user) {
            ws.userId = user.id;
            ws.openId = user.openId;
          }
          // Mirror the HTTP/tRPC device-role cap: a token minted for a paired
          // phone carries a `deviceId`, so its effective role is "device"
          // regardless of the owner account's stored role. Otherwise use the
          // account's real role (defaulting to the least-privileged "user").
          const accountRole = (user?.role as OmnecorSocket["accountRole"]) ?? "user";
          ws.accountRole = accountRole;
          if (session.deviceId) {
            ws.role = "device";
            // Verified from the signed JWT — safe to key per-device terminal
            // authorization on it.
            ws.deviceId = session.deviceId;
          } else {
            ws.role = accountRole;
          }
          return true;
        }
      }
    } catch {
      /* fall through to unauthenticated */
    }
    return false;
  }

  /** Process a message from a client */
  private handleClientMessage(ws: OmnecorSocket, message: ClientMessage): void {
    // Ignore tRPC protocol messages (which have method or id) so tRPC's applyWSSHandler can process them
    if ((message as any).method || (message as any).id) {
      return;
    }

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

      case "pty:input": {
        const inputData = message.data as PtyInputData | undefined;
        if (ws.ptySession && inputData?.input !== undefined) {
          ws.ptySession.proc.write(inputData.input);
        }
        break;
      }

      case "pty:resize": {
        const resizeData = message.data as PtyResizeData | undefined;
        if (ws.ptySession && resizeData) {
          ws.ptySession.proc.resize(resizeData.cols, resizeData.rows);
        }
        break;
      }

      case "pty:kill":
        this.killPtySession(ws);
        break;

      // ── Mobile OMMESH Node Registration ──────────────────────────────────
      case "mobile_node_register": {
        const secret = process.env.OMMESH_SECRET;
        // Loopback and zero-login connections are already trusted (set at
        // upgrade); everything else MUST present a matching OMMESH_SECRET.
        const preTrusted = isLoopbackAddress(ws.remoteAddress) || ENV.zeroLoginMode;
        // The APK sends the secret as `secret`; accept `ommeshSecret` too for
        // any caller using the older field name.
        const providedSecret = message.ommeshSecret ?? message.secret;
        if (secret) {
          // Constant-time comparison; rejects when the secret is missing too.
          if (!providedSecret || !secretsMatch(providedSecret, secret)) {
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
        // send other message types. It authenticated purely via OMMESH_SECRET
        // (an inference-node join secret), so its effective role is "device":
        // it must NOT be able to open a host PTY shell. Loopback/zero-login
        // registrations keep the trusted role set at upgrade time.
        ws.authenticated = true;
        if (ws.role !== "owner" && ws.role !== "admin") ws.role = "device";
        ws.mobileNodeId = nodeId;
        
        const defaultOpenId = ENV.zeroLoginMode ? "local-zero-login" : "local:owner";

        this.mobileNodes.set(nodeId, {
          ws,
          nodeId,
          nodeName: message.nodeName ?? nodeId,
          capabilities: message.capabilities ?? { modelLoaded: false },
          lastSeen: Date.now(),
          stats: { totalRequests: 0, totalTokens: 0, tokensPerSecond: 0 },
        });

        // Resolve the owner user, record the device, and hand back a session
        // token in the ack so the phone's HTTP/tRPC calls authenticate too —
        // zero-touch OMMESH auto-pair. Falls back to a plain ack when no owner
        // account exists yet or minting fails (the phone can still pair by code).
        void (async () => {
          try {
            const { getUserByOpenId, getDb } = await import("../../db.factory.js");
            let dbUser = await getUserByOpenId(defaultOpenId);
            if (!dbUser) {
              // No user under the conventional openId — pair against the
              // owner-role account instead (e.g. seeded dev users, renamed
              // installs). A phone paired to nobody can't make tRPC calls.
              const { users } = await import("../../../drizzle/schema.js");
              const { eq } = await import("drizzle-orm");
              const db = await getDb();
              const owners = await db.select().from(users).where(eq(users.role, "owner")).limit(1);
              dbUser = owners[0];
            }
            let sessionToken: string | undefined;
            if (dbUser) {
              ws.userId = dbUser.id;
              ws.openId = dbUser.openId;
              const { PairingService } = await import("../../_core/pairing.js");
              sessionToken = await PairingService.pairViaOmmesh(
                dbUser.openId,
                nodeId,
                message.nodeName ?? nodeId,
              );
            }
            ws.send(JSON.stringify({
              type: "mobile_node_ack",
              accepted: true,
              ...(sessionToken ? { sessionToken } : {}),
            }));
          } catch (err) {
            log.error("OMMESH auto-pair token mint failed", err);
            ws.send(JSON.stringify({ type: "mobile_node_ack", accepted: true }));
          }
        })();
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
        // The APK reports modelLoaded inside stats; accept the top-level field
        // too for older clients. Without this a phone that loads a model AFTER
        // registering never becomes a worker until it reconnects.
        const hb = message.modelLoaded ?? (message.stats as { modelLoaded?: unknown } | undefined)?.modelLoaded;
        if (typeof hb === "boolean") node.capabilities.modelLoaded = hb;
        break;
      }

      // ── Mobile Inference Response (streaming token) ───────────────────────
      case "mobile_inference_response": {
        const { requestId, done, error } = message;
        if (!requestId) break;
        const pending = this.pendingInferences.get(requestId);
        if (!pending) break;
        if (error) {
          this.pendingInferences.delete(requestId);
          pending.reject(new Error(error));
          break;
        }
        // The APK streams the delta in `content`; accept legacy `token` too.
        const token = (message.token ?? message.content) as string | undefined;
        pending.onToken(token ?? "", done ?? false);
        if (done) {
          this.pendingInferences.delete(requestId);
        }
        break;
      }

      // ── Voice Input and Interrupt Handlers ────────────────────────────────
      case "voice:interrupt": {
        const { jobId } = message.data || {};
        if (jobId) {
          const session = this.activeVoiceSessions.get(jobId);
          if (session) {
            session.aborted = true;
            if (session.abortController) {
              session.abortController.abort();
            }
            this.activeVoiceSessions.delete(jobId);
            log.info("Voice session interrupted by client", { jobId });
          }
        }
        break;
      }

      case "voice:audio_input": {
        const { personaId, text, jobId } = message.data || {};
        if (!personaId || !text || !jobId) {
          this.sendToClient(ws, {
            type: "error",
            data: { message: "voice:audio_input missing personaId, text, or jobId" },
          });
          break;
        }

        // Require a resolved authenticated user — never fall back to user 0,
        // which would mix messenger threads and skip the sovereign-mode check.
        if (ws.userId == null) {
          this.sendToClient(ws, {
            type: "error",
            data: { message: "voice:audio_input requires an authenticated session" },
          });
          break;
        }
        const userId = ws.userId;

        const abortController = new AbortController();
        const session: ActiveVoiceSession = { aborted: false, abortController };
        this.activeVoiceSessions.set(jobId, session);

        (async () => {
          try {
            const { getDb } = await import("../../db.factory.js");
            const db = await getDb();
            const { personas, users } = await import("../../../drizzle/schema.js");
            const { eq, and } = await import("drizzle-orm");

            const userRows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
            const user = userRows[0];
            // Scope the persona to the authenticated user — prevents driving
            // another user's persona (IDOR) via a guessed personaId.
            const personaRows = await db
              .select()
              .from(personas)
              .where(and(eq(personas.id, personaId), eq(personas.userId, userId)))
              .limit(1);
            const persona = personaRows[0];

            if (!persona) {
              throw new Error("Persona not found");
            }

            const personaData = persona.data ?? {};
            const backend = resolveBackend(personaData);

            if (isSovereignMode(user?.executionMode) && CLOUD_PROVIDER_IDS.has(backend.providerId)) {
              throw new Error(`Sovereign mode: cloud provider "${backend.providerId}" is disabled. Use a local provider.`);
            }

            if (this.isBusy()) {
              const peers = meshNode.getDiscovery().getPeers();
              if (peers.length > 0) {
                log.info("PC busy — routing inference remotely", { peersCount: peers.length });
                const remoteResult = await meshNode.routeInference(text, {
                  providerId: backend.providerId,
                  modelId: backend.modelId,
                });
                
                if (session.aborted) return;
                
                await this.segmentAndSynthesizeStream(ws, remoteResult.content, persona, jobId, session, userId);
                return;
              } else {
                log.info("PC busy, no remote peers — queueing request up to 60s");

                const busyWarning = "The server is busy. Queueing your request.";
                await this.synthesizeAndSendLocal(ws, busyWarning, 0, jobId, session);

                let waited = 0;
                while (this.isBusy() && waited < 60) {
                  if (session.aborted) return;
                  await new Promise(r => setTimeout(r, 1000));
                  waited++;
                }

                if (this.isBusy()) {
                  const timeoutWarning = "Server busy timeout. Please try again later.";
                  await this.synthesizeAndSendLocal(ws, timeoutWarning, 1, jobId, session);
                  this.sendToClient(ws, {
                    type: "voice:done",
                    channel: `voice:stream:${jobId}`,
                  });
                  return;
                }
              }
            }

            log.info("PC not busy — executing locally", { providerId: backend.providerId });
            const { AiProviderService } = await import("../services/AiProviderService.js");
            const aiProvider = AiProviderService.getInstance();

            const systemPrompt = buildSystemPrompt(persona);
            const store = AgentMessengerStore.getInstance();
            const rawHistory = await store.getMessages(userId, persona.id);
            const history = rawHistory.slice(-10);
            
            const messages = [
              ...history.map(m => ({
                role: m.role === "agent" ? "assistant" as const : "user" as const,
                content: m.content,
              })),
              { role: "user" as const, content: text }
            ];

            await store.append(userId, persona.id, "user", text);

            let bufferedText = "";
            let sentenceIndex = 0;
            const sentenceRegex = /[^.!?\n]+[.!?\n]+/g;
            let fullReply = "";

            const processChunk = async (chunkText: string, isLast = false) => {
              bufferedText += chunkText;
              let match;
              let lastIndex = 0;
              while ((match = sentenceRegex.exec(bufferedText)) !== null) {
                if (session.aborted) return;
                const sentence = match[0].trim();
                if (sentence.length > 0) {
                  await this.synthesizeAndSendLocal(ws, sentence, sentenceIndex++, jobId, session, persona);
                }
                lastIndex = sentenceRegex.lastIndex;
              }
              if (lastIndex > 0) {
                bufferedText = bufferedText.slice(lastIndex);
              }
              if (isLast && bufferedText.trim().length > 0) {
                if (session.aborted) return;
                await this.synthesizeAndSendLocal(ws, bufferedText.trim(), sentenceIndex++, jobId, session, persona);
                bufferedText = "";
              }
            };

            const stream = aiProvider.streamChat({
              providerId: backend.providerId,
              modelId: backend.modelId,
              messages,
              systemPrompt,
            });

            for await (const chunk of stream) {
              if (session.aborted) return;
              fullReply += chunk.delta;
              await processChunk(chunk.delta, false);
            }
            await processChunk("", true);

            if (session.aborted) return;

            await store.append(userId, persona.id, "agent", fullReply);

            this.sendToClient(ws, {
              type: "voice:done",
              channel: `voice:stream:${jobId}`,
            });

          } catch (err) {
            log.error("Error running voice turn", err);
            if (!session.aborted) {
              const errMsg = err instanceof Error ? err.message : String(err);
              try {
                const errorTts = await VoiceService.getInstance().synthesize({
                  text: `Sorry, I encountered an error: ${errMsg}`,
                  speakerWavPath: path.join(PATHS.data, "default.wav"),
                  language: "en",
                });
                this.sendToClient(ws, {
                  type: "voice:audio_chunk",
                  channel: `voice:stream:${jobId}`,
                  data: {
                    chunk: (errorTts.audioBuffer ?? Buffer.alloc(0)).toString("base64"),
                    index: 0,
                  },
                });
              } catch {
                /* ignore */
              }
              this.sendToClient(ws, {
                type: "voice:done",
                channel: `voice:stream:${jobId}`,
              });
            }
          } finally {
            this.activeVoiceSessions.delete(jobId);
          }
        })();
        break;
      }

      default:
        this.sendToClient(ws, {
          type: "error",
          data: { message: `Unknown message type: ${message.type}` },
        });
    }
  }

  private isBusy(): boolean {
    const jobs = this.processManager.getAllJobs();
    const busyTypes = ["lora_training", "blender", "esp_flash"];
    return jobs.some(j => j.state === "running" && busyTypes.includes(j.type));
  }

  private async synthesizeAndSendLocal(
    ws: OmnecorSocket,
    text: string,
    index: number,
    jobId: string,
    session: ActiveVoiceSession,
    persona?: any
  ): Promise<void> {
    const fs = await import("fs/promises");
    const path = await import("path");
    const { PATHS } = await import("../../_core/paths.js");
    const voiceSvc = VoiceService.getInstance();
    
    const defaultWavPath = path.join(PATHS.data, "default.wav");
    
    const ttsRes = await voiceSvc.synthesize({
      text,
      speakerWavPath: defaultWavPath,
      language: "en",
    });
    
    let audioBuffer = ttsRes.audioBuffer ?? Buffer.alloc(0);
    
    const vc = persona?.data?.voiceConfig;
    if (vc && vc.rvcModelPath) {
      try {
        const tempBase = path.join(PATHS.data, "temp");
        await fs.mkdir(tempBase, { recursive: true });
        const tempInPath = path.join(tempBase, `voice_in_${jobId}_${index}.wav`);
        await fs.writeFile(tempInPath, audioBuffer);
        
        const modelPath = await validatePath(vc.rvcModelPath);
        const rvcRes = await voiceSvc.convertVoice({
          audioFilePath: tempInPath,
          modelPath,
          pitchShift: typeof vc.pitchShift === "number" ? vc.pitchShift : 0,
        });
        
        if (rvcRes.success && rvcRes.outputPath) {
          audioBuffer = await fs.readFile(rvcRes.outputPath);
          await fs.unlink(rvcRes.outputPath).catch(() => {});
        }
        await fs.unlink(tempInPath).catch(() => {});
      } catch (rvcErr) {
        log.error("RVC conversion failed, falling back to base TTS", rvcErr);
      }
    }
    
    if (session.aborted) return;

    // Deliver only to the originating socket — never broadcast voice audio on a
    // shared channel (any subscriber could otherwise eavesdrop). The channel
    // field is retained purely for client-side jobId correlation.
    this.sendToClient(ws, {
      type: "voice:audio_chunk",
      channel: `voice:stream:${jobId}`,
      data: {
        chunk: audioBuffer.toString("base64"),
        index,
      },
    });
  }

  private async segmentAndSynthesizeStream(
    ws: OmnecorSocket,
    fullText: string,
    persona: any,
    jobId: string,
    session: ActiveVoiceSession,
    userId: number
  ): Promise<void> {
    const sentenceRegex = /[^.!?\n]+[.!?\n]+/g;
    let match;
    let sentenceIndex = 0;
    
    const store = AgentMessengerStore.getInstance();
    if (userId) {
      await store.append(userId, persona.id, "agent", fullText);
    }
    
    let text = fullText;
    let matchedAny = false;
    while ((match = sentenceRegex.exec(text)) !== null) {
      if (session.aborted) return;
      const sentence = match[0].trim();
      if (sentence.length > 0) {
        matchedAny = true;
        await this.synthesizeAndSendLocal(ws, sentence, sentenceIndex++, jobId, session, persona);
      }
    }

    if (!matchedAny && text.trim().length > 0) {
      if (session.aborted) return;
      await this.synthesizeAndSendLocal(ws, text.trim(), sentenceIndex++, jobId, session, persona);
    }

    this.sendToClient(ws, {
      type: "voice:done",
      channel: `voice:stream:${jobId}`,
    });
  }

  /**
   * Whether this connection may open a host PTY shell.
   *  - Local operator / admin / owner session → yes (trusted desktop operator).
   *  - A paired device → yes ONLY when the owner has explicitly enabled terminal
   *    for THIS device (verified `deviceId` from the signed JWT), the device is
   *    not revoked, and the owning account is admin/owner.
   *  - Everything else (plain "user", mesh `mobile_node_register` connections
   *    which never carry a `deviceId`) → no.
   */
  private async isPtyAuthorized(ws: OmnecorSocket): Promise<boolean> {
    if (ws.role === "admin" || ws.role === "owner") return true;
    if (
      ws.role === "device" &&
      ws.deviceId &&
      (ws.accountRole === "owner" || ws.accountRole === "admin")
    ) {
      try {
        const { PairingService } = await import("../../_core/pairing.js");
        const device = await PairingService.getDevice(ws.deviceId);
        return !!device && device.terminalEnabled === true && device.revokedAt == null;
      } catch (err) {
        log.warn("PTY auth: device lookup failed", { deviceId: ws.deviceId, err: String(err) });
        return false; // fail closed
      }
    }
    return false;
  }

  private async handlePtySpawn(ws: OmnecorSocket, data: PtySpawnData | undefined): Promise<void> {
    // AUTHORIZATION GATE — a PTY is arbitrary command execution on the host, so
    // it is restricted to the trusted local operator (loopback/zero-login),
    // admin/owner accounts, and paired devices the owner has EXPLICITLY enabled
    // for terminal access. A mesh node (OMMESH_SECRET) or a plain "user" account
    // is always refused. See isPtyAuthorized.
    if (!(await this.isPtyAuthorized(ws))) {
      log.warn("PTY spawn refused — not authorized", { id: ws.id, role: ws.role, deviceId: ws.deviceId, ip: ws.remoteAddress });
      this.sendToClient(ws, {
        type: "error",
        data: { message: "Terminal access is not enabled for this device. Enable it from the PC (Settings → Devices)." },
      });
      return;
    }

    const pty = await getPty();
    if (!pty) {
      this.sendToClient(ws, { type: "error", data: { message: "PTY (node-pty) native binding not available on this server." } });
      return;
    }

    // Kill any existing session first
    this.killPtySession(ws);

    // Only honour a client-supplied shell when it is a known interactive shell
    // (matched by basename); otherwise fall back to the platform default so an
    // arbitrary binary can never be launched as the "shell".
    const defaultShell = process.env.SHELL || (process.platform === "win32" ? "powershell.exe" : "bash");
    const requestedShell = typeof data?.shell === "string" ? data.shell.trim() : "";
    const shell =
      requestedShell && ALLOWED_PTY_SHELLS.has(path.basename(requestedShell).toLowerCase())
        ? requestedShell
        : defaultShell;

    // Initial working directory: use the requested one only if it is an existing
    // directory, else the operator's home. (An admin shell is unconstrained once
    // open; this just avoids a spawn failure on a bogus cwd.)
    let cwd = homedir();
    if (typeof data?.cwd === "string" && data.cwd) {
      try {
        if (fsSync.statSync(data.cwd).isDirectory()) cwd = data.cwd;
      } catch { /* fall back to homedir */ }
    }
    const cols = data?.cols || 80;
    const rows = data?.rows || 24;
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

    // --- Async Job Results → agent continuation ---
    // When an agent-launched long job finishes, AsyncJobService condenses the
    // output; we push the compact result to the originating user's channel so
    // the client can inject it as a new conversation turn.
    AsyncJobService.getInstance().on("result", (event: AsyncJobResultEvent) => {
      const ts = new Date().toISOString();
      const userChannel =
        event.context.userId != null
          ? `asyncjob:${event.context.userId}`
          : "asyncjob:all";
      this.broadcastToChannel(userChannel, {
        type: "asyncJobResult",
        channel: userChannel,
        data: event,
        timestamp: ts,
      });
      // Mirror to a global channel for dashboards / multi-tab clients.
      if (userChannel !== "asyncjob:all") {
        this.broadcastToChannel("asyncjob:all", {
          type: "asyncJobResult",
          channel: "asyncjob:all",
          data: event,
          timestamp: ts,
        });
      }
    });

    // --- Mesh delegation lifecycle (Mesh-Delegation.md) ---
    // A managed chat was created / finished a turn / failed / was cancelled.
    // Clients use this to surface the new conversation without a manual
    // refresh (the APK's "appears automatically" requirement) and to refresh
    // list badges. Rides the same channel the async-job pings use, so both
    // web and APK already hold a subscription that receives it.
    DelegationService.getInstance().on("delegation", (event: {
      kind: string;
      userId?: number;
      conversationId: string;
      taskId: string;
      nodeName?: string;
      label?: string;
    }) => {
      const ts = new Date().toISOString();
      const userChannel = event.userId != null ? `asyncjob:${event.userId}` : "asyncjob:all";
      this.broadcastToChannel(userChannel, {
        type: "delegationEvent",
        channel: userChannel,
        data: event,
        timestamp: ts,
      });
      if (userChannel !== "asyncjob:all") {
        this.broadcastToChannel("asyncjob:all", {
          type: "delegationEvent",
          channel: "asyncjob:all",
          data: event,
          timestamp: ts,
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
  public broadcastToChannel(channel: string, message: ServerMessage): void {
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
    let originUrl: URL;
    try {
      originUrl = new URL(origin);
    } catch {
      log.warn("WebSocket upgrade rejected — malformed Origin", { origin });
      return false;
    }

    const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);
    if (LOCAL_HOSTNAMES.has(originUrl.hostname)) {
      return true;
    }

    // Same-origin upgrade: the Origin's host:port equals the Host the client
    // dialed. Covers the SPA served over a LAN IP and React Native's Android
    // WebSocket, which synthesizes `Origin: http://<server-ip>:<port>` (the
    // mobile APK was silently rejected here before this check existed).
    const reqHost = info.req.headers.host;
    if (reqHost && originUrl.host === reqHost) {
      return true;
    }

    // Check against configured CORS origins by exact origin match.
    const allowed = SERVER_CONFIG.corsOrigins.some(a => {
      try {
        return new URL(a).origin === originUrl.origin;
      } catch {
        return a === origin;
      }
    });
    if (!allowed) {
      // Always log rejections — a silent upgrade refusal is indistinguishable
      // from a network fault at the client and costs real debugging time.
      log.warn("WebSocket upgrade rejected — origin not allowed", { origin, host: reqHost });
    }
    return allowed;
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
