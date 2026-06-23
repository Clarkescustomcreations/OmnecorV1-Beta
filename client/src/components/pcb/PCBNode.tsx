/**
 * PCBNode Component
 * 
 * Renders a PCB footprint as a React Flow node.
 * Displays the component footprint outline and pad positions.
 * Supports rotation and layer visualization.
 */

import React, { useMemo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { Component } from '@/lib/componentLibrary';
type ComponentSymbol = Component;

export interface PCBNodeData {
  component: ComponentSymbol;
  reference: string;
  rotation: number; // 0, 90, 180, 270
  layer: 'top' | 'bottom'; // PCB layer
  isSelected: boolean;
}

export const PCBNode: React.FC<NodeProps<PCBNodeData>> = ({
  data,
  selected = false,
}) => {
  const { component, reference, rotation, layer } = data;

  // Calculate transform based on rotation
  const rotationDeg = rotation || 0;

  // Render handles for each pad
  const handles = useMemo(() => {
    return component.handles.map((handle: { id: string; position?: string; x?: number; y?: number }, index: number) => {
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
          type="source"
          position={positionMap[handle.position ?? "left"] ?? Position.Left}
          id={handle.id}
          className="w-2 h-2 bg-accent-warning rounded-none border border-accent-warning hover:bg-accent-warning"
          style={{
            opacity: 0.5,
          }}
        />
      );
    });
  }, [component.handles]);

  return (
    <div
      className={`
        relative p-1 rounded border transition-all
        ${
          selected
            ? 'border-2 border-primary bg-primary shadow-lg'
            : `border border-border ${layer === 'top' ? 'bg-red-50' : 'bg-blue-50'} shadow`
        }
      `}
      style={{
        width: `${component.footprintWidth}px`,
        height: `${component.footprintHeight}px`,
        transform: `rotate(${rotationDeg}deg)`,
        opacity: layer === 'top' ? 1 : 0.7,
      }}
    >
      {/* Footprint SVG */}
      {component.footprintSvg && (
        <div
          className="w-full h-full flex items-center justify-center"
          dangerouslySetInnerHTML={{
            __html: component.footprintSvg,
          }}
        />
      )}

      {/* Reference Label */}
      <div
        className="absolute top-0 left-0 text-xs font-bold text-muted-foreground pointer-events-none bg-white bg-opacity-70 px-1 rounded"
        style={{
          transform: `rotate(-${rotationDeg}deg)`,
          transformOrigin: 'top left',
        }}
      >
        {reference}
      </div>

      {/* Layer Indicator */}
      <div
        className="absolute bottom-0 right-0 text-xs font-semibold pointer-events-none px-1 rounded"
        style={{
          backgroundColor: layer === 'top' ? 'rgba(239, 68, 68, 0.3)' : 'rgba(59, 130, 246, 0.3)',
          color: layer === 'top' ? 'rgb(127, 29, 29)' : 'rgb(30, 58, 138)',
          transform: `rotate(-${rotationDeg}deg)`,
          transformOrigin: 'bottom right',
        }}
      >
        {layer.toUpperCase()}
      </div>

      {/* Pad Handles */}
      {handles}
    </div>
  );
};

