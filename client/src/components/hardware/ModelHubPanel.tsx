import React, { useState } from "react";
import { trpc } from "../../lib/trpc";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "../ui/card";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import { Badge } from "../ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../ui/tabs";
import { ScrollArea } from "../ui/scroll-area";
import { Database, Download, Trash2, FileCode, Loader2, RefreshCw, Play, Search, Star } from "lucide-react";
import { toast } from "sonner";

export const ModelHubPanel: React.FC = () => {
  const [pullName, setPullName] = useState("");
  const [deleteName, setDeleteName] = useState("");
  const [modelfileName, setModelfileName] = useState("");
  const [modelfileContent, setModelfileContent] = useState(`FROM llama3.2\nSYSTEM "You are a helpful assistant for the Omnecor AI workstation."`);
  const [marketplaceSearch, setMarketplaceSearch] = useState("");
  const [marketplaceSource, setMarketplaceSource] = useState<"all" | "ollama" | "huggingface">("all");

  const listQuery = trpc.ollama.listModels.useQuery(undefined, { refetchInterval: 10000 });
  const runningQuery = trpc.ollama.runningModels.useQuery(undefined, { refetchInterval: 5000 });
  const registryQuery = trpc.modelManagement.list.useQuery(undefined, { refetchInterval: 15000 });

  // Marketplace queries
  const featuredQuery = trpc.modelMarketplace.featured.useQuery();
  const marketplaceQuery = trpc.modelMarketplace.search.useQuery(
    { query: marketplaceSearch, source: marketplaceSource, limit: 20 },
    { enabled: marketplaceSearch.length > 0 }
  );

  const pullMutation = trpc.ollama.pullModel.useMutation({
    onSuccess: (data) => {
      toast.success(`Pull started for ${data.name}. Check Installed Models tab — it may take several minutes.`);
      setPullName("");
    },
    onError: (e) => toast.error("Pull failed: " + e.message),
  });

  const deleteMutation = trpc.ollama.deleteModel.useMutation({
    onSuccess: (data) => {
      toast.success(`${data.name} deleted.`);
      setDeleteName("");
      listQuery.refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const createModelfileMutation = trpc.ollama.createModelfile.useMutation({
    onSuccess: (data) => {
      toast.success(`Model "${data.name}" created from Modelfile.`);
      listQuery.refetch();
      registryQuery.refetch();
    },
    onError: (e) => toast.error("Modelfile error: " + e.message),
  });

  const setActiveMutation = trpc.modelManagement.setActive.useMutation({
    onSuccess: (data) => {
      toast.success(`Set ${data.model.name} as active.`);
      registryQuery.refetch();
    },
    onError: (e) => toast.error("Failed to set active model: " + e.message),
  });

  const syncRegistryMutation = trpc.modelManagement.syncFromOllama.useMutation({
    onSuccess: (data) => {
      toast.success(`Synced ${data.count} models into registry.`);
      registryQuery.refetch();
    },
    onError: (e) => toast.error("Failed to sync registry: " + e.message),
  });

  const formatBytes = (bytes: number) => {
    if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
    if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
    return `${bytes} B`;
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <Database className="w-6 h-6 text-blue-500" aria-hidden="true" /> Model Hub
        </h2>
        <p className="text-sm text-muted-foreground">Manage local Ollama models — install, configure, and delete.</p>
      </div>

      <Tabs defaultValue="installed">
        <TabsList>
          <TabsTrigger value="installed" id="tab-installed">
            <Database className="w-4 h-4 mr-1" aria-hidden="true" /> Installed
          </TabsTrigger>
          <TabsTrigger value="marketplace" id="tab-marketplace">
            <Search className="w-4 h-4 mr-1" aria-hidden="true" /> Marketplace
          </TabsTrigger>
          <TabsTrigger value="pull" id="tab-pull">
            <Download className="w-4 h-4 mr-1" aria-hidden="true" /> Pull Model
          </TabsTrigger>
          <TabsTrigger value="delete" id="tab-delete">
            <Trash2 className="w-4 h-4 mr-1" aria-hidden="true" /> Delete
          </TabsTrigger>
          <TabsTrigger value="modelfile" id="tab-modelfile">
            <FileCode className="w-4 h-4 mr-1" aria-hidden="true" /> Modelfile
          </TabsTrigger>
        </TabsList>

        <TabsContent value="installed" role="tabpanel" aria-labelledby="tab-installed">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <div>
                <CardTitle>Installed Models</CardTitle>
                <CardDescription>
                  {runningQuery.data?.running?.length ?? 0} running — {registryQuery.data?.models?.length ?? 0} registered
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => syncRegistryMutation.mutate({ models: listQuery.data?.models ?? [] })} disabled={syncRegistryMutation.isPending} aria-label="Sync models to registry">
                  {syncRegistryMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="w-4 h-4" aria-hidden="true" />}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => listQuery.refetch()} aria-label="Refresh model list">
                  <RefreshCw className={`w-4 h-4 ${listQuery.isFetching ? "animate-spin" : ""}`} aria-hidden="true" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {listQuery.isLoading ? (
                <p className="text-sm text-muted-foreground text-center py-4" role="status" aria-live="polite">Loading models…</p>
              ) : (
                <ScrollArea className="h-80">
                  <div role="list" className="space-y-2" aria-label="Installed Ollama models">
                    {(listQuery.data?.models ?? []).map(model => {
                      const isRunning = runningQuery.data?.running?.some(r => r.name === model.name);
                      const registered = registryQuery.data?.models?.find(m => m.id === `ollama:${model.name}`);
                      const isActive = registered?.isActive ?? false;
                      return (
                        <div key={model.name} role="listitem" className="flex items-center justify-between rounded-md border px-4 py-3">
                          <div>
                            <p className="text-sm font-mono font-medium">{model.name}</p>
                            <p className="text-xs text-muted-foreground">{formatBytes(model.size)}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            {isRunning && (
                              <Badge variant="default" className="text-xs">
                                <Play className="w-3 h-3 mr-1" aria-hidden="true" /> Running
                              </Badge>
                            )}
                            {isActive && (
                              <Badge className="text-xs bg-green-600">Active</Badge>
                            )}
                            <Badge variant="outline" className="text-xs font-mono truncate max-w-[80px]">
                              {model.digest?.slice(7, 14) ?? "—"}
                            </Badge>
                            {!isActive && (
                              <Button variant="outline" size="sm" onClick={() => setActiveMutation.mutate({ id: `ollama:${model.name}` })} disabled={setActiveMutation.isPending} aria-label={`Set ${model.name} as active`}>
                                {setActiveMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" /> : <span className="text-xs">Set Active</span>}
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {(listQuery.data?.models ?? []).length === 0 && (
                      <p className="text-sm text-muted-foreground text-center py-8">No models installed. Use Pull Model to download one.</p>
                    )}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="marketplace" role="tabpanel" aria-labelledby="tab-marketplace">
          <div className="space-y-4">
            {/* Featured Models Section */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Star className="w-5 h-5 text-yellow-500" aria-hidden="true" /> Featured Models
                </CardTitle>
                <CardDescription>Popular models curated for easy discovery</CardDescription>
              </CardHeader>
              <CardContent>
                {featuredQuery.isLoading ? (
                  <p className="text-sm text-muted-foreground text-center py-4">Loading featured models…</p>
                ) : (
                  <ScrollArea className="h-64">
                    <div className="grid gap-3 pr-4">
                      {(featuredQuery.data?.models ?? []).map(model => (
                        <div key={model.id} className="flex items-start justify-between rounded-md border p-3">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold truncate">{model.name}</p>
                            <p className="text-xs text-muted-foreground line-clamp-2">{model.description}</p>
                            <div className="flex flex-wrap gap-1 mt-2">
                              {(model.tags ?? []).slice(0, 3).map(tag => (
                                <Badge key={tag} variant="secondary" className="text-xs">
                                  {tag}
                                </Badge>
                              ))}
                            </div>
                          </div>
                          <Button
                            size="sm"
                            onClick={() => pullMutation.mutate({ name: model.pullCommand?.replace("ollama pull ", "") ?? model.id })}
                            disabled={pullMutation.isPending}
                            className="ml-2 flex-shrink-0"
                            aria-label={`Pull ${model.name}`}
                          >
                            {pullMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" /> : <Download className="w-3 h-3" aria-hidden="true" />}
                          </Button>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>

            {/* Search & Browse Section */}
            <Card>
              <CardHeader>
                <CardTitle>Search Marketplace</CardTitle>
                <CardDescription>Discover models from Ollama library and HuggingFace</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="marketplace-search">Search query</Label>
                  <Input
                    id="marketplace-search"
                    value={marketplaceSearch}
                    onChange={e => setMarketplaceSearch(e.target.value)}
                    placeholder="e.g. code, chat, math"
                    onKeyDown={e => e.key === "Enter" && marketplaceSearch ? marketplaceQuery.refetch() : undefined}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="marketplace-source">Source</Label>
                  <select
                    id="marketplace-source"
                    value={marketplaceSource}
                    onChange={e => setMarketplaceSource(e.target.value as "all" | "ollama" | "huggingface")}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="all">All Sources</option>
                    <option value="ollama">Ollama Library</option>
                    <option value="huggingface">HuggingFace</option>
                  </select>
                </div>

                {marketplaceSearch && (
                  <>
                    {marketplaceQuery.isLoading ? (
                      <p className="text-sm text-muted-foreground text-center py-4">Searching…</p>
                    ) : marketplaceQuery.data?.models && marketplaceQuery.data.models.length > 0 ? (
                      <ScrollArea className="h-96">
                        <div className="space-y-2 pr-4">
                          {marketplaceQuery.data.models.map(model => (
                            <div key={model.id} className="flex items-start justify-between rounded-md border p-3">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <p className="text-sm font-semibold truncate">{model.name}</p>
                                  <Badge variant="outline" className="text-xs flex-shrink-0">
                                    {model.source}
                                  </Badge>
                                </div>
                                <p className="text-xs text-muted-foreground line-clamp-2">{model.description}</p>
                                {model.downloads && (
                                  <p className="text-xs text-muted-foreground mt-1">
                                    Downloads: {model.downloads.toLocaleString()}
                                  </p>
                                )}
                                <div className="flex flex-wrap gap-1 mt-2">
                                  {(model.tags ?? []).slice(0, 3).map(tag => (
                                    <Badge key={tag} variant="secondary" className="text-xs">
                                      {tag}
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                              {model.source === "ollama" && model.pullCommand && (
                                <Button
                                  size="sm"
                                  onClick={() => pullMutation.mutate({ name: model.pullCommand?.replace("ollama pull ", "") ?? model.id })}
                                  disabled={pullMutation.isPending}
                                  className="ml-2 flex-shrink-0"
                                  aria-label={`Pull ${model.name}`}
                                >
                                  {pullMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" /> : <Download className="w-3 h-3" aria-hidden="true" />}
                                </Button>
                              )}
                              {model.source === "huggingface" && model.url && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => window.open(model.url, "_blank")}
                                  className="ml-2 flex-shrink-0"
                                  aria-label={`Open ${model.name} on HuggingFace`}
                                >
                                  View
                                </Button>
                              )}
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    ) : (
                      <p className="text-sm text-muted-foreground text-center py-4">No models found for "{marketplaceSearch}"</p>
                    )}
                    {marketplaceQuery.error && (
                      <p className="text-sm text-red-500 text-center py-2">Error: {marketplaceQuery.error.message}</p>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="pull" role="tabpanel" aria-labelledby="tab-pull">
          <Card>
            <CardHeader>
              <CardTitle>Pull Model from Registry</CardTitle>
              <CardDescription>Download a model from the Ollama registry. Enter the model name (e.g., llama3.2, mistral, codellama).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="pull-name">Model name</Label>
                <div className="flex gap-2">
                  <Input
                    id="pull-name"
                    value={pullName}
                    onChange={e => setPullName(e.target.value)}
                    placeholder="e.g. llama3.2, mistral:7b, codellama"
                    onKeyDown={e => e.key === "Enter" && pullName ? pullMutation.mutate({ name: pullName }) : undefined}
                  />
                  <Button
                    onClick={() => pullMutation.mutate({ name: pullName })}
                    disabled={!pullName || pullMutation.isPending}
                    aria-label={`Pull model ${pullName}`}
                  >
                    {pullMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Download className="w-4 h-4" aria-hidden="true" />}
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Pull runs in the background. Refresh the Installed Models tab after a few minutes to see the new model.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="delete" role="tabpanel" aria-labelledby="tab-delete">
          <Card>
            <CardHeader>
              <CardTitle>Delete Model</CardTitle>
              <CardDescription>Permanently delete a model from disk. Requires admin role and HITL approval.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="delete-name">Model name</Label>
                <div className="flex gap-2">
                  <Input
                    id="delete-name"
                    value={deleteName}
                    onChange={e => setDeleteName(e.target.value)}
                    placeholder="e.g. llama3.2"
                    list="installed-models"
                  />
                  <datalist id="installed-models">
                    {(listQuery.data?.models ?? []).map(m => <option key={m.name} value={m.name} />)}
                  </datalist>
                  <Button
                    variant="destructive"
                    onClick={() => deleteMutation.mutate({ name: deleteName })}
                    disabled={!deleteName || deleteMutation.isPending}
                    aria-label={`Delete model ${deleteName}`}
                  >
                    {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Trash2 className="w-4 h-4" aria-hidden="true" />}
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground text-amber-600">
                This action cannot be undone. A HITL approval request will appear in the approvals panel before deletion proceeds.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="modelfile" role="tabpanel" aria-labelledby="tab-modelfile">
          <Card>
            <CardHeader>
              <CardTitle>Modelfile Creator</CardTitle>
              <CardDescription>Create a custom model from a Modelfile definition. Uses Ollama's /api/create endpoint.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="modelfile-name">New model name</Label>
                <Input
                  id="modelfile-name"
                  value={modelfileName}
                  onChange={e => setModelfileName(e.target.value)}
                  placeholder="e.g. omnecor-assistant"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="modelfile-content">Modelfile</Label>
                <Textarea
                  id="modelfile-content"
                  value={modelfileContent}
                  onChange={e => setModelfileContent(e.target.value)}
                  className="font-mono text-xs h-48"
                  placeholder="FROM llama3.2&#10;SYSTEM You are a helpful assistant."
                />
              </div>
              <Button
                onClick={() => createModelfileMutation.mutate({ name: modelfileName, modelfile: modelfileContent })}
                disabled={!modelfileName || !modelfileContent || createModelfileMutation.isPending}
                aria-label="Create model from Modelfile"
              >
                {createModelfileMutation.isPending
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />Creating…</>
                  : <><FileCode className="w-4 h-4 mr-2" aria-hidden="true" />Create Model</>
                }
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ModelHubPanel;
