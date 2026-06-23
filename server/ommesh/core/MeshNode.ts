// server/ommesh/core/MeshNode.ts
import * as https from 'https';
import { createHmac } from 'crypto';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { NodeIdentity, NodeCapabilities } from '../../../shared/types/ommesh.types.js';
import { DiscoveryService, type PeerInfo } from './DiscoveryService.js';
import { securityManager, SecurityManager } from './SecurityManager.js';
import { RoutingEngine } from './RoutingEngine.js';
import { collectHostTelemetry } from './HostTelemetry.js';
import { MeshServer, MESH_PORT } from './MeshServer.js';
import { createLogger } from "../../_core/logger.js";
import { CLOUD_PROVIDER_IDS } from "../../_core/sovereign.js";
const log = createLogger("OMMESH:MeshNode");

const SETTINGS_PATH = join(homedir(), '.omnecor', 'settings.json');

// Providers that reach an external cloud API. OMMESH distributes *local* compute
// across LAN nodes; tunnelling a cloud provider through mesh routing would make a
// billed external call on a `protectedProcedure` (and on inbound peer requests),
// silently bypassing the Sovereign-mode enforcement that lives in aiRouter's
// `cloudProcedure`/`assertProviderAllowedInMode` gate. Cloud calls must go
// through the proper aiRouter path — never through the mesh. CLOUD_PROVIDER_IDS
// is the shared set from _core/sovereign.ts (single source of truth).

export interface InferenceResult {
  content: string;
  /** Which node actually produced the completion. */
  executedBy: string;
  /** True when a remote routing attempt failed and we fell back to local. */
  fellBack?: boolean;
}

/** Minimal persona shape received from or sent to a peer. */
export interface PeerPersona {
  id: string;
  name: string;
  description?: string;
  systemPrompt?: string;
  tags?: string[];
}

/** One entry in the in-memory received-sync cache. */
interface SyncCacheEntry {
  nodeId: string;
  personas: PeerPersona[];
  receivedAt: string;
}

export class MeshNode {
  private identity: NodeIdentity;
  private discovery: DiscoveryService;
  private security: SecurityManager;
  private routing: RoutingEngine;
  private server: MeshServer;

  /** In-memory cache of persona data received from peers via /sync. */
  private syncCache: Map<string, SyncCacheEntry> = new Map();

  /** Whether cross-node persona sync is enabled (persisted via settings). */
  private crossNodeSyncEnabled = false;

  /** Whether agent discourse routing is enabled (persisted via settings). */
  private agentDiscourseEnabled = false;

  /** Interval handle for the sync heartbeat. */
  private syncHeartbeatTimer: ReturnType<typeof setInterval> | null = null;

  /** Interval handle for the GPU/host telemetry refresh. */
  private telemetryTimer: ReturnType<typeof setInterval> | null = null;

  /** Last advertised dynamic telemetry — gates re-advertise to avoid mDNS churn. */
  private lastAdvertisedGpu: { vram: number; utilization: number } | null = null;

  constructor() {
    this.security = securityManager;
    this.identity = this.security.getIdentity();
    this.discovery = new DiscoveryService(this.identity, this.security);
    this.routing = new RoutingEngine(this);
    this.server = new MeshServer(this);

    // Restore persisted OMMESH settings synchronously at construction time.
    try {
      if (existsSync(SETTINGS_PATH)) {
        const settings = JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8')) as Record<string, unknown>;
        if (settings['ommesh.crossNodeSync'] === true) this.crossNodeSyncEnabled = true;
        if (settings['ommesh.agentDiscourse'] === true) this.agentDiscourseEnabled = true;
        log.info("OMMESH: restored settings", { crossNodeSyncEnabled: this.crossNodeSyncEnabled, agentDiscourseEnabled: this.agentDiscourseEnabled });
      }
    } catch {
      // Non-critical — defaults are already set above
    }

    // Wire up peer notification broadcast logic
    this.security.on('certificate-rotated', async (data: { newFingerprint: string }) => {
      log.info("Certificate rotated — broadcasting update to mesh");
      await this.discovery.broadcastFingerprintUpdate(data.newFingerprint);
    });
  }

