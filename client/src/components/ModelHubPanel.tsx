import { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Download,
  Trash2,
  Check,
  AlertCircle,
  Zap,
  Server,
  Search,
  RefreshCw,
  PlusCircle,
  Info,
  Sliders,
  Play,
  Cpu,
  Network,
  Wrench,
} from "lucide-react";
import { HowToTooltip } from "@/components/shell/HowToTooltip";
import { HfModelBrowser } from "@/components/hardware/HfModelBrowser";
import { cn } from "@/lib/utils";
import {
  getActiveModels,
  toggleActiveModel,
  isModelActive,
  API_MODEL_CATALOG,
  type AIModel,
  type ModelMarketplaceItem,
} from "@/lib/aiModels";
import { trpc } from "@/lib/trpc";
import { describeCatalogHost } from "@shared/types/modelCatalog";
import { toast } from "sonner";

interface ModelHubPanelProps {
  onModelSelect?: (model: AIModel) => void;
  onModelDownload?: (item: ModelMarketplaceItem) => void;
}

/** Capability matrix for a cloud API model, derived from its provider. */
function apiModelCapabilities(providerId: string): NonNullable<AIModel["capabilities"]> {
  return {
    chat: true,
    completion: true,
    embedding: providerId === "openai",
    vision: providerId === "openai" || providerId === "gemini",
    functionCalling: providerId === "openai" || providerId === "anthropic",
  };
}

