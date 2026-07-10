/**
 * PeerCard — Persistent Ommesh peer status indicator.
 *
 * Lives in the sidebar footer so it's always visible regardless of which
 * page (chat, neural map, pipelines, etc.) the user is on. The component
 * polls the `mesh.discover` tRPC endpoint every 10 seconds to reflect
 * real-time peer availability.
 *
 * When `getPeers()` in DiscoveryService is fully wired it will receive
 * NodeIdentity-shaped objects. Until then it shows graceful empty state.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Wifi, WifiOff, ChevronDown, ChevronUp, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { HowToTooltip } from "@/components/shell/HowToTooltip";
import type { NodeCapabilities } from "@shared/types/ommesh.types";

interface DiscoveredPeer {
  id: string;
  hostname?: string;
  name?: string;
  latencyMs?: number;
  capabilities?: NodeCapabilities;
}

export function PeerCard() {
  const [expanded, setExpanded] = useState(false);

  const { data: peers = [], isLoading } = trpc.ommesh.discover.useQuery(undefined, {
    refetchInterval: 10_000,
    staleTime: 8_000,
  }) as { data: DiscoveredPeer[]; isLoading: boolean };

  const online = peers.length > 0;

  return (
    <div className="w-full rounded-lg border border-sidebar-border bg-sidebar-hover overflow-hidden text-xs">
      {/* Header row — always visible */}
      <HowToTooltip title="Toggle Ommesh Peers" description="View status of other Omnecor nodes on your local network." side="top">
        <button
          className="w-full flex items-center justify-between px-3 py-2 hover:bg-sidebar-hover/80 transition-colors"
          onClick={() => setExpanded(v => !v)}
          title="Toggle Ommesh peer list"
        >
          <div className="flex items-center gap-2 min-w-0">
            {isLoading ? (
              <span className="w-2 h-2 rounded-full bg-muted-foreground animate-pulse flex-shrink-0" />
            ) : online ? (
              <span className="w-2 h-2 rounded-full bg-accent-success flex-shrink-0" />
            ) : (
              <span className="w-2 h-2 rounded-full bg-muted-foreground/40 flex-shrink-0" />
            )}
            <span className="text-sidebar-foreground/80 font-medium truncate">Mesh Peers</span>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <Badge
              variant={online ? "default" : "secondary"}
              className={cn("text-[10px] px-1.5 py-0", online && "bg-accent-success/20 text-accent-success border-accent-success/30")}
            >
              {peers.length}
            </Badge>
            {expanded ? (
              <ChevronUp className="w-3 h-3 text-muted-foreground" />
            ) : (
              <ChevronDown className="w-3 h-3 text-muted-foreground" />
            )}
          </div>
        </button>
      </HowToTooltip>

      {/* Expanded peer list */}
      {expanded && (
        <div className="border-t border-sidebar-border px-2 pb-2 pt-1 space-y-1 max-h-48 overflow-y-auto">
          {isLoading && (
            <p className="text-[10px] text-muted-foreground px-1 py-1">Scanning mesh…</p>
          )}
          {!isLoading && !online && (
            <div className="flex items-center gap-1.5 px-1 py-1.5 text-muted-foreground">
              <WifiOff className="w-3 h-3 flex-shrink-0" />
              <span className="text-[10px]">No peers on local network</span>
            </div>
          )}
          {peers.map(peer => {
            const label = peer.name ?? peer.hostname ?? peer.id.slice(0, 14);
            const modelCount = peer.capabilities?.models?.length ?? 0;
            return (
              <div
                key={peer.id}
                className="flex items-center justify-between px-2 py-1.5 rounded bg-background/40 gap-2"
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <Wifi className="w-3 h-3 text-accent-success flex-shrink-0" />
                  <span className="font-mono text-[10px] truncate text-sidebar-foreground">{label}</span>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {peer.latencyMs !== undefined && (
                    <span className="text-[10px] text-muted-foreground">{peer.latencyMs}ms</span>
                  )}
                  {modelCount > 0 && (
                    <Badge variant="outline" className="text-[9px] px-1 py-0 gap-0.5">
                      <Zap className="w-2 h-2" />
                      {modelCount}
                    </Badge>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
