// server/ommesh/core/RoutingEngine.ts
import { RoutingDecision, NodeCapabilities } from '../../../shared/types/ommesh.types.js';
import { MeshNode } from './MeshNode.js';

/** Anything the scorer can rank — the local identity or a discovered peer. */
interface Scorable {
  capabilities: NodeCapabilities;
}

export class RoutingEngine {
  constructor(private node: MeshNode) {}

  async decide(prompt: string, options: Record<string, unknown>): Promise<RoutingDecision> {
    const identity = this.node.getIdentity();
    const peers = this.node.getDiscovery().getPeers();
    const tokens = prompt.length;

    // Start with the local node as the incumbent.
    let targetNodeId = identity.id;
    let bestScore = this.calculateScore(identity, tokens);

    // A peer only wins if it strictly out-scores the current best. Peers are
    // keyed by `name`, which is the remote node's id (DiscoveryService sets
    // `name: service.name` = the peer's advertised identity id) — routeInference
    // looks the peer back up by that same `name`.
    for (const peer of peers) {
      const score = this.calculateScore(peer, tokens);
      if (score > bestScore) {
        bestScore = score;
        targetNodeId = peer.name;
      }
    }

    return {
      targetNodeId,
      model: typeof options.model === 'string' ? options.model : 'default',
      estimatedLatency: 0,
      score: bestScore,
      fallbackChain: [],
    };
  }

  /**
   * Score a node by available GPU VRAM weighted against current utilization.
   * Higher is better. Nodes with no GPU (or no telemetry yet) score a minimal
   * 0.1 so a GPU-equipped peer always wins over a CPU-only one. `gpu.vram` is
   * free VRAM headroom in MB (see HostTelemetry).
   */
  private calculateScore(node: Scorable, tokens: number): number {
    const gpu = node.capabilities?.gpu;
    if (!gpu || gpu.vram === 0) return 0.1; // Minimal score for non-GPU / untelemetered nodes

    const vramWeight = (gpu.vram - tokens * 2) / 1000;
    const utilizationWeight = (100 - gpu.utilization) / 100;

    return vramWeight * 0.6 + utilizationWeight * 0.4;
  }
}
