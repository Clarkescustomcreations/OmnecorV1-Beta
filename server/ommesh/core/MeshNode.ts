// server/ommesh/core/MeshNode.ts
import * as https from 'https';
import { NodeIdentity, NodeCapabilities } from '../../../shared/types/ommesh.types.js';
import { DiscoveryService, type PeerInfo } from './DiscoveryService.js';
import { securityManager, SecurityManager } from './SecurityManager.js';
import { RoutingEngine } from './RoutingEngine.js';
import { MeshServer, MESH_PORT } from './MeshServer.js';
import { createLogger } from "../../_core/logger.js";
const log = createLogger("OMMESH:MeshNode");

// Providers that reach an external cloud API. OMMESH distributes *local* compute
// across LAN nodes; tunnelling a cloud provider through mesh routing would make a
// billed external call on a `protectedProcedure` (and on inbound peer requests),
// silently bypassing the Sovereign-mode enforcement that lives in aiRouter's
// `cloudProcedure`/`assertProviderAllowedInMode` gate. Cloud calls must go
// through the proper aiRouter path — never through the mesh. Mirrors the set in
// server/routers/aiRouter.ts.
const CLOUD_PROVIDER_IDS = new Set(["openai", "anthropic", "gemini", "grok", "huggingface"]);

export interface InferenceResult {
  content: string;
  /** Which node actually produced the completion. */
  executedBy: string;
  /** True when a remote routing attempt failed and we fell back to local. */
  fellBack?: boolean;
}

export class MeshNode {
  private identity: NodeIdentity;
  private discovery: DiscoveryService;
  private security: SecurityManager;
  private routing: RoutingEngine;
  private server: MeshServer;

  constructor() {
    this.security = securityManager;
    this.identity = this.security.getIdentity();
    this.discovery = new DiscoveryService(this.identity, this.security);
    this.routing = new RoutingEngine(this);
    this.server = new MeshServer(this);

    // Wire up peer notification broadcast logic
    this.security.on('certificate-rotated', async (data: { newFingerprint: string }) => {
      log.info("Certificate rotated — broadcasting update to mesh");
      await this.discovery.broadcastFingerprintUpdate(data.newFingerprint);
    });
  }

  async start() {
    await this.discovery.startMdnsBeacon();
    await this.server.start();
    log.info("OMMESH node started", { nodeId: this.identity.id });
  }

  // Expose components
  getIdentity() { return this.identity; }
  getDiscovery() { return this.discovery; }
  getSecurity() { return this.security; }
  getRouting() { return this.routing; }

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
