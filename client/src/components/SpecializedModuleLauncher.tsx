import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Brain, Box, Zap, Play, Settings, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getModuleInfo,
  type LLMBuilderSession,
  type BlenderProject,
  type PCBProject,
} from "@/lib/specializedModules";

interface SpecializedModuleLauncherProps {
  className?: string;
}

/**
 * Specialized Module Launcher Component
 *
 * Provides access to three specialized tools:
 * 1. Custom LLM Builder - Fine-tuning with LoRA/QLoRA
 * 2. AI-Assisted 3D Modeler - Blender co-pilot
 * 3. AI-Assisted PCB Designer - KiCad co-pilot
 */
export default function SpecializedModuleLauncher({
  className,
}: SpecializedModuleLauncherProps) {
  const [activeTab, setActiveTab] = useState<"llm" | "3d" | "pcb">("llm");
  const [llmSession, setLLMSession] = useState<LLMBuilderSession | null>(null);
  const [blenderProject, setBlenderProject] = useState<BlenderProject | null>(null);
  const [pcbProject, setPCBProject] = useState<PCBProject | null>(null);

  const getLLMBuilderContent = () => {
    if (!llmSession) {
      return (
        <div className="flex items-center justify-center p-8">
          <div className="text-center">
            <Brain className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <h3 className="font-semibold mb-2">No Active Session</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Create a new LLM fine-tuning session to get started.
            </p>
            <Button size="sm">
              <Plus className="w-4 h-4 mr-2" />
              Create Session
            </Button>
          </div>
        </div>
      );
    }

    return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Session Info */}
        <Card className="bg-muted/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Active Session</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div>
              <p className="text-muted-foreground">Name</p>
              <p className="font-semibold">{llmSession.name}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Base Model</p>
              <p className="font-mono text-xs">{llmSession.baseModel}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Status</p>
              <Badge
                variant={
                  llmSession.status === "completed" ? "default" : "secondary"
                }
              >
                {llmSession.status}
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* Progress */}
        <Card className="bg-muted/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Training Progress</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span>Overall Progress</span>
                <span className="font-semibold">{llmSession.progress}%</span>
              </div>
              <div className="w-full bg-muted rounded-full h-2">
                <div
                  className="bg-accent h-2 rounded-full transition-all"
                  style={{ width: `${llmSession.progress}%` }}
                />
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              {llmSession.trainingMetrics.length} epochs completed
            </div>
          </CardContent>
        </Card>
      </div>

      {/* LoRA Configurations */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">LoRA Configurations</CardTitle>
            <Button size="sm" variant="outline">
              <Plus className="w-4 h-4 mr-2" />
              New Config
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {llmSession.loraConfigs.length > 0 ? (
            <div className="space-y-2">
              {llmSession.loraConfigs.map(config => (
                <div
                  key={config.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border"
                >
                  <div>
                    <p className="font-semibold text-sm">{config.name}</p>
                    <p className="text-xs text-muted-foreground">
                      Rank: {config.rank}, Alpha: {config.alpha}, Epochs:{" "}
                      {config.epochs}
                    </p>
                  </div>
                  <Button size="sm" variant="ghost" aria-label={`Configure ${config.name}`}>
                    <Settings className="w-4 h-4" aria-hidden="true" />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No LoRA configurations yet
            </p>
          )}
        </CardContent>
      </Card>

      {/* Training Metrics */}
      {llmSession.trainingMetrics.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Training Metrics</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-32">
              <div className="space-y-2">
                {llmSession.trainingMetrics.map(metric => (
                  <div
                    key={metric.epoch}
                    className="text-xs p-2 rounded bg-muted/50"
                  >
                    <div className="flex justify-between">
                      <span>Epoch {metric.epoch}</span>
                      <span className="text-accent">
                        Loss: {metric.loss.toFixed(3)}
                      </span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>Val Loss: {metric.valLoss.toFixed(3)}</span>
                      <span>
                        Accuracy: {(metric.accuracy * 100).toFixed(1)}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <Button className="flex-1" aria-label="Start LLM training">
          <Play className="w-4 h-4 mr-2" aria-hidden="true" />
          Start Training
        </Button>
        <Button variant="outline" className="flex-1" aria-label="Configure LLM training">
          <Settings className="w-4 h-4 mr-2" aria-hidden="true" />
          Configure
        </Button>
      </div>
    </div>
    );
  };

  const get3DModelerContent = () => {
    if (!blenderProject) {
      return (
        <div className="flex items-center justify-center p-8">
          <div className="text-center">
            <Box className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <h3 className="font-semibold mb-2">No Active Project</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Create a new Blender project to start 3D modeling.
            </p>
            <Button size="sm">
              <Plus className="w-4 h-4 mr-2" />
              New Project
            </Button>
          </div>
        </div>
      );
    }

    return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Project Info */}
        <Card className="bg-muted/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Active Project</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div>
              <p className="text-muted-foreground">Project Name</p>
              <p className="font-semibold">{blenderProject.name}</p>
            </div>
            <div>
              <p className="text-muted-foreground">File Path</p>
              <p className="font-mono text-xs truncate">
                {blenderProject.filePath}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Status</p>
              <Badge
                variant={
                  blenderProject.status === "completed"
                    ? "default"
                    : "secondary"
                }
              >
                {blenderProject.status}
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* Objects Count */}
        <Card className="bg-muted/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Scene Objects</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-3xl font-bold text-accent">
              {blenderProject.objects.length}
            </div>
            <div className="text-xs text-muted-foreground">
              Objects in scene
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Objects List */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Scene Objects</CardTitle>
            <Button size="sm" variant="outline">
              <Plus className="w-4 h-4 mr-2" />
              Add Object
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {blenderProject.objects.length > 0 ? (
            <div className="space-y-2">
              {blenderProject.objects.map((obj, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border"
                >
                  <div>
                    <p className="font-semibold text-sm">{obj.name}</p>
                    <p className="text-xs text-muted-foreground">
                      Type: {obj.type} | Pos: ({obj.position.join(", ")})
                    </p>
                  </div>
                  <Button size="sm" variant="ghost" aria-label={`Configure ${obj.name}`}>
                    <Settings className="w-4 h-4" aria-hidden="true" />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No objects in scene</p>
          )}
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex gap-2">
        <Button className="flex-1" aria-label="Open project in Blender">
          <Box className="w-4 h-4 mr-2" aria-hidden="true" />
          Open in Blender
        </Button>
        <Button variant="outline" className="flex-1" aria-label="Configure 3D Modeler settings">
          <Settings className="w-4 h-4 mr-2" aria-hidden="true" />
          Settings
        </Button>
      </div>
    </div>
    );
  };

  const getPCBDesignerContent = () => {
    if (!pcbProject) {
      return (
        <div className="flex items-center justify-center p-8">
          <div className="text-center">
            <Zap className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <h3 className="font-semibold mb-2">No Active Project</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Create a new KiCad project to start PCB design.
            </p>
            <Button size="sm">
              <Plus className="w-4 h-4 mr-2" />
              New Project
            </Button>
          </div>
        </div>
      );
    }

    return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Project Info */}
        <Card className="bg-muted/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Active Project</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div>
              <p className="text-muted-foreground">Project Name</p>
              <p className="font-semibold truncate">{pcbProject.name}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Status</p>
              <Badge
                variant={
                  pcbProject.status === "completed" ? "default" : "secondary"
                }
              >
                {pcbProject.status}
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* Components Count */}
        <Card className="bg-muted/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Components</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-3xl font-bold text-accent">
              {pcbProject.components.length}
            </div>
            <div className="text-xs text-muted-foreground">
              Total components
            </div>
          </CardContent>
        </Card>

        {/* Nets Count */}
        <Card className="bg-muted/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Nets</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-3xl font-bold text-accent">
              {pcbProject.nets.length}
            </div>
            <div className="text-xs text-muted-foreground">Total nets</div>
          </CardContent>
        </Card>
      </div>

      {/* Components */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Components</CardTitle>
            <Button size="sm" variant="outline">
              <Plus className="w-4 h-4 mr-2" />
              Add Component
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-32">
            <div className="space-y-2">
              {pcbProject.components.map(comp => (
                <div
                  key={comp.reference}
                  className="text-xs p-2 rounded bg-muted/50"
                >
                  <div className="flex justify-between">
                    <span className="font-semibold">{comp.reference}</span>
                    <span className="text-muted-foreground">{comp.value}</span>
                  </div>
                  <div className="text-muted-foreground">
                    {comp.footprint} @ ({comp.position.join(", ")})
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex gap-2">
        <Button className="flex-1" aria-label="Open project in KiCad">
          <Zap className="w-4 h-4 mr-2" aria-hidden="true" />
          Open in KiCad
        </Button>
        <Button variant="outline" className="flex-1" aria-label="Configure PCB Designer settings">
          <Settings className="w-4 h-4 mr-2" aria-hidden="true" />
          Settings
        </Button>
      </div>
    </div>
    );
  };

  return (
    <div className={cn("space-y-4", className)}>
      <Tabs
        value={activeTab}
        onValueChange={v => setActiveTab(v as "llm" | "3d" | "pcb")}
      >
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="llm" className="flex items-center gap-2">
            <Brain className="w-4 h-4" />
            <span className="hidden sm:inline">LLM Builder</span>
          </TabsTrigger>
          <TabsTrigger value="3d" className="flex items-center gap-2">
            <Box className="w-4 h-4" />
            <span className="hidden sm:inline">3D Modeler</span>
          </TabsTrigger>
          <TabsTrigger value="pcb" className="flex items-center gap-2">
            <Zap className="w-4 h-4" />
            <span className="hidden sm:inline">PCB Designer</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="llm" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Custom LLM Builder</CardTitle>
              <CardDescription>
                Fine-tune models with LoRA/QLoRA and visualize neural networks
              </CardDescription>
            </CardHeader>
          </Card>
          {getLLMBuilderContent()}
        </TabsContent>

        <TabsContent value="3d" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>AI-Assisted 3D Modeler</CardTitle>
              <CardDescription>
                Blender co-pilot for creating and modifying 3D models
              </CardDescription>
            </CardHeader>
          </Card>
          {get3DModelerContent()}
        </TabsContent>

        <TabsContent value="pcb" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>AI-Assisted PCB Designer</CardTitle>
              <CardDescription>
                KiCad co-pilot for schematic and PCB layout design
              </CardDescription>
            </CardHeader>
          </Card>
          {getPCBDesignerContent()}
        </TabsContent>
      </Tabs>
    </div>
  );
}
