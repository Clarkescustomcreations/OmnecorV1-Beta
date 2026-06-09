/**
 * PropertiesPanel Component
 *
 * Right sidebar panel for editing:
 * - Component reference designator
 * - Component value
 * - Footprint selection
 * - Net labels
 * - Custom properties
 */

import React, { useMemo } from 'react';
import { Node } from 'reactflow';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { componentLibrary } from '@/lib/componentLibrary';

export interface PropertiesPanelProps {
  selectedNodeId: string | null;
  nodes: Node[];
  onUpdateNode: (node: Node) => void;
}

export const PropertiesPanel: React.FC<PropertiesPanelProps> = ({
  selectedNodeId,
  nodes,
  onUpdateNode,
}) => {
  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId),
    [selectedNodeId, nodes]
  );

  const componentInfo = useMemo(() => {
    if (!selectedNode?.data?.component) return null;
    return componentLibrary.find((c) => c.id === selectedNode.data.component);
  }, [selectedNode]);

  const handlePropertyChange = (key: string, value: any) => {
    if (!selectedNode) return;
    const updatedNode: Node = {
      ...selectedNode,
      data: { ...selectedNode.data, [key]: value },
    };
    onUpdateNode(updatedNode);
  };

  if (!selectedNode || !componentInfo) {
    return (
      <div className="w-72 border-l border-border bg-card flex flex-col">
        <div className="p-4 flex items-center justify-center h-full text-muted-foreground text-sm">
          Select a component to view properties
        </div>
      </div>
    );
  }

  return (
    <div className="w-72 border-l border-border bg-card flex flex-col shadow-sm">
      {/* Header */}
      <div className="p-3 border-b border-border">
        <h2 className="text-sm font-semibold text-foreground">Properties</h2>
        <p className="text-xs text-muted-foreground mt-1">{componentInfo.name}</p>
      </div>

      {/* Properties */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          <div>
            <Label htmlFor="reference" className="text-xs font-semibold">
              Reference
            </Label>
            <Input
              id="reference"
              value={selectedNode.data.reference || ''}
              onChange={(e) => handlePropertyChange('reference', e.target.value)}
              className="mt-1 h-8 text-sm"
              placeholder="e.g., R1, C2, U3"
            />
          </div>

          <Separator />

          <div>
            <Label htmlFor="value" className="text-xs font-semibold">
              Value
            </Label>
            <Input
              id="value"
              value={selectedNode.data.value || ''}
              onChange={(e) => handlePropertyChange('value', e.target.value)}
              className="mt-1 h-8 text-sm"
              placeholder="e.g., 10k, 100nF, LM7805"
            />
          </div>

          <Separator />

          <div>
            <Label htmlFor="footprint" className="text-xs font-semibold">
              Footprint
            </Label>
            <select
              id="footprint"
              value={selectedNode.data.footprint || 'default'}
              onChange={(e) => handlePropertyChange('footprint', e.target.value)}
              className="mt-1 w-full h-8 text-sm border border-border rounded px-2 bg-background text-foreground"
            >
              <option value="default">Default</option>
              <option value="0603">0603</option>
              <option value="0805">0805</option>
              <option value="1206">1206</option>
              <option value="SOT-23">SOT-23</option>
              <option value="DIP8">DIP8</option>
              <option value="DIP14">DIP14</option>
              <option value="SOIC8">SOIC8</option>
            </select>
          </div>

          <Separator />

          <div>
            <Label htmlFor="net" className="text-xs font-semibold">
              Net Label
            </Label>
            <Input
              id="net"
              value={selectedNode.data.net || ''}
              onChange={(e) => handlePropertyChange('net', e.target.value)}
              className="mt-1 h-8 text-sm"
              placeholder="e.g., VCC, GND, DATA"
            />
          </div>

          <Separator />

          <div>
            <Label htmlFor="rotation" className="text-xs font-semibold">
              Rotation
            </Label>
            <div className="flex gap-2 mt-1">
              {[0, 90, 180, 270].map((angle) => (
                <button
                  key={angle}
                  onClick={() => handlePropertyChange('rotation', angle)}
                  className={`
                    flex-1 h-8 text-xs font-medium rounded border transition-all
                    ${
                      selectedNode.data.rotation === angle
                        ? 'bg-accent text-accent-foreground border-accent'
                        : 'bg-muted text-muted-foreground border-border hover:bg-muted/80'
                    }
                  `}
                >
                  {angle}°
                </button>
              ))}
            </div>
          </div>

          <Separator />

          <div>
            <h3 className="text-xs font-semibold text-foreground mb-2">Component Info</h3>
            <div className="space-y-1 text-xs text-muted-foreground">
              <p>
                <span className="font-semibold">Category:</span> {componentInfo.category}
              </p>
              {componentInfo.manufacturer && (
                <p>
                  <span className="font-semibold">Manufacturer:</span>{' '}
                  {componentInfo.manufacturer}
                </p>
              )}
              {componentInfo.partNumber && (
                <p>
                  <span className="font-semibold">Part #:</span> {componentInfo.partNumber}
                </p>
              )}
              <p>
                <span className="font-semibold">Tags:</span> {componentInfo.tags.join(', ')}
              </p>
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
};

export default PropertiesPanel;
