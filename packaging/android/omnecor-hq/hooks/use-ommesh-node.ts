/**
 * React hook for the OMMESH phone node.
 * Wraps the mobile-mesh-node module and exposes reactive state.
 */
import { useState, useEffect, useCallback } from "react";
import {
  connect,
  disconnect,
  subscribeStatus,
  subscribeStats,
  getNodeStatus,
  getNodeId,
  type NodeStatus,
} from "@/lib/_core/mobile-mesh-node";
import { isServerConfigured } from "@/lib/_core/server-config";

export type OmmeshStats = {
  totalRequests: number;
  totalTokens: number;
  tokensPerSec: number;
};

export function useOmmeshNode(autoConnect = false) {
  const [status, setStatus]   = useState<NodeStatus>(getNodeStatus());
  const [stats, setStats]     = useState<OmmeshStats>({ totalRequests: 0, totalTokens: 0, tokensPerSec: 0 });
  const [nodeId]              = useState<string>(getNodeId());

  useEffect(() => {
    const unsubStatus = subscribeStatus(setStatus);
    const unsubStats  = subscribeStats(setStats);
    return () => {
      unsubStatus();
      unsubStats();
    };
  }, []);

  useEffect(() => {
    if (autoConnect && isServerConfigured()) connect();
  }, [autoConnect]);

  const handleConnect    = useCallback(() => connect(),    []);
  const handleDisconnect = useCallback(() => disconnect(), []);

  const isConnected  = status === "connected" || status === "registered";
  const isRegistered = status === "registered";

  return {
    status,
    nodeId,
    stats,
    isConnected,
    isRegistered,
    connect: handleConnect,
    disconnect: handleDisconnect,
  };
}
