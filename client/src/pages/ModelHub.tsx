import OmnecorDashboardLayout from "@/components/OmnecorDashboardLayout";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Zap, Plus, RefreshCw } from "lucide-react";
import { useState } from "react";
import ModelHubPanel from "@/components/ModelHubPanel";
import { type AIModel, type ModelMarketplaceItem } from "@/lib/aiModels";
import { trpc } from "@/lib/trpc";

/**
 * Model Hub Page
 */
export default function ModelHub() {
  const [selectedModel, setSelectedModel] = useState<AIModel | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const {
    data: ollamaModels = [],
    isLoading: ollamaLoading,
    refetch,
  } = trpc.aiProvider.discoverOllamaModels.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  const { data: providerHealth = [] } = trpc.aiProvider.getProviders.useQuery(
    undefined,
    {
      refetchInterval: 60_000,
    }
  );

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refetch();
    setIsRefreshing(false);
  };

  const handleModelSelect = (model: AIModel) => {
    setSelectedModel(model);
    localStorage.setItem(
      "omnecor:selectedModel",
      JSON.stringify({
        providerId: model.source,
        modelId: model.id,
      })
    );
  };

  const handleModelDownload = (item: ModelMarketplaceItem) => {
    console.log("Downloading model:", item.name);
  };

  const localModels: AIModel[] = ollamaModels.map(m => ({
    id: m.name,
    name: m.name,
    displayName: m.name,
    type: "local" as const,
    source: "ollama" as const,
    status: "available" as const,
    size: m.size ?? 0,
    contextWindow: m.details?.parameter_size
      ? parseInt(m.details.parameter_size)
      : undefined,
  }));

  const apiModels: AIModel[] = providerHealth
    .filter(p => p.providerId !== "ollama")
    .map(p => ({
      id: p.providerId,
      name: p.providerId,
      displayName: p.providerId.charAt(0).toUpperCase() + p.providerId.slice(1),
      type: "api" as const,
      source: p.providerId as AIModel["source"],
      status: p.available ? "available" : ("offline" as const),
    }));

  const allModels = [...localModels, ...apiModels];

  return (
    <OmnecorDashboardLayout>
      <div className="h-full flex flex-col bg-background">
        {/* Header */}
        <div className="border-b border-border bg-card px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Zap className="w-6 h-6 text-accent" />
              <div>
                <h1 className="text-xl font-bold">Model Hub</h1>
                <p className="text-sm text-muted-foreground">
                  Manage local and API-based AI models
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={handleRefresh}
                disabled={isRefreshing || ollamaLoading}
              >
                <RefreshCw
                  className={`w-4 h-4 mr-2 ${isRefreshing ? "animate-spin" : ""}`}
                />
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </Button>
              <Button size="sm">
                <Plus className="w-4 h-4 mr-2" />
                Add Provider
              </Button>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex gap-6 p-6 overflow-hidden">
          {/* Models Panel */}
          <div className="flex-1 flex flex-col">
            <Card className="flex-1 flex flex-col">
              <CardHeader>
                <CardTitle>Active Models</CardTitle>
                <CardDescription>
                  Search, filter, and manage your models
                </CardDescription>
              </CardHeader>
              <CardContent className="flex-1 overflow-hidden">
                {ollamaLoading && (
                  <p className="text-sm text-muted-foreground">
                    Discovering Ollama models…
                  </p>
                )}
                <ModelHubPanel
                  onModelSelect={handleModelSelect}
                  onModelDownload={handleModelDownload}
                />
              </CardContent>
            </Card>
          </div>

          {/* Right Sidebar */}
          <div className="w-80 flex flex-col gap-4">
            {/* Selected Model Details */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Selected Model</CardTitle>
                <CardDescription className="text-xs">
                  Current model details
                </CardDescription>
              </CardHeader>
              <CardContent>
                {selectedModel ? (
                  <div className="space-y-3 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Name</p>
                      <p className="font-mono font-medium">
                        {selectedModel.displayName}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Type</p>
                      <p className="font-mono capitalize">
                        {selectedModel.type}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">
                        Status
                      </p>
                      <p className="font-mono capitalize">
                        {selectedModel.status}
                      </p>
                    </div>
                    {selectedModel.contextWindow && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">
                          Context Window
                        </p>
                        <p className="font-mono">
                          {selectedModel.contextWindow.toLocaleString()} tokens
                        </p>
                      </div>
                    )}
                    <Button className="w-full mt-4" size="sm">
                      Use This Model
                    </Button>
                  </div>
                ) : (
                  <div className="p-4 rounded-lg bg-muted/50 flex items-center justify-center text-muted-foreground text-sm h-40">
                    Select a model to view details
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Statistics */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Statistics</CardTitle>
                <CardDescription className="text-xs">
                  Model inventory overview
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total Models:</span>
                    <span className="font-mono font-medium">
                      {allModels.length}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Local Models:</span>
                    <span className="font-mono font-medium">
                      {localModels.length}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">API Models:</span>
                    <span className="font-mono font-medium">
                      {apiModels.length}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </OmnecorDashboardLayout>
  );
}
