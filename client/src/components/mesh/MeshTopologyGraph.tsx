import { useEffect, useRef, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";
import type { NodeIdentity } from "@shared/types/ommesh.types";

// Canvas colors — canvas API cannot read CSS vars; values match UI-Tokens.md §5.1
// Same exception policy as ThreeViewer, SchematicEditor, EnhancedPCBEditor.
const COLOR_SELF   = "#1d4ed8"; // primary
const COLOR_PEER   = "#16a34a"; // success
const COLOR_UNAUTH = "#dc2626"; // destructive
const COLOR_EDGE   = "#3b82f6"; // accent
const COLOR_MUTED  = "#6b7280"; // muted-foreground
const GRAPH_BG     = "#0e0f14"; // background

export interface MeshGraphPeer {
  id: string;
  name: string;
  address: string;
  port: number;
  fingerprint: string;
  isApproved?: boolean;
}

interface MeshTopologyGraphProps {
  identity: NodeIdentity | undefined;
  peers: MeshGraphPeer[];
}

export function MeshTopologyGraph({ identity, peers }: MeshTopologyGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setWidth(el.offsetWidth || 300);
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setWidth(Math.floor(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const selfId = identity?.id ?? "__self__";

  const nodes = [
    {
      id: selfId,
      label: identity ? `${identity.hostname} (this)` : "This Node",
      isSelf: true,
      isApproved: true,
    },
    ...peers.map((p) => ({
      id: p.name || p.id || p.address,
      label: p.name || p.address,
      isSelf: false,
      ip: p.address,
      port: p.port,
      fingerprint: p.fingerprint,
      isApproved: p.isApproved ?? false,
    })),
  ];

  const links = peers.map((p) => ({
    source: selfId,
    target: p.name || p.id || p.address,
    isApproved: p.isApproved ?? false,
  }));

  return (
    <div
      ref={containerRef}
      className="w-full rounded-lg border border-border overflow-hidden"
      style={{ height: 320, background: GRAPH_BG }}
    >
      {width > 0 && (
        <ForceGraph2D
          graphData={{ nodes, links }}
          width={width}
          height={320}
          backgroundColor={GRAPH_BG}
          nodeCanvasObjectMode={() => "replace"}
          nodeCanvasObject={(node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
            const r = 8;
            const x = (node.x as number) ?? 0;
            const y = (node.y as number) ?? 0;

            if (node.isSelf) {
              ctx.beginPath();
              ctx.arc(x, y, r + 5, 0, Math.PI * 2);
              ctx.fillStyle = COLOR_SELF + "33";
              ctx.fill();
            }

            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fillStyle = node.isSelf
              ? COLOR_SELF
              : node.isApproved
              ? COLOR_PEER
              : COLOR_UNAUTH;
            ctx.fill();

            const fontSize = Math.max(9 / globalScale, 2.5);
            ctx.font = `${fontSize}px sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "top";
            ctx.fillStyle = "#f8f9fa";
            const raw: string = String(node.label ?? node.id ?? "");
            ctx.fillText(raw.length > 20 ? raw.slice(0, 18) + "…" : raw, x, y + r + 2);
          }}
          nodePointerAreaPaint={(node: any, color: string, ctx: CanvasRenderingContext2D) => {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc((node.x ?? 0) as number, (node.y ?? 0) as number, 12, 0, Math.PI * 2);
            ctx.fill();
          }}
          nodeLabel={(node: any) => {
            const lines: string[] = [`<b>${String(node.label ?? node.id)}</b>`];
            if (node.ip) lines.push(`IP: ${node.ip as string}${node.port ? `:${node.port as number}` : ""}`);
            if (node.fingerprint) lines.push(`FP: ${(node.fingerprint as string).slice(0, 20)}…`);
            lines.push(
              node.isSelf
                ? "Role: local node"
                : node.isApproved
                ? "Status: trusted"
                : "Status: pending approval"
            );
            return lines.join("<br/>");
          }}
          linkColor={(link: any) => (link.isApproved ? COLOR_EDGE : COLOR_MUTED)}
          linkLineDash={(link: any) => (link.isApproved ? null : [4, 4])}
          linkWidth={1.5}
          d3AlphaDecay={0.02}
          d3VelocityDecay={0.3}
          warmupTicks={50}
          cooldownTime={3000}
        />
      )}
    </div>
  );
}
