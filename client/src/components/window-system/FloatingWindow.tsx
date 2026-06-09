"use client";

import React from "react";
import { motion, AnimatePresence, useDragControls } from "framer-motion";
import { X, Maximize2, Anchor, Pin, PinOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { HowToTooltip } from "@/components/shell/HowToTooltip";

interface FloatingWindowProps {
  title: string;
  isOpen: boolean;
  onClose: () => void;
  onDock?: () => void;
  onExternal?: () => void;
  children: React.ReactNode;
  initialPosition?: { x: number; y: number };
  initialSize?: { width: number; height: number };
}

export function FloatingWindow({
  title,
  isOpen,
  onClose,
  onDock,
  onExternal,
  children,
  initialPosition = { x: 100, y: 100 },
  initialSize = { width: 800, height: 600 },
}: FloatingWindowProps) {
  const [isPinned, setIsPinned] = React.useState(false);
  const dragControls = useDragControls();
  
  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        drag
        dragControls={dragControls}
        dragListener={false}
        dragMomentum={false}
        initial={{ opacity: 0, scale: 0.95, x: initialPosition.x, y: initialPosition.y }}
        animate={{ opacity: 1, scale: 1, x: initialPosition.x, y: initialPosition.y }}
        exit={{ opacity: 0, scale: 0.95 }}
        style={{
          width: initialSize.width,
          height: initialSize.height,
        }}
        className={cn(
          "fixed flex flex-col overflow-hidden rounded-xl border border-border bg-background/95 shadow-2xl backdrop-blur-xl floating-window-root",
          isPinned ? "z-[9999]" : "z-50"
        )}
        transition={{ type: "spring", duration: 0.3, bounce: 0.2 }}
      >
        {/* Header / Drag Handle */}
        <div 
          onPointerDown={(e) => dragControls.start(e)}
          className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-2 cursor-grab active:cursor-grabbing select-none"
        >
          <div className="flex items-center gap-2">
            <div className={cn("h-2 w-2 rounded-full animate-pulse", isPinned ? "bg-red-500 shadow-[0_0_8px_red]" : "bg-accent")} />
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground truncate max-w-[200px]">
              {title}
            </span>
          </div>
          
          <div className="flex items-center gap-1" onPointerDown={e => e.stopPropagation()}>
            <HowToTooltip title="Stay on Top" description="Pin this window to the foreground. It will remain visible even when you click on other workspace elements.">
              <Button 
                variant="ghost" 
                size="icon" 
                className={cn("h-7 w-7", isPinned && "text-accent bg-accent/10")} 
                onClick={() => setIsPinned(!isPinned)}
              >
                {isPinned ? <PinOff className="h-3.5 h-3.5" /> : <Pin className="h-3.5 h-3.5" />}
              </Button>
            </HowToTooltip>

            {onDock && (
              <HowToTooltip title="Re-dock" description="Return this window to its fixed position within the workspace layout.">
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onDock}>
                  <Anchor className="h-3.5 w-3.5" />
                </Button>
              </HowToTooltip>
            )}

            {onExternal && (
              <HowToTooltip title="External Window" description="Pop this workspace out into a completely separate browser window for multi-monitor setups.">
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onExternal}>
                  <Maximize2 className="h-3.5 w-3.5" />
                </Button>
              </HowToTooltip>
            )}

            <HowToTooltip title="Close Window" description="Close this floating overlay and return to the main view.">
              <Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-destructive/20 hover:text-destructive" onClick={onClose}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </HowToTooltip>
          </div>
        </div>

        {/* Content */}
        <div className="relative flex-1 overflow-hidden bg-background/50">
          {children}
        </div>

        {/* Resize Handle (Simplified) */}
        <div className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize" />
        
        <style>{`
          .floating-window-root {
            background: var(--bg-primary);
            border: 1px solid var(--border);
            box-shadow: 0 0 40px oklch(0.72 0.18 210 / 0.12);
          }
        `}</style>
      </motion.div>
    </AnimatePresence>
  );
}