export function ModelHubPanel({
  onModelSelect,
  onModelDownload,
}: ModelHubPanelProps) {
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>("active");
  const [searchQuery, setSearchQuery] = useState("");
  const [marketplaceSearch, setMarketplaceSearch] = useState("");
  const [customModelId, setCustomModelId] = useState("");
  const [toggleCounter, setToggleCounter] = useState(0);

  // Role gate — deleteModel is admin-only on the server
  const { data: me } = trpc.auth.me.useQuery();
  const isAdmin = me?.role === "admin" || me?.role === "owner";

  // Load configured API providers from Settings
  const { data: aiProviders } = trpc.system.aiProviders.useQuery();

  // Unified model catalog (Model-Fabric) — the source of truth for what
  // Omnecor's own runtime is hosting, on this PC and across OMMESH peers.
  const { data: catalog = [], isLoading: catalogLoading, isError: catalogError } =
    trpc.aiProvider.catalog.useQuery(undefined, { refetchInterval: 30_000 });

  // Omnecor self-hosted models, grouped per node ("Omnecor · This PC",
  // "Omnecor · <peer>"). Ollama and cloud are handled by their own tabs.
  const omnecorGroups = useMemo(() => {
    const byNode = new Map<string, { label: string; order: number; entries: typeof catalog }>();
    for (const entry of catalog) {
      const host = describeCatalogHost(entry);
      if (host.brand !== "omnecor") continue;
      const g = byNode.get(host.key) ?? { label: host.label, order: host.order, entries: [] };
      g.entries.push(entry);
      byNode.set(host.key, g);
    }
    return Array.from(byNode.entries())
      .sort(([, a], [, b]) => a.order - b.order || a.label.localeCompare(b.label))
      .map(([key, g]) => ({ key, ...g }));
  }, [catalog]);

  // Dynamic tabs list depending on active keys
  const activeTabsList = useMemo(() => {
    const list = [
      { id: "active", label: "Active Models" },
      { id: "omnecor", label: "Omnecor" },
      { id: "ollama", label: "Ollama" },
      { id: "hf-gguf", label: "HF GGUF" },
    ];
    if (aiProviders?.openai) list.push({ id: "openai", label: "OpenAI" });
    if (aiProviders?.anthropic) list.push({ id: "anthropic", label: "Claude" });
    if (aiProviders?.gemini) list.push({ id: "gemini", label: "Google Gemini" });
    if (aiProviders?.grok) list.push({ id: "grok", label: "Grok" });
    if (aiProviders?.huggingface) list.push({ id: "huggingface", label: "Hugging Face" });
    return list;
  }, [aiProviders]);

  // Discover real models from Ollama
  const { data: ollamaRaw = [], isLoading: ollamaLoading, refetch: refetchOllama } =
    trpc.aiProvider.discoverOllamaModels.useQuery(undefined, {
      refetchInterval: 30_000,
    });

  // Dynamic discovery for API models
  const providerModelsQuery = trpc.aiProvider.discoverProviderModels.useQuery(
    { providerId: activeTab as any },
    {
      enabled: ["openai", "anthropic", "gemini", "grok", "huggingface"].includes(activeTab),
      retry: false,
      staleTime: 60_000,
    }
  );

  // Real marketplace search from server proxy
  const marketplaceQuery = trpc.ollama.searchModels.useQuery(
    { query: marketplaceSearch, limit: 12 },
    { enabled: activeTab === "ollama" }
  );

  const deleteMutation = trpc.ollama.deleteModel.useMutation({
    onSuccess: ({ name }) => {
      toast.success(`Deleted local model: ${name}`);
      refetchOllama();
    },
    onError: (err) => toast.error("Delete failed: " + err.message),
  });

  // List of active models for the "Active Models" tab
  const activeModelsList = useMemo<AIModel[]>(() => {
    // 1. Downloaded local Ollama models are always considered active
    const local: AIModel[] = ollamaRaw.map((m) => ({
      id: m.name ?? m.model,
      name: m.name ?? m.model,
      displayName: `${m.name ?? m.model} (Ollama)`,
      source: "ollama" as const,
      type: "local" as const,
      status: "available" as const,
      metadata: {
        size: m.size ? Math.round(m.size / 1024 / 1024) : undefined,
        quantization: m.details?.quantization_level,
        endpoint: aiProviders?.ollamaUrl ?? "http://localhost:11434",
      },
      capabilities: { chat: true, completion: true, embedding: false, vision: false, functionCalling: false },
    }));

    // 2. Activated cloud models from localStorage
    const activeCloudItems = getActiveModels();
    const cloud: AIModel[] = activeCloudItems
      .filter((item) => {
        // Ensure provider key is configured
        if (item.providerId === "openai") return !!aiProviders?.openai;
        if (item.providerId === "anthropic") return !!aiProviders?.anthropic;
        if (item.providerId === "gemini") return !!aiProviders?.gemini;
        if (item.providerId === "grok") return !!aiProviders?.grok;
        if (item.providerId === "huggingface") return !!aiProviders?.huggingface;
        return false;
      })
      .map((item) => {
        const catalogItem = API_MODEL_CATALOG[item.providerId as keyof typeof API_MODEL_CATALOG]?.find(
          (m) => m.id === item.modelId
        );
        const name = catalogItem?.name ?? item.modelId;
        return {
          id: item.modelId,
          name,
          displayName: `${name} (${item.providerId})`,
          source: item.providerId as AIModel["source"],
          type: "api" as const,
          status: "available" as const,
          costPer1kTokens: catalogItem?.costPer1kTokens,
          capabilities: apiModelCapabilities(item.providerId),
        };
      });

    return [...local, ...cloud];
  }, [ollamaRaw, aiProviders, toggleCounter]);

  // Compute models to show in dynamic provider tabs
  const providerTabModels = useMemo(() => {
    if (!["openai", "anthropic", "gemini", "grok", "huggingface"].includes(activeTab)) return [];

    const provId = activeTab as keyof typeof API_MODEL_CATALOG;
    const isOffline = providerModelsQuery.isError || !providerModelsQuery.data || providerModelsQuery.data.length === 0;

    if (providerModelsQuery.data && providerModelsQuery.data.length > 0) {
      return providerModelsQuery.data.map((m) => ({
        id: m.id,
        name: m.name,
        isFallback: false,
      }));
    }

    // Return static catalog as fallback
    const fallbackList = API_MODEL_CATALOG[provId] || [];
    return fallbackList.map((m) => ({
      id: m.id,
      name: m.name,
      isFallback: true,
    }));
  }, [activeTab, providerModelsQuery.data, providerModelsQuery.isError]);

  // Filtered models for Active Models search
  const filteredActiveModels = useMemo(() => {
    if (!searchQuery) return activeModelsList;
    const q = searchQuery.toLowerCase();
    return activeModelsList.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.displayName.toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q)
    );
  }, [activeModelsList, searchQuery]);

  const handleModelSelect = (model: AIModel) => {
    setSelectedModelId(model.id);
    onModelSelect?.(model);
  };

  const handleToggleActive = (providerId: string, modelId: string, active: boolean) => {
    toggleActiveModel(providerId, modelId, active);
    setToggleCounter((prev) => prev + 1);
    toast.success(`${active ? "Activated" : "Deactivated"} model: ${modelId}`);
  };

  const handleAddCustomModel = (provider: string) => {
    if (!customModelId.trim()) return;
    const model = customModelId.trim();
    toggleActiveModel(provider, model, true);
    setToggleCounter((prev) => prev + 1);
    setCustomModelId("");
    toast.success(`Custom model "${model}" added and activated!`);
  };

  const handleDeleteModel = (model: AIModel, e: React.MouseEvent) => {
    e.stopPropagation();
    if (model.type !== "local") return;
    deleteMutation.mutate({ name: model.id });
  };

  return (
    <div className="w-full h-full flex flex-col gap-4">
      {/* Dynamic Tab Selector */}
      <div className="flex flex-wrap gap-1.5 border-b border-border pb-2">
        {activeTabsList.map((tab) => (
          <HowToTooltip key={tab.id} title="Switch View" description="Toggle between active models, local Ollama models, and cloud provider APIs" side="bottom">
            <button
              id={`tab-selector-${tab.id}`}
              onClick={() => {
                setActiveTab(tab.id);
                setSearchQuery("");
              }}
              className={cn(
                "px-3 py-1.5 font-mono text-xs rounded transition-all cursor-pointer",
                activeTab === tab.id
                  ? "bg-primary/20 border border-primary/40 text-primary font-semibold shadow-[0_0_8px_rgba(168,85,247,0.2)]"
                  : "bg-transparent border border-transparent text-muted-foreground hover:text-foreground hover:bg-primary/5"
              )}
            >
              {tab.label}
            </button>
          </HowToTooltip>
        ))}
      </div>

      {/* Main Content Pane */}
      <div className="min-h-0 flex-1 overflow-auto pr-1">
        {/* TAB 1: ACTIVE MODELS */}
        {activeTab === "active" && (
          <div className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                id="active-models-search"
                placeholder="Search activated models..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 h-9"
              />
            </div>

            <div className="space-y-3" role="list">
              {filteredActiveModels.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 border border-dashed border-border rounded-lg text-muted-foreground p-4">
                  <Info className="w-6 h-6 mb-2 opacity-60" />
                  <p className="text-xs">No active models matching search criteria.</p>
                </div>
              ) : (
                filteredActiveModels.map((model) => (
                  <Card
                    key={`${model.source}-${model.id}`}
                    role="listitem"
                    className={cn(
                      "cursor-pointer transition-all hover:border-primary/30",
                      selectedModelId === model.id && "border-primary/30 bg-primary/5 shadow-[0_0_12px_rgba(168,85,247,0.05)]"
                    )}
                    onClick={() => handleModelSelect(model)}
                  >
                    <CardContent className="p-4 flex items-center justify-between gap-4 card-content-safe">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <h3 className="font-semibold text-sm truncate">{model.name}</h3>
                          <Badge variant="outline" className="text-[10px] capitalize">
                            {model.source}
                          </Badge>
                          <Badge variant="secondary" className="text-[10px]">
                            {model.type === "local" ? "Local" : "API"}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {model.capabilities?.chat && <Badge className="text-[9px] bg-accent-purple/10 text-accent-purple border-accent-purple/20">Chat</Badge>}
                          {model.capabilities?.vision && <Badge className="text-[9px] bg-accent-cyan/10 text-accent-cyan border-accent-cyan/20">Vision</Badge>}
                          {model.capabilities?.functionCalling && <Badge className="text-[9px] bg-accent-success/10 text-accent-success border-accent-success/20">Functions</Badge>}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {model.type === "api" ? (
                          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                            <span className="text-[10px] text-muted-foreground font-mono">Active</span>
                            <HowToTooltip title="Toggle Activation" description="Enable or disable this model for use across the application" side="top">
                              <Switch
                                id={`switch-active-${model.source}-${model.id}`}
                                checked={isModelActive(model.source, model.id)}
                                onCheckedChange={(checked) => handleToggleActive(model.source, model.id, checked)}
                              />
                            </HowToTooltip>
                          </div>
                        ) : (
                          <Badge className="bg-accent-success/20 text-accent-success border-accent-success/30 font-semibold text-[10px]">
                            Local Weight
                          </Badge>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </div>
        )}

        {/* TAB: OMNECOR SELF-HOSTED RUNTIME (per node) */}
        {activeTab === "omnecor" && (
          <div className="space-y-5">
            <div className="flex items-start gap-2 border border-accent-info/20 bg-accent-info/5 p-3 rounded text-xs">
              <Zap className="w-4 h-4 text-accent-info mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-semibold text-accent-info">Omnecor hosts these itself.</p>
                <p className="text-muted-foreground mt-0.5">
                  Omnecor's own runtime serves these models with full tool access — no Ollama required.
                  With OMMESH, each PC running Omnecor appears as its own node below.
                </p>
              </div>
            </div>

            {catalogLoading ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground text-xs">
                <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                Loading Omnecor runtime catalog...
              </div>
            ) : omnecorGroups.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 border border-dashed border-border rounded-lg text-muted-foreground p-4 text-center">
                <Info className="w-6 h-6 mb-2 opacity-60" />
                <p className="text-xs">
                  {catalogError
                    ? "Couldn't reach the server to load the catalog."
                    : "Omnecor isn't hosting any models yet — its local runtime starts automatically once a GGUF model is available, or join an OMMESH peer running Omnecor."}
                </p>
              </div>
            ) : (
              omnecorGroups.map((group) => {
                const isMesh = group.key.startsWith("omnecor:mesh:");
                const NodeIcon = isMesh ? Network : Cpu;
                return (
                  <div key={group.key} className="space-y-3">
                    <h2 className="text-xs uppercase font-bold tracking-wider text-accent-purple flex items-center gap-1.5">
                      <NodeIcon className="w-3.5 h-3.5" /> {group.label}
                    </h2>
                    <div className="grid grid-cols-1 gap-2.5">
                      {group.entries.map((entry) => {
                        const model: AIModel = {
                          id: entry.modelId,
                          name: entry.name,
                          displayName: entry.name,
                          source: "ollama",
                          type: "local",
                          status: "available",
                          metadata: { size: entry.capabilities.sizeMb ? Math.round(entry.capabilities.sizeMb) : undefined },
                        };
                        return (
                          <Card
                            key={entry.key}
                            className={cn(
                              "cursor-pointer hover:border-accent-purple/40 transition-all",
                              selectedModelId === entry.modelId && "border-accent-purple/40 bg-accent-purple/5"
                            )}
                            onClick={() => handleModelSelect(model)}
                          >
                            <CardContent className="p-3.5 flex items-center justify-between gap-4 card-content-safe">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 mb-1 flex-wrap">
                                  <h3 className="font-semibold text-xs truncate">{entry.name}</h3>
                                  <Badge className="text-[9px] bg-accent-purple/10 text-accent-purple border-accent-purple/20">
                                    Self-hosted
                                  </Badge>
                                  {entry.capabilities.nativeTools && (
                                    <Badge className="text-[9px] bg-accent-success/10 text-accent-success border-accent-success/20 flex items-center gap-0.5">
                                      <Wrench className="w-2.5 h-2.5" /> Native tools
                                    </Badge>
                                  )}
                                </div>
                                <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground mt-1">
                                  <span className="font-mono">{entry.providerId}</span>
                                  {entry.capabilities.sizeMb && (
                                    <span>Size: {Math.round(entry.capabilities.sizeMb).toLocaleString()} MB</span>
                                  )}
                                  {entry.capabilities.contextWindow && (
                                    <span>Ctx: {entry.capabilities.contextWindow.toLocaleString()}</span>
                                  )}
                                </div>
                              </div>
                              <Badge className="bg-accent-success/20 text-accent-success border-accent-success/30 font-semibold text-[10px] flex-shrink-0">
                                Ready
                              </Badge>
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* TAB 2: OLLAMA LOCAL & MARKETPLACE */}
        {activeTab === "ollama" && (
          <div className="space-y-6">
            {/* Part A: Local Library */}
            <div className="space-y-3">
              <h2 className="text-xs uppercase font-bold tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Server className="w-3.5 h-3.5" /> Local Library
              </h2>
              {ollamaLoading ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground text-xs">
                  <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                  Loading local library...
                </div>
              ) : ollamaRaw.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-24 border border-dashed border-border rounded-lg text-muted-foreground p-4">
                  <p className="text-xs">No local weights found on Ollama server.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-2.5">
                  {ollamaRaw.map((m) => {
                    const model: AIModel = {
                      id: m.name,
                      name: m.name,
                      displayName: `${m.name} (Ollama)`,
                      source: "ollama",
                      type: "local",
                      status: "available",
                      metadata: {
                        size: m.size ? Math.round(m.size / 1024 / 1024) : undefined,
                        quantization: m.details?.quantization_level,
                      },
                    };
                    return (
                      <Card
                        key={m.name}
                        className={cn(
                          "cursor-pointer hover:border-primary/30 transition-all",
                          selectedModelId === m.name && "border-primary/30 bg-primary/5"
                        )}
                        onClick={() => handleModelSelect(model)}
                      >
                        <CardContent className="p-3.5 flex items-center justify-between gap-4 card-content-safe">
                          <div className="min-w-0">
                            <h3 className="font-semibold text-xs truncate">{m.name}</h3>
                            <div className="flex gap-3 text-[10px] text-muted-foreground mt-1">
                              {m.size && <span>Size: {Math.round(m.size / 1024 / 1024).toLocaleString()} MB</span>}
                              {m.details?.quantization_level && <span>Quant: {m.details.quantization_level}</span>}
                            </div>
                          </div>
                          {isAdmin && (
                            <HowToTooltip title="Delete Model" description="Remove this local model from your Ollama server" side="left">
                              <Button
                                id={`btn-delete-ollama-${m.name}`}
                                size="sm"
                                variant="ghost"
                                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                onClick={(e) => handleDeleteModel(model, e)}
                                disabled={deleteMutation.isPending}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </HowToTooltip>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Part B: Marketplace Search & Pull */}
            <div className="space-y-3 pt-4 border-t border-border">
              <h2 className="text-xs uppercase font-bold tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Download className="w-3.5 h-3.5" /> Library Marketplace
              </h2>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="marketplace-search-input"
                    placeholder="Search library or enter tags (e.g. llama3, mistral)..."
                    value={marketplaceSearch}
                    onChange={(e) => setMarketplaceSearch(e.target.value)}
                    className="pl-10 h-9 text-xs"
                  />
                </div>
                <HowToTooltip title="Pull Model" description="Download the specified model from the Ollama registry" side="top">
                  <Button
                    id="btn-pull-custom-input"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      if (marketplaceSearch.trim()) {
                        onModelDownload?.({
                          id: marketplaceSearch.trim(),
                          name: marketplaceSearch.trim(),
                          provider: "ollama",
                          description: `Ollama Model ${marketplaceSearch.trim()}`,
                          size: 0,
                          quantizations: [],
                          popularity: 0,
                          rating: 0,
                          downloads: 0,
                          tags: [],
                          releaseDate: new Date(),
                          latestVersion: "latest",
                        });
                      } else {
                        toast.info("Enter a model name in the search box to pull directly.");
                      }
                    }}
                  >
                    Pull Custom
                  </Button>
                </HowToTooltip>
              </div>

              {/* Search Results */}
              <div className="space-y-2">
                {marketplaceQuery.isLoading ? (
                  <div className="flex items-center justify-center py-8 text-muted-foreground text-xs">
                    <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                    Searching registry...
                  </div>
                ) : (marketplaceQuery.data?.models ?? []).length === 0 ? (
                  <div className="text-center py-6 text-xs text-muted-foreground">
                    No models found. Try searching for "llama" or "gemma".
                  </div>
                ) : (
                  (marketplaceQuery.data?.models ?? []).map((item: { id: string; name: string; description: string; tags: string[]; pulls: number }) => (
                    <Card key={item.id} className="hover:border-primary/20 transition-all">
                      <CardContent className="p-3 flex items-start justify-between gap-4 card-content-safe">
                        <div className="min-w-0 flex-1">
                          <h4 className="font-semibold text-xs">{item.name}</h4>
                          <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">
                            {item.description || "No description available"}
                          </p>
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {item.tags.slice(0, 3).map((tag: string) => (
                              <Badge key={tag} variant="secondary" className="text-[8px] px-1 py-0">
                                {tag}
                              </Badge>
                            ))}
                            {item.pulls > 0 && (
                              <Badge variant="outline" className="text-[8px] px-1 py-0">
                                ↓ {(item.pulls / 1000).toFixed(0)}K pulls
                              </Badge>
                            )}
                          </div>
                        </div>
                        <HowToTooltip title="Download Model" description="Pull this model to your local Ollama library" side="left">
                          <Button
                            id={`btn-pull-marketplace-${item.id}`}
                            size="sm"
                            className="h-7 text-[10px] px-2.5 flex-shrink-0"
                            onClick={() => onModelDownload?.({
                              id: item.id,
                              name: item.name,
                              provider: "ollama",
                              description: item.description,
                              size: 0,
                              quantizations: [],
                              popularity: 0,
                              rating: 0,
                              downloads: item.pulls,
                              tags: item.tags,
                              releaseDate: new Date(),
                              latestVersion: "latest",
                            })}
                          >
                            <Download className="w-3 h-3 mr-1" /> Pull
                          </Button>
                        </HowToTooltip>
                      </CardContent>
                    </Card>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* HF GGUF: browse Hugging Face + download a quant into Omnecor's runtime */}
        {activeTab === "hf-gguf" && (
          <div className="space-y-3">
            <h2 className="text-xs uppercase font-bold tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Server className="w-3.5 h-3.5" /> Hugging Face → Omnecor Runtime
            </h2>
            <HfModelBrowser mode="gguf" />
          </div>
        )}

        {/* TAB 3: DYNAMIC API PROVIDERS */}
        {!["active", "omnecor", "ollama", "hf-gguf"].includes(activeTab) && (
          <div className="space-y-4">
            {/* Status & Fallback Banner */}
            <div className="flex items-center justify-between border border-border p-2.5 rounded bg-muted/20 text-xs">
              <span className="text-muted-foreground font-mono">Status Telemetry</span>
              <div className="flex items-center gap-2">
                {providerModelsQuery.isLoading ? (
                  <span className="flex items-center gap-1.5 text-accent-cyan font-medium animate-pulse">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Fetching live API...
                  </span>
                ) : providerModelsQuery.isError ? (
                  <span className="flex items-center gap-1 text-accent-warning font-semibold">
                    <AlertCircle className="w-3.5 h-3.5" /> Offline Catalog Fallback
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-accent-success font-medium">
                    <Check className="w-3.5 h-3.5" /> Connected Live API
                  </span>
                )}
              </div>
            </div>

            {/* Error detail message if any */}
            {providerModelsQuery.isError && (
              <div className="p-2 border border-destructive/20 bg-destructive/10 rounded text-[10px] text-destructive-foreground flex items-start gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-semibold">Live connection offline or blocked.</p>
                  <p className="opacity-80">Displaying cache templates for {activeTab}.</p>
                </div>
              </div>
            )}

            {/* Models selection checklist */}
            <div className="space-y-2.5">
              {providerTabModels.map((model: { id: string; name: string; isFallback: boolean }) => {
                const isActive = isModelActive(activeTab, model.id);
                const catalogItem = API_MODEL_CATALOG[activeTab as keyof typeof API_MODEL_CATALOG]?.find(m => m.id === model.id);
                const mockModel: AIModel = {
                  id: model.id,
                  name: model.name,
                  displayName: `${model.name} (${activeTab})`,
                  source: activeTab as AIModel["source"],
                  type: "api",
                  status: "available",
                  costPer1kTokens: catalogItem?.costPer1kTokens,
                  capabilities: apiModelCapabilities(activeTab),
                };

                return (
                  <Card
                    key={model.id}
                    className={cn(
                      "hover:border-primary/20 transition-all cursor-pointer",
                      isActive && "border-primary/30 bg-primary/5",
                      selectedModelId === model.id && "ring-1 ring-primary/40"
                    )}
                    onClick={() => handleModelSelect(mockModel)}
                  >
                    <CardContent className="p-3.5 flex items-center justify-between gap-4 card-content-safe">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="font-semibold text-xs truncate">{model.name}</h4>
                          {model.isFallback && (
                            <Badge variant="outline" className="text-[8px] text-muted-foreground/60 border-muted-foreground/20">
                              Cache Template
                            </Badge>
                          )}
                        </div>
                        {catalogItem?.costPer1kTokens && (
                          <p className="text-[9px] text-muted-foreground mt-1">
                            Pricing: ${catalogItem.costPer1kTokens.input}/1k in, ${catalogItem.costPer1kTokens.output}/1k out
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        <span className="text-[10px] text-muted-foreground font-mono">Active</span>
                        <HowToTooltip title="Toggle Activation" description="Enable or disable this model for use across the application" side="top">
                          <Switch
                            id={`switch-activate-${activeTab}-${model.id}`}
                            checked={isActive}
                            onCheckedChange={(checked) => handleToggleActive(activeTab, model.id, checked)}
                          />
                        </HowToTooltip>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* Custom Model Form */}
            <div className="mt-4 pt-4 border-t border-border space-y-2.5">
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">
                Add Custom Model Identifier
              </span>
              <div className="flex gap-2">
                <Input
                  id="custom-model-id-input"
                  placeholder="Enter exact model ID (e.g. gpt-4.5-preview)"
                  value={customModelId}
                  onChange={(e) => setCustomModelId(e.target.value)}
                  className="h-9 text-xs"
                />
                <HowToTooltip title="Add Model Identifier" description="Register a specific model ID for this cloud provider" side="top">
                  <Button
                    id="btn-add-custom-model"
                    size="sm"
                    onClick={() => handleAddCustomModel(activeTab)}
                    disabled={!customModelId.trim()}
                  >
                    <PlusCircle className="w-3.5 h-3.5 mr-1" /> Add
                  </Button>
                </HowToTooltip>
              </div>
              <p className="text-[10px] text-muted-foreground">
                Enter any new model ID deployed by the provider. Useful for launching preview or experimental releases immediately.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
