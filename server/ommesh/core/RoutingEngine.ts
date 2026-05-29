// server/ommesh/core/RoutingEngine.ts
import { RoutingDecision } from '../../../shared/types/ommesh.types.js';
import { MeshNode } from './MeshNode.js';

export class RoutingEngine {
  constructor(private node: MeshNode) {}

  async decide(prompt: string, options: any): Promise<RoutingDecision> {
    const peers = this.node.getDiscovery().getPeers();
    let bestScore = -1;
    let best: any = null;

    // Evaluate local node first
    const localScore = this.calculateScore(this.node.getIdentity(), prompt.length, options);
    bestScore = localScore;
    best = { id: this.node.getIdentity().id };

    for (const peer of peers) {
      const score = this.calculateScore(peer, prompt.length, options);
      if (score > bestScore) {
        bestScore = score;
        best = peer;
      }
    }

    return {
      targetNodeId: best?.id || this.node.getIdentity().id,
      model: options.model || 'default',
      estimatedLatency: 0,
      score: bestScore,
      fallbackChain: []
    };
  }

  private calculateScore(node: any, tokens: number, options: any): number {
    // Basic score calculation: VRAM capacity weighted against current utilization.
    // Higher score is better.
    const gpu = node.capabilities.gpu;
    if (!gpu || gpu.vram === 0) return 0.1; // Minimal score for non-GPU nodes

    const vramWeight = (gpu.vram - tokens * 2) / 1000;
    const utilizationWeight = (100 - gpu.utilization) / 100;
    
    return (vramWeight * 0.6) + (utilizationWeight * 0.4);
  }
}
