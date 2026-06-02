import OmnecorDashboardLayout from "@/components/OmnecorDashboardLayout";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Zap, Plus, RefreshCw, Download } from "lucide-react";
import { useState } from "react";
import ModelHubPanel from "@/components/ModelHubPanel";
import { type AIModel, type ModelMarketplaceItem } from "@/lib/aiModels";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useLocation } from "wouter";

const PROVIDER_TYPES = [
  { id: "openai", label: "OpenAI", placeholder: "sk-..." },
  { id: "anthropic", label: "Anthropic", placeholder: "sk-ant-..." },
  { id: "gemini", label: "Google Gemini", placeholder: "AIza..." },
  { id: "ollama", label: "Ollama (Local)", placeholder: "http://localhost:11434" },
  { id: "custom", label: "Custom / Other", placeholder: "https://..." },
];

export default function ModelHub() {
  const [selectedModel, setSelectedModel] = useState<AIModel | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showAddProviderDialog, setShowAddProviderDialog] = useState(false);
  const [providerType, setProviderType] = useState("openai");
  const [providerApiKey, setProviderApiKey] = useState("");
  const [providerBaseUrl, setProviderBaseUrl] = useState("");

  const [, setLocation] = useLocation();

  const {
    data: ollamaModels = [],
    isLoading: ollamaLoading,
    refetch,
  } = trpc.aiProvider.discoverOllamaModels.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  const { data: providerHealth = [] } = trpc.aiProvider.getProviders.useQuery(
    undefined,
    { refetchInterval: 60_000 }
  );

  const pullMutation = trpc.ollama.pullModel.useMutation({
    onSuccess: ({ name }) => {
      toast.success(`Pulling model: ${name}. Refresh in a moment to see it.`);
    },
    onError: (err) => toast.error("Pull failed: " + err.message),
  });

  const saveKeysMutation = trpc.system.saveKeys.useMutation({
    onSuccess: () => {
      toast.success("Provider configured successfully");
      setShowAddProviderDialog(false);
      setProviderApiKey("");
      setProviderBaseUrl("");
    },
    onError: (err) => toast.error("Failed to save provider: " + err.message),
  });

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refetch();
    setIsRefreshing(false);
  };

  const handleModelSelect = (model: AIModel) => {
    setSelectedModel(model);
    localStorage.setItem(
      "omnecor:selectedModel",
      JSON.stringify({ providerId: model.source, modelId: model.id })
    );
  };

  const handleModelDownload = (item: ModelMarketplaceItem) => {
    pullMutation.mutate({ name: item.id });
  };

  const handleUseThisModel = () => {
    if (!selectedModel) return;
    localStorage.setItem(
      "omnecor:selectedModel",
      JSON.stringify({ providerId: selectedModel.source, modelId: selectedModel.id })
    );
    toast.success(`Now using: ${selectedModel.displayName}`);
    setLocation("/chat");
  };

  const handleAddProvider = () => {
    const chosen = PROVIDER_TYPES.find(p => p.id === providerType)!;
    const keys: Record<string, string> = {};
    if (providerType === "ollama") {
      keys["OLLAMA_BASE_URL"] = providerBaseUrl || "http://localhost:11434";
    } else if (providerApiKey) {
      keys[`${providerType.toUpperCase()}_API_KEY`] = providerApiKey;
      if (providerBaseUrl) keys[`${providerType.toUpperCase()}_BASE_URL`] = providerBaseUrl;
    } else {
      toast.error("Please enter an API key");
      return;
    }
    saveKeysMutation.mutate({ keys });
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
    .filter(p => p.id !== "ollama")
    .map(p => ({
      id: p.id,
      name: p.name,
      displayName: p.name,
      type: "api" as const,
      source: p.id as AIModel["source"],
      status: p.status === "online" ? "available" : ("offline" as const),
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
                <p className="text-sm text-muted-foreground">Manage local and API-based AI models</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={handleRefresh} disabled={isRefreshing || ollamaLoading}>
                <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? "animate-spin" : ""}`} />
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </Button>
              <Button size="sm" onClick={() => setShowAddProviderDialog(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Add Provider
              </Button>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex gap-6 p-6 overflow-hidden">
          <div className="flex-1 flex flex-col">
            <Card className="flex-1 flex flex-col">
              <CardHeader>
                <CardTitle>Active Models</CardTitle>
                <CardDescription>Search, filter, and manage your models</CardDescription>
              </CardHeader>
              <CardContent className="flex-1 overflow-hidden">
                {ollamaLoading && (
                  <p className="text-sm text-muted-foreground">Discovering Ollama models…</p>
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
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Selected Model</CardTitle>
                <CardDescription className="text-xs">Current model details</CardDescription>
              </CardHeader>
              <CardContent>
                {selectedModel ? (
                  <div className="space-y-3 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Name</p>
                      <p className="font-mono font-medium">{selectedModel.displayName}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Type</p>
                      <p className="font-mono capitalize">{selectedModel.type}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Status</p>
                      <Badge variant={selectedModel.status === "available" ? "default" : "secondary"}>
                        {selectedModel.status}
                      </Badge>
                    </div>
                    {selectedModel.contextWindow && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Context Window</p>
                        <p className="font-mono">{selectedModel.contextWindow.toLocaleString()} tokens</p>
                      </div>
                    )}
                    <Button
                      className="w-full mt-4"
                      size="sm"
                      onClick={handleUseThisModel}
                    >
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

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Statistics</CardTitle>
                <CardDescription className="text-xs">Model inventory overview</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total Models:</span>
                    <span className="font-mono font-medium">{allModels.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Local Models:</span>
                    <span className="font-mono font-medium">{localModels.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">API Models:</span>
                    <span className="font-mono font-medium">{apiModels.length}</span>
                  </div>
                  {pullMutation.isPending && (
                    <div className="flex items-center gap-2 text-xs text-blue-400 mt-2">
                      <Download className="w-3 h-3 animate-bounce" />
                      Pulling model in background...
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Add Provider Dialog */}
      <Dialog open={showAddProviderDialog} onOpenChange={setShowAddProviderDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add AI Provider</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Provider Type</Label>
              <Select value={providerType} onValueChange={setProviderType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDER_TYPES.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {providerType !== "ollama" && (
              <div className="space-y-2">
                <Label>API Key</Label>
                <Input
                  type="password"
                  placeholder={PROVIDER_TYPES.find(p => p.id === providerType)?.placeholder ?? ""}
                  value={providerApiKey}
                  onChange={e => setProviderApiKey(e.target.value)}
                />
              </div>
            )}

            <div className="space-y-2">
              <Label>{providerType === "ollama" ? "Ollama URL" : "Base URL (optional)"}</Label>
              <Input
                placeholder={providerType === "ollama" ? "http://localhost:11434" : "https://api.example.com/v1"}
                value={providerBaseUrl}
                onChange={e => setProviderBaseUrl(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddProviderDialog(false)}>Cancel</Button>
            <Button onClick={handleAddProvider} disabled={saveKeysMutation.isPending}>
              {saveKeysMutation.isPending ? "Saving..." : "Add Provider"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </OmnecorDashboardLayout>
  );
}
