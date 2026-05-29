import OmnecorDashboardLayout from "@/components/OmnecorDashboardLayout";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Brain, Grid3x3, List, Settings, Shield } from "lucide-react";
import { useState, useMemo, useEffect } from "react";
import NeuralGraphView from "@/components/neural/NeuralGraphView";
import NeuralTreeView from "@/components/neural/NeuralTreeView";
import MapManager from "@/components/neural/MapManager";
import FictionModePanel from "@/components/neural/FictionModePanel";
import { trpc } from "@/lib/trpc";
import { fileTreeToNetwork } from "@/lib/fileTreeToNetwork";
import { NeuralMapProvider, useNeuralMap } from "@/contexts/NeuralMapContext";
import { FictionModeProvider, useFictionMode } from "@/contexts/FictionModeContext";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { Badge } from "@/components/ui/badge";

/**
 * Neural Brain Map Page Content
 * Extracted to use contexts provided in the main BrainMap export
 */
function BrainMapContent() {
  const [viewMode, setViewMode] = useState<"graph" | "tree">("graph");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const { activeMap } = useNeuralMap();
  const { setFictionMode, isFictionMode } = useFictionMode();

  // Sync fiction mode with active map mode
  useEffect(() => {
    if (activeMap) {
      setFictionMode(activeMap.mode === "fiction");
    }
  }, [activeMap, setFictionMode]);

  // Fetch file tree for the active map (first root for now)
  const activeRoot = activeMap?.rootDirectories[0];
  const { data: fileTree, isLoading } = trpc.project.getFileTree.useQuery(
    { 
      projectId: activeMap?.id ?? "", 
      rootDir: activeRoot ?? "" 
    },
    { 
      enabled: !!activeMap && !!activeRoot,
      refetchInterval: activeMap?.settings.realtimeSync ? 30000 : false 
    }
  );

  // Register watchers for all roots of active map
  const registerProject = trpc.project.registerProject.useMutation();
  
  useEffect(() => {
    if (activeMap?.rootDirectories) {
      activeMap.rootDirectories.forEach(dir => {
        registerProject.mutate({
          projectId: activeMap.id,
          rootDir: dir,
        });
      });
    }
  }, [activeMap?.id]); // Only on map switch

  const neuralNetwork = useMemo(() => {
    if (!fileTree || !activeMap)
      return {
        id: "default",
        name: "No Active Map",
        type: "master",
        nodes: [],
        edges: [],
      } as any;
    
    return fileTreeToNetwork(fileTree, {
      projectId: activeMap.id,
      projectName: activeMap.name,
    });
  }, [fileTree, activeMap]);

  const selectedNode = neuralNetwork.nodes.find(
    (n: any) => n.id === selectedNodeId
  );

  return (
    <OmnecorDashboardLayout>
      <div className="h-full flex flex-col bg-background overflow-hidden">
        <ResizablePanelGroup direction="horizontal" className="flex-1">
          {/* Left Sidebar: Map Manager */}
          <ResizablePanel defaultSize={20} minSize={15} maxSize={30} className="border-r border-border">
            <div className="h-full p-4">
              <MapManager />
            </div>
          </ResizablePanel>
          
          <ResizableHandle withHandle />

          {/* Main Area: Graph/Tree View */}
          <ResizablePanel defaultSize={55} className="flex flex-col">
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Header */}
              <div className="border-b border-border bg-card px-6 py-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Brain className="w-6 h-6 text-accent" />
                  <div>
                    <h1 className="text-xl font-bold flex items-center gap-2">
                      {activeMap?.name ?? "Neural Brain Map"}
                      {isFictionMode && (
                        <Badge variant="outline" className="text-accent border-accent text-[10px] py-0">
                          Fiction Mode
                        </Badge>
                      )}
                    </h1>
                    <p className="text-sm text-muted-foreground">
                      {activeMap ? `Mode: ${activeMap.mode}` : "Select or create a neural map to begin"}
                    </p>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button
                    size="icon"
                    variant={viewMode === "graph" ? "default" : "outline"}
                    onClick={() => setViewMode("graph")}
                    title="Graph view"
                  >
                    <Grid3x3 className="w-4 h-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant={viewMode === "tree" ? "default" : "outline"}
                    onClick={() => setViewMode("tree")}
                    title="Tree view"
                  >
                    <List className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              {/* View Content */}
              <div className="flex-1 p-6 overflow-hidden">
                <Card className="h-full flex flex-col overflow-hidden">
                  <CardContent className="flex-1 p-0 flex overflow-hidden">
                    {activeMap ? (
                      isLoading ? (
                        <div className="flex-1 flex items-center justify-center text-muted-foreground animate-pulse">
                          Indexing Neural Network...
                        </div>
                      ) : viewMode === "graph" ? (
                        <NeuralGraphView
                          network={neuralNetwork}
                          projectId={activeMap.id}
                          onNodeClick={setSelectedNodeId}
                        />
                      ) : (
                        <NeuralTreeView
                          network={neuralNetwork}
                          onNodeClick={setSelectedNodeId}
                        />
                      )
                    ) : (
                      <div className="flex-1 flex items-center justify-center text-muted-foreground">
                        Please select or create a map from the sidebar
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* Right Sidebar: Properties or Fiction Controls */}
          <ResizablePanel defaultSize={25} minSize={20} maxSize={35} className="border-l border-border">
            <div className="h-full overflow-auto">
              {isFictionMode ? (
                <FictionModePanel />
              ) : (
                <div className="p-4 space-y-4">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <Settings className="w-4 h-4" /> Map Properties
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Active Map:</span>
                        <span className="font-medium">{activeMap?.name || "None"}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Files Indexed:</span>
                        <span className="font-mono text-accent">{neuralNetwork.nodes.length}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Realtime Sync:</span>
                        <Badge variant={activeMap?.settings.realtimeSync ? "default" : "secondary"}>
                          {activeMap?.settings.realtimeSync ? "On" : "Off"}
                        </Badge>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Node Inspector</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {selectedNode ? (
                        <div className="space-y-3 text-sm">
                          <div className="flex flex-col gap-1">
                            <span className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Name</span>
                            <span className="font-mono break-all">{selectedNode.label}</span>
                          </div>
                          <div className="flex flex-col gap-1">
                            <span className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Type</span>
                            <Badge className="w-fit capitalize">{selectedNode.type}</Badge>
                          </div>
                          <div className="flex flex-col gap-1">
                            <span className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Path</span>
                            <span className="font-mono text-[10px] break-all bg-muted p-1 rounded">
                              {selectedNode.data?.path}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="p-8 rounded-lg border border-dashed border-border flex items-center justify-center text-muted-foreground text-xs text-center">
                          Select a node in the graph to view its cognitive properties
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              )}
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </OmnecorDashboardLayout>
  );
}

export default function BrainMap() {
  return (
    <NeuralMapProvider>
      <NeuralMapWrapper />
    </NeuralMapProvider>
  );
}

/**
 * Wrapper to access NeuralMapContext for FictionModeProvider
 */
function NeuralMapWrapper() {
  const { activeMapId } = useNeuralMap();
  return (
    <FictionModeProvider mapId={activeMapId || undefined}>
      <BrainMapContent />
    </FictionModeProvider>
  );
}
