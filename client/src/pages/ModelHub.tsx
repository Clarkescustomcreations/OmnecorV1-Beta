/**
 * Model Hub
 *
 * Displays local Ollama models + API provider status loaded from Settings.
 * API keys are managed exclusively in Settings > AI Providers — not here.
 * "Configure Providers" navigates there directly.
 */
import OmnecorDashboardLayout from "@/components/OmnecorDashboardLayout";
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
import ModelHubPanel from "@/components/ModelHubPanel";
import { type AIModel, type ModelMarketplaceItem } from "@/lib/aiModels";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useLocation } from "wouter";

export default function ModelHub() {
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

  const localModels: AIModel[] = ollamaModels.map(m => ({
    id: m.name,
    name: m.name,
    displayName: m.name,
    type: "local" as const,
    source: "ollama" as const,
    status: "available" as const,
    size: m.size ?? 0,
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
              <Button
                size="sm"
                variant="outline"
                onClick={() => setLocation("/settings")}
                className="gap-1.5"
              >
                <Settings className="w-4 h-4" />
                Configure Providers
                <ExternalLink className="w-3 h-3 opacity-60" />
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
          <div className="w-80 flex flex-col gap-4">
            {/* Selected Model */}
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
                    <Button className="w-full mt-4" size="sm" onClick={handleUseThisModel}>
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

            {/* API Provider Status — loaded from Settings */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">API Providers</CardTitle>
                <CardDescription className="text-xs">
                  Keys are managed in{" "}
                  <button
                    className="underline text-accent hover:text-accent/80 transition-colors"
                    onClick={() => setLocation("/settings")}
                  >
                    Settings → AI Providers
                  </button>
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {configuredProviders.map(p => (
                  <div key={p.id} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{p.label}</span>
                    {p.configured ? (
                      <span className="flex items-center gap-1 text-emerald-500 text-xs font-medium">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Configured
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-muted-foreground/50 text-xs">
                        <XCircle className="w-3.5 h-3.5" /> Not set
                      </span>
                    )}
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full mt-3 gap-1.5 text-xs"
                  onClick={() => setLocation("/settings")}
                >
                  <Settings className="w-3.5 h-3.5" />
                  Add / Edit API Keys
                </Button>
              </CardContent>
            </Card>

            {/* Model Lifecycle */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Model Lifecycle</CardTitle>
                <CardDescription className="text-xs">Preferences for local model management</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-[11px]">Preferred Quantization</Label>
                  <Select
                    value={preferredQuantization}
                    onValueChange={(v) => {
                      setPreferredQuantization(v);
                      saveQuantMutation.mutate({ settings: { preferredQuantization: v } });
                    }}
                  >
                    <SelectTrigger className="h-8 text-xs">
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
                <div className="space-y-2 pt-2 border-t">
                  <Label className="text-[11px]">Role Assignments</Label>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-muted-foreground">Default Chat:</span>
                      <span className="font-mono text-accent">Auto</span>
                    </div>
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-muted-foreground">Default Code:</span>
                      <span className="font-mono text-accent">Auto</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Statistics */}
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
    </OmnecorDashboardLayout>
  );
}
