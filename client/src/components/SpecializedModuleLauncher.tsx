import { useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
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
import { Brain, Box, Zap, Play, Settings, Plus, Trash2, Cloud, CheckCircle2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import {
  getModuleInfo,
  createLoRAConfig,
  type LLMBuilderSession,
  type BlenderProject,
  type PCBProject,
  type LoRAConfig,
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
export function SpecializedModuleLauncher({
  className,
}: SpecializedModuleLauncherProps) {
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState<"llm" | "3d" | "pcb">("llm");
  const [llmSession, setLLMSession] = useState<LLMBuilderSession | null>(null);
  const [blenderProject, setBlenderProject] = useState<BlenderProject | null>(null);
  const [pcbProject, setPCBProject] = useState<PCBProject | null>(null);
  const [editingLoraConfig, setEditingLoraConfig] = useState<LoRAConfig | null>(null);
  const [selectedObject, setSelectedObject] = useState<BlenderProject["objects"][0] | null>(null);

  const kaggleStatus = trpc.training.kaggleStatus.useQuery();
  const startKaggle = trpc.training.startKaggleTraining.useMutation({
    onSuccess: (d) => { toast.success(`Kaggle job queued: ${d.kernelSlug}`); },
    onError: (e) => toast.error("Kaggle launch failed: " + e.message),
  });

  const openInBlenderMutation = trpc.blender.openFile.useMutation({
    onSuccess: (d) => {
      const name = d.file ? d.file.split("/").pop() : null;
      toast.success(name ? `Opened ${name} in Blender` : "Blender launched");
    },
    onError: (e) => toast.error("Failed to launch Blender: " + e.message),
  });

  const openInKicadMutation = trpc.kicad.openProject.useMutation({
    onSuccess: (d) => {
      const name = d.file ? d.file.split("/").pop() : null;
      toast.success(name ? `Opened ${name} in KiCad` : "KiCad launched");
    },
    onError: (e) => toast.error("Failed to launch KiCad: " + e.message),
  });
  const handleCreateSession = () => {
    toast.info("Creating new fine-tuning session...");
    setLLMSession({
      id: "new-session",
      name: "New Fine-tuning Task",
      baseModel: "Qwen/Qwen1.5-1.8B",
      status: "idle",
      progress: 0,
      loraConfigs: [],
      trainingMetrics: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  };

  const handleStartTraining = () => {
    if (!llmSession) return;
    setLLMSession({ ...llmSession, status: "training" });
    toast.success("Training started!");
  };

  const handleNewProject = (type: "3d" | "pcb") => {
    if (type === "3d") {
      setBlenderProject({
        id: "new-blender",
        name: "New Scene",
        filePath: "/projects/scene_01.blend",
        status: "idle",
        objects: [],
        description: "",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      toast.success("New Blender project created");
    } else {
      setPCBProject({
        id: "new-pcb",
        name: "New Board",
        status: "idle",
        components: [],
        nets: [],
        filePath: "",
        description: "",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      toast.success("New KiCad project created");
    }
  };

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
            <Button size="sm" onClick={handleCreateSession}>
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
            <Button size="sm" variant="outline" onClick={() => {
              if (!llmSession) return;
              const newConfig = createLoRAConfig(
                `new-config-${llmSession.loraConfigs.length + 1}`,
                llmSession.baseModel,
                "/path/to/dataset.jsonl",
                { rank: 16, alpha: 16, epochs: 3 }
              );
              setLLMSession({ ...llmSession, loraConfigs: [...llmSession.loraConfigs, newConfig] });
              setEditingLoraConfig(newConfig);
            }}>
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
                                                          <Button size="sm" variant="ghost" aria-label={`Configure ${config.name}`} onClick={() => setEditingLoraConfig(config)}>
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

      {/* LoRA Config Editor */}
      {editingLoraConfig && (
        <Card className="bg-accent/5 border-accent/20">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Edit LoRA Config</CardTitle>
              <Button size="sm" variant="ghost" onClick={() => setEditingLoraConfig(null)}>✕</Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold mb-1 block">Config Name</label>
                <input type="text" value={editingLoraConfig.name} onChange={(e) => setEditingLoraConfig({ ...editingLoraConfig, name: e.target.value })} className="w-full px-2 py-1 border rounded text-sm" />
              </div>
              <div>
                <label className="text-xs font-semibold mb-1 block">Rank</label>
                <input type="number" min="4" max="256" value={editingLoraConfig.rank} onChange={(e) => setEditingLoraConfig({ ...editingLoraConfig, rank: Number(e.target.value) })} className="w-full px-2 py-1 border rounded text-sm" />
              </div>
              <div>
                <label className="text-xs font-semibold mb-1 block">Alpha</label>
                <input type="number" min="1" max="256" value={editingLoraConfig.alpha} onChange={(e) => setEditingLoraConfig({ ...editingLoraConfig, alpha: Number(e.target.value) })} className="w-full px-2 py-1 border rounded text-sm" />
              </div>
              <div>
                <label className="text-xs font-semibold mb-1 block">Epochs</label>
                <input type="number" min="1" max="100" value={editingLoraConfig.epochs} onChange={(e) => setEditingLoraConfig({ ...editingLoraConfig, epochs: Number(e.target.value) })} className="w-full px-2 py-1 border rounded text-sm" />
              </div>
            </div>
            <Button className="w-full" size="sm" onClick={() => {
              if (!llmSession) return;
              setLLMSession({
                ...llmSession,
                loraConfigs: llmSession.loraConfigs.map(c => c.id === editingLoraConfig.id ? editingLoraConfig : c)
              });
              setEditingLoraConfig(null);
              toast.success("LoRA config updated");
            }}>
              <Settings className="w-4 h-4 mr-2" />
              Save Config
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <Button className="flex-1" aria-label="Start LLM training" onClick={handleStartTraining}>
          <Play className="w-4 h-4 mr-2" aria-hidden="true" />
          Start Training
        </Button>
        <Button variant="outline" className="flex-1" aria-label="Configure LLM training" onClick={() => setLocation("/settings?tab=valet")}>
          <Settings className="w-4 h-4 mr-2" aria-hidden="true" />
          Configure
        </Button>
      </div>

      {/* Kaggle GPU Training */}
      <Card className="border-accent-cyan/20 bg-accent-cyan/5">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Cloud className="w-4 h-4 text-accent-cyan" />
              Kaggle GPU Training (Free)
            </CardTitle>
            {kaggleStatus.data?.connected
              ? <Badge className="bg-accent-success/10 text-accent-success border-accent-success/20 text-[10px] gap-1"><CheckCircle2 className="w-3 h-3" /> {kaggleStatus.data.username}</Badge>
              : <Badge variant="outline" className="text-[10px] text-muted-foreground gap-1"><AlertCircle className="w-3 h-3" /> Not connected</Badge>
            }
          </div>
          <CardDescription className="text-xs">
            Train your custom model on free Kaggle T4 GPUs — no credit card needed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!kaggleStatus.data?.connected ? (
            <div className="space-y-2 text-xs text-muted-foreground">
              <p className="font-semibold text-foreground">Quick setup (5 minutes, completely free):</p>
              <p>1. Create a free account at <strong>kaggle.com</strong></p>
              <p>2. Verify your phone number in your Kaggle profile (required for GPU access)</p>
              <p>3. Go to <strong>kaggle.com/settings</strong> → API section → click <strong>"Create New Token"</strong> — this downloads a file called <code className="font-mono bg-muted px-1 rounded">kaggle.json</code></p>
              <p>4. Open that file — it looks like: <code className="font-mono bg-muted px-1 rounded">{`{"username":"you","key":"abc123..."}`}</code></p>
              <p>5. Enter those values in <strong>Settings → AI Providers → Kaggle</strong> or in the <strong>Valet Router tab</strong> to connect.</p>
              <p className="text-accent-cyan">Once connected, come back here to launch a training run with one click.</p>
            </div>
          ) : (
            <Button
              className="w-full"
              size="sm"
              onClick={() => startKaggle.mutate({
                datasetPath: "data/valet",
                modelName: llmSession?.name || undefined,
                epochs: 1.5,
                maxSeqLength: 3072,
                r: 8,
                loraAlpha: 16,
              })}
              disabled={startKaggle.isPending}
            >
              <Cloud className="w-4 h-4 mr-2" />
              {startKaggle.isPending ? "Launching..." : "Train on Kaggle GPU"}
            </Button>
          )}
          <p className="text-[10px] text-muted-foreground">Monitor training progress and import the finished model via <strong>Settings → Valet Router → Kaggle Training</strong>.</p>
        </CardContent>
      </Card>
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
            <Button size="sm" onClick={() => handleNewProject("3d")}>
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
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (!blenderProject) return;
                const newObj = { name: `Object_${blenderProject.objects.length + 1}`, type: "MESH", position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number] };
                setBlenderProject({ ...blenderProject, objects: [...blenderProject.objects, newObj] });
                toast.success("Object added to scene — open Blender to place it");
              }}
            >
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
                                                          <Button size="sm" variant="ghost" aria-label={`Configure ${obj.name}`} onClick={() => setSelectedObject(obj)}>
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

      {/* Object Editor */}
      {selectedObject && (
        <Card className="bg-accent/5 border-accent/20">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Edit Object Properties</CardTitle>
              <Button size="sm" variant="ghost" onClick={() => setSelectedObject(null)}>✕</Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-xs font-semibold mb-1 block">Name</label>
              <input type="text" value={selectedObject.name} onChange={(e) => setSelectedObject({ ...selectedObject, name: e.target.value })} className="w-full px-2 py-1 border rounded text-sm" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-xs font-semibold mb-1 block">Position X</label>
                <input type="number" step="0.1" value={selectedObject.position[0]} onChange={(e) => setSelectedObject({ ...selectedObject, position: [Number(e.target.value), selectedObject.position[1], selectedObject.position[2]] })} className="w-full px-2 py-1 border rounded text-sm" />
              </div>
              <div>
                <label className="text-xs font-semibold mb-1 block">Position Y</label>
                <input type="number" step="0.1" value={selectedObject.position[1]} onChange={(e) => setSelectedObject({ ...selectedObject, position: [selectedObject.position[0], Number(e.target.value), selectedObject.position[2]] })} className="w-full px-2 py-1 border rounded text-sm" />
              </div>
              <div>
                <label className="text-xs font-semibold mb-1 block">Position Z</label>
                <input type="number" step="0.1" value={selectedObject.position[2]} onChange={(e) => setSelectedObject({ ...selectedObject, position: [selectedObject.position[0], selectedObject.position[1], Number(e.target.value)] })} className="w-full px-2 py-1 border rounded text-sm" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-xs font-semibold mb-1 block">Scale X</label>
                <input type="number" step="0.1" min="0.1" value={selectedObject.scale[0]} onChange={(e) => setSelectedObject({ ...selectedObject, scale: [Number(e.target.value), selectedObject.scale[1], selectedObject.scale[2]] })} className="w-full px-2 py-1 border rounded text-sm" />
              </div>
              <div>
                <label className="text-xs font-semibold mb-1 block">Scale Y</label>
                <input type="number" step="0.1" min="0.1" value={selectedObject.scale[1]} onChange={(e) => setSelectedObject({ ...selectedObject, scale: [selectedObject.scale[0], Number(e.target.value), selectedObject.scale[2]] })} className="w-full px-2 py-1 border rounded text-sm" />
              </div>
              <div>
                <label className="text-xs font-semibold mb-1 block">Scale Z</label>
                <input type="number" step="0.1" min="0.1" value={selectedObject.scale[2]} onChange={(e) => setSelectedObject({ ...selectedObject, scale: [selectedObject.scale[0], selectedObject.scale[1], Number(e.target.value)] })} className="w-full px-2 py-1 border rounded text-sm" />
              </div>
            </div>
            <Button className="w-full" size="sm" onClick={() => {
              if (!blenderProject) return;
              setBlenderProject({
                ...blenderProject,
                objects: blenderProject.objects.map((o, idx) => o.name === selectedObject.name ? selectedObject : o)
              });
              setSelectedObject(null);
              toast.success("Object properties updated");
            }}>
              <Settings className="w-4 h-4 mr-2" />
              Save Object
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <Button
          className="flex-1"
          aria-label="Open project in Blender"
          disabled={openInBlenderMutation.isPending}
          onClick={() => {
            openInBlenderMutation.mutate({
              filePath: blenderProject?.filePath || undefined,
            });
          }}
        >
          <Box className="w-4 h-4 mr-2" aria-hidden="true" />
          {openInBlenderMutation.isPending ? "Opening…" : "Open in Blender"}
        </Button>
        <Button variant="outline" className="flex-1" aria-label="Configure 3D Modeler settings" onClick={() => setLocation("/settings?tab=hardware")}>
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
            <Button size="sm" onClick={() => handleNewProject("pcb")}>
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
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (!pcbProject) return;
                const ref = `C${pcbProject.components.length + 1}`;
                setPCBProject({ ...pcbProject, components: [...pcbProject.components, { reference: ref, value: "100nF", footprint: "C_0402", position: [0, 0] as [number, number], rotation: 0 }] });
                toast.success(`Component ${ref} added`);
              }}
            >
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
        <Button
          className="flex-1"
          aria-label="Open project in KiCad"
          disabled={openInKicadMutation.isPending}
          onClick={() => {
            openInKicadMutation.mutate({
              filePath: pcbProject?.filePath || undefined,
            });
          }}
        >
          <Zap className="w-4 h-4 mr-2" aria-hidden="true" />
          {openInKicadMutation.isPending ? "Opening…" : "Open in KiCad"}
        </Button>
        <Button variant="outline" className="flex-1" aria-label="Configure PCB Designer settings" onClick={() => setLocation("/settings?tab=hardware")}>
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
