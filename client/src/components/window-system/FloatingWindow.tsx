"use client";

import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Maximize2, Minimize2, Anchor } from "lucide-react";
import { Button } from "@/components/ui/button";

interface FloatingWindowProps {
  title: string;
  isOpen: boolean;
  onClose: () => void;
  onDock?: () => void;
  onExternal?: () => void;
  children: React.ReactNode;
  initialPosition?: { x: number; y: number };
  initialSize?: { width: number; height: number };
  onPositionChange?: (pos: { x: number; y: number }) => void;
  onSizeChange?: (size: { width: number; height: number }) => void;
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
  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        drag
        dragMomentum={false}
        initial={{ opacity: 0, scale: 0.95, x: initialPosition.x, y: initialPosition.y }}
        animate={{ opacity: 1, scale: 1, x: initialPosition.x, y: initialPosition.y }}
        exit={{ opacity: 0, scale: 0.95 }}
        style={{
          width: initialSize.width,
          height: initialSize.height,
        }}
        className="fixed z-50 flex flex-col overflow-hidden rounded-xl border border-border bg-background/95 shadow-2xl backdrop-blur-xl floating-window-root"
        transition={{ type: "spring", duration: 0.3, bounce: 0.2 }}
      >
        {/* Header / Drag Handle */}
        <div className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-2 cursor-grab active:cursor-grabbing">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-accent animate-pulse" />
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {title}
            </span>
          </div>
          
          <div className="flex items-center gap-1">
            {onDock && (
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onDock} title="Dock to workspace">
                <Anchor className="h-3.5 w-3.5" />
              </Button>
            )}
            {onExternal && (
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onExternal} title="Move to external window">
                <Maximize2 className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-destructive/20 hover:text-destructive" onClick={onClose}>
              <X className="h-3.5 w-3.5" />
            </Button>
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
