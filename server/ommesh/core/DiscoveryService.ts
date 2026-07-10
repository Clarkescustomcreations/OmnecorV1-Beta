// server/ommesh/core/DiscoveryService.ts
import bonjour from 'bonjour';
import * as https from "https";
import { NodeIdentity, NodeCapabilities } from '../../../shared/types/ommesh.types.js';
import { SecurityManager } from './SecurityManager.js';
import { createLogger } from "../../_core/logger.js";
import { mdnsBindInterface, pickPeerAddress } from "../../_core/net-utils.js";
import { MESH_PORT } from "./MeshServer.js";
import { hashModelList } from "../crypto.js";
const log = createLogger("OMMESH:Discovery");

export interface PeerInfo {
  name: string;
  address: string;
  port: number;
  fingerprint: string;
  /** Parsed from the peer's mDNS TXT record; feeds VRAM-weighted routing. */
  capabilities: NodeCapabilities;
  /**
   * The peer's advertised model-list hash (Model-Fabric Phase 4 beacon-
   * minimal design) — `capabilities.models` is only refetched over mTLS when
   * this changes, not on every mDNS re-announce.
   */
  modelsHash: string;
  discoveredAt: Date;
}

/** Valid zero-telemetry capabilities — used when a peer's TXT is missing/malformed. */
function emptyCapabilities(): NodeCapabilities {
  return {
    models: [],
    gpu: { vram: 0, utilization: 0, temperature: 0 },
    cpu: 0,
    ram: 0,
    roles: ['peer'],
  };
}

export class DiscoveryService {
  private bonjourInstance: any;
  private browser: any;
  private publishedService: any;
  private peers = new Map<string, PeerInfo>();

  constructor(private identity: NodeIdentity, private security: SecurityManager) {
    // On hosts with a WSL/Hyper-V vEthernet adapter, bind mDNS multicast to the
    // real LAN interface so announcements don't egress the wrong NIC. On clean
    // single-NIC hosts this returns undefined → bind all interfaces (default),
    // which avoids breaking multicast reception alongside avahi on Linux.
    const ifaceIp = mdnsBindInterface();
    const bonjourFactory = bonjour as unknown as (opts?: any) => any;
    this.bonjourInstance = bonjourFactory(ifaceIp ? { interface: ifaceIp } : undefined);
    if (ifaceIp) log.info("mDNS bound to LAN interface", { interface: ifaceIp });

    // GET /models is pinned-peer gated (Model-Fabric Phase 4), so a peer
    // discovered before approval can't be fetched from yet. Once it's
    // approved, retry the fetch immediately rather than waiting for the next
    // mDNS re-announce (which may not come for a long time if the peer's
    // model list happens to be static).
    this.security.on?.('peer-trusted', (fingerprint: string) => {
      const peer = Array.from(this.peers.values()).find((p) => p.fingerprint === fingerprint);
      if (peer) void this.refreshPeerModels(peer);
    });
  }

  /**
   * Publish (or re-publish) this node's mDNS service advertisement.
   *
   * Beacon-minimal (Model-Fabric Decision 4): the TXT record carries the
   * node's fingerprint, live GPU/CPU/RAM telemetry, and a `modelsHash` —
   * NOT the full model list. A model catalog can grow arbitrarily (many
   * Ollama tags), which would blow past the mDNS TXT record's per-entry size
   * limit; the small scalar telemetry fields don't have that problem and stay
   * inline so routing has fresh data on every re-advertise. Peers fetch the
   * real model list over mTLS (`GET /models`) only when `modelsHash` changes
   * — see `handlePeerDiscovery`/`refreshPeerModels`.
   */
  private publishBeacon() {
    const { models, ...restCapabilities } = this.identity.capabilities;
    const service = this.bonjourInstance.publish({
      name: this.identity.id,
      type: 'omnecor',
      port: MESH_PORT, // Dedicated mesh port (mTLS inference server)
      txt: {
        fingerprint: this.identity.fingerprint,
        capabilities: JSON.stringify(restCapabilities),
        modelsHash: hashModelList(models ?? []),
      }
    });

    // bonjour emits 'error' asynchronously on the Service EventEmitter (e.g.
    // "Service name is already in use on the network" when a stale instance of
    // this same node is still advertising). With no listener attached Node
    // rethrows it as an unhandled 'error' event, which crashes the whole
    // process on boot. Swallow it so OMMESH degrades gracefully — the node
    // keeps serving even if its mDNS announcement can't be registered.
    service?.on?.('error', (err: any) => {
      log.warn("mDNS service registration failed — discovery degraded", {
        nodeId: this.identity.id,
        error: err?.message ?? String(err),
      });
    });

    this.publishedService = service;
  }

  async startMdnsBeacon() {
    log.info("Starting mDNS beacon", { nodeId: this.identity.id });

    try {
      this.publishBeacon();

      // Browse for peers using event-based browser for up/down tracking.
      // Set up once — re-advertising (publishBeacon) must NOT re-register the
      // browser, or duplicate 'up'/'down' listeners accumulate.
      this.browser = this.bonjourInstance.find({ type: 'omnecor' });
      this.browser.on('up', (service: any) => this.handlePeerDiscovery(service));
      this.browser.on('down', (service: any) => {
        this.peers.delete(service.name);
        log.info("Peer left mesh", { name: service.name });
      });
    } catch (err) {
      console.error('❌ Failed to start mDNS beacon:', err);
    }
  }

