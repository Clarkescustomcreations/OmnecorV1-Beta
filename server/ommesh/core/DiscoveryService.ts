// server/ommesh/core/DiscoveryService.ts
import bonjour from 'bonjour';
import { NodeIdentity } from '../../../shared/types/ommesh.types.js';
import { SecurityManager } from './SecurityManager.js';
import { createLogger } from "../../_core/logger.js";
import { mdnsBindInterface, pickPeerAddress } from "../../_core/net-utils.js";
const log = createLogger("OMMESH:Discovery");

export interface PeerInfo {
  name: string;
  address: string;
  port: number;
  fingerprint: string;
  capabilities: any[];
  discoveredAt: Date;
}

export class DiscoveryService {
  private bonjourInstance: any;
  private browser: any;
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

  async startMdnsBeacon() {
    log.info("Starting mDNS beacon", { nodeId: this.identity.id });

    try {
      this.bonjourInstance.publish({
        name: this.identity.id,
        type: 'omnecor',
        port: 3001, // Dedicated mesh port
        txt: {
          fingerprint: this.identity.fingerprint,
          capabilities: JSON.stringify(this.identity.capabilities)
        }
      });

      // Browse for peers using event-based browser for up/down tracking
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

  private handlePeerDiscovery(service: any) {
    // Basic validation: don't discover ourselves
    if (service.name === this.identity.id) return;

    const peerInfo: PeerInfo = {
      name: service.name,
      address: pickPeerAddress(service),
      port: service.port,
      fingerprint: service.txt?.fingerprint ?? "",
      capabilities: (() => {
        try { return JSON.parse(service.txt?.capabilities ?? "[]"); } catch { return []; }
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
    try {
      this.bonjourInstance.unpublishAll(() => {
        this.startMdnsBeacon();
      });
    } catch (err) {
      console.error('❌ Failed to broadcast fingerprint update:', err);
    }
  }

  getPeers(): PeerInfo[] {
    return Array.from(this.peers.values());
  }
}
