"use client";

import React, { useEffect } from "react";
import { BrainMapViewport } from "@/components/neural/NeuralGraphView";
import { useBrainMapStore } from "@/lib/stores/brainMapStore";
import { Brain, Anchor } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ExternalBrainMapWindow() {
  const { setWindowMode } = useBrainMapStore();

  useEffect(() => {
    document.title = "Omnecor Neural Brain Map (External)";

    // Request current state from main window immediately
    const storeChannel = new BroadcastChannel('omnecor_brain_map_store');
    storeChannel.postMessage({ type: 'requestInitialState' });

    const visualChannel = new BroadcastChannel('omnecor_visual_control_sync');
    visualChannel.postMessage({ type: 'requestInitialState' });

    // Listen for redock signal from main window
    const controlChannel = new BroadcastChannel('omnecor_neural_sync');
    controlChannel.onmessage = (event) => {
      if (event.data === 'redock') window.close();
    };

    return () => {
      storeChannel.close();
      visualChannel.close();
      controlChannel.close();
    };
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
          <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center border border-primary/20">
            <Brain className="w-5 h-5 text-primary" />
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
            className="h-8 gap-2 text-xs border-primary/30 hover:bg-primary/10"
            onClick={handleRedock}
          >
            <Anchor className="h-3.5 w-3.5" /> Redock to Workspace
          </Button>
          <div className="h-4 w-px bg-border mx-2" />
          <div className="flex gap-1.5">
            <div className="h-2.5 w-2.5 rounded-full bg-accent-warning/50 border border-accent-warning/20" />
            <div className="h-2.5 w-2.5 rounded-full bg-accent-success/50 border border-accent-success/20" />
          </div>
        </div>
      </div>

      {/* Main Viewport */}
      <div className="flex-1 relative bg-[#0B0F14]">
        <BrainMapViewport />
        
        {/* Floating Status Badge */}
        <div className="absolute top-6 right-6 px-3 py-1.5 rounded-full bg-background/80 border border-border backdrop-blur-md flex items-center gap-2 z-10 shadow-xl">
          <div className="h-1.5 w-1.5 rounded-full bg-primary/10 animate-pulse" />
          <span className="text-[10px] font-mono font-bold text-primary uppercase tracking-widest">Live Sync Active</span>
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
