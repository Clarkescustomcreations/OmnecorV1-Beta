// shared/types/ommesh.types.ts
export interface NodeIdentity {
  id: string;
  fingerprint: string;
  publicKey: string;
  hostname: string;
  version: string;
  capabilities: NodeCapabilities;
  lastSeen: Date;
}

export interface NodeCapabilities {
  models: Array<{ name: string; contextWindow: number; vramReq: number }>;
  gpu: { vram: number; utilization: number; temperature: number };
  cpu: number;
  ram: number;
  roles: ('coordinator' | 'worker' | 'peer')[];
}

export interface MeshMessage {
  type: 'discovery' | 'heartbeat' | 'inference' | 'stream' | 'agent_task' | 'memory_query' | 'unknown';
  payload: any;
  signature: string;
  timestamp: number;
  nodeId: string;
}

export interface RoutingDecision {
  targetNodeId: string;
  model: string;
  estimatedLatency: number;
  score: number; // VRAM-weighted + other factors
  fallbackChain: string[];
}
