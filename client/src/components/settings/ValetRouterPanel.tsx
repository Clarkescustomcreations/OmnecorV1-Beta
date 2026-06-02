import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Cpu, Database, GitBranch, Loader2, PackageCheck, Server, Zap } from "lucide-react";
import { toast } from "sonner";

export default function ValetRouterPanel() {
  const [localTrainingEnabled, setLocalTrainingEnabled] = useState(false);

  const gpuQuery = trpc.valet.gpuStatus.useQuery(undefined, { refetchOnWindowFocus: false });
  const venvQuery = trpc.valet.mlVenvStatus.useQuery(undefined, { refetchOnWindowFocus: false });
  const artifactQuery = trpc.training.getArtifact.useQuery();
  const valetStatus = trpc.valet.status.useQuery(undefined, { refetchInterval: 15000 });

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
              <Badge className="bg-green-600 text-white border-transparent">Online</Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground">Offline (rule fallback active)</Badge>
            )}
          </div>
          {artifact?.status === "ready" && artifact.artifact_path && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Active model</span>
              <span className="text-xs font-mono text-muted-foreground truncate max-w-[240px]">
                {artifact.base_model ?? "unknown"} · {artifact.format}
              </span>
            </div>
          )}
          {artifact?.status === "pending" && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              No trained artifact registered. Use the controls below to build one, or run{" "}
              <code className="font-mono bg-muted px-1 rounded">pnpm valet:fetch --tag v1.0.0</code>.
            </p>
          )}
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
                    <span className="text-green-600 dark:text-green-400 font-medium">GPU ready</span>
                    <span className="text-xs text-muted-foreground">
                      {gpu!.name} · {Math.round(gpu!.vramMb / 1024)} GB VRAM
                    </span>
                  </>
                ) : gpu?.available ? (
                  <>
                    <span className="text-amber-600 dark:text-amber-400 font-medium">GPU: insufficient VRAM</span>
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
                  <span className="text-green-600 dark:text-green-400 font-medium">Unsloth stack ready</span>
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
              <p className="text-xs text-amber-600 dark:text-amber-400">
                GPU requirement not met. Training needs ≥ 8 GB VRAM.
              </p>
            )}
            {localTrainingEnabled && gpuOk && !venvOk && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
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
    </div>
  );
}