  /**
   * Re-advertise the mDNS TXT record after the local node's capabilities
   * change (e.g. a telemetry refresh updated free VRAM / utilization). Stops
   * the existing service announcement then re-publishes with the current
   * `identity.capabilities`. Only the service is re-registered — the peer
   * browser is left intact.
   */
  refreshAdvertisement(): void {
    try {
      if (this.publishedService?.stop) {
        this.publishedService.stop(() => this.publishBeacon());
      } else {
        this.publishBeacon();
      }
    } catch (err) {
      log.warn("mDNS re-advertise failed — keeping previous announcement", {
        error: (err as Error).message,
      });
    }
  }

  private handlePeerDiscovery(service: any) {
    // Basic validation: don't discover ourselves
    if (service.name === this.identity.id) return;

    const existing = this.peers.get(service.name);
    const modelsHash = typeof service.txt?.modelsHash === "string" ? service.txt.modelsHash : "";

    const parsedCapabilities: NodeCapabilities = (() => {
      try {
        const parsed = JSON.parse(service.txt?.capabilities ?? "");
        // Guard against malformed or legacy (array-shaped) TXT payloads.
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && parsed.gpu) {
          return parsed as NodeCapabilities;
        }
        return emptyCapabilities();
      } catch {
        return emptyCapabilities();
      }
    })();

    const peerInfo: PeerInfo = {
      name: service.name,
      address: pickPeerAddress(service),
      port: service.port,
      fingerprint: service.txt?.fingerprint ?? "",
      capabilities: {
        ...parsedCapabilities,
        // Beacon-minimal (Model-Fabric Phase 4): the TXT never carries the
        // full model list. Keep the previously-fetched list as long as the
        // hash hasn't moved (avoids flickering to `[]` on every re-announce);
        // a changed/new hash starts empty until the fetch below resolves.
        models: existing?.modelsHash === modelsHash ? existing?.capabilities.models ?? [] : [],
      },
      modelsHash,
      discoveredAt: new Date(),
    };

    this.peers.set(service.name, peerInfo);
    log.info("Peer added to mesh", { name: service.name, address: peerInfo.address, port: peerInfo.port });

    if (modelsHash && modelsHash !== existing?.modelsHash) {
      void this.refreshPeerModels(peerInfo);
    }
  }

  /**
   * Fetch a peer's full model list over mTLS (`GET /models`) and update the
   * cached `PeerInfo` in place — only if the peer is still the one we asked
   * about (its hash hasn't moved again mid-fetch) and is currently trusted
   * (the endpoint is pinned-peer gated, so an unapproved peer's request would
   * just 403; skip the network round trip entirely in that case).
   */
  private async refreshPeerModels(peer: PeerInfo): Promise<void> {
    if (!this.security.isTrusted(peer.fingerprint)) return;
    try {
      const models = await this.fetchModelsFromPeer(peer);
      const current = this.peers.get(peer.name);
      if (current && current.modelsHash === peer.modelsHash) {
        current.capabilities.models = models;
        log.info("Fetched peer model list", { peer: peer.name, modelCount: models.length });
      }
    } catch (err) {
      log.warn("Failed to fetch peer model list", { peer: peer.name, error: (err as Error).message });
    }
  }

  private fetchModelsFromPeer(peer: PeerInfo): Promise<NodeCapabilities["models"]> {
    const tlsOptions = this.security.getClientTlsOptions(peer.fingerprint || undefined);

    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          host: peer.address,
          port: peer.port || MESH_PORT,
          path: "/models",
          method: "GET",
          ...tlsOptions,
          timeout: 10_000,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            if (res.statusCode !== 200) {
              reject(new Error(`peer ${peer.name} /models returned ${res.statusCode}: ${text.slice(0, 200)}`));
              return;
            }
            try {
              const parsed = JSON.parse(text) as { models?: unknown };
              resolve(Array.isArray(parsed.models) ? (parsed.models as NodeCapabilities["models"]) : []);
            } catch {
              reject(new Error(`peer ${peer.name} /models returned invalid JSON`));
            }
          });
        },
      );

      req.on("error", reject);
      req.on("timeout", () => req.destroy(new Error(`peer ${peer.name} /models timed out`)));
      req.end();
    });
  }

  /**
   * Broadcast a fingerprint update to the mesh.
   */
  async broadcastFingerprintUpdate(newFingerprint: string) {
    log.info("Broadcasting fingerprint update", { fingerprint: newFingerprint });
    // Re-publish only the service announcement (the identity's fingerprint has
    // already been updated upstream). Reusing refreshAdvertisement avoids
    // re-creating the peer browser and stacking duplicate listeners.
    this.refreshAdvertisement();
  }

  getPeers(): PeerInfo[] {
    return Array.from(this.peers.values());
  }
}
