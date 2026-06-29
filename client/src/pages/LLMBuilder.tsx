import { useState } from 'react';
import { useLocation } from 'wouter';
import { toast } from 'sonner';
import { trpc } from '@/lib/trpc';
import { OmnecorDashboardLayout } from '@/components/OmnecorDashboardLayout';
import { DatasetCurationPanel } from '@/components/hardware/DatasetCurationPanel';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Brain,
  Database,
  Zap,
  Activity,
  Cloud,
  Cpu,
  PackageCheck,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Download,
  RefreshCw,
  Settings,
  ChevronRight,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

type ActiveTab = 'dataset' | 'model' | 'train' | 'history';
type SaveFormat = 'lora' | 'merged_16bit' | 'merged_4bit' | 'gguf' | 'ollama';
type ComputeTarget = 'local' | 'kaggle' | 'ommesh' | 'cloud';

interface SuggestedModel {
  id: string;
  label: string;
  desc: string;
  value: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SUGGESTED_MODELS: SuggestedModel[] = [
  { id: 'qwen-1.5b', label: 'Qwen2.5-1.5B', desc: 'Tiny · 1.5B · Best for routing', value: 'Qwen/Qwen2.5-1.5B-Instruct' },
  { id: 'llama-8b', label: 'Llama 3.1 8B', desc: 'Fast · 8B · Unsloth optimized', value: 'unsloth/llama-3-8b-bnb-4bit' },
  { id: 'mistral-7b', label: 'Mistral 7B', desc: 'Balanced · 7B', value: 'mistralai/Mistral-7B-v0.3' },
  { id: 'gemma-9b', label: 'Gemma 2 9B', desc: 'Google · 9B', value: 'google/gemma-2-9b' },
  { id: 'qwen-7b', label: 'Qwen2.5-7B', desc: 'Balanced · 7B', value: 'Qwen/Qwen2.5-7B-Instruct' },
  { id: 'phi-3', label: 'Phi-3 Mini', desc: 'Microsoft · 3.8B', value: 'microsoft/Phi-3-mini-4k-instruct' },
];

const FORMAT_DESCRIPTIONS: Record<SaveFormat, string> = {
  gguf: 'Quantised binary — runs locally via Ollama or llama.cpp. Best for deployment.',
  lora: 'Saves only the lightweight LoRA adapter weights. Requires the base model at inference time.',
  merged_16bit: 'Full merged model in fp16. High quality, large disk footprint (~2× base).',
  merged_4bit: 'Full merged model in 4-bit NF4. Good balance of quality and size.',
  ollama: 'Push directly to your local Ollama registry so the model is instantly available.',
};

// ─── Sub-components ───────────────────────────────────────────────────────────

interface GpuStatusChipProps {
  readonly className?: string;
}

function GpuStatusChip({ className }: GpuStatusChipProps) {
  const { data: gpu, isLoading } = trpc.valet.gpuStatus.useQuery(undefined, { refetchInterval: 30_000 });

  if (isLoading) {
    return (
      <span className={`flex items-center gap-1.5 text-xs text-muted-foreground ${className ?? ''}`}>
        <Loader2 className="size-3 animate-spin" /> Checking GPU…
      </span>
    );
  }

  if (!gpu?.available) {
    return (
      <span className={`flex items-center gap-1.5 text-xs text-accent-warning ${className ?? ''}`}>
        <AlertCircle className="size-3" /> No GPU detected
      </span>
    );
  }

  const vramGb = gpu.vramMb ? (gpu.vramMb / 1024).toFixed(1) : '?';
  const ok = gpu.minVramMet;

  return (
    <span
      className={`flex items-center gap-1.5 text-xs ${ok ? 'text-accent-success' : 'text-accent-warning'} ${className ?? ''}`}
    >
      {ok ? <CheckCircle2 className="size-3" /> : <AlertCircle className="size-3" />}
      {gpu.name ?? 'GPU'} · {vramGb} GB VRAM
      {!ok && <span className="text-muted-foreground">(≥ 8 GB recommended)</span>}
    </span>
  );
}

interface MlVenvChipProps {
  readonly className?: string;
}

function MlVenvChip({ className }: MlVenvChipProps) {
  const { data: venv, isLoading } = trpc.valet.mlVenvStatus.useQuery();

  if (isLoading) {
    return (
      <span className={`flex items-center gap-1.5 text-xs text-muted-foreground ${className ?? ''}`}>
        <Loader2 className="size-3 animate-spin" /> Checking ML venv…
      </span>
    );
  }

  return venv?.installed ? (
    <span className={`flex items-center gap-1.5 text-xs text-accent-success ${className ?? ''}`}>
      <PackageCheck className="size-3" /> ML venv installed
    </span>
  ) : (
    <span className={`flex items-center gap-1.5 text-xs text-accent-warning ${className ?? ''}`}>
      <AlertCircle className="size-3" /> ML venv not found — run Setup Wizard
    </span>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function LLMBuilder() {
  const [, navigate] = useLocation();

  // ── State ──────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<ActiveTab>('dataset');
  const [datasetPath, setDatasetPath] = useState('');
  const [baseModel, setBaseModel] = useState('unsloth/llama-3-8b-bnb-4bit');
  const [saveFormat, setSaveFormat] = useState<SaveFormat>('gguf');
  const [computeTarget, setComputeTarget] = useState<ComputeTarget>('local');
  const [loraRank, setLoraRank] = useState(16);
  const [loraAlpha, setLoraAlpha] = useState(32);
  const [dropout, setDropout] = useState(0.05);
  const [maxSeqLength, setMaxSeqLength] = useState(2048);
  const [epochs, setEpochs] = useState(1);
  const [targetModules, setTargetModules] = useState('q_proj,v_proj');
  const [kernelSlug, setKernelSlug] = useState<string | undefined>();
  const [mergedPath, setMergedPath] = useState<string | undefined>();
  const [mergeJobId, setMergeJobId] = useState<string | undefined>();
  const [showOllamaModels, setShowOllamaModels] = useState(false);
  const [pollKaggle, setPollKaggle] = useState(false);
  const [validateResult, setValidateResult] = useState<{ ok: boolean; message: string } | null>(null);

  // ── tRPC queries ───────────────────────────────────────────────────────────
  const { data: artifactData, refetch: refetchArtifact } = trpc.training.getArtifact.useQuery();
  const { data: kaggleStatus } = trpc.training.kaggleStatus.useQuery();
  const { data: ollamaModels } = trpc.ollama.listModels.useQuery();
  const { data: kaggleJobData, refetch: refetchKaggleJob } = trpc.training.kaggleJobStatus.useQuery(
    { kernelSlug: kernelSlug ?? '' },
    { enabled: !!kernelSlug && pollKaggle, refetchInterval: pollKaggle ? 15_000 : false },
  );

  // ── tRPC mutations ─────────────────────────────────────────────────────────
  const startTraining = trpc.training.startTraining.useMutation({
    onSuccess: (data) => {
      toast.success(`Training started — Job ID: ${(data as { jobId?: string })?.jobId ?? 'queued'}`);
      void refetchArtifact();
    },
    onError: (err) => toast.error(`Training failed: ${err.message}`),
  });

  const startKaggleTraining = trpc.training.startKaggleTraining.useMutation({
    onSuccess: (data) => {
      const slug = (data as { kernelSlug?: string })?.kernelSlug;
      if (slug) {
        setKernelSlug(slug);
        setPollKaggle(true);
        toast.success(`Kaggle job submitted: ${slug}`);
      }
    },
    onError: (err) => toast.error(`Kaggle submission failed: ${err.message}`),
  });

  const validateDataset = trpc.training.validateDataset.useMutation({
    onSuccess: (data) => {
      const res = data as { valid?: boolean; message?: string };
      setValidateResult({ ok: res.valid ?? false, message: res.message ?? 'Validation complete.' });
    },
    onError: (err) => setValidateResult({ ok: false, message: err.message }),
  });

  const pullKaggleArtifact = trpc.training.pullKaggleArtifact.useMutation({
    onSuccess: (data) => {
      const res = data as { mergedPath?: string; jobId?: string };
      setMergedPath(res.mergedPath);
      setMergeJobId(res.jobId);
      toast.success('Adapter import started.');
    },
    onError: (err) => toast.error(`Import failed: ${err.message}`),
  });

  const registerArtifact = trpc.training.registerArtifact.useMutation({
    onSuccess: () => {
      toast.success('Model registered and ready to use!');
      void refetchArtifact();
    },
    onError: (err) => toast.error(`Registration failed: ${err.message}`),
  });

  // ── Derived ────────────────────────────────────────────────────────────────
  const kaggleJobStatus = kaggleJobData as { status?: string; output?: string } | undefined;
  const isKaggleComplete = kaggleJobStatus?.status === 'complete';
  const isTraining = startTraining.isPending || startKaggleTraining.isPending;

  const trainingConfig = {
    modelName: baseModel,
    datasetPath,
    outputDir: './lora_output',
    epochs,
    r: loraRank,
    loraAlpha,
    maxSeqLength,
    saveMethod: saveFormat,
    targetModules: targetModules.split(',').map((s) => s.trim()),
  };

  function handleStartTraining() {
    if (!datasetPath) {
      toast.warning('Please select a dataset first.');
      return;
    }
    if (computeTarget === 'local') {
      startTraining.mutate(trainingConfig);
    } else if (computeTarget === 'kaggle') {
      startKaggleTraining.mutate({
        datasetPath,
        modelName: baseModel,
        epochs,
        maxSeqLength,
        r: loraRank,
        loraAlpha,
      });
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <OmnecorDashboardLayout>
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* ── Page Header ──────────────────────────────────────────────────── */}
      <div className="shrink-0 border-b border-border bg-card/50 px-6 py-5">
        <div className="border-l-4 border-accent-cyan bg-gradient-to-r from-accent-cyan/5 to-transparent px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-accent-cyan/10">
              <Brain className="size-5 text-accent-cyan" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-foreground">LLM Builder</h1>
              <p className="text-sm text-muted-foreground">
                Fine-tune any open-weights model on custom topics, skills, and knowledge bases.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Tab Shell ────────────────────────────────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-hidden">
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as ActiveTab)}
          className="flex h-full flex-col"
        >
          {/* Tab Bar */}
          <div className="shrink-0 border-b border-border bg-card/30 px-6">
            <TabsList className="h-12 gap-1 bg-transparent p-0">
              <TabsTrigger
                value="dataset"
                className="flex items-center gap-2 rounded-none border-b-2 border-transparent px-4 py-3 text-sm font-medium text-muted-foreground data-[state=active]:border-accent-cyan data-[state=active]:bg-transparent data-[state=active]:text-accent-cyan"
              >
                <Database className="size-4" /> Dataset
              </TabsTrigger>
              <TabsTrigger
                value="model"
                className="flex items-center gap-2 rounded-none border-b-2 border-transparent px-4 py-3 text-sm font-medium text-muted-foreground data-[state=active]:border-accent-cyan data-[state=active]:bg-transparent data-[state=active]:text-accent-cyan"
              >
                <Brain className="size-4" /> Model
              </TabsTrigger>
              <TabsTrigger
                value="train"
                className="flex items-center gap-2 rounded-none border-b-2 border-transparent px-4 py-3 text-sm font-medium text-muted-foreground data-[state=active]:border-accent-cyan data-[state=active]:bg-transparent data-[state=active]:text-accent-cyan"
              >
                <Zap className="size-4" /> Train
              </TabsTrigger>
              <TabsTrigger
                value="history"
                className="flex items-center gap-2 rounded-none border-b-2 border-transparent px-4 py-3 text-sm font-medium text-muted-foreground data-[state=active]:border-accent-cyan data-[state=active]:bg-transparent data-[state=active]:text-accent-cyan"
              >
                <Activity className="size-4" /> History
              </TabsTrigger>
            </TabsList>
          </div>

          {/* ── Tab 1: Dataset ────────────────────────────────────────────── */}
          <TabsContent value="dataset" className="min-h-0 flex-1 overflow-y-auto p-6">
            {/* Step indicator */}
            <div className="mb-5 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card/40 px-4 py-2.5">
              {[
                '1. Ingest raw text',
                '2. AI curates instruction pairs',
                '3. Review & approve',
                '4. Compile',
                '5. Train',
              ].map((step, i, arr) => (
                <span key={step} className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{step}</span>
                  {i < arr.length - 1 && <ChevronRight className="size-3 text-muted-foreground/40" />}
                </span>
              ))}
            </div>

            {/* Dataset curation panel */}
            <DatasetCurationPanel
              datasetPath={datasetPath}
              setDatasetPath={setDatasetPath}
              setActiveTab={(tab: string) => setActiveTab(tab as ActiveTab)}
            />

            {/* Next button */}
            <div className="mt-6 flex justify-end">
              <Button
                id="btn-llm-dataset-next"
                disabled={!datasetPath}
                onClick={() => setActiveTab('model')}
                className="gap-2 bg-accent-cyan/10 text-accent-cyan hover:bg-accent-cyan/20 disabled:opacity-40"
                variant="outline"
              >
                Next: Configure Model <ChevronRight className="size-4" />
              </Button>
            </div>
          </TabsContent>

          {/* ── Tab 2: Model ─────────────────────────────────────────────── */}
          <TabsContent value="model" className="min-h-0 flex-1 overflow-y-auto p-6">
            <div className="grid gap-5">
              {/* Card 1: Base Model */}
              <Card className="border-border bg-card/60">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base text-foreground">
                    <Brain className="size-4 text-accent-cyan" /> Base Model
                  </CardTitle>
                  <CardDescription>
                    HuggingFace model ID or one of the recommended options below.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="input-llm-base-model" className="text-xs text-muted-foreground">
                      Model ID
                    </Label>
                    <Input
                      id="input-llm-base-model"
                      value={baseModel}
                      onChange={(e) => setBaseModel(e.target.value)}
                      placeholder="e.g. unsloth/llama-3-8b-bnb-4bit"
                      className="font-mono text-sm"
                    />
                  </div>

                  {/* Suggested model badges */}
                  <div>
                    <p className="mb-2 text-xs text-muted-foreground">Suggested models</p>
                    <div className="flex flex-wrap gap-2">
                      {SUGGESTED_MODELS.map((m) => (
                        <button
                          key={m.id}
                          id={`badge-model-${m.id}`}
                          onClick={() => setBaseModel(m.value)}
                          title={m.value}
                          className={`group flex flex-col rounded-lg border px-3 py-2 text-left transition-all hover:border-accent-cyan/50 hover:bg-accent-cyan/5 ${
                            baseModel === m.value
                              ? 'border-accent-cyan bg-accent-cyan/10 text-accent-cyan'
                              : 'border-border text-foreground'
                          }`}
                        >
                          <span className="text-xs font-semibold">{m.label}</span>
                          <span className="text-[10px] text-muted-foreground group-hover:text-muted-foreground/80">
                            {m.desc}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Ollama model browser */}
                  <div>
                    <Button
                      id="btn-llm-toggle-ollama"
                      variant="outline"
                      size="sm"
                      onClick={() => setShowOllamaModels((p) => !p)}
                      className="gap-2 border-border text-muted-foreground hover:border-accent-cyan/40 hover:text-foreground"
                    >
                      <Cpu className="size-3.5" />
                      {showOllamaModels ? 'Hide' : 'Browse'} Ollama Models
                    </Button>

                    {showOllamaModels && (
                      <div className="mt-3 max-h-48 overflow-y-auto rounded-lg border border-border bg-background/40 p-3">
                        {!ollamaModels?.models?.length ? (
                          <p className="text-xs text-muted-foreground">
                            No Ollama models found. Start Ollama and pull a model to see it here.
                          </p>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {ollamaModels.models.map((m) => (
                              <Badge
                                key={m.name}
                                variant="outline"
                                onClick={() => setBaseModel(m.name)}
                                className="cursor-pointer border-border text-xs text-muted-foreground hover:border-accent-cyan/50 hover:text-foreground"
                              >
                                {m.name}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Card 2: Save Format */}
              <Card className="border-border bg-card/60">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base text-foreground">
                    <PackageCheck className="size-4 text-accent-cyan" /> Save Format
                  </CardTitle>
                  <CardDescription>How to export the fine-tuned weights.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Format</Label>
                    <Select value={saveFormat} onValueChange={(v) => setSaveFormat(v as SaveFormat)}>
                      <SelectTrigger
                        id="select-llm-save-format"
                        className="w-full focus-visible:border-accent-cyan/60 focus-visible:ring-accent-cyan/20"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="gguf">gguf — Recommended · runs in Ollama</SelectItem>
                        <SelectItem value="lora">lora — Adapter only</SelectItem>
                        <SelectItem value="merged_16bit">merged_16bit — Full fp16 merge</SelectItem>
                        <SelectItem value="merged_4bit">merged_4bit — Full 4-bit merge</SelectItem>
                        <SelectItem value="ollama">ollama — Push to Ollama registry</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <p className="rounded-md border border-border/50 bg-background/30 px-3 py-2 text-xs text-muted-foreground">
                    {FORMAT_DESCRIPTIONS[saveFormat]}
                  </p>
                </CardContent>
              </Card>

              {/* Card 3: Compute Target */}
              <Card className="border-border bg-card/60">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base text-foreground">
                    <Cpu className="size-4 text-accent-cyan" /> Compute Target
                  </CardTitle>
                  <CardDescription>Where the training job will run.</CardDescription>
                </CardHeader>
                <CardContent>
                  <RadioGroup
                    id="rg-llm-compute-target"
                    value={computeTarget}
                    onValueChange={(v) => setComputeTarget(v as ComputeTarget)}
                    className="space-y-3"
                  >
                    {/* Local GPU */}
                    <div
                      className={`flex items-start gap-3 rounded-lg border p-4 transition-colors ${
                        computeTarget === 'local'
                          ? 'border-accent-cyan/50 bg-accent-cyan/5'
                          : 'border-border hover:border-border/80'
                      }`}
                    >
                      <RadioGroupItem value="local" id="compute-local" className="mt-0.5" />
                      <div className="flex-1 space-y-1">
                        <Label htmlFor="compute-local" className="cursor-pointer font-medium text-foreground">
                          <span className="flex items-center gap-2">
                            <Cpu className="size-4 text-accent-cyan" /> Local GPU
                          </span>
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          Run training on your machine's GPU via Unsloth + PyTorch.
                        </p>
                        <GpuStatusChip className="mt-1" />
                      </div>
                    </div>

                    {/* Kaggle */}
                    <div
                      className={`flex items-start gap-3 rounded-lg border p-4 transition-colors ${
                        computeTarget === 'kaggle'
                          ? 'border-accent-cyan/50 bg-accent-cyan/5'
                          : 'border-border hover:border-border/80'
                      }`}
                    >
                      <RadioGroupItem value="kaggle" id="compute-kaggle" className="mt-0.5" />
                      <div className="flex-1 space-y-1">
                        <Label htmlFor="compute-kaggle" className="cursor-pointer font-medium text-foreground">
                          <span className="flex items-center gap-2">
                            <Cloud className="size-4 text-accent-cyan" /> Kaggle (Free GPU)
                          </span>
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          Free T4 / P100 cloud GPU via the Kaggle Kernels API. No cost.
                        </p>
                        {kaggleStatus?.connected ? (
                          <span className="flex items-center gap-1.5 text-xs text-accent-success">
                            <CheckCircle2 className="size-3" /> Connected
                            {kaggleStatus.username ? ` as ${kaggleStatus.username}` : ''}
                          </span>
                        ) : (
                          <span className="flex items-center gap-1.5 text-xs text-accent-warning">
                            <AlertCircle className="size-3" /> Not connected —{' '}
                            <button
                              onClick={() => navigate('/settings?tab=api-providers')}
                              className="underline underline-offset-2 hover:text-foreground"
                            >
                              Configure in Settings → API Providers
                            </button>
                          </span>
                        )}
                      </div>
                    </div>

                    {/* OMMESH Node */}
                    <div
                      className={`flex items-start gap-3 rounded-lg border p-4 transition-colors ${
                        computeTarget === 'ommesh'
                          ? 'border-accent-cyan/50 bg-accent-cyan/5'
                          : 'border-border hover:border-border/80'
                      }`}
                    >
                      <RadioGroupItem value="ommesh" id="compute-ommesh" className="mt-0.5" />
                      <div className="flex-1 space-y-1">
                        <Label htmlFor="compute-ommesh" className="cursor-pointer font-medium text-foreground">
                          <span className="flex items-center gap-2">
                            <Activity className="size-4 text-accent-cyan" /> OMMESH Node
                          </span>
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          Route training to a peer node in your OMMESH network.
                        </p>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => navigate('/settings?tab=ommesh')}
                          className="mt-1 h-7 gap-1.5 border-border text-xs text-muted-foreground hover:text-foreground"
                        >
                          <Settings className="size-3" /> Set up in Settings → OMMESH
                        </Button>
                      </div>
                    </div>

                    {/* Cloud Compute */}
                    <div
                      className={`flex items-start gap-3 rounded-lg border p-4 transition-colors ${
                        computeTarget === 'cloud'
                          ? 'border-accent-cyan/50 bg-accent-cyan/5'
                          : 'border-border hover:border-border/80'
                      }`}
                    >
                      <RadioGroupItem value="cloud" id="compute-cloud" className="mt-0.5" />
                      <div className="flex-1 space-y-1">
                        <Label htmlFor="compute-cloud" className="cursor-pointer font-medium text-foreground">
                          <span className="flex items-center gap-2">
                            <Cloud className="size-4 text-accent-cyan" /> Cloud Compute
                          </span>
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          Paid GPU cloud (RunPod, Lambda, etc.) configured in Settings.
                        </p>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => navigate('/settings?tab=cloud')}
                          className="mt-1 h-7 gap-1.5 border-border text-xs text-muted-foreground hover:text-foreground"
                        >
                          <Settings className="size-3" /> Open Cloud Compute
                        </Button>
                      </div>
                    </div>
                  </RadioGroup>
                </CardContent>
              </Card>

              {/* Training Summary */}
              <Card className="border-border bg-card/60">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-foreground">Training Summary</CardTitle>
                </CardHeader>
                <CardContent>
                  <pre className="overflow-x-auto rounded-md border border-border/50 bg-background/60 p-3 text-[11px] font-mono leading-relaxed text-muted-foreground">
                    {JSON.stringify(
                      {
                        baseModel,
                        saveFormat,
                        computeTarget,
                        datasetPath: datasetPath || '(not selected)',
                        epochs,
                        loraRank,
                        loraAlpha,
                        maxSeqLength,
                        targetModules,
                      },
                      null,
                      2,
                    )}
                  </pre>
                </CardContent>
              </Card>

              <div className="flex justify-end">
                <Button
                  id="btn-llm-model-next"
                  onClick={() => setActiveTab('train')}
                  className="gap-2 bg-accent-cyan/10 text-accent-cyan hover:bg-accent-cyan/20"
                  variant="outline"
                >
                  Next: Train <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          </TabsContent>

          {/* ── Tab 3: Train ─────────────────────────────────────────────── */}
          <TabsContent value="train" className="min-h-0 flex-1 overflow-y-auto p-6">
            <div className="grid gap-5">
              {/* LoRA Config */}
              <Card className="border-border bg-card/60">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base text-foreground">
                    <Zap className="size-4 text-accent-cyan" /> LoRA Configuration
                  </CardTitle>
                  <CardDescription>
                    Low-Rank Adaptation hyperparameters. Defaults work for most fine-tuning tasks.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  {/* Rank */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="slider-lora-rank" className="text-sm text-foreground">
                        Rank (R)
                      </Label>
                      <Badge variant="outline" className="border-border font-mono text-xs text-muted-foreground">
                        {loraRank}
                      </Badge>
                    </div>
                    <input
                      id="slider-lora-rank"
                      type="range"
                      min={4}
                      max={128}
                      step={4}
                      value={loraRank}
                      onChange={(e) => setLoraRank(Number(e.target.value))}
                      className="w-full cursor-pointer accent-[var(--accent-cyan)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/50 focus-visible:ring-offset-2 rounded"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Higher rank = more expressive but more VRAM. Start with 16 for most tasks.
                    </p>
                  </div>

                  <Separator className="bg-border/50" />

                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                    {/* Alpha */}
                    <div className="space-y-1.5">
                      <Label htmlFor="input-lora-alpha" className="text-xs text-muted-foreground">
                        Alpha
                      </Label>
                      <Input
                        id="input-lora-alpha"
                        type="number"
                        min={1}
                        value={loraAlpha}
                        onChange={(e) => setLoraAlpha(Number(e.target.value))}
                        className="font-mono text-sm"
                      />
                    </div>

                    {/* Dropout */}
                    <div className="space-y-1.5">
                      <Label htmlFor="input-lora-dropout" className="text-xs text-muted-foreground">
                        Dropout
                      </Label>
                      <Input
                        id="input-lora-dropout"
                        type="number"
                        step={0.01}
                        min={0}
                        max={1}
                        value={dropout}
                        onChange={(e) => setDropout(Number(e.target.value))}
                        className="font-mono text-sm"
                      />
                    </div>

                    {/* Max Seq Length */}
                    <div className="space-y-1.5">
                      <Label htmlFor="input-max-seq-len" className="text-xs text-muted-foreground">
                        Max Seq Length
                      </Label>
                      <Input
                        id="input-max-seq-len"
                        type="number"
                        min={128}
                        step={128}
                        value={maxSeqLength}
                        onChange={(e) => setMaxSeqLength(Number(e.target.value))}
                        className="font-mono text-sm"
                      />
                    </div>

                    {/* Epochs */}
                    <div className="space-y-1.5">
                      <Label htmlFor="input-epochs" className="text-xs text-muted-foreground">
                        Epochs
                      </Label>
                      <Input
                        id="input-epochs"
                        type="number"
                        min={1}
                        max={100}
                        value={epochs}
                        onChange={(e) => setEpochs(Number(e.target.value))}
                        className="font-mono text-sm"
                      />
                    </div>
                  </div>

                  {/* Target modules */}
                  <div className="space-y-1.5">
                    <Label htmlFor="input-target-modules" className="text-xs text-muted-foreground">
                      Target Modules (comma-separated)
                    </Label>
                    <Input
                      id="input-target-modules"
                      value={targetModules}
                      onChange={(e) => setTargetModules(e.target.value)}
                      placeholder="q_proj,v_proj"
                      className="font-mono text-sm"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Typically <code className="text-accent-cyan">q_proj,v_proj</code> for attention-only LoRA. Add{' '}
                      <code className="text-accent-cyan">k_proj,o_proj</code> for deeper adaptation.
                    </p>
                  </div>
                </CardContent>
              </Card>

              {/* Dataset Card */}
              <Card className="border-border bg-card/60">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base text-foreground">
                    <Database className="size-4 text-accent-cyan" /> Dataset
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex gap-2">
                    <Input
                      id="input-train-dataset-path"
                      readOnly
                      value={datasetPath}
                      placeholder="No dataset selected — go to Dataset tab"
                      className="font-mono text-sm text-muted-foreground"
                    />
                    <Button
                      id="btn-llm-edit-dataset"
                      variant="outline"
                      size="sm"
                      onClick={() => setActiveTab('dataset')}
                      className="shrink-0 border-border text-muted-foreground hover:text-foreground"
                    >
                      Edit
                    </Button>
                  </div>

                  {/* Validate */}
                  <div className="flex items-center gap-3">
                    <Button
                      id="btn-llm-validate-dataset"
                      variant="outline"
                      size="sm"
                      disabled={!datasetPath || validateDataset.isPending}
                      onClick={() => {
                        setValidateResult(null);
                        validateDataset.mutate({ datasetPath });
                      }}
                      className="gap-2 border-border text-muted-foreground hover:border-accent-cyan/40 hover:text-foreground disabled:opacity-40"
                    >
                      {validateDataset.isPending ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="size-3.5" />
                      )}
                      Validate Dataset
                    </Button>

                    {validateResult && (
                      <span
                        className={`flex items-center gap-1.5 text-xs ${
                          validateResult.ok ? 'text-accent-success' : 'text-accent-warning'
                        }`}
                      >
                        {validateResult.ok ? (
                          <CheckCircle2 className="size-3" />
                        ) : (
                          <AlertCircle className="size-3" />
                        )}
                        {validateResult.message}
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* ── Start Training ── */}
              <Card className="border-accent-success/20 bg-accent-success/5">
                <CardContent className="pt-6">
                  {computeTarget === 'ommesh' || computeTarget === 'cloud' ? (
                    <div className="flex flex-col items-center gap-3 py-2 text-center">
                      <AlertCircle className="size-8 text-accent-warning" />
                      <p className="text-sm text-muted-foreground">
                        Navigate to the{' '}
                        <button
                          className="text-accent-cyan underline underline-offset-2 hover:opacity-80"
                          onClick={() =>
                            navigate(computeTarget === 'ommesh' ? '/settings?tab=ommesh' : '/settings?tab=cloud')
                          }
                        >
                          {computeTarget === 'ommesh' ? 'OMMESH' : 'Cloud Compute'} panel
                        </button>{' '}
                        to launch training there.
                      </p>
                    </div>
                  ) : (
                    <Button
                      id="btn-llm-start-training"
                      size="lg"
                      disabled={!datasetPath || isTraining}
                      onClick={handleStartTraining}
                      className="w-full gap-2 bg-accent-success/20 text-accent-success hover:bg-accent-success/30 disabled:opacity-40"
                      variant="outline"
                    >
                      {isTraining ? (
                        <>
                          <Loader2 className="size-5 animate-spin" /> Submitting Job…
                        </>
                      ) : (
                        <>
                          <Zap className="size-5" />
                          {computeTarget === 'kaggle' ? 'Submit to Kaggle' : 'Start Local Training'}
                        </>
                      )}
                    </Button>
                  )}

                  {!datasetPath && (
                    <p className="mt-2 text-center text-xs text-accent-warning">
                      ⚠ Select a dataset in the Dataset tab before training.
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* ── Kaggle Job Flow ── */}
              {kernelSlug && computeTarget === 'kaggle' && (
                <Card className="border-border bg-card/60">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-base text-foreground">
                      <Cloud className="size-4 text-accent-cyan" /> Kaggle Job
                      <Badge variant="outline" className="ml-auto border-border font-mono text-xs text-muted-foreground">
                        {kernelSlug}
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center gap-3">
                      <span
                        className={`flex items-center gap-1.5 text-sm ${
                          isKaggleComplete ? 'text-accent-success' : 'text-muted-foreground'
                        }`}
                      >
                        {kaggleJobData ? (
                          isKaggleComplete ? (
                            <CheckCircle2 className="size-4" />
                          ) : (
                            <Loader2 className="size-4 animate-spin" />
                          )
                        ) : (
                          <Loader2 className="size-4 animate-spin" />
                        )}
                        Status: {kaggleJobStatus?.status ?? 'loading…'}
                      </span>
                      <Button
                        id="btn-llm-kaggle-refresh"
                        variant="ghost"
                        size="sm"
                        onClick={() => void refetchKaggleJob()}
                        className="ml-auto gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                      >
                        <RefreshCw className="size-3.5" /> Refresh
                      </Button>
                    </div>

                    {kaggleJobStatus?.output && (
                      <pre className="max-h-40 overflow-y-auto rounded-md border border-border/50 bg-background/60 p-2 text-[10px] font-mono text-muted-foreground">
                        {kaggleJobStatus.output}
                      </pre>
                    )}

                    {isKaggleComplete && (
                      <div className="flex flex-wrap gap-2 pt-1">
                        {!mergedPath && (
                          <Button
                            id="btn-llm-kaggle-import"
                            variant="outline"
                            size="sm"
                            disabled={pullKaggleArtifact.isPending}
                            onClick={() => pullKaggleArtifact.mutate({ kernelSlug, baseModel })}
                            className="gap-2 border-border text-muted-foreground hover:border-accent-cyan/40 hover:text-foreground"
                          >
                            {pullKaggleArtifact.isPending ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              <Download className="size-3.5" />
                            )}
                            Import Adapter
                          </Button>
                        )}

                        {mergedPath && (
                          <Button
                            id="btn-llm-kaggle-activate"
                            variant="outline"
                            size="sm"
                            disabled={registerArtifact.isPending}
                            onClick={() =>
                              registerArtifact.mutate({
                                artifactPath: mergedPath,
                                baseModel,
                                format: saveFormat,
                                source: 'trained',
                              })
                            }
                            className="gap-2 border-accent-success/40 text-accent-success hover:bg-accent-success/10"
                          >
                            {registerArtifact.isPending ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              <CheckCircle2 className="size-3.5" />
                            )}
                            Activate Model
                          </Button>
                        )}
                      </div>
                    )}

                    {mergeJobId && (
                      <p className="text-[11px] text-muted-foreground">
                        Merge job: <code className="text-accent-cyan">{mergeJobId}</code>
                      </p>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* ── Current Artifact ── */}
              {artifactData && (
                <Card className="border-border bg-card/60">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm text-foreground">
                      <PackageCheck className="size-4 text-accent-cyan" /> Current Registered Artifact
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <pre className="overflow-x-auto rounded-md border border-border/50 bg-background/60 p-3 text-[11px] font-mono leading-relaxed text-muted-foreground">
                      {JSON.stringify(artifactData, null, 2)}
                    </pre>
                  </CardContent>
                </Card>
              )}

              {/* ── Prerequisites ── */}
              <Card className="border-border bg-card/40">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-foreground">Prerequisites</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <GpuStatusChip />
                  <MlVenvChip />
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ── Tab 4: History ───────────────────────────────────────────── */}
          <TabsContent value="history" className="min-h-0 flex-1 overflow-y-auto p-6">
            <div className="grid gap-5">
              {/* Artifact detail */}
              <Card className="border-border bg-card/60">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base text-foreground">
                    <PackageCheck className="size-4 text-accent-cyan" /> Registered Model Artifact
                  </CardTitle>
                  <CardDescription>
                    The most recently registered fine-tuned model for this workstation.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {artifactData ? (
                    <div className="space-y-3">
                      <pre className="overflow-x-auto rounded-md border border-border/50 bg-background/60 p-4 text-[11px] font-mono leading-relaxed text-muted-foreground">
                        {JSON.stringify(artifactData, null, 2)}
                      </pre>
                      <Button
                        id="btn-llm-history-refresh"
                        variant="ghost"
                        size="sm"
                        onClick={() => void refetchArtifact()}
                        className="gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                      >
                        <RefreshCw className="size-3.5" /> Refresh
                      </Button>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-3 py-8 text-center">
                      <Brain className="size-10 text-muted-foreground/30" />
                      <p className="text-sm text-muted-foreground">No artifact registered yet.</p>
                      <p className="text-xs text-muted-foreground/60">
                        Complete a training run and register the output to see it here.
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Kaggle job monitor in history */}
              {kernelSlug && (
                <Card className="border-border bg-card/60">
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base text-foreground">
                      <Cloud className="size-4 text-accent-cyan" /> Kaggle Job Monitor
                      <Badge variant="outline" className="ml-auto border-border font-mono text-xs text-muted-foreground">
                        {kernelSlug}
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center gap-3">
                      <span
                        className={`flex items-center gap-1.5 text-sm ${
                          isKaggleComplete ? 'text-accent-success' : 'text-muted-foreground'
                        }`}
                      >
                        {isKaggleComplete ? (
                          <CheckCircle2 className="size-4" />
                        ) : (
                          <Loader2 className="size-4 animate-spin" />
                        )}
                        {kaggleJobStatus?.status ?? 'Loading…'}
                      </span>
                      <Button
                        id="btn-llm-history-kaggle-refresh"
                        variant="ghost"
                        size="sm"
                        onClick={() => void refetchKaggleJob()}
                        className="ml-auto gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                      >
                        <RefreshCw className="size-3.5" /> Refresh
                      </Button>
                    </div>

                    {kaggleJobStatus?.output && (
                      <pre className="max-h-48 overflow-y-auto rounded-md border border-border/50 bg-background/60 p-2 text-[10px] font-mono text-muted-foreground">
                        {kaggleJobStatus.output}
                      </pre>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Run history placeholder */}
              <Card className="border-border bg-card/40">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base text-foreground">
                    <Activity className="size-4 text-accent-cyan" /> Training Run History
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-col items-center gap-3 py-10 text-center">
                    <Activity className="size-10 text-muted-foreground/30" />
                    <p className="text-sm text-muted-foreground">
                      Training run history will appear here as you build models.
                    </p>
                    <p className="text-xs text-muted-foreground/60">
                      Monitor active jobs in{' '}
                      <button
                        className="text-accent-cyan underline underline-offset-2 hover:opacity-80"
                        onClick={() => navigate('/notifications?tab=jobs')}
                      >
                        Notifications → Jobs
                      </button>
                      .
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
    </OmnecorDashboardLayout>
  );
}