  async start() {
    // Collect real host telemetry BEFORE the first beacon so the node's very
    // first mDNS advertisement already carries true VRAM/CPU/RAM figures (no
    // initial vram:0 → immediate re-advertise churn).
    await this.primeTelemetry();
    await this.discovery.startMdnsBeacon();
    await this.server.start();
    this.startTelemetryPush();
    log.info("OMMESH node started", { nodeId: this.identity.id });
  }

  // ─── Host Telemetry (feeds VRAM-weighted routing — TD-018) ────────────────

  /**
   * Mutate the local identity's dynamic capabilities in place. The capabilities
   * object is shared by reference with DiscoveryService (passed at construction)
   * and the RoutingEngine (reads `getIdentity()`), so an in-place update is seen
   * everywhere; the mDNS TXT record is refreshed separately via the discovery
   * service when the change is material.
   */
  private applyTelemetry(telemetry: Pick<NodeCapabilities, "gpu" | "cpu" | "ram">): void {
    const caps = this.identity.capabilities;
    caps.gpu = telemetry.gpu;
    caps.cpu = telemetry.cpu;
    caps.ram = telemetry.ram;
  }

  /** One-shot telemetry collection used to seed capabilities before the first beacon. */
  private async primeTelemetry(): Promise<void> {
    try {
      const telemetry = await collectHostTelemetry();
      this.applyTelemetry(telemetry);
      this.lastAdvertisedGpu = { vram: telemetry.gpu.vram, utilization: telemetry.gpu.utilization };
      log.info("OMMESH telemetry primed", {
        vramFreeMb: telemetry.gpu.vram,
        gpuUtil: telemetry.gpu.utilization,
        cpuCores: telemetry.cpu,
        ramFreeMb: telemetry.ram,
      });
    } catch (err) {
      log.warn("OMMESH telemetry prime failed — advertising zero capabilities", {
        error: (err as Error).message,
      });
    }
  }

  /** Start the periodic telemetry refresh (30 s). Idempotent. */
  private startTelemetryPush(): void {
    if (this.telemetryTimer) return;
    this.telemetryTimer = setInterval(() => {
      void this.refreshTelemetry();
    }, 30_000);
    log.info("OMMESH telemetry push started (30 s refresh)");
  }

  /**
   * Re-collect telemetry and, when free VRAM or utilization has moved
   * materially, re-advertise so peers route on fresh headroom. The change-guard
   * means a steady-state node re-advertises only when load actually shifts —
   * avoiding constant mDNS up/down flapping.
   */
  private async refreshTelemetry(): Promise<void> {
    try {
      const telemetry = await collectHostTelemetry();
      this.applyTelemetry(telemetry);

      const last = this.lastAdvertisedGpu;
      const materiallyChanged =
        !last ||
        Math.abs(telemetry.gpu.vram - last.vram) > 512 || // > 512 MB free-VRAM delta
        Math.abs(telemetry.gpu.utilization - last.utilization) > 15; // > 15% util delta

      if (materiallyChanged) {
        this.lastAdvertisedGpu = { vram: telemetry.gpu.vram, utilization: telemetry.gpu.utilization };
        this.discovery.refreshAdvertisement();
        log.info("OMMESH re-advertised capabilities", {
          vramFreeMb: telemetry.gpu.vram,
          gpuUtil: telemetry.gpu.utilization,
        });
      }
    } catch (err) {
      log.warn("OMMESH telemetry refresh failed", { error: (err as Error).message });
    }
  }

  // Expose components
  getIdentity() { return this.identity; }
  getDiscovery() { return this.discovery; }
  getSecurity() { return this.security; }
  getRouting() { return this.routing; }

  // ─── Cross-Node Sync Settings ─────────────────────────────────────────────

  /**
   * Enable or disable cross-node persona sync. When enabled, a heartbeat
   * pushes local personas to all known peers every 30 seconds.
   */
  setCrossNodeSync(enabled: boolean): void {
    this.crossNodeSyncEnabled = enabled;
    if (enabled && !this.syncHeartbeatTimer) {
      this.syncHeartbeatTimer = setInterval(() => {
        this.pushPersonaSync().catch((err: unknown) => {
          log.warn("Persona sync heartbeat failed", { error: (err as Error).message });
        });
      }, 30_000);
      log.info("Cross-node persona sync enabled (30 s heartbeat)");
    } else if (!enabled && this.syncHeartbeatTimer) {
      clearInterval(this.syncHeartbeatTimer);
      this.syncHeartbeatTimer = null;
      log.info("Cross-node persona sync disabled");
    }
  }

