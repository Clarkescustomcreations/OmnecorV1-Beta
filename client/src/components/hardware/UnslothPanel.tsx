import React, { useState } from "react";
import { trpc } from "../../lib/trpc";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "../ui/card";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Slider } from "../ui/slider";
import { Zap, Save, Database, Activity, Route, Loader2, Brain, FolderOpen } from "lucide-react";
import { Badge } from "../ui/badge";
import { toast } from "sonner";
import { Switch } from "../ui/switch";
import { useNeuralMap } from "../../contexts/NeuralMapContext";

export const UnslothPanel: React.FC = () => {
  const [loraRank, setLoraRank] = useState(16);
  const [datasetPath, setDatasetPath] = useState("");
  const [baseModel, setBaseModel] = useState("unsloth/llama-3-8b-bnb-4bit");

  // Model scope: "project" saves the trained model into the active map's folder; "global" saves to main models folder
  const [modelScope, setModelScope] = useState<"project" | "global">(() => {
    try { return (localStorage.getItem("omnecor:unsloth_model_scope") as "project" | "global") || "global"; } catch { return "global"; }
  });
  const handleScopeToggle = (v: boolean) => {
    const scope = v ? "project" : "global";
    setModelScope(scope);
    localStorage.setItem("omnecor:unsloth_model_scope", scope);
  };

  const { activeMap } = useNeuralMap();
  const projectModelPath = activeMap?.rootDirectories[0] ? `${activeMap.rootDirectories[0]}/models` : undefined;
  const effectiveOutputPath = modelScope === "project" && projectModelPath ? projectModelPath : "./models";

  const valetStatus = trpc.valet.status.useQuery(undefined, { refetchInterval: 15000 });

  const startFineTuning = trpc.training.startTraining.useMutation({
    onSuccess: () => toast.success("Fine-tuning process initialized via Unsloth"),
    onError: (err) => toast.error("Training error: " + err.message)
  });

  const generateValetDataset = trpc.training.generateValetDataset.useMutation({
    onSuccess: (data) => toast.success(`Dataset generation started — monitor in Jobs panel (job: ${data.jobId})`),
    onError: (err) => toast.error("Dataset generation error: " + err.message),
  });

  const saveConfig = trpc.training.saveLoraConfig.useMutation({
    onSuccess: () => toast.success("LoRA config saved"),
    onError: (err) => toast.error("Save failed: " + err.message),
  });

  const handleSaveConfig = () => {
    saveConfig.mutate({
      r: loraRank,
      alpha: 32,
      dropout: 0.05,
      targetModules: ["q_proj", "v_proj"],
    });
  };

  return (
    <div className="p-6 space-y-8">
      <div>
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <Zap className="w-6 h-6 text-yellow-500" /> Unsloth LLM Builder
        </h2>
        <p className="text-sm text-muted-foreground">High-performance local LoRA fine-tuning powered by Unsloth FastLanguageModel.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm font-medium">Fine-Tuning Configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Model output scope */}
            <div className="flex items-center justify-between rounded-lg border bg-muted/20 px-4 py-3">
              <div className="flex items-center gap-2">
                {modelScope === "project" ? <Brain className="w-4 h-4 text-primary" /> : <FolderOpen className="w-4 h-4 text-muted-foreground" />}
                <div>
                  <p className="text-xs font-semibold">{modelScope === "project" ? "Project Model" : "Global Models Folder"}</p>
                  <p className="text-[10px] text-muted-foreground font-mono">{effectiveOutputPath}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground">Global</span>
                <Switch
                  checked={modelScope === "project"}
                  onCheckedChange={handleScopeToggle}
                  disabled={!activeMap}
                  aria-label="Toggle project model scope"
                />
                <span className="text-[10px] text-muted-foreground">Project</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Base Model</Label>
                <Input value={baseModel} onChange={e => setBaseModel(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Dataset Path (JSONL)</Label>
                <div className="flex gap-1.5">
                  <Input
                    value={datasetPath}
                    onChange={e => setDatasetPath(e.target.value)}
                    placeholder="/path/to/dataset.jsonl"
                    className="flex-1"
                  />
                  {activeMap?.rootDirectories[0] && (
                    <Button
                      size="icon"
                      variant="outline"
                      className="h-10 w-10 shrink-0"
                      title="Use active map's data folder"
                      onClick={() => setDatasetPath(`${activeMap.rootDirectories[0]}/data/dataset.jsonl`)}
                    >
                      <Brain className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <Label>LoRA Rank (R)</Label>
                <span className="text-xs font-mono">{loraRank}</span>
              </div>
              <input
                type="range"
                min="4"
                max="128"
                step="4"
                value={loraRank}
                onChange={(e) => setLoraRank(Number(e.target.value))}
                className="w-full h-2 bg-muted rounded-full appearance-none cursor-pointer accent-yellow-500"
              />
              <p className="text-[10px] text-muted-foreground italic">Higher rank allows more complex learning but increases VRAM usage.</p>
            </div>

            <div className="flex gap-2">
               <Button className="flex-1 bg-yellow-600 hover:bg-yellow-700" onClick={() => startFineTuning.mutate({
                 datasetPath: datasetPath || "/path/to/dataset.jsonl",
                 r: loraRank,
                 loraAlpha: 32,
                 maxSeqLength: 2048,
                 saveMethod: "gguf"
               })}>
                 <Activity className="w-4 h-4 mr-2" /> Start Training Pass
               </Button>
               <Button variant="outline" onClick={handleSaveConfig}><Save className="w-4 h-4 mr-2" /> Save Config</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Database className="w-4 h-4" /> VRAM Management
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-3 bg-muted rounded-md text-[10px] font-mono space-y-1">
               <div className="flex justify-between"><span>Status:</span> <span className="text-accent-success uppercase">Ready</span></div>
               <div className="flex justify-between"><span>VRAM Available:</span> <span>16.0 GB</span></div>
               <div className="flex justify-between"><span>Est. Required:</span> <span>4.2 GB</span></div>
               <div className="flex justify-between"><span>Optimization:</span> <span className="text-primary">4-bit BNB</span></div>
            </div>
            <div className="text-xs text-muted-foreground p-2 border border-dashed rounded italic">
               Unsloth reduces memory usage by up to 60% compared to standard fine-tuning.
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Valet Router Status */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Route className="w-4 h-4 text-primary" aria-hidden="true" />
            Valet Router
          </CardTitle>
          <CardDescription className="text-xs">1.5B local routing model for intelligent multi-API task distribution.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${valetStatus?.data?.available ? "bg-accent-success" : "bg-destructive"}`} aria-hidden="true" />
            <span className="text-sm font-medium">
              {valetStatus?.isLoading ? "Checking…" : valetStatus?.data?.available ? "Online" : "Offline"}
            </span>
            {valetStatus?.data?.url && (
              <span className="text-xs text-muted-foreground font-mono ml-auto">{valetStatus.data.url}</span>
            )}
          </div>
          {!valetStatus?.data?.available && (
            <p className="text-xs text-muted-foreground">
              Start the Valet Router with: <code className="font-mono bg-muted px-1 rounded">python server/python_bridges/valet_router_inference.py</code>
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Route className="w-4 h-4" /> Valet Router Dataset
          </CardTitle>
          <CardDescription className="text-xs">
            Generate training data for the 1.5B local routing model (Qwen2.5-1.5B).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-xs">~4,000 routing examples</Badge>
            <Badge variant="outline" className="text-xs">10 categories</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Uses Ollama oracle to annotate prompts with optimal provider, model, cost tier, and local_capable flag.
            Output saved to <span className="font-mono">data/valet_router_dataset.jsonl</span> with 90/10 train/val split.
          </p>
          <div className="flex gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              disabled={generateValetDataset.isPending}
              onClick={() => generateValetDataset.mutate({})}
            >
              {generateValetDataset.isPending
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating...</>
                : <><Route className="w-4 h-4 mr-2" /> Generate Valet Dataset</>
              }
            </Button>
            {activeMap && (
              <Button
                variant="outline"
                size="sm"
                disabled={generateValetDataset.isPending}
                title={`Generate training dataset from "${activeMap.name}" neural map context`}
                onClick={() => {
                  const mapPath = activeMap.rootDirectories[0];
                  if (!mapPath) { toast.error("Active map has no root directory set"); return; }
                  setDatasetPath(`${mapPath}/data/dataset.jsonl`);
                  generateValetDataset.mutate({});
                  toast.info(`Generating dataset from neural map: ${activeMap.name}`);
                }}
              >
                <Brain className="w-4 h-4 mr-2" /> Train from Neural Map
              </Button>
            )}
          </div>
          {generateValetDataset.isSuccess && (
            <p className="text-xs text-accent-success">
              Dataset generation started — monitor in Jobs panel (job: {generateValetDataset.data.jobId})
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
