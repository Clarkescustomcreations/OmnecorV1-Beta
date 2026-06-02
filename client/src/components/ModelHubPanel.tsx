import { useState, useMemo } from "react";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Download,
  Trash2,
  Check,
  AlertCircle,
  Zap,
  Server,
  Search,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getAllModels,
  type AIModel,
  type ModelMarketplaceItem,
} from "@/lib/aiModels";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

interface ModelHubPanelProps {
  onModelSelect?: (model: AIModel) => void;
  onModelDownload?: (item: ModelMarketplaceItem) => void;
}

export default function ModelHubPanel({
  onModelSelect,
  onModelDownload,
}: ModelHubPanelProps) {
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<"all" | "local" | "api">("all");
  const [activeTab, setActiveTab] = useState<"models" | "marketplace">("models");
  const [marketplaceSearch, setMarketplaceSearch] = useState("");

  // Role gate — deleteModel is admin-only on the server
  const { data: me } = trpc.auth.me.useQuery();
  const isAdmin = me?.role === "admin" || me?.role === "owner";

  // Real marketplace data from ollamadb.dev via server proxy
  const marketplaceQuery = trpc.ollama.searchModels.useQuery(
    { query: marketplaceSearch, limit: 30 },
    { enabled: activeTab === "marketplace" }
  );

  const deleteMutation = trpc.ollama.deleteModel.useMutation({
    onSuccess: ({ name }) => toast.success(`Deleted model: ${name}`),
    onError: (err) => toast.error("Delete failed: " + err.message),
  });

  const allModels = useMemo(
    () => getAllModels(selectedModelId || undefined),
    [selectedModelId]
  );

  const filteredModels = useMemo(() => {
    let models = allModels;
    if (filterType !== "all") {
      models = models.filter(m => m.type === filterType);
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      models = models.filter(
        m =>
          m.name.toLowerCase().includes(q) ||
          m.displayName.toLowerCase().includes(q) ||
          m.description?.toLowerCase().includes(q)
      );
    }
    return models;
  }, [allModels, filterType, searchQuery]);

  const handleModelSelect = (model: AIModel) => {
    setSelectedModelId(model.id);
    onModelSelect?.(model);
  };

  const handleDeleteModel = (model: AIModel, e: React.MouseEvent) => {
    e.stopPropagation();
    if (model.type !== "local") {
      toast.info("Only locally installed models can be deleted.");
      return;
    }
    deleteMutation.mutate({ name: model.id });
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "available": return <Check className="w-4 h-4 text-green-500" />;
      case "loading":   return <Zap className="w-4 h-4 text-yellow-500 animate-pulse" />;
      case "error":     return <AlertCircle className="w-4 h-4 text-red-500" />;
      default:          return <AlertCircle className="w-4 h-4 text-gray-500" />;
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "available": return "Available";
      case "loading":   return "Loading";
      case "error":     return "Error";
      case "offline":   return "Offline";
      default:          return "Unknown";
    }
  };

  return (
    <div className="w-full h-full flex flex-col gap-4">
      {/* Search and Filter Bar */}
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder={activeTab === "models" ? "Search active models..." : "Search Ollama library..."}
            value={activeTab === "models" ? searchQuery : marketplaceSearch}
            onChange={e =>
              activeTab === "models"
                ? setSearchQuery(e.target.value)
                : setMarketplaceSearch(e.target.value)
            }
            className="pl-10"
          />
        </div>
        {activeTab === "models" && (
          <Select value={filterType} onValueChange={(v) => setFilterType(v as "all" | "local" | "api")}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Models</SelectItem>
              <SelectItem value="local">Local Only</SelectItem>
              <SelectItem value="api">API Only</SelectItem>
            </SelectContent>
          </Select>
        )}
        {activeTab === "marketplace" && (
          <Button
            variant="outline"
            size="icon"
            onClick={() => marketplaceQuery.refetch()}
            disabled={marketplaceQuery.isFetching}
            title="Refresh marketplace"
          >
            <RefreshCw className={`w-4 h-4 ${marketplaceQuery.isFetching ? "animate-spin" : ""}`} />
          </Button>
        )}
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-2 border-b border-border">
        <button
          onClick={() => setActiveTab("models")}
          className={cn(
            "px-4 py-2 font-medium text-sm border-b-2 transition-colors",
            activeTab === "models"
              ? "border-accent text-accent"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          <Server className="w-4 h-4 inline mr-2" />
          Active Models
        </button>
        <button
          onClick={() => setActiveTab("marketplace")}
          className={cn(
            "px-4 py-2 font-medium text-sm border-b-2 transition-colors",
            activeTab === "marketplace"
              ? "border-accent text-accent"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          <Download className="w-4 h-4 inline mr-2" />
          Marketplace
        </button>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-auto">
        {activeTab === "models" ? (
          <div role="list" className="space-y-3">
            {filteredModels.length === 0 ? (
              <div className="flex items-center justify-center h-48 text-muted-foreground">
                <p>No models found</p>
              </div>
            ) : (
              filteredModels.map(model => (
                <Card
                  key={model.id}
                  role="listitem"
                  className={cn(
                    "cursor-pointer transition-all hover:border-accent",
                    selectedModelId === model.id && "border-accent bg-accent/5"
                  )}
                  onClick={() => handleModelSelect(model)}
                >
                  <CardContent className="pt-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-semibold text-sm truncate">{model.displayName}</h3>
                          <Badge variant="outline" className="text-xs">
                            {model.type === "local" ? "Local" : "API"}
                          </Badge>
                          {model.isSelected && (
                            <Badge className="text-xs bg-green-500/20 text-green-500 border-green-500/30">
                              Selected
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mb-2 line-clamp-2">
                          {model.description || "No description available"}
                        </p>
                        <div className="flex flex-wrap gap-2 mb-2">
                          {model.capabilities?.chat && <Badge variant="secondary" className="text-xs">Chat</Badge>}
                          {model.capabilities?.vision && <Badge variant="secondary" className="text-xs">Vision</Badge>}
                          {model.capabilities?.embedding && <Badge variant="secondary" className="text-xs">Embedding</Badge>}
                          {model.capabilities?.functionCalling && <Badge variant="secondary" className="text-xs">Functions</Badge>}
                        </div>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          {model.contextWindow && (
                            <span>Context: {model.contextWindow.toLocaleString()} tokens</span>
                          )}
                          {model.costPer1kTokens && (
                            <span>
                              Cost: ${model.costPer1kTokens.input}/1k in, ${model.costPer1kTokens.output}/1k out
                            </span>
                          )}
                          {model.metadata?.size && (
                            <span>Size: {(model.metadata.size as number).toLocaleString()} MB</span>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <div className="flex items-center gap-2">
                          {getStatusIcon(model.status)}
                          <span className="text-xs font-medium">{getStatusLabel(model.status)}</span>
                        </div>
                        {model.type === "local" && isAdmin && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            aria-label={`Delete model ${model.displayName}`}
                            onClick={(e) => handleDeleteModel(model, e)}
                            disabled={deleteMutation.isPending}
                          >
                            <Trash2 className="w-4 h-4" aria-hidden="true" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        ) : (
          <div role="list" className="space-y-3">
            {marketplaceQuery.isLoading ? (
              <div className="flex items-center justify-center h-48 text-muted-foreground">
                <RefreshCw className="w-5 h-5 animate-spin mr-2" />
                Loading Ollama library...
              </div>
            ) : marketplaceQuery.isError ? (
              <div className="flex flex-col items-center justify-center h-48 text-muted-foreground gap-2">
                <AlertCircle className="w-6 h-6 text-red-400" />
                <p className="text-sm">Failed to load marketplace</p>
                <p className="text-xs">{marketplaceQuery.error.message}</p>
                <Button size="sm" variant="outline" onClick={() => marketplaceQuery.refetch()}>
                  Retry
                </Button>
              </div>
            ) : (marketplaceQuery.data?.models ?? []).length === 0 ? (
              <div className="flex items-center justify-center h-48 text-muted-foreground">
                <p>No models found in marketplace</p>
              </div>
            ) : (
              (marketplaceQuery.data?.models ?? []).map(item => (
                <Card key={item.id} role="listitem" className="cursor-pointer transition-all hover:border-accent">
                  <CardContent className="pt-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-semibold text-sm">{item.name}</h3>
                        </div>
                        <p className="text-xs text-muted-foreground mb-2 line-clamp-2">
                          {item.description || "No description available"}
                        </p>
                        <div className="flex flex-wrap gap-1 mb-2">
                          {(item.tags as string[]).slice(0, 6).map(tag => (
                            <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
                          ))}
                        </div>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <span>↓ {(item.pulls as number / 1000).toFixed(0)}K pulls</span>
                          <span>{item.variantCount as number} variants</span>
                          {item.lastUpdated && (
                            <span>Updated: {new Date(item.lastUpdated as string).toLocaleDateString()}</span>
                          )}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        aria-label={`Download model ${item.name}`}
                        onClick={() => onModelDownload?.({
                          id: item.id,
                          name: item.name,
                          provider: "ollama",
                          description: item.description,
                          size: 0,
                          quantizations: [],
                          popularity: 0,
                          rating: 0,
                          downloads: item.pulls as number,
                          tags: item.tags as string[],
                          releaseDate: new Date(),
                          latestVersion: "latest",
                        })}
                      >
                        <Download className="w-4 h-4 mr-2" aria-hidden="true" />
                        Pull
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
