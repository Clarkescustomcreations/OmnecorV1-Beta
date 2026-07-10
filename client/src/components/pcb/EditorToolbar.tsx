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
  Map,
} from 'lucide-react';
import { HowToTooltip } from "@/components/shell/HowToTooltip";

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
  showMiniMap: boolean;
  onMiniMapToggle: () => void;
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
  showMiniMap,
  onMiniMapToggle,
}) => {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-card border-b border-border shadow-sm w-full">
      <div className="flex flex-wrap items-center gap-2">
        {/* Mode Selector - Wider separate buttons */}
        <div className="flex items-center gap-1.5 mr-2">
          <HowToTooltip title="Editor Mode" description="Switch to Schematic layout" side="bottom">
            <Button
              size="sm"
              variant={mode === 'schematic' ? 'default' : 'outline'}
              className="h-8 px-4 text-xs font-semibold min-w-[95px] transition-colors"
              onClick={() => onModeChange('schematic')}
              id="btn-schematic-mode"
            >
              Schematic
            </Button>
          </HowToTooltip>
          <HowToTooltip title="Editor Mode" description="Switch to PCB layout" side="bottom">
            <Button
              size="sm"
              variant={mode === 'pcb' ? 'default' : 'outline'}
              className="h-8 px-4 text-xs font-semibold min-w-[95px] transition-colors"
              onClick={() => onModeChange('pcb')}
              id="btn-pcb-mode"
            >
              PCB
            </Button>
          </HowToTooltip>
        </div>

        <Separator orientation="vertical" className="h-6" />

        {/* Grid Controls */}
        <HowToTooltip title="Toggle Grid" description="Show or hide the canvas grid" side="bottom">
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
        </HowToTooltip>

        {/* Snap to Grid */}
        <HowToTooltip title="Snap to Grid" description="Toggle snapping components to grid lines" side="bottom">
          <Button
            variant="outline"
            size="sm"
            onClick={onSnapToggle}
            title={snapToGrid ? 'Disable Snap' : 'Enable Snap'}
            className={snapToGrid ? 'bg-primary/10' : ''}
          >
            <Magnet className={`w-4 h-4 ${snapToGrid ? 'text-primary' : ''}`} />
          </Button>
        </HowToTooltip>

        <Separator orientation="vertical" className="h-6" />

        {/* Transform Controls */}
        <HowToTooltip title="Rotate Component" description="Rotate selected component 90 degrees" side="bottom">
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
        </HowToTooltip>

        <HowToTooltip title="Flip Component" description="Mirror selected component horizontally" side="bottom">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onFlip('horizontal')}
            title="Flip Horizontal"
          >
            <FlipHorizontal2 className="w-4 h-4" />
          </Button>
        </HowToTooltip>

        {/* Delete */}
        <HowToTooltip title="Delete Component" description="Remove selected component from canvas" side="bottom">
          <Button
            variant="outline"
            size="sm"
            onClick={onDelete}
            title="Delete Selected (Del)"
            className="gap-2 text-destructive hover:text-destructive"
          >
            <Trash2 className="w-4 h-4" />
            Delete
          </Button>
        </HowToTooltip>

        <Separator orientation="vertical" className="h-6" />

        {/* Panel Toggles */}
        <HowToTooltip title="Component Library" description="Show or hide the component browser" side="bottom">
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
        </HowToTooltip>

        <HowToTooltip title="Properties Panel" description="Show or hide component properties" side="bottom">
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
        </HowToTooltip>

        <HowToTooltip title="AI Assistant" description="Show or hide the AI design helper" side="bottom">
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
        </HowToTooltip>

        <HowToTooltip title="Netlist View" description="Show or hide the circuit netlist" side="bottom">
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
        </HowToTooltip>
      </div>

      {/* Mini Map Toggle - Far Right Corner */}
      <div className="flex items-center gap-2 ml-auto">
        <HowToTooltip title="Mini Map" description="Show or hide canvas overview map" side="bottom">
          <Button
            variant="outline"
            size="sm"
            onClick={onMiniMapToggle}
            title={showMiniMap ? 'Hide Mini Map' : 'Show Mini Map'}
            className={`h-8 px-3 text-xs gap-1.5 transition-colors ${
              showMiniMap ? 'bg-primary/10 border-primary/40 text-primary hover:bg-primary/20' : ''
            }`}
            id="btn-toggle-minimap"
          >
            <Map className="w-3.5 h-3.5" />
            Mini Map: {showMiniMap ? 'On' : 'Off'}
          </Button>
        </HowToTooltip>
      </div>
    </div>
  );
};

