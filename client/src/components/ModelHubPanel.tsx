import { useState, useMemo } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
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
  Filter,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getAllModels,
  getModelsByType,
  mockMarketplaceModels,
  type AIModel,
  type ModelMarketplaceItem,
} from "@/lib/aiModels";

interface ModelHubPanelProps {
  onModelSelect?: (model: AIModel) => void;
  onModelDownload?: (item: ModelMarketplaceItem) => void;
}

/**
 * Model Hub Panel Component
 *
 * Displays local and API models with marketplace for downloading new models.
 * Features:
 * - Local model management (Ollama, Llama.cpp)
 * - API model configuration
 * - Model marketplace with download capability
 * - Health status indicators
 * - Model switching and selection
 */
export default function ModelHubPanel({
  onModelSelect,
  onModelDownload,
}: ModelHubPanelProps) {
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<"all" | "local" | "api">("all");
  const [activeTab, setActiveTab] = useState<"models" | "marketplace">(
    "models"
  );

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
      const query = searchQuery.toLowerCase();
      models = models.filter(
        m =>
          m.name.toLowerCase().includes(query) ||
          m.displayName.toLowerCase().includes(query) ||
          m.description?.toLowerCase().includes(query)
      );
    }

    return models;
  }, [allModels, filterType, searchQuery]);

  const marketplaceModels = useMemo(() => {
    if (!searchQuery) return mockMarketplaceModels;

    const query = searchQuery.toLowerCase();
    return mockMarketplaceModels.filter(
      m =>
        m.name.toLowerCase().includes(query) ||
        m.description.toLowerCase().includes(query) ||
        m.tags.some(t => t.toLowerCase().includes(query))
    );
  }, [searchQuery]);

  const handleModelSelect = (model: AIModel) => {
    setSelectedModelId(model.id);
    onModelSelect?.(model);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "available":
        return <Check className="w-4 h-4 text-green-500" />;
      case "loading":
        return <Zap className="w-4 h-4 text-yellow-500 animate-pulse" />;
      case "error":
        return <AlertCircle className="w-4 h-4 text-red-500" />;
      default:
        return <AlertCircle className="w-4 h-4 text-gray-500" />;
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "available":
        return "Available";
      case "loading":
        return "Loading";
      case "error":
        return "Error";
      case "offline":
        return "Offline";
      default:
        return "Unknown";
    }
  };

  return (
    <div className="w-full h-full flex flex-col gap-4">
      {/* Search and Filter Bar */}
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search models..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select
          value={filterType}
          onValueChange={(value) => setFilterType(value as "all" | "local" | "api")}
        >
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Models</SelectItem>
            <SelectItem value="local">Local Only</SelectItem>
            <SelectItem value="api">API Only</SelectItem>
          </SelectContent>
        </Select>
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
          <div className="space-y-3">
            {filteredModels.length === 0 ? (
              <div className="flex items-center justify-center h-48 text-muted-foreground">
                <p>No models found</p>
              </div>
            ) : (
              filteredModels.map(model => (
                <Card
                  key={model.id}
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
                          <h3 className="font-semibold text-sm truncate">
                            {model.displayName}
                          </h3>
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
                          {model.capabilities?.chat && (
                            <Badge variant="secondary" className="text-xs">
                              Chat
                            </Badge>
                          )}
                          {model.capabilities?.vision && (
                            <Badge variant="secondary" className="text-xs">
                              Vision
                            </Badge>
                          )}
                          {model.capabilities?.embedding && (
                            <Badge variant="secondary" className="text-xs">
                              Embedding
                            </Badge>
                          )}
                          {model.capabilities?.functionCalling && (
                            <Badge variant="secondary" className="text-xs">
                              Functions
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          {model.contextWindow && (
                            <span>
                              Context: {model.contextWindow.toLocaleString()}{" "}
                              tokens
                            </span>
                          )}
                          {model.costPer1kTokens && (
                            <span>
                              Cost: ${model.costPer1kTokens.input}/1k in, $
                              {model.costPer1kTokens.output}/1k out
                            </span>
                          )}
                          {model.metadata?.size && (
                            <span>
                              Size:{" "}
                              {(model.metadata.size as number).toLocaleString()}{" "}
                              MB
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <div className="flex items-center gap-2">
                          {getStatusIcon(model.status)}
                          <span className="text-xs font-medium">
                            {getStatusLabel(model.status)}
                          </span>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {marketplaceModels.length === 0 ? (
              <div className="flex items-center justify-center h-48 text-muted-foreground">
                <p>No models found in marketplace</p>
              </div>
            ) : (
              marketplaceModels.map(item => (
                <Card
                  key={item.id}
                  className="cursor-pointer transition-all hover:border-accent"
                >
                  <CardContent className="pt-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-semibold text-sm">{item.name}</h3>
                          <Badge variant="outline" className="text-xs">
                            {item.provider}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mb-2">
                          {item.description}
                        </p>
                        <div className="flex flex-wrap gap-2 mb-2">
                          {item.tags.map(tag => (
                            <Badge
                              key={tag}
                              variant="secondary"
                              className="text-xs"
                            >
                              {tag}
                            </Badge>
                          ))}
                        </div>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <span>Size: {item.size.toLocaleString()} MB</span>
                          <span>Rating: {item.rating.toFixed(1)}/5</span>
                          <span>
                            Downloads: {(item.downloads / 1000).toFixed(0)}K
                          </span>
                          <span>Popularity: {item.popularity}%</span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {item.quantizations.map(q => (
                            <Badge
                              key={q}
                              variant="outline"
                              className="text-xs"
                            >
                              {q}
                            </Badge>
                          ))}
                        </div>
                      </div>
                      <Button size="sm" onClick={() => onModelDownload?.(item)}>
                        <Download className="w-4 h-4 mr-2" />
                        Download
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
