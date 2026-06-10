/**
 * NetlistPanel Component
 *
 * Displays:
 * - Extracted netlist from schematic
 * - Net connections
 * - Component pin assignments
 */

import React, { useMemo } from 'react';
import { Node, Edge } from 'reactflow';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { componentLibrary } from '@/lib/componentLibrary';

export interface NetlistPanelProps {
  nodes: Node[];
  edges: Edge[];
  onClose: () => void;
}

interface NetConnection {
  net: string;
  components: Array<{
    reference: string;
    pin: string;
  }>;
}

export const NetlistPanel: React.FC<NetlistPanelProps> = ({
  nodes,
  edges,
  onClose,
}) => {
  const netlist = useMemo(() => {
    const nets: Record<string, NetConnection> = {};

    edges.forEach((edge) => {
      const sourceNode = nodes.find((n) => n.id === edge.source);
      const targetNode = nodes.find((n) => n.id === edge.target);

      if (sourceNode && targetNode) {
        const netName = edge.data?.net || `NET_${edge.id.substring(0, 8)}`;

        if (!nets[netName]) {
          nets[netName] = { net: netName, components: [] };
        }

        if (sourceNode.data?.reference) {
          nets[netName].components.push({
            reference: sourceNode.data.reference,
            pin: edge.sourceHandle || '1',
          });
        }

        if (targetNode.data?.reference) {
          nets[netName].components.push({
            reference: targetNode.data.reference,
            pin: edge.targetHandle || '1',
          });
        }
      }
    });

    nodes.forEach((node) => {
      if (node.data?.net && node.data.net !== '') {
        const netName = node.data.net;
        if (!nets[netName]) {
          nets[netName] = { net: netName, components: [] };
        }

        const exists = nets[netName].components.some(
          (c) => c.reference === node.data.reference
        );

        if (!exists && node.data.reference) {
          nets[netName].components.push({
            reference: node.data.reference,
            pin: '1',
          });
        }
      }
    });

    return Object.values(nets).sort((a, b) => a.net.localeCompare(b.net));
  }, [nodes, edges]);

  const stats = useMemo(
    () => ({
      totalNets: netlist.length,
      totalComponents: nodes.length,
      totalConnections: edges.length,
    }),
    [netlist, nodes, edges]
  );

  return (
    <div className="w-80 border-l border-border bg-card flex flex-col min-h-0 shadow-sm">
      {/* Header */}
      <div className="p-3 border-b border-border flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">Netlist</h2>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground text-lg leading-none"
        >
          ×
        </button>
      </div>

      {/* Statistics */}
      <div className="px-3 py-2 bg-muted/40 border-b border-border text-xs text-muted-foreground space-y-1">
        <p>
          <span className="font-semibold">Nets:</span> {stats.totalNets}
        </p>
        <p>
          <span className="font-semibold">Components:</span> {stats.totalComponents}
        </p>
        <p>
          <span className="font-semibold">Connections:</span> {stats.totalConnections}
        </p>
      </div>

      {/* Netlist */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-3 space-y-3">
          {netlist.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8">
              No connections yet. Draw wires to create nets.
            </p>
          ) : (
            netlist.map((net) => (
              <div key={net.net} className="border border-border rounded p-2">
                <div className="font-semibold text-xs text-foreground mb-2 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-accent" />
                  {net.net}
                </div>

                {net.components.length === 0 ? (
                  <p className="text-xs text-muted-foreground ml-4">No connections</p>
                ) : (
                  <ul className="space-y-1 ml-4">
                    {net.components.map((comp, idx) => (
                      <li key={idx} className="text-xs text-muted-foreground">
                        <span className="font-mono bg-muted px-1 rounded">
                          {comp.reference}
                        </span>
                        <span className="text-muted-foreground/60 mx-1">Pin</span>
                        <span className="font-mono bg-muted px-1 rounded">
                          {comp.pin}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))
          )}
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="p-2 border-t border-border bg-muted/40 text-xs text-muted-foreground">
        <p>Netlist auto-generated from connections</p>
      </div>
    </div>
  );
};

export default NetlistPanel;