  /** Enable or disable agent discourse routing. */
  setAgentDiscourse(enabled: boolean): void {
    this.agentDiscourseEnabled = enabled;
    log.info("Agent discourse routing", { enabled });
  }

  isCrossNodeSyncEnabled(): boolean { return this.crossNodeSyncEnabled; }
  isAgentDiscourseEnabled(): boolean { return this.agentDiscourseEnabled; }

  /** Return cached persona data received from all peers. */
  getPeerSyncCache(): SyncCacheEntry[] {
    return Array.from(this.syncCache.values());
  }

  // ─── Inbound handlers (called by MeshServer) ──────────────────────────────

  /**
   * Called when a peer sends us its persona data via POST /sync.
   * Stores in-memory cache and broadcasts a WS event — never writes to local DB.
   */
  async receivePeerSync(nodeId: string, personas: unknown[]): Promise<void> {
    const safe: PeerPersona[] = (Array.isArray(personas) ? personas : []).flatMap((p) => {
      if (typeof p !== "object" || p === null) return [];
      const obj = p as Record<string, unknown>;
      if (typeof obj.id !== "string" || typeof obj.name !== "string") return [];
      return [{
        id: obj.id,
        name: obj.name,
        description: typeof obj.description === "string" ? obj.description : undefined,
        systemPrompt: typeof obj.systemPrompt === "string" ? obj.systemPrompt : undefined,
        tags: Array.isArray(obj.tags) ? (obj.tags as string[]).filter(t => typeof t === "string") : undefined,
      }];
    });

    this.syncCache.set(nodeId, { nodeId, personas: safe, receivedAt: new Date().toISOString() });
    log.info("Peer sync cached", { nodeId, personaCount: safe.length });

    // Broadcast to subscribed WS clients
    try {
      const { getWsInstance } = await import("../../phase2/websocket/WebSocketServer.js");
      getWsInstance()?.broadcastAll("ommesh:sync_received", { nodeId, personaCount: safe.length });
    } catch {
      // WS not yet initialized — acceptable during early boot
    }
  }

  /**
   * Called when a peer delivers an inter-agent message via POST /discourse.
   * Looks up the target persona and appends the message to the messenger store.
   * Non-destructive: if the persona is not found, returns { ok: false }.
   */
  async receiveDiscourse(
    fromNode: string,
    fromAgentId: string,
    toAgentId: string,
    content: string,
  ): Promise<{ ok: boolean }> {
    try {
      const { getDb } = await import("../../db.factory.js");
      const { personas } = await import("../../../drizzle/schema.js");
      const { eq } = await import("drizzle-orm");

      const db = await getDb();
      const rows = await db.select().from(personas).where(eq(personas.id, toAgentId));
      if (rows.length === 0) {
        log.warn("Discourse: target persona not found", { toAgentId, fromNode });
        return { ok: false };
      }

      const persona = rows[0];
      const prefixedContent = `[From ${fromNode}/${fromAgentId}]: ${content}`;

      const { AgentMessengerStore } = await import("../../_core/AgentMessengerStore.js");
      await AgentMessengerStore.getInstance().append(persona.userId, toAgentId, "user", prefixedContent);

      log.info("Discourse message delivered", { toAgentId, fromNode, fromAgentId });
      return { ok: true };
    } catch (err) {
      log.warn("Discourse delivery error", { error: (err as Error).message });
      return { ok: false };
    }
  }

  // ─── Outbound methods ─────────────────────────────────────────────────────

