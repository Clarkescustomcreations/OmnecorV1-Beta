import React, { useState, useEffect } from "react";
import { trpc } from "../../lib/trpc";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "../ui/card";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import { Badge } from "../ui/badge";
import { useNeuralMap } from "../../contexts/NeuralMapContext";
import { toast } from "sonner";
import {
  Search,
  FolderOpen,
  Loader2,
  Check,
  X,
  Play,
  Database,
  FileText,
  Activity,
  ArrowRight,
  Settings,
  HelpCircle,
  Brain
} from "lucide-react";

interface DatasetCurationPanelProps {
  datasetPath: string;
  setDatasetPath: (path: string) => void;
  setActiveTab: (tab: string) => void;
}

export const DatasetCurationPanel: React.FC<DatasetCurationPanelProps> = ({
  datasetPath,
  setDatasetPath,
  setActiveTab,
}) => {
  const { activeMap } = useNeuralMap();
  const projectId = activeMap?.id || null;

  // Discovery Inputs
  const [sourceType, setSourceType] = useState<'local' | 'online_search' | 'kaggle_search' | 'huggingface'>('local');
  const [queryOrPath, setQueryOrPath] = useState('');
  const [limit, setLimit] = useState(10);

  // Curation Progress States
  const [curatingAll, setCuratingAll] = useState(false);
  const [curateProgress, setCurateProgress] = useState(0);
  const [curateTotal, setCurateTotal] = useState(0);

  // Set default path if active map changes
  useEffect(() => {
    if (activeMap?.rootDirectories?.[0] && sourceType === "local" && !queryOrPath) {
      setQueryOrPath(activeMap.rootDirectories[0]);
    }
  }, [activeMap, sourceType]);

  // Queries
  const {
    data: unprocessedSources,
    isLoading: isLoadingUnprocessed,
    refetch: refetchUnprocessed,
  } = trpc.dataset.listUnprocessedSources.useQuery({ projectId });

  const {
    data: curatedExamples,
    isLoading: isLoadingCurated,
    refetch: refetchCurated,
  } = trpc.dataset.listCuratedExamples.useQuery({ projectId });

  // Mutations
  const discoverSources = trpc.dataset.discoverSources.useMutation({
    onSuccess: (data) => {
      toast.success(`Discovered and ingested ${data.count} raw text chunks.`);
      refetchUnprocessed();
    },
    onError: (err) => {
      toast.error(`Discovery failed: ${err.message}`);
    },
  });

  const curateItem = trpc.dataset.curateSourceItem.useMutation({
    onSuccess: () => {
      refetchUnprocessed();
      refetchCurated();
    },
  });

  const updateExample = trpc.dataset.updateCuratedExample.useMutation({
    onSuccess: (data) => {
      toast.success(`Example #${data.id} updated successfully.`);
      refetchCurated();
    },
    onError: (err) => {
      toast.error(`Failed to update example: ${err.message}`);
    },
  });

  const compileDataset = trpc.dataset.compileDataset.useMutation({
    onSuccess: (data) => {
      toast.success(`Dataset compiled successfully!`);
      setDatasetPath(data.filePath);
      setActiveTab("config");
    },
    onError: (err) => {
      toast.error(`Compilation failed: ${err.message}`);
    },
  });

  const handleDiscover = () => {
    if (!queryOrPath.trim()) {
      toast.error(
        sourceType === 'local'
          ? 'Please provide a valid local directory path.'
          : sourceType === 'kaggle_search'
          ? 'Please enter a Kaggle dataset search query (e.g. "medical records nlp").'
          : sourceType === 'huggingface'
          ? 'Please enter a HuggingFace dataset name (e.g. "squad" or "HuggingFaceH4/ultrachat_200k").'
          : 'Please enter an online search query.'
      );
      return;
    }
    // For kaggle_search and huggingface we map to online_search with a prefixed query
    // so the backend DatasetDiscoveryService handles them as web-sourced text chunks.
    const effectiveSourceType: 'local' | 'online_search' = sourceType === 'local' ? 'local' : 'online_search';
    const effectiveQuery =
      sourceType === 'kaggle_search'
        ? `site:kaggle.com/datasets ${queryOrPath.trim()}`
        : sourceType === 'huggingface'
        ? `site:huggingface.co/datasets/${queryOrPath.trim()} dataset card`
        : queryOrPath.trim();
    discoverSources.mutate({
      projectId,
      sourceType: effectiveSourceType,
      queryOrPath: effectiveQuery,
      limit,
    });
  };

  const handleCurateAll = async () => {
    if (!unprocessedSources || unprocessedSources.length === 0) return;
    setCuratingAll(true);
    setCurateTotal(unprocessedSources.length);
    setCurateProgress(0);

    toast.info(`Starting batch curation of ${unprocessedSources.length} raw text chunks.`);

    for (let i = 0; i < unprocessedSources.length; i++) {
      const item = unprocessedSources[i];
      try {
        await curateItem.mutateAsync({ itemId: item.id });
      } catch (err) {
        console.error(`Failed to curate item ${item.id}:`, err);
      }
      setCurateProgress(i + 1);
    }

    setCuratingAll(false);
    toast.success("Batch curation complete!");
    refetchUnprocessed();
    refetchCurated();
  };

  const handleCompile = () => {
    compileDataset.mutate({ projectId });
  };

  // Filter queues
  const pendingReviewExamples = curatedExamples?.filter((ex) => ex.status === "pending_review") || [];
  const approvedExamples = curatedExamples?.filter((ex) => ex.status === "approved") || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Database className="w-5 h-5 text-accent-cyan" /> Dataset Discovery & Curation
        </h3>
        <p className="text-xs text-muted-foreground">
          Scan local codebases, document folders, or search web sources to generate instruction-tuning training pairs.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left pane: Discovery controls & raw chunks list */}
        <div className="lg:col-span-1 space-y-6">
          <Card>
            <CardHeader className="py-4">
              <CardTitle className="text-sm font-medium">1. Data Ingestion & Scan</CardTitle>
              <CardDescription className="text-[11px]">Ingest raw text segments to be curated.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-0">
              <div className="space-y-2">
                <Label htmlFor="select-dataset-source-type">Source Type</Label>
                <select
                  id="select-dataset-source-type"
                  value={sourceType}
                  onChange={(e) => setSourceType(e.target.value as 'local' | 'online_search' | 'kaggle_search' | 'huggingface')}
                  className="w-full h-10 px-3 rounded-md border border-input bg-transparent text-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:border-ring cursor-pointer"
                >
                  <option value="local" className="bg-card text-foreground">Local Folder Path</option>
                  <option value="online_search" className="bg-card text-foreground">Online Web Search</option>
                  <option value="kaggle_search" className="bg-card text-foreground">Kaggle Dataset Search</option>
                  <option value="huggingface" className="bg-card text-foreground">HuggingFace Dataset</option>
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="input-dataset-source-value">
                  {sourceType === 'local' ? 'Directory Path'
                    : sourceType === 'kaggle_search' ? 'Kaggle Search Query'
                    : sourceType === 'huggingface' ? 'HuggingFace Dataset Name'
                    : 'Search Query'}
                </Label>
                <div className="relative">
                  <Input
                    id="input-dataset-source-value"
                    value={queryOrPath}
                    onChange={(e) => setQueryOrPath(e.target.value)}
                    placeholder={
                      sourceType === 'local'
                        ? '/absolute/path/to/folder'
                        : sourceType === 'kaggle_search'
                        ? 'e.g., medical imaging classification'
                        : sourceType === 'huggingface'
                        ? 'e.g., squad or HuggingFaceH4/ultrachat_200k'
                        : 'e.g., Python fast-api routing guidelines'
                    }
                    className="pr-8"
                  />
                  {sourceType === 'local' ? (
                    <FolderOpen className="absolute right-2.5 top-3 w-4 h-4 text-muted-foreground pointer-events-none" />
                  ) : (
                    <Search className="absolute right-2.5 top-3 w-4 h-4 text-muted-foreground pointer-events-none" />
                  )}
                </div>
                {sourceType === 'kaggle_search' && (
                  <p className="text-[10px] text-muted-foreground">
                    Searches Kaggle for datasets matching your query and ingests dataset card text as training material. Requires internet access.
                  </p>
                )}
                {sourceType === 'huggingface' && (
                  <p className="text-[10px] text-muted-foreground">
                    Ingests the HuggingFace dataset card and README as training material. For full dataset loading, use the local folder option after downloading with <code className="font-mono bg-muted px-0.5 rounded">datasets-cli</code>.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="input-dataset-source-limit">Ingest Limit</Label>
                  <Input
                    id="input-dataset-source-limit"
                    type="number"
                    min={1}
                    max={200}
                    value={limit}
                    onChange={(e) => setLimit(parseInt(e.target.value, 10) || 10)}
                  />
                </div>
                <div className="flex items-end">
                  <Button
                    id="btn-discover-dataset"
                    className="w-full bg-accent-cyan text-background hover:bg-accent-cyan/95 font-medium transition-all"
                    onClick={handleDiscover}
                    disabled={discoverSources.isPending}
                  >
                    {discoverSources.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <Activity className="w-4 h-4 mr-2" /> Ingest
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="py-4 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-sm font-medium">Unprocessed Sources</CardTitle>
                <CardDescription className="text-[11px]">Raw chunks awaiting LLM curation.</CardDescription>
              </div>
              <Badge variant="secondary" className="font-mono text-xs">
                {unprocessedSources?.length || 0}
              </Badge>
            </CardHeader>
            <CardContent className="pt-0 space-y-3">
              {unprocessedSources && unprocessedSources.length > 0 ? (
                <>
                  <Button
                    id="btn-curate-all-sources"
                    variant="outline"
                    className="w-full text-xs h-8 border-accent-cyan/40 hover:bg-accent-cyan/10 transition-colors"
                    onClick={handleCurateAll}
                    disabled={curatingAll || curateItem.isPending}
                  >
                    {curatingAll ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                        Curating ({curateProgress}/{curateTotal})
                      </>
                    ) : (
                      <>
                        <Play className="w-3.5 h-3.5 mr-2 text-accent-cyan" />
                        Curate All ({unprocessedSources.length})
                      </>
                    )}
                  </Button>

                  <div className="max-h-72 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                    {unprocessedSources.map((item) => (
                      <div
                        key={item.id}
                        className="p-2 rounded border bg-muted/20 text-[11px] space-y-1.5 flex flex-col justify-between"
                      >
                        <div>
                          <p className="font-medium text-foreground truncate">{item.sourceName}</p>
                          <p className="text-muted-foreground line-clamp-2 card-content-safe italic">
                            "{item.content}"
                          </p>
                        </div>
                        <div className="flex justify-between items-center pt-1 border-t border-border/40">
                          <span className="text-[10px] text-muted-foreground font-mono">
                            ID: {item.id} • {item.sourceType}
                          </span>
                          <Button
                            id={`btn-curate-item-${item.id}`}
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2 text-[10px] text-accent-cyan hover:bg-accent-cyan/10"
                            onClick={() => curateItem.mutate({ itemId: item.id })}
                            disabled={curateItem.isPending && curateItem.variables?.itemId === item.id}
                          >
                            {curateItem.isPending && curateItem.variables?.itemId === item.id ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              "Curate"
                            )}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="text-center py-6 text-xs text-muted-foreground border border-dashed rounded-lg bg-muted/5">
                  <FileText className="w-8 h-8 mx-auto mb-2 text-muted-foreground/45" />
                  No raw sources. Ingest files or run online searches above.
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right pane: Review queue & Compilation */}
        <div className="lg:col-span-2 space-y-6">
          <div className="flex items-center justify-between border-b pb-2">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="font-mono text-xs">
                {pendingReviewExamples.length} Pending
              </Badge>
              <Badge variant="outline" className="font-mono text-xs border-accent-success text-accent-success">
                {approvedExamples.length} Approved
              </Badge>
            </div>

            <Button
              id="btn-compile-dataset-load"
              disabled={approvedExamples.length === 0 || compileDataset.isPending}
              onClick={handleCompile}
              className="bg-accent-success text-background hover:bg-accent-success/95 text-xs font-semibold h-8"
            >
              {compileDataset.isPending ? (
                <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
              ) : (
                <>
                  <Check className="w-3.5 h-3.5 mr-1.5" /> Compile & Load ({approvedExamples.length})
                </>
              )}
            </Button>
          </div>

          <div className="max-h-[600px] overflow-y-auto space-y-4 pr-2 custom-scrollbar">
            {pendingReviewExamples.length > 0 ? (
              pendingReviewExamples.map((ex) => (
                <ExampleReviewCard
                  key={ex.id}
                  example={ex}
                  onApprove={(id, instruction, inputVal, output) => {
                    updateExample.mutate({
                      id,
                      instruction,
                      input: inputVal || null,
                      output,
                      status: "approved",
                    });
                  }}
                  onReject={(id) => {
                    updateExample.mutate({
                      id,
                      status: "rejected",
                    });
                  }}
                  isUpdating={updateExample.isPending && updateExample.variables?.id === ex.id}
                />
              ))
            ) : (
              <div className="text-center py-16 border border-dashed rounded-lg bg-muted/5">
                <Brain className="w-12 h-12 mx-auto mb-3 text-muted-foreground/30" />
                <p className="text-sm font-medium text-foreground">Curation Review Queue Empty</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                  Run "Curate" on unprocessed sources to generate training instructions using local or cloud AI models.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

type CuratedExample = inferRouterOutputs<AppRouter>["dataset"]["listCuratedExamples"][number];

/* ─── Child Review Card Component ─── */
interface ExampleReviewCardProps {
  example: CuratedExample;
  onApprove: (id: number, instruction: string, inputVal: string, output: string) => void;
  onReject: (id: number) => void;
  isUpdating: boolean;
}

const ExampleReviewCard: React.FC<ExampleReviewCardProps> = ({
  example,
  onApprove,
  onReject,
  isUpdating,
}) => {
  const [instruction, setInstruction] = useState(example.instruction);
  const [inputVal, setInputVal] = useState(example.input || "");
  const [output, setOutput] = useState(example.output);

  return (
    <Card className="border border-border/80 bg-card/65 hover:bg-card transition-colors relative overflow-hidden">
      <div className="absolute left-0 top-0 bottom-0 w-1 bg-accent-cyan/80" />
      <CardHeader className="py-3 flex flex-row items-center justify-between border-b border-border/40">
        <div>
          <CardTitle className="text-xs font-semibold text-accent-cyan">Curated Example #{example.id}</CardTitle>
          <CardDescription className="text-[10px]">Verify and edit generated instruction-tuning pair.</CardDescription>
        </div>
        <div className="flex gap-1.5">
          <Button
            id={`btn-reject-example-${example.id}`}
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0 text-destructive hover:bg-destructive/15"
            onClick={() => onReject(example.id)}
            disabled={isUpdating}
            title="Reject Example"
          >
            <X className="w-3.5 h-3.5" />
          </Button>
          <Button
            id={`btn-approve-example-${example.id}`}
            size="sm"
            className="h-7 px-2.5 bg-accent-success text-background hover:bg-accent-success/90 text-xs font-medium"
            onClick={() => onApprove(example.id, instruction, inputVal, output)}
            disabled={isUpdating}
            title="Approve & Save Example"
          >
            {isUpdating ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <>
                <Check className="w-3.5 h-3.5 mr-1" /> Approve
              </>
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-4 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor={`textarea-instruction-${example.id}`} className="text-xs text-muted-foreground font-medium">
            Instruction / Prompt
          </Label>
          <Textarea
            id={`textarea-instruction-${example.id}`}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            className="text-xs min-h-16 font-mono leading-relaxed"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`textarea-input-${example.id}`} className="text-xs text-muted-foreground font-medium flex items-center gap-1">
            Input Context <span className="text-[10px] text-muted-foreground/60">(Optional)</span>
          </Label>
          <Textarea
            id={`textarea-input-${example.id}`}
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            placeholder="No context input required."
            className="text-xs min-h-12 font-mono leading-relaxed"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`textarea-output-${example.id}`} className="text-xs text-muted-foreground font-medium">
            Correct Output Response
          </Label>
          <Textarea
            id={`textarea-output-${example.id}`}
            value={output}
            onChange={(e) => setOutput(e.target.value)}
            className="text-xs min-h-24 font-mono leading-relaxed"
          />
        </div>
      </CardContent>
    </Card>
  );
};
