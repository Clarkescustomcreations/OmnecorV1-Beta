// server/ommesh/core/DiscoveryService.ts
import bonjour from 'bonjour';
import { NodeIdentity, NodeCapabilities } from '../../../shared/types/ommesh.types.js';
import { SecurityManager } from './SecurityManager.js';
import { createLogger } from "../../_core/logger.js";
import { mdnsBindInterface, pickPeerAddress } from "../../_core/net-utils.js";
import { MESH_PORT } from "./MeshServer.js";
const log = createLogger("OMMESH:Discovery");

export interface PeerInfo {
  name: string;
  address: string;
  port: number;
  fingerprint: string;
  /** Parsed from the peer's mDNS TXT record; feeds VRAM-weighted routing. */
  capabilities: NodeCapabilities;
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
  }

  /**
   * Publish (or re-publish) this node's mDNS service advertisement. The TXT
   * record carries the node's fingerprint and current `capabilities` (including
   * live GPU/CPU/RAM telemetry), so re-calling this after telemetry changes
   * propagates fresh routing data to peers. Stores the service handle so it can
   * be stopped before a re-publish.
   */
  private publishBeacon() {
    const service = this.bonjourInstance.publish({
      name: this.identity.id,
      type: 'omnecor',
      port: MESH_PORT, // Dedicated mesh port (mTLS inference server)
      txt: {
        fingerprint: this.identity.fingerprint,
        capabilities: JSON.stringify(this.identity.capabilities)
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

    const peerInfo: PeerInfo = {
      name: service.name,
      address: pickPeerAddress(service),
      port: service.port,
      fingerprint: service.txt?.fingerprint ?? "",
      capabilities: (() => {
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
      })(),
      discoveredAt: new Date(),
    };

    this.peers.set(service.name, peerInfo);
    log.info("Peer added to mesh", { name: service.name, address: peerInfo.address, port: peerInfo.port });
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
