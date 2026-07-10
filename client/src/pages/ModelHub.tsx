/**
 * Model Hub
 *
 * Displays local Ollama models + API provider status loaded from Settings.
 * API keys are managed exclusively in Settings > AI Providers — not here.
 * "Configure Providers" navigates there directly.
 */
import { OmnecorDashboardLayout } from "@/components/OmnecorDashboardLayout";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Zap, RefreshCw, Download, Settings, CheckCircle2, XCircle, ExternalLink } from "lucide-react";
import { useState, useEffect } from "react";
import { ModelHubPanel } from "@/components/ModelHubPanel";
import { type AIModel, type ModelMarketplaceItem, getActiveModels } from "@/lib/aiModels";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useLocation } from "wouter";

export function ModelHub() {
  const [selectedModel, setSelectedModel] = useState<AIModel | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [preferredQuantization, setPreferredQuantization] = useState("q4_k_m");

  const [, setLocation] = useLocation();

  const { data: hubSettings } = trpc.system.getSettings.useQuery();
  const saveQuantMutation = trpc.system.saveSettings.useMutation({
    onSuccess: () => toast.success("Quantization preference saved"),
    onError: (e) => toast.error(e.message),
  });

  useEffect(() => {
    if (hubSettings) setPreferredQuantization((hubSettings as { preferredQuantization?: string }).preferredQuantization || "q4_k_m");
  }, [hubSettings]);

  const {
    data: ollamaModels = [],
    isLoading: ollamaLoading,
    refetch,
  } = trpc.aiProvider.discoverOllamaModels.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  // Load provider health — configured providers come from Settings
  const { data: providerHealth = [] } = trpc.aiProvider.getProviders.useQuery(
    undefined,
    { refetchInterval: 60_000 }
  );

  // Load the actual API key config status from Settings backend
  const { data: aiProviders } = trpc.system.aiProviders.useQuery();

  const pullMutation = trpc.ollama.pullModel.useMutation({
    onSuccess: ({ name }) => {
      toast.success(`Pulling model: ${name}. Refresh in a moment to see it.`);
    },
    onError: (err) => toast.error("Pull failed: " + err.message),
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

  const activeList = getActiveModels();

  const localModels: AIModel[] = ollamaModels.map(m => ({
    id: m.name,
    name: m.name,
    displayName: m.name,
    type: "local" as const,
    source: "ollama" as const,
    status: "available" as const,
    size: m.size ?? 0,
  }));

  const apiModels: AIModel[] = activeList.map(item => ({
    id: item.modelId,
    name: item.modelId,
    displayName: `${item.modelId} (${item.providerId})`,
    type: "api" as const,
    source: item.providerId as AIModel["source"],
    status: "available" as const,
  }));

  const allModels = [...localModels, ...apiModels];

  // Build a readable list of configured API providers from Settings
  const configuredProviders: { id: string; label: string; configured: boolean }[] = [
    { id: "openai",     label: "OpenAI",           configured: !!aiProviders?.openai },
    { id: "anthropic",  label: "Anthropic (Claude)", configured: !!aiProviders?.anthropic },
    { id: "gemini",     label: "Google Gemini",     configured: !!aiProviders?.gemini },
    { id: "grok",       label: "Grok (xAI)",        configured: !!aiProviders?.grok },
    { id: "ollama",     label: "Ollama (Local)",    configured: true },
  ];

  return (
    <OmnecorDashboardLayout>
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="border-b border-border bg-card px-4 sm:px-6 py-3 sm:py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <Zap className="w-6 h-6 text-primary flex-shrink-0" />
              <div className="min-w-0">
                <h1 className="text-xl font-bold truncate">Model Hub</h1>
                <p className="text-sm text-muted-foreground truncate">Manage local and API-based AI models</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 flex-shrink-0">
              <Button size="sm" variant="outline" onClick={handleRefresh} disabled={isRefreshing || ollamaLoading}>
                <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? "animate-spin" : ""}`} />
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setLocation("/settings")}
                className="gap-1.5"
              >
                <Settings className="w-4 h-4" />
                <span className="hidden sm:inline">Configure Providers</span>
                <span className="sm:hidden">Configure</span>
                <ExternalLink className="w-3 h-3 opacity-60" />
              </Button>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex flex-col md:flex-row gap-4 sm:gap-6 p-4 sm:p-6 overflow-auto md:overflow-hidden">
          <div className="flex-1 flex flex-col min-w-0 min-h-0">
            <Card className="flex-1 flex flex-col">
              <CardHeader>
                <CardTitle>Active Models</CardTitle>
                <CardDescription>Search, filter, and manage your models</CardDescription>
              </CardHeader>
              <CardContent className="min-h-0 flex-1 overflow-hidden">
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
          <div className="w-full md:w-72 flex flex-col gap-4 md:overflow-y-auto md:flex-shrink-0">
            {/* Selected Model */}
            <Card className="w-full min-w-0 overflow-hidden py-3 gap-0">
              <CardHeader className="px-4 py-0 flex flex-row items-center justify-between gap-2">
                <CardTitle className="text-sm font-semibold truncate">Selected Model Details</CardTitle>
                {selectedModel && (
                  <Button
                    size="sm"
                    className="h-6 px-2 text-[10px] font-bold bg-primary/10 text-accent-foreground hover:bg-primary/90 shadow-[0_0_12px_rgba(168,85,247,0.4)] border border-primary/20 transition-all duration-300 animate-pulse flex-shrink-0"
                    onClick={handleUseThisModel}
                  >
                    Use Model
                  </Button>
                )}
              </CardHeader>
              <CardContent className="px-4 pb-0 mt-1">
                {selectedModel ? (
                  <div className="space-y-3 text-sm">
                    <div className="w-full min-w-0 max-h-40 overflow-y-auto rounded border border-border/50 bg-muted/20 p-2.5 space-y-3">
                      <div className="flex flex-col gap-1">
                        <span className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Name</span>
                        <p className="font-mono text-[10px] break-all bg-muted p-1 rounded mt-1">{selectedModel.displayName}</p>
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Type</span>
                        <p className="font-mono text-[10px] break-all bg-muted p-1 rounded mt-1 capitalize">{selectedModel.type}</p>
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Status</span>
                        <div className="mt-1">
                          <Badge variant={selectedModel.status === "available" ? "default" : "secondary"} className="capitalize">
                            {selectedModel.status}
                          </Badge>
                        </div>
                      </div>
                      {selectedModel.contextWindow && (
                        <div className="flex flex-col gap-1">
                          <span className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Context Window</span>
                          <p className="font-mono text-[10px] break-all bg-muted p-1 rounded mt-1">{selectedModel.contextWindow.toLocaleString()} tokens</p>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="p-4 rounded-lg bg-muted/50 flex items-center justify-center text-muted-foreground text-xs h-28">
                    Select a model to view details
                  </div>
                )}
              </CardContent>
            </Card>

            {/* API Provider Status — loaded from Settings */}
            <Card className="w-full min-w-0 overflow-hidden py-3 gap-0">
              <CardHeader className="px-4 py-0">
                <CardTitle className="text-sm font-semibold">API Providers</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-0 mt-1">
                <div className="w-full min-w-0 max-h-32 overflow-y-auto rounded border border-border/50 bg-muted/20 p-1.5 space-y-1">
                  {configuredProviders.map(p => (
                    <div key={p.id} className="flex items-center justify-between px-2 py-1 rounded hover:bg-primary/5 text-[11px] font-mono min-w-0 gap-2">
                      <span className="text-muted-foreground truncate">{p.label}</span>
                      {p.configured ? (
                        <span className="flex items-center gap-1 text-accent-success font-medium flex-shrink-0">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Configured
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-muted-foreground/50 flex-shrink-0">
                          <XCircle className="w-3.5 h-3.5" /> Not set
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Model Lifecycle */}
            <Card className="w-full min-w-0 overflow-hidden py-3 gap-0">
              <CardHeader className="px-4 py-0">
                <CardTitle className="text-sm font-semibold">Model Lifecycle</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-0 mt-1 space-y-3">
                <div className="space-y-1">
                  <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Preferred Quantization</span>
                  <Select
                    value={preferredQuantization}
                    onValueChange={(v) => {
                      setPreferredQuantization(v);
                      saveQuantMutation.mutate({ settings: { preferredQuantization: v } });
                    }}
                  >
                    <SelectTrigger className="h-8 text-xs mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="q2_k">Q2_K (Lightest)</SelectItem>
                      <SelectItem value="q4_k_m">Q4_K_M (Balanced)</SelectItem>
                      <SelectItem value="q8_0">Q8_0 (Heavy)</SelectItem>
                      <SelectItem value="fp16">F16 (Original)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1 pt-1.5 border-t">
                  <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Role Assignments</span>
                  <div className="w-full min-w-0 max-h-24 overflow-y-auto rounded border border-border/50 bg-muted/20 p-1.5 space-y-1 mt-1">
                    <div className="flex items-center justify-between px-2 py-1 rounded text-[11px] font-mono min-w-0 gap-2">
                      <span className="text-muted-foreground flex-shrink-0">Default Chat:</span>
                      <span className="text-primary font-bold break-all ml-2 text-right">Auto</span>
                    </div>
                    <div className="flex items-center justify-between px-2 py-1 rounded text-[11px] font-mono min-w-0 gap-2">
                      <span className="text-muted-foreground flex-shrink-0">Default Code:</span>
                      <span className="text-primary font-bold break-all ml-2 text-right">Auto</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Statistics */}
            <Card className="w-full min-w-0 overflow-hidden py-3 gap-0">
              <CardHeader className="px-4 py-0">
                <CardTitle className="text-sm font-semibold">Statistics</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-0 mt-1">
                <div className="w-full min-w-0 max-h-28 overflow-y-auto rounded border border-border/50 bg-muted/20 p-1.5 space-y-1">
                  <div className="flex justify-between px-2 py-1 text-[11px] font-mono">
                    <span className="text-muted-foreground">Total Models:</span>
                    <span className="font-medium text-foreground">{allModels.length}</span>
                  </div>
                  <div className="flex justify-between px-2 py-1 text-[11px] font-mono">
                    <span className="text-muted-foreground">Local Models:</span>
                    <span className="font-medium text-foreground">{localModels.length}</span>
                  </div>
                  <div className="flex justify-between px-2 py-1 text-[11px] font-mono">
                    <span className="text-muted-foreground">API Models:</span>
                    <span className="font-medium text-foreground">{apiModels.length}</span>
                  </div>
                </div>
                {pullMutation.isPending && (
                  <div className="flex items-center gap-2 text-xs text-accent-cyan mt-2 px-1">
                    <Download className="w-3.5 h-3.5 animate-bounce" />
                    Pulling model in background...
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </OmnecorDashboardLayout>
  );
}
