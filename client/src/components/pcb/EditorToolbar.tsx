/**
 * EditorToolbar Component
 * 
 * Provides toolbar with editor controls:
 * - Mode switching (Schematic/PCB)
 * - Grid and snap controls
 * - Rotation and flip operations
 * - Delete and other actions
 * - Panel visibility toggles
 */

import React from 'react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  ToggleGroup,
  ToggleGroupItem,
} from '@/components/ui/toggle-group';
import {
  Grid3x3,
  RotateCw,
  FlipHorizontal2,
  Trash2,
  Eye,
  EyeOff,
  Grid2x2,
  Magnet,
  MessageSquare,
  List,
} from 'lucide-react';

export interface EditorToolbarProps {
  mode: 'schematic' | 'pcb';
  onModeChange: (mode: 'schematic' | 'pcb') => void;
  gridVisible: boolean;
  onGridToggle: () => void;
  snapToGrid: boolean;
  onSnapToggle: () => void;
  onRotate: (angle: number) => void;
  onFlip: (direction: 'horizontal' | 'vertical') => void;
  onDelete: () => void;
  onShowLibrary: () => void;
  onShowProperties: () => void;
  onShowAI: () => void;
  onShowNetlist: () => void;
}

export const EditorToolbar: React.FC<EditorToolbarProps> = ({
  mode,
  onModeChange,
  gridVisible,
  onGridToggle,
  snapToGrid,
  onSnapToggle,
  onRotate,
  onFlip,
  onDelete,
  onShowLibrary,
  onShowProperties,
  onShowAI,
  onShowNetlist,
}) => {
  return (
    <div className="flex items-center gap-2 p-3 bg-card border-b border-border shadow-sm">
      {/* Mode Selector */}
      <ToggleGroup
        type="single"
        value={mode}
        onValueChange={(value) => {
          if (value) onModeChange(value as 'schematic' | 'pcb');
        }}
        className="border border-border rounded"
      >
        <ToggleGroupItem value="schematic" aria-label="Schematic Mode">
          Schematic
        </ToggleGroupItem>
        <ToggleGroupItem value="pcb" aria-label="PCB Mode">
          PCB
        </ToggleGroupItem>
      </ToggleGroup>

      <Separator orientation="vertical" className="h-6" />

      {/* Grid Controls */}
      <Button
        variant="outline"
        size="sm"
        onClick={onGridToggle}
        title={gridVisible ? 'Hide Grid' : 'Show Grid'}
        className="gap-2"
      >
        {gridVisible ? (
          <>
            <Grid2x2 className="w-4 h-4" />
            Grid On
          </>
        ) : (
          <>
            <EyeOff className="w-4 h-4" />
            Grid Off
          </>
        )}
      </Button>

      {/* Snap to Grid */}
      <Button
        variant="outline"
        size="sm"
        onClick={onSnapToggle}
        title={snapToGrid ? 'Disable Snap' : 'Enable Snap'}
        className={snapToGrid ? 'bg-accent/10' : ''}
      >
        <Magnet className={`w-4 h-4 ${snapToGrid ? 'text-accent' : ''}`} />
      </Button>

      <Separator orientation="vertical" className="h-6" />

      {/* Transform Controls */}
      <Button
        variant="outline"
        size="sm"
        onClick={() => onRotate(90)}
        title="Rotate 90°"
        className="gap-2"
      >
        <RotateCw className="w-4 h-4" />
        Rotate
      </Button>

      <Button
        variant="outline"
        size="sm"
        onClick={() => onFlip('horizontal')}
        title="Flip Horizontal"
      >
        <FlipHorizontal2 className="w-4 h-4" />
      </Button>

      {/* Delete */}
      <Button
        variant="outline"
        size="sm"
        onClick={onDelete}
        title="Delete Selected (Del)"
        className="gap-2 text-red-600 hover:text-red-700"
      >
        <Trash2 className="w-4 h-4" />
        Delete
      </Button>

      <Separator orientation="vertical" className="h-6" />

      {/* Panel Toggles */}
      <Button
        variant="outline"
        size="sm"
        onClick={onShowLibrary}
        title="Toggle Component Library"
        className="gap-2"
      >
        <Grid3x3 className="w-4 h-4" />
        Library
      </Button>

      <Button
        variant="outline"
        size="sm"
        onClick={onShowProperties}
        title="Toggle Properties Panel"
        className="gap-2"
      >
        <Eye className="w-4 h-4" />
        Properties
      </Button>

      <Button
        variant="outline"
        size="sm"
        onClick={onShowAI}
        title="Toggle AI Assistant"
        className="gap-2"
      >
        <MessageSquare className="w-4 h-4" />
        AI
      </Button>

      <Button
        variant="outline"
        size="sm"
        onClick={onShowNetlist}
        title="Toggle Netlist"
        className="gap-2"
      >
        <List className="w-4 h-4" />
        Netlist
      </Button>
    </div>
  );
};

export default EditorToolbar;