  /**
   * Fetch local personas from DB and push them to all known peers via /sync.
   * Only runs if crossNodeSync is enabled — guards are intentionally redundant
   * so calling code doesn't need to check the flag first.
   */
  async pushPersonaSync(): Promise<void> {
    if (!this.crossNodeSyncEnabled) return;
    const peers = this.discovery.getPeers();
    if (peers.length === 0) return;

    // Fetch all personas from the local DB
    let localPersonas: PeerPersona[] = [];
    try {
      const { getDb } = await import("../../db.factory.js");
      const { personas } = await import("../../../drizzle/schema.js");
      const db = await getDb();
      const rows = await db.select().from(personas);
      localPersonas = rows.map(r => ({
        id: r.id,
        name: r.name,
        description: typeof (r.data as Record<string, unknown>)?.description === "string"
          ? (r.data as Record<string, unknown>).description as string
          : undefined,
        systemPrompt: typeof (r.data as Record<string, unknown>)?.systemPrompt === "string"
          ? (r.data as Record<string, unknown>).systemPrompt as string
          : undefined,
        tags: Array.isArray((r.data as Record<string, unknown>)?.tags)
          ? (r.data as Record<string, unknown>).tags as string[]
          : undefined,
      }));
    } catch (err) {
      log.warn("pushPersonaSync: failed to fetch local personas", { error: (err as Error).message });
      return;
    }

    const timestamp = Date.now();
    const analyticsAt = new Date().toISOString();
    const canonical = JSON.stringify({
      nodeId: this.identity.id,
      personas: localPersonas,
      analyticsAt,
      timestamp,
    });
    const sig = this.signPayload(canonical);
    const body = JSON.stringify({
      nodeId: this.identity.id,
      personas: localPersonas,
      analyticsAt,
      timestamp,
      sig,
    });

    await Promise.allSettled(
      peers.map(peer =>
        this.postToPeer(peer, "/sync", body).then(() => {
          log.info("Persona sync pushed to peer", { peer: peer.name });
        }).catch((err: unknown) => {
          log.warn("Failed to push persona sync to peer", { peer: peer.name, error: (err as Error).message });
        })
      )
    );
  }

  /**
   * Send an inter-agent discourse message to a specific peer.
   */
  async sendPeerDiscourse(
    peerId: string,
    fromAgentId: string,
    toAgentId: string,
    content: string,
  ): Promise<{ ok: boolean }> {
    const peer = this.discovery.getPeers().find(p => p.name === peerId);
    if (!peer) {
      log.warn("sendPeerDiscourse: peer not found", { peerId });
      return { ok: false };
    }

    const timestamp = new Date().toISOString();
    const canonical = JSON.stringify({
      fromNode: this.identity.id,
      fromAgentId,
      toAgentId,
      content,
      timestamp,
    });
    const sig = this.signPayload(canonical);
    const body = JSON.stringify({
      fromNode: this.identity.id,
      fromAgentId,
      toAgentId,
      content,
      timestamp,
      sig,
    });

    try {
      await this.postToPeer(peer, "/discourse", body);
      return { ok: true };
    } catch (err) {
      log.warn("sendPeerDiscourse failed", { peerId, error: (err as Error).message });
      return { ok: false };
    }
  }

  // ─── Shared private helpers ───────────────────────────────────────────────

  /**
   * Sign a raw payload string with HMAC-SHA256 using OMMESH_SECRET.
   * Returns an empty string if OMMESH_SECRET is not set.
   */
  private signPayload(payload: string): string {
    const secret = process.env.OMMESH_SECRET;
    if (!secret) return "";
    return createHmac("sha256", secret).update(payload).digest("hex");
  }

