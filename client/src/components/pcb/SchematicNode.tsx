/**
 * SchematicNode Component
 * 
 * Renders a schematic symbol as a React Flow node.
 * Displays the component symbol, reference designator, and value.
 * Supports rotation and selection states.
 */

import React, { useMemo } from 'react';
import DOMPurify from 'dompurify';
import { Handle, Position, NodeProps } from 'reactflow';
import { Component, componentLibrary } from '@/lib/componentLibrary';
type ComponentSymbol = Component;

export interface SchematicNodeData {
  component: ComponentSymbol;
  reference: string;
  value: string;
  rotation: number; // 0, 90, 180, 270
  isSelected: boolean;
}

export const SchematicNode: React.FC<NodeProps<SchematicNodeData>> = ({
  data,
  selected = false,
}) => {
  // Old saved designs may store the component ID string instead of the full object.
  const raw = data.component as unknown;
  const component: ComponentSymbol | undefined =
    typeof raw === 'string'
      ? componentLibrary.find(c => c.id === raw)
      : (raw as ComponentSymbol | undefined);
  const { reference, value, rotation } = data;

  // Calculate transform based on rotation
  const rotationDeg = rotation || 0;

  // Render handles for each connection point
  const handles = useMemo(() => {
    if (!component?.handles) return [];
    return component.handles.map((handle: { id: string; position?: string; type?: string; x?: number; y?: number }, _index: number) => {
      // Map position to React Flow Position enum
      const positionMap: Record<string, Position> = {
        left: Position.Left,
        right: Position.Right,
        top: Position.Top,
        bottom: Position.Bottom,
      };

      return (
        <Handle
          key={handle.id}
          type={handle.type === 'both' ? 'source' : handle.type === 'source' ? 'source' : 'target'}
          position={positionMap[handle.position ?? "left"] ?? Position.Left}
          id={handle.id}
          className="w-3 h-3 bg-accent-warning rounded-none border-2 border-accent-warning hover:bg-accent-warning"
          style={{
            // Position handles around the node
            opacity: 0.5,
          }}
        />
      );
    });
  }, [component?.handles]);

  if (!component) {
    return (
      <div className="relative p-2 rounded border-2 border-destructive bg-destructive/10 text-xs text-destructive w-24 h-12 flex items-center justify-center">
        Unknown component
      </div>
    );
  }

  return (
    <div
      className={`
        relative p-2 rounded border-2 transition-all
        ${
          selected
            ? 'border-primary bg-blue-50 shadow-lg'
            : 'border-accent-warning bg-card shadow'
        }
      `}
      style={{
        width: `${component.symbolWidth}px`,
        height: `${component.symbolHeight}px`,
        transform: `rotate(${rotationDeg}deg)`,
      }}
    >
      {/* Symbol SVG */}
      <div
        className="w-full h-full flex items-center justify-center"
        dangerouslySetInnerHTML={{
          __html: DOMPurify.sanitize(component.symbolSvg),
        }}
      />

      {/* Reference and Value Labels */}
      <div
        className="absolute top-0 left-0 text-xs font-bold text-accent-warning pointer-events-none"
        style={{
          transform: `rotate(-${rotationDeg}deg)`,
          transformOrigin: 'top left',
        }}
      >
        <div>{reference}</div>
        {value && <div className="text-xs text-accent-warning">{value}</div>}
      </div>

      {/* Connection Handles */}
      {handles}
    </div>
  );
};

