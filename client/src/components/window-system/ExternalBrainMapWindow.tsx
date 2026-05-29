"use client";

import React, { useEffect } from "react";
import { BrainMapViewport } from "@/components/neural/NeuralGraphView";
import { useBrainMapStore } from "@/lib/stores/brainMapStore";
import { Brain, Anchor, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ExternalBrainMapWindow() {
  const { setWindowMode } = useBrainMapStore();

  useEffect(() => {
    // Set document title for the separate window
    document.title = "Omnecor Neural Brain Map (External)";
    
    // Listen for redock message from parent if needed
    const bc = new BroadcastChannel('omnecor_neural_sync');
    bc.onmessage = (event) => {
      if (event.data === 'redock') {
        window.close();
      }
    };
    
    return () => bc.close();
  }, []);

  const handleRedock = () => {
    const bc = new BroadcastChannel('omnecor_neural_sync');
    bc.postMessage('redock_request');
    bc.close();
    window.close();
  };

  return (
    <div className="fixed inset-0 flex flex-col bg-background overflow-hidden select-none external-window-body">
      {/* Custom Title Bar for External Window */}
      <div className="flex items-center justify-between border-b border-border bg-card/80 px-6 py-3 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-accent/10 flex items-center justify-center border border-accent/20">
            <Brain className="w-5 h-5 text-accent" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight uppercase">Neural Brain Map</h1>
            <p className="text-[10px] text-muted-foreground font-mono">Cognitive Monitoring System v1.0</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button 
            variant="outline" 
            size="sm" 
            className="h-8 gap-2 text-xs border-accent/30 hover:bg-accent/10"
            onClick={handleRedock}
          >
            <Anchor className="h-3.5 w-3.5" /> Redock to Workspace
          </Button>
          <div className="h-4 w-px bg-border mx-2" />
          <div className="flex gap-1.5">
            <div className="h-2.5 w-2.5 rounded-full bg-orange-500/50 border border-orange-500/20" />
            <div className="h-2.5 w-2.5 rounded-full bg-green-500/50 border border-green-500/20" />
          </div>
        </div>
      </div>

      {/* Main Viewport */}
      <div className="flex-1 relative bg-[#0B0F14]">
        <BrainMapViewport />
        
        {/* Floating Status Badge */}
        <div className="absolute top-6 right-6 px-3 py-1.5 rounded-full bg-background/80 border border-border backdrop-blur-md flex items-center gap-2 z-10 shadow-xl">
          <div className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
          <span className="text-[10px] font-mono font-bold text-accent uppercase tracking-widest">Live Sync Active</span>
        </div>
      </div>

      <style>{`
        .external-window-body {
          background: #0B0F14;
          color: white;
        }
        
        /* Preserve exact visual identity - node styling override for external */
        .react-flow__node {
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.8) !important;
        }
      `}</style>
    </div>
  );
}