  /**
   * POST a JSON body to a peer endpoint using mTLS, matching the pattern of
   * `routeToRemote`. Returns the response body string (for callers that don't
   * need it) or rejects on non-2xx status.
   */
  private postToPeer(peer: PeerInfo, path: string, body: string): Promise<string> {
    const tlsOptions = this.security.getClientTlsOptions(peer.fingerprint || undefined);

    return new Promise<string>((resolve, reject) => {
      const req = https.request(
        {
          host: peer.address,
          port: peer.port || MESH_PORT,
          path,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
          },
          ...tlsOptions,
          timeout: 15_000,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              resolve(text);
            } else {
              reject(new Error(`peer ${peer.name} returned ${res.statusCode}: ${text.slice(0, 200)}`));
            }
          });
        },
      );

      req.on("error", reject);
      req.on("timeout", () => req.destroy(new Error(`peer ${peer.name} timed out`)));
      req.write(body);
      req.end();
    });
  }

  /**
   * Route an inference request through the mesh.
   *
   * The RoutingEngine scores the local node against discovered peers (VRAM /
   * utilization weighted). If the local node wins, we execute here. Otherwise we
   * make an mTLS call to the chosen peer's inference endpoint; if that call
   * fails for any reason we fall back to local execution so a flaky peer never
   * loses the request.
   */
  async routeInference(prompt: string, options: Record<string, unknown>): Promise<InferenceResult> {
    const decision = await this.routing.decide(prompt, options);

    if (decision.targetNodeId === this.identity.id) {
      log.info("Executing inference locally", { nodeId: this.identity.id });
      return this.executeLocal(prompt, options);
    }

    const peer = this.discovery.getPeers().find(p => p.name === decision.targetNodeId);
    if (!peer) {
      log.warn("Routing target no longer in peer table — executing locally", { targetNodeId: decision.targetNodeId });
      const local = await this.executeLocal(prompt, options);
      return { ...local, fellBack: true };
    }

    log.info("Routing inference to remote node", { targetNodeId: peer.name, address: peer.address, port: peer.port });
    try {
      const content = await this.routeToRemote(peer, prompt, options);
      return { content, executedBy: peer.name };
    } catch (err) {
      log.warn("Remote routing failed — falling back to local execution", {
        targetNodeId: peer.name,
        error: (err as Error).message,
      });
      const local = await this.executeLocal(prompt, options);
      return { ...local, fellBack: true };
    }
  }

  /**
   * Run inference on this node via the local AI provider stack. Used both for
   * locally-routed requests and for inbound peer requests (via MeshServer).
   *
   * AiProviderService imports `meshNode`, so this is a dynamic import to avoid a
   * circular module dependency at load time.
   */
  async executeLocal(prompt: string, options: Record<string, unknown>): Promise<InferenceResult> {
    const { AiProviderService } = await import("../../phase2/services/AiProviderService.js");

    const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
    const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

    const providerId = str(options.providerId) ?? "ollama";
    const modelId = str(options.model) ?? str(options.modelId) ?? "llama3.2";

    if (CLOUD_PROVIDER_IDS.has(providerId)) {
      throw new Error(
        `Cloud provider "${providerId}" cannot be routed through OMMESH. ` +
        `The mesh distributes local compute only; use the aiRouter chat path for cloud providers.`,
      );
    }

    const content = await AiProviderService.getInstance().chat({
      providerId,
      modelId,
      messages: [{ role: "user", content: prompt }],
      systemPrompt: str(options.systemPrompt),
      temperature: num(options.temperature),
      maxTokens: num(options.maxTokens),
    });

    return { content, executedBy: this.identity.id };
  }

  /**
   * Make a strict-mTLS HTTPS call to a peer's inference endpoint. The peer's
   * certificate fingerprint (advertised over mDNS) is pinned via
   * getClientTlsOptions, so a MITM presenting a different CA-signed cert is
   * rejected even though it would otherwise validate against the shared CA.
   */
  private routeToRemote(peer: PeerInfo, prompt: string, options: Record<string, unknown>): Promise<string> {
    const tlsOptions = this.security.getClientTlsOptions(peer.fingerprint || undefined);
    const body = JSON.stringify({ prompt, options });

    return new Promise<string>((resolve, reject) => {
      const req = https.request(
        {
          host: peer.address,
          port: peer.port || MESH_PORT,
          path: "/inference",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
          },
          ...tlsOptions,
          timeout: 120_000,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            if (res.statusCode !== 200) {
              reject(new Error(`peer ${peer.name} returned ${res.statusCode}: ${text.slice(0, 200)}`));
              return;
            }
            try {
              const parsed = JSON.parse(text) as { content?: string };
              if (typeof parsed.content !== "string") {
                reject(new Error(`peer ${peer.name} returned no content`));
                return;
              }
              resolve(parsed.content);
            } catch {
              reject(new Error(`peer ${peer.name} returned invalid JSON`));
            }
          });
        },
      );

      req.on("error", reject);
      req.on("timeout", () => req.destroy(new Error(`peer ${peer.name} timed out`)));
      req.write(body);
      req.end();
    });
  }
}

// Singleton for easy access
export const meshNode = new MeshNode();
