// server/ommesh/core/DiscoveryService.ts
import bonjour from 'bonjour';
import { NodeIdentity } from '../../../shared/types/ommesh.types.js';
import { SecurityManager } from './SecurityManager.js';
import { createLogger } from "../../_core/logger.js";
const log = createLogger("OMMESH:Discovery");

export class DiscoveryService {
  private bonjourInstance: any;

  constructor(private identity: NodeIdentity, private security: SecurityManager) {
    this.bonjourInstance = (bonjour as any)();
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

      // Browse for peers
      this.bonjourInstance.find({ type: 'omnecor' }, (service: any) => {
        this.handlePeerDiscovery(service);
      });
    } catch (err) {
      console.error('❌ Failed to start mDNS beacon:', err);
    }
  }

  private handlePeerDiscovery(service: any) {
    // Basic validation: don't discover ourselves
    if (service.name === this.identity.id) return;
    
    log.info("Discovered OMMESH peer", { name: service.name, address: service.addresses[0], port: service.port });
    // Further validation and trust logic would happen here or in MeshNode
  }

  /**
   * Broadcast a fingerprint update to the mesh.
   * This is a simplified version; in a real mesh, this might be a 
   * signed message sent to all known peer WebSockets.
   */
  async broadcastFingerprintUpdate(newFingerprint: string) {
    log.info("Broadcasting fingerprint update", { fingerprint: newFingerprint });
    // Re-publish the beacon with the new fingerprint
    try {
      this.bonjourInstance.unpublishAll(() => {
        this.startMdnsBeacon();
      });
    } catch (err) {
      console.error('❌ Failed to broadcast fingerprint update:', err);
    }
  }

  getPeers() {
    // Returns a list of currently discovered services
    return []; // Implementation would track these in a Map
  }
}
