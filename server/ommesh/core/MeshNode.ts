// server/ommesh/core/MeshNode.ts
import { NodeIdentity, NodeCapabilities } from '../../../shared/types/ommesh.types.js';
import { DiscoveryService } from './DiscoveryService.js';
import { securityManager, SecurityManager } from './SecurityManager.js';
import { RoutingEngine } from './RoutingEngine.js';
import { createLogger } from "../../_core/logger.js";
const log = createLogger("OMMESH:MeshNode");

export class MeshNode {
  private identity: NodeIdentity;
  private discovery: DiscoveryService;
  private security: SecurityManager;
  private routing: RoutingEngine;

  constructor() {
    this.security = securityManager;
    this.identity = this.security.getIdentity();
    this.discovery = new DiscoveryService(this.identity, this.security);
    this.routing = new RoutingEngine(this);

    // Wire up peer notification broadcast logic
    this.security.on('certificate-rotated', async (data: { newFingerprint: string }) => {
      log.info("Certificate rotated — broadcasting update to mesh");
      await this.discovery.broadcastFingerprintUpdate(data.newFingerprint);
    });
  }

  async start() {
    await this.discovery.startMdnsBeacon();
    log.info("OMMESH node started", { nodeId: this.identity.id });
  }

  // Expose components
  getIdentity() { return this.identity; }
  getDiscovery() { return this.discovery; }
  getSecurity() { return this.security; }
  getRouting() { return this.routing; }

  // Route an inference request through the mesh
  async routeInference(prompt: string, options: any) {
    const decision = await this.routing.decide(prompt, options);
    
    if (decision.targetNodeId === this.identity.id) {
      log.info("Executing inference locally", { nodeId: this.identity.id });
      // In a full integration, this would call ctx.services.aiProvider.chat(...)
      return { content: `Local execution stub for: ${prompt.slice(0, 20)}...` };
    }

    log.info("Routing inference to remote node", { targetNodeId: decision.targetNodeId });
    // Remote call logic using SecurityManager's mTLS options would go here
    return { content: `Remote routing stub for: ${decision.targetNodeId}` };
  }
}

// Singleton for easy access
export const meshNode = new MeshNode();
