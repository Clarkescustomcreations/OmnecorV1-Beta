import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Cpu, Database, GitBranch, Loader2, PackageCheck, Server, Zap, Cloud, CheckCircle2, AlertCircle, Download, RefreshCw, Wand2 } from "lucide-react";
import { MoeChainPanel } from "./MoeChainPanel";
import { toast } from "sonner";
import { useAppStore } from "@/lib/store/app.store";
import { ModelSelector } from "@/components/chat/ModelSelector";
import type { SelectedModel } from "@/lib/chatContext";

// ---------------------------------------------------------------------------
// Kaggle Cloud Training Card
// ---------------------------------------------------------------------------

function KaggleTrainingCard() {
  const [datasetPath, setDatasetPath] = useState("data/valet");
  const [epochs, setEpochs] = useState("1.5");
  const [maxSeqLength, setMaxSeqLength] = useState("3072");
  const [kernelSlug, setKernelSlug] = useState<string | undefined>();
  const [mergeJobId, setMergeJobId] = useState<string | undefined>();
  const [mergedPath, setMergedPath] = useState<string | undefined>();
  const [pollEnabled, setPollEnabled] = useState(false);

  const kaggleStatus = trpc.training.kaggleStatus.useQuery(undefined, { refetchOnWindowFocus: false });
  const artifactQuery = trpc.training.getArtifact.useQuery();

  const jobStatus = trpc.training.kaggleJobStatus.useQuery(
    { kernelSlug: kernelSlug ?? "" },
    { enabled: Boolean(kernelSlug) && pollEnabled, refetchInterval: 60_000 }
  );

  useEffect(() => {
    if (jobStatus.data?.status === "complete" || jobStatus.data?.status === "error") {
      setPollEnabled(false);
    }
  }, [jobStatus.data?.status]);

  const startTraining = trpc.training.startKaggleTraining.useMutation({
    onSuccess: (data) => {
      setKernelSlug(data.kernelSlug);
      setPollEnabled(true);
      toast.success("Training job submitted to Kaggle! Checking status every 60 s…");
    },
    onError: (e) => toast.error("Kaggle training failed: " + e.message),
  });

  const pullArtifact = trpc.training.pullKaggleArtifact.useMutation({
    onSuccess: (data) => {
      setMergeJobId(data.mergeJobId);
      setMergedPath(data.mergedModelPath);
      toast.success(`Adapter downloaded. Merging (job: ${data.mergeJobId.slice(0, 8)}) — monitor in Jobs panel.`);
    },
    onError: (e) => toast.error("Failed to pull adapter: " + e.message),
  });

  const registerArtifact = trpc.training.registerArtifact.useMutation({
    onSuccess: () => {
      toast.success("Valet model activated! Restart inference server to serve it.");
      artifactQuery.refetch();
      setKernelSlug(undefined); setMergeJobId(undefined); setMergedPath(undefined);
    },
    onError: (e) => toast.error("Failed to register model: " + e.message),
  });

  const isConnected = kaggleStatus.data?.connected;
  const connectedAs = kaggleStatus.data?.username;
  const statusColor: Record<string, string> = {
    running: "text-primary", queued: "text-accent-warning",
    complete: "text-accent-success", error: "text-destructive", unknown: "text-muted-foreground",
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Cloud className="h-4 w-4" />
          Kaggle Cloud Training
          <Badge variant="outline" className="ml-auto text-xs">Free GPU · No credit card</Badge>
        </CardTitle>
        <CardDescription>
          Train the Valet Router on a free Kaggle T4/P100 GPU (16 GB VRAM). Ideal for machines
          with weak or no GPU. Jobs run in the cloud; you import the finished model.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center gap-2">
          {isConnected
            ? <Badge className="bg-accent-success text-white border-transparent text-xs"><CheckCircle2 className="w-3 h-3 mr-1" />Connected as {connectedAs}</Badge>
            : <Badge variant="secondary" className="text-xs"><AlertCircle className="w-3 h-3 mr-1" />Not connected</Badge>
          }
          {!isConnected && (
            <p className="text-xs text-muted-foreground">
              Add your key in <strong>Settings → API Providers → Kaggle</strong> first.
            </p>
          )}
        </div>

        {isConnected && (
          <>
            <Separator />
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Training Configuration</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="kg-dataset" className="text-xs">Dataset Folder</Label>
                  <Input id="kg-dataset" value={datasetPath} onChange={e => setDatasetPath(e.target.value)}
                    placeholder="data/valet" className="h-8 text-xs font-mono" />
                  <p className="text-[10px] text-muted-foreground">Must contain train.jsonl</p>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="kg-epochs" className="text-xs">Epochs</Label>
                  <Input id="kg-epochs" value={epochs} onChange={e => setEpochs(e.target.value)}
                    placeholder="1.5" className="h-8 text-xs" />
                  <p className="text-[10px] text-muted-foreground">1.5 recommended</p>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="kg-seq" className="text-xs">Max Sequence Length</Label>
                  <Input id="kg-seq" value={maxSeqLength} onChange={e => setMaxSeqLength(e.target.value)}
                    placeholder="3072" className="h-8 text-xs" />
                  <p className="text-[10px] text-muted-foreground">3072 = Valet default</p>
                </div>
              </div>
              <div className="rounded-md bg-muted/40 border px-3 py-2 text-xs text-muted-foreground">
                Cloud GPU: Kaggle T4 or P100 (16 GB) · Base: Qwen2.5-1.5B-Instruct · LoRA r=8 · fp16
              </div>
            </div>

            {!kernelSlug && (
              <Button size="sm" disabled={startTraining.isPending || !datasetPath}
                onClick={() => startTraining.mutate({
                  datasetPath, epochs: parseFloat(epochs) || 1.5,
                  maxSeqLength: parseInt(maxSeqLength, 10) || 3072,
                })}
                className="flex items-center gap-2">
                {startTraining.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cloud className="h-4 w-4" />}
                {startTraining.isPending ? "Submitting to Kaggle…" : "Train on Kaggle"}
              </Button>
            )}

            {kernelSlug && (
              <>
                <Separator />
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Cloud Job Status</p>
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-xs"
                      onClick={() => { setPollEnabled(true); jobStatus.refetch(); }}>
                      <RefreshCw className="h-3 w-3 mr-1" />Refresh
                    </Button>
                  </div>
                  <div className="rounded-md bg-muted p-3 text-xs font-mono space-y-1">
                    <div>Kernel: {kernelSlug}</div>
                    {jobStatus.data && (
                      <div className={statusColor[jobStatus.data.status] ?? "text-muted-foreground"}>
                        Status: {jobStatus.data.status}{jobStatus.data.runtime && ` · ${jobStatus.data.runtime}`}
                      </div>
                    )}
                    {jobStatus.data?.status === "running" && (
                      <div className="text-muted-foreground">Kaggle runs take 30–120 min. Checking every 60 s.</div>
                    )}
                  </div>

                  {jobStatus.data?.status === "complete" && !mergeJobId && (
                    <Button size="sm" disabled={pullArtifact.isPending}
                      onClick={() => pullArtifact.mutate({ kernelSlug })}
                      className="flex items-center gap-2">
                      {pullArtifact.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                      {pullArtifact.isPending ? "Downloading adapter…" : "Import Adapter"}
                    </Button>
                  )}

                  {mergeJobId && !mergedPath && (
                    <div className="text-xs text-muted-foreground flex items-center gap-2">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Merging LoRA into base model (CPU, ~5–15 min) · Job {mergeJobId.slice(0, 8)} — see Jobs panel
                    </div>
                  )}

                  {mergedPath && (
                    <Button size="sm" disabled={registerArtifact.isPending}
                      onClick={() => registerArtifact.mutate({
                        artifactPath: mergedPath, format: "merged_16bit",
                        baseModel: "Qwen/Qwen2.5-1.5B-Instruct", source: "trained",
                      })}
                      className="flex items-center gap-2">
                      {registerArtifact.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                      {registerArtifact.isPending ? "Activating…" : "Activate Model"}
                    </Button>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------

export function ValetRouterPanel() {
  const [localTrainingEnabled, setLocalTrainingEnabled] = useState(false);

  const gpuQuery = trpc.valet.gpuStatus.useQuery(undefined, { refetchOnWindowFocus: false });
  const venvQuery = trpc.valet.mlVenvStatus.useQuery(undefined, { refetchOnWindowFocus: false });
  const artifactQuery = trpc.training.getArtifact.useQuery();
  const valetStatus = trpc.valet.status.useQuery(undefined, { refetchInterval: 15000 });

  const valetFallbackModel = useAppStore(s => s.valetFallbackModel);
  const setValetFallbackModel = useAppStore(s => s.setValetFallbackModel);

  const startDataset = trpc.valet.startLocalTraining.useMutation({
    onSuccess: ({ jobId }) => {
      toast.success(`Dataset generation started — monitor in Jobs panel (job: ${jobId.slice(0, 8)})`);
    },
    onError: (err) => toast.error(`Dataset generation failed: ${err.message}`),
  });

  const startTraining = trpc.valet.startLocalTraining.useMutation({
    onSuccess: ({ jobId }) => {
      toast.success(`Router training started — monitor in Jobs panel (job: ${jobId.slice(0, 8)})`);
      artifactQuery.refetch();
    },
    onError: (err) => toast.error(`Training failed: ${err.message}`),
  });

  const gpu = gpuQuery.data;
  const venv = venvQuery.data;
  const artifact = artifactQuery.data;

  const gpuOk = gpu?.available && gpu.minVramMet;
  const venvOk = venv?.installed;
  const canTrain = localTrainingEnabled && gpuOk && venvOk;

  return (
    <div className="space-y-6">
      {/* Router Server Status */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Server className="h-4 w-4" />
            Router Server
          </CardTitle>
          <CardDescription>
            The Valet Router inference server runs locally on port 8010.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Inference server</span>
            {valetStatus.isLoading ? (
              <Badge variant="secondary">Checking…</Badge>
            ) : valetStatus.data?.available ? (
              <Badge className="bg-accent-success text-white border-transparent">Online</Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground">Offline (rule fallback active)</Badge>
            )}
          </div>
          {valetStatus.data?.available && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Model</span>
              {valetStatus.data.modelLoaded ? (
                <Badge className="bg-accent-success text-white border-transparent">
                  Loaded{valetStatus.data.backend ? ` · ${valetStatus.data.backend}` : ""}
                </Badge>
              ) : (
                <Badge variant="outline" className="text-accent-warning dark:text-accent-warning">
                  Loading…
                </Badge>
              )}
            </div>
          )}
          {artifact?.status === "ready" && artifact.artifact_path && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Artifact</span>
              <span className="text-xs font-mono text-muted-foreground truncate max-w-[240px]">
                {artifact.base_model ?? "unknown"} · {artifact.format}
              </span>
            </div>
          )}
          {artifact?.status === "pending" && !valetStatus.data?.available && (
            <p className="text-xs text-accent-warning dark:text-accent-warning">
              No trained artifact registered. Use the controls below to build one, or run{" "}
              <code className="font-mono bg-muted px-1 rounded">pnpm valet:fetch --tag v1.0.0</code>.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Router Fallback */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Wand2 className="h-4 w-4" />
            Router Fallback
          </CardTitle>
          <CardDescription>
            If the Valet inference server is offline or fails to route your prompt, this model will be used as a fallback.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Fallback model</span>
            <ModelSelector
              selectedModel={(valetFallbackModel as SelectedModel) ?? undefined}
              onSelect={setValetFallbackModel}
            />
          </div>
        </CardContent>
      </Card>

      {/* Local Training Gate */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="h-4 w-4" />
            Local Router Training
            <Badge variant="outline" className="ml-auto text-xs">Sovereign power-user</Badge>
          </CardTitle>
          <CardDescription>
            Train a fine-tuned Valet Router model entirely on this machine. Requires an NVIDIA/AMD GPU
            with ≥ 8 GB VRAM and the Unsloth ML stack installed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Enable toggle */}
          <div className="flex items-center gap-3">
            <Switch
              id="local-training"
              checked={localTrainingEnabled}
              onCheckedChange={setLocalTrainingEnabled}
            />
            <Label htmlFor="local-training" className="cursor-pointer">
              Enable local router training
            </Label>
          </div>

          <Separator />

          {/* Prerequisites status */}
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Prerequisites</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {/* GPU */}
              <div className="flex items-center gap-2 text-sm">
                <Cpu className="h-4 w-4 shrink-0 text-muted-foreground" />
                {gpuQuery.isLoading ? (
                  <span className="text-muted-foreground">Detecting GPU…</span>
                ) : gpuOk ? (
                  <>
                    <span className="text-accent-success dark:text-accent-success font-medium">GPU ready</span>
                    <span className="text-xs text-muted-foreground">
                      {gpu!.name} · {Math.round(gpu!.vramMb / 1024)} GB VRAM
                    </span>
                  </>
                ) : gpu?.available ? (
                  <>
                    <span className="text-accent-warning dark:text-accent-warning font-medium">GPU: insufficient VRAM</span>
                    <span className="text-xs text-muted-foreground">
                      {Math.round(gpu.vramMb / 1024)} GB / 8 GB min
                    </span>
                  </>
                ) : (
                  <span className="text-muted-foreground">No GPU detected</span>
                )}
              </div>
              {/* ML venv */}
              <div className="flex items-center gap-2 text-sm">
                <PackageCheck className="h-4 w-4 shrink-0 text-muted-foreground" />
                {venvQuery.isLoading ? (
                  <span className="text-muted-foreground">Checking ML stack…</span>
                ) : venvOk ? (
                  <span className="text-accent-success dark:text-accent-success font-medium">Unsloth stack ready</span>
                ) : (
                  <span className="text-muted-foreground">
                    ML stack not installed —{" "}
                    <code className="font-mono text-xs bg-muted px-1 rounded">pnpm valet:setup-ml</code>
                  </span>
                )}
              </div>
            </div>
          </div>

          <Separator />

          {/* Two-step build flow */}
          <div className="space-y-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Build pipeline
              <span className="ml-2 normal-case font-normal text-muted-foreground/70">
                (Phase 1 orchestrator will collapse these to one button)
              </span>
            </p>

            <div className="flex flex-col sm:flex-row gap-2">
              {/* Step 1 */}
              <Button
                variant="outline"
                size="sm"
                disabled={!canTrain || startDataset.isPending}
                onClick={() => startDataset.mutate({ step: "dataset" })}
                className="flex items-center gap-2"
              >
                {startDataset.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Database className="h-4 w-4" />
                )}
                Step 1 — Generate Dataset
              </Button>

              {/* Step 2 */}
              <Button
                size="sm"
                disabled={!canTrain || startTraining.isPending}
                onClick={() => startTraining.mutate({ step: "training" })}
                className="flex items-center gap-2"
              >
                {startTraining.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <GitBranch className="h-4 w-4" />
                )}
                Step 2 — Train Router
              </Button>
            </div>

            {!localTrainingEnabled && (
              <p className="text-xs text-muted-foreground">
                Enable local training above to unlock the build buttons.
              </p>
            )}
            {localTrainingEnabled && !gpuOk && (
              <p className="text-xs text-accent-warning dark:text-accent-warning">
                GPU requirement not met. Training needs ≥ 8 GB VRAM.
              </p>
            )}
            {localTrainingEnabled && gpuOk && !venvOk && (
              <p className="text-xs text-accent-warning dark:text-accent-warning">
                Run <code className="font-mono bg-muted px-1 rounded">pnpm valet:setup-ml</code> to install
                the Unsloth + TRL training stack, then reload.
              </p>
            )}

            <p className="text-xs text-muted-foreground leading-relaxed">
              Step 1 generates training data from the live manifest + knowledge base (runs via Ollama,
              ~10–20 min). Step 2 runs LoRA fine-tuning on Qwen2.5-1.5B and exports a GGUF to{" "}
              <code className="font-mono bg-muted px-1 rounded">models/valet-router/</code>.
              Monitor progress in the Jobs panel.
            </p>
          </div>

          {/* Artifact status */}
          {artifact?.status === "ready" && (
            <>
              <Separator />
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                  <PackageCheck className="h-3.5 w-3.5" />
                  Current artifact
                </p>
                <div className="rounded-md bg-muted p-3 text-xs space-y-1 font-mono">
                  <div>Model: {artifact.base_model}</div>
                  <div>Format: {artifact.format}</div>
                  {artifact.dataset_hash && <div>Dataset: {artifact.dataset_hash.slice(0, 12)}…</div>}
                  {artifact.created_at && <div>Built: {new Date(artifact.created_at).toLocaleDateString()}</div>}
                  <div>Source: {artifact.source}</div>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <div className="space-y-4">
        <KaggleTrainingCard />
      </div>

      <Separator />

      <MoeChainPanel />
    </div>
  );
}
