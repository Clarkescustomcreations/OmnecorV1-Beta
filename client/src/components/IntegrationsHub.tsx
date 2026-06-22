import React, { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertCircle,
  CheckCircle2,
  Link2,
  Unlink2,
  RefreshCw,
  Settings,
  MessageSquare,
  Network,
  Share2,
  Plus,
  Loader2,
  Brain,
} from "lucide-react";
import { useNeuralMap } from "@/contexts/NeuralMapContext";

const FEATURE_LABELS: Record<string, { label: string; icon: React.ReactNode }> = {
  "chat":             { label: "Chat",          icon: <MessageSquare className="w-3 h-3" /> },
  "neural-map":       { label: "Neural Map",    icon: <Network className="w-3 h-3" /> },
  "agent-networking": { label: "Agent Network", icon: <Share2 className="w-3 h-3" /> },
};
import { cn } from "@/lib/utils";
import { getIntegrationInfo, INTEGRATION_FEATURES, type IntegrationType } from "@/lib/integrations";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

const TOKEN_HINTS: Record<string, { label: string; placeholder: string; helpUrl: string; helpText: string }> = {
  outlook: {
    label: "Microsoft Graph Access Token",
    placeholder: "eyJ...",
    helpUrl: "https://developer.microsoft.com/en-us/graph/graph-explorer",
    helpText: "Use Microsoft Graph Explorer to generate an access token with Mail.Read, Mail.Send, and Calendars.Read scopes.",
  },
  gmail: {
    label: "Google OAuth Access Token",
    placeholder: "ya29...",
    helpUrl: "https://developers.google.com/oauthplayground/",
    helpText: "Use Google OAuth Playground with scopes: gmail.readonly and gmail.send.",
  },
  github: {
    label: "Personal Access Token",
    placeholder: "ghp_...",
    helpUrl: "https://github.com/settings/tokens/new",
    helpText: "Create a token at GitHub → Settings → Developer settings → Personal access tokens (classic).",
  },
  notion: {
    label: "Integration Token",
    placeholder: "secret_...",
    helpUrl: "https://www.notion.com/my-integrations",
    helpText: "Create an integration at notion.com/my-integrations and copy the Internal Integration Token.",
  },
  slack: {
    label: "Bot Token",
    placeholder: "xoxb-...",
    helpUrl: "https://api.slack.com/apps",
    helpText: "Create a Slack app at api.slack.com/apps, add Bot Token Scopes (channels:read, users:read).",
  },
  "google-drive": {
    label: "OAuth Access Token",
    placeholder: "ya29...",
    helpUrl: "https://developers.google.com/oauthplayground/",
    helpText: "Use OAuth Playground to generate an access token with the drive.readonly scope.",
  },
};

/** Integration types connected via the one-click OAuth flow (server stores the
 *  token in platformAccounts), rather than a pasted token. */
const OAUTH_CONNECT_TYPES = new Set<string>(["dropbox", "onedrive"]);

interface IntegrationsHubProps {
  className?: string;
}

export function IntegrationsHub({ className }: IntegrationsHubProps) {
  const [activeTab, setActiveTab] = useState<"connected" | "available" | "social">("connected");
  const [connectType, setConnectType] = useState<IntegrationType | null>(null);
  const [tokenInput, setTokenInput] = useState("");
  const [settingsType, setSettingsType] = useState<IntegrationType | null>(null);

  const { activeMap } = useNeuralMap();
  const [crossProject, setCrossProject] = useState<boolean>(() => {
    try { return localStorage.getItem("omnecor:integrations_cross_project") !== "false"; } catch { return true; }
  });
  const handleCrossProjectToggle = (v: boolean) => {
    setCrossProject(v);
    localStorage.setItem("omnecor:integrations_cross_project", String(v));
  };

  const utils = trpc.useUtils();
  const integrationsQuery = trpc.integrations.getIntegrations.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  // Health check query
  const healthQuery = trpc.integrationManagement.listAll.useQuery(undefined, {
    refetchInterval: 60_000, // Check health every minute
  });

  const { data: socialAccounts, refetch: refetchSocial } = trpc.platforms.listAccounts.useQuery();
  const getAuthUrlMutation = trpc.oauth.getAuthorizationUrl.useMutation({
    onSuccess: (data) => {
      window.location.href = data.authUrl;
    },
    onError: (err) => toast.error("OAuth failed: " + err.message),
  });

  const disconnectSocialMutation = trpc.platforms.disconnectAccount.useMutation({
    onSuccess: () => {
      toast.success("Social account disconnected");
      refetchSocial();
    },
    onError: (err) => toast.error("Disconnect failed: " + err.message),
  });

  const connectMutation = trpc.integrations.connect.useMutation({
    onSuccess: (data) => {
      toast.success(`Connected! Welcome, ${String(data.metadata?.username ?? "")}`);
      setConnectType(null);
      setTokenInput("");
      integrationsQuery.refetch();
    },
    onError: (err) => toast.error("Connection failed: " + err.message),
  });

  const disconnectMutation = trpc.integrations.disconnect.useMutation({
    onSuccess: () => {
      toast.success("Disconnected successfully");
      integrationsQuery.refetch();
    },
    onError: (err) => toast.error("Disconnect failed: " + err.message),
  });

  const syncMutation = trpc.integrations.sync.useMutation({
    onSuccess: (data) => {
      toast.success(`${data.type} synced successfully`);
      integrationsQuery.refetch();
    },
    onError: (err) => toast.error("Sync failed: " + err.message),
  });

  const refreshTokenMutation = trpc.integrationManagement.refreshToken.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      healthQuery.refetch();
    },
    onError: (err) => toast.error("Token refresh failed: " + err.message),
  });

  const healthDisconnectMutation = trpc.integrationManagement.disconnect.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      integrationsQuery.refetch();
      healthQuery.refetch();
    },
    onError: (err) => toast.error("Disconnect failed: " + err.message),
  });

  const integrations = integrationsQuery.data ?? [];
  const connected = integrations.filter(i => i.isConnected);
  const available = integrations.filter(i => !i.isConnected);
  const healthStatuses = healthQuery.data ?? [];

  // Get health status for an integration
  const getHealthStatus = (integrationType: string) => {
    return healthStatuses.find(h => h.id === integrationType);
  };

  // Get status indicator color
  const getStatusColor = (status: string): string => {
    switch (status) {
      case "connected": return "bg-green-500";
      case "disconnected": return "bg-gray-400";
      case "error": return "bg-red-500";
      case "checking": return "bg-yellow-500";
      default: return "bg-gray-300";
    }
  };

  const renderIntegrationCard = (item: typeof integrations[number]) => {
    const info = getIntegrationInfo(item.type as IntegrationType);
    const meta = item.metadata as Record<string, unknown> | null;
    const isSyncing = syncMutation.isPending && syncMutation.variables?.type === item.type;
    const isDisconnecting = disconnectMutation.isPending && disconnectMutation.variables?.type === item.type;
    const isRefreshing = refreshTokenMutation.isPending && refreshTokenMutation.variables?.integrationId === item.type;
    const healthStatus = getHealthStatus(item.type as string);

    return (
      <Card key={item.type} className="bg-muted/50">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="text-3xl">{info.icon}</div>
              <div>
                <CardTitle className="text-sm">{info.title}</CardTitle>
                <CardDescription className="text-xs">{info.description}</CardDescription>
                {(() => {
                  const features = INTEGRATION_FEATURES[item.type as IntegrationType] ?? [];
                  if (features.length === 0) return null;
                  return (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {features.map(f => {
                        const fl = FEATURE_LABELS[f];
                        if (!fl) return null;
                        return (
                          <span key={f} className="inline-flex items-center gap-1 text-[10px] bg-accent/20 text-accent-foreground rounded px-1.5 py-0.5">
                            {fl.icon}{fl.label}
                          </span>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            </div>
            <div className="flex flex-col items-end gap-1 ml-2 shrink-0">
              <div className="flex items-center gap-2">
                {healthStatus && (
                  <div className={cn(
                    "w-2.5 h-2.5 rounded-full",
                    getStatusColor(healthStatus.status)
                  )} title={`Status: ${healthStatus.status}`} />
                )}
                <Badge variant={item.isConnected ? "default" : "secondary"}>
                  {item.isConnected ? "Connected" : "Available"}
                </Badge>
              </div>
              {item.isConnected && !crossProject && activeMap && (
                <span className="inline-flex items-center gap-1 text-[9px] bg-accent/10 text-accent rounded px-1.5 py-0.5 whitespace-nowrap">
                  <Brain className="w-2.5 h-2.5" />{activeMap.name}
                </span>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          {item.isConnected && meta && (
            <div className="p-3 rounded-lg bg-background/50 border">
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle2 className="w-4 h-4 text-accent" />
                <span className="text-sm font-semibold">{String(meta.username ?? "")}</span>
              </div>
              {!!meta.email && (
                <p className="text-xs text-muted-foreground">{String(meta.email)}</p>
              )}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            {item.isConnected ? (
              <>
                <Button size="sm" variant="outline" className="flex-1" onClick={() => syncMutation.mutate({ type: item.type as IntegrationType })} disabled={isSyncing}>
                  <RefreshCw className={cn("w-3 h-3 mr-1", isSyncing && "animate-spin")} /> {isSyncing ? "Syncing..." : "Sync"}
                </Button>
                {healthStatus?.status === "error" && (
                  <Button size="sm" variant="outline" className="flex-1" onClick={() => refreshTokenMutation.mutate({ integrationId: item.type as string })} disabled={isRefreshing}>
                    <RefreshCw className={cn("w-3 h-3 mr-1", isRefreshing && "animate-spin")} /> {isRefreshing ? "..." : "Refresh"}
                  </Button>
                )}
                <Button size="sm" variant="outline" className="flex-1" onClick={() => setSettingsType(item.type as IntegrationType)}>
                  <Settings className="w-3 h-3 mr-1" /> Settings
                </Button>
                <Button size="sm" variant="destructive" className="flex-1" onClick={() => disconnectMutation.mutate({ type: item.type as IntegrationType })} disabled={isDisconnecting}>
                  <Unlink2 className="w-3 h-3 mr-1" /> {isDisconnecting ? "..." : "Disconnect"}
                </Button>
              </>
            ) : OAUTH_CONNECT_TYPES.has(item.type) ? (
              <Button
                size="sm"
                className="w-full"
                onClick={() => getAuthUrlMutation.mutate({ platform: item.type as Parameters<typeof getAuthUrlMutation.mutate>[0]["platform"] })}
                disabled={getAuthUrlMutation.isPending}
              >
                <Link2 className="w-3 h-3 mr-2" /> Connect with OAuth
              </Button>
            ) : (
              <Button size="sm" className="w-full" onClick={() => setConnectType(item.type as IntegrationType)}>
                <Link2 className="w-3 h-3 mr-2" /> Connect Account
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex items-center justify-end">
        <div className={cn(
          "flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-colors",
          !crossProject && activeMap
            ? "bg-accent/10 border-accent/40 text-accent"
            : "border-border text-muted-foreground"
        )}>
          <Brain className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="text-xs font-medium whitespace-nowrap">
            {!crossProject && activeMap ? activeMap.name : "Cross-Project"}
          </span>
          <Switch
            checked={!crossProject}
            onCheckedChange={v => handleCrossProjectToggle(!v)}
            className="scale-75"
            aria-label="Scope integrations to active neural map"
          />
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={v => setActiveTab(v as "connected" | "available" | "social")}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="connected">Integrations ({connected.length})</TabsTrigger>
          <TabsTrigger value="available">Available</TabsTrigger>
          <TabsTrigger value="social">Social Accounts ({socialAccounts?.length || 0})</TabsTrigger>
        </TabsList>

        <TabsContent value="connected" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {connected.map(i => renderIntegrationCard(i))}
            {connected.length === 0 && (
               <div className="col-span-2 p-12 text-center text-muted-foreground border-2 border-dashed rounded-xl">No active integrations.</div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="available" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {available.map(i => renderIntegrationCard(i))}
          </div>
        </TabsContent>

        <TabsContent value="social" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {socialAccounts?.map(account => (
              <Card key={account.id} className="bg-muted/50 border-accent/10">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center font-bold">
                        {account.platform.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <CardTitle className="text-sm uppercase">{account.platform}</CardTitle>
                        <CardDescription className="text-xs">{account.accountName}</CardDescription>
                      </div>
                    </div>
                    <Badge className="bg-green-500/10 text-green-500 border-green-500/20">Active</Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="w-full text-destructive border-destructive/20 hover:bg-destructive/10"
                    onClick={() => disconnectSocialMutation.mutate({ accountId: account.id })}
                    disabled={disconnectSocialMutation.isPending}
                  >
                    Disconnect Social Profile
                  </Button>
                </CardContent>
              </Card>
            ))}
            <Card className="border-dashed flex items-center justify-center p-6 bg-muted/20">
              <div className="text-center space-y-3">
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-tighter">Add Discourse Channel</p>
                <div className="flex flex-wrap justify-center gap-2">
                  {["twitter", "discord", "github"].map(p => (
                    <Button
                      key={p}
                      size="sm"
                      variant="outline"
                      className="capitalize h-8 text-[10px] gap-2"
                      onClick={() => getAuthUrlMutation.mutate({ platform: p as Parameters<typeof getAuthUrlMutation.mutate>[0]["platform"] })}
                    >
                      {getAuthUrlMutation.isPending && getAuthUrlMutation.variables?.platform === p ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                      Link {p}
                    </Button>
                  ))}
                </div>
              </div>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* Connect Account Dialog */}
      {connectType && (() => {
        const info = getIntegrationInfo(connectType);
        const hint = TOKEN_HINTS[connectType]!;
        return (
          <Dialog open onOpenChange={(open) => !open && (setConnectType(null), setTokenInput(""))}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{info.icon} Connect {info.title}</DialogTitle>
                <DialogDescription>{hint.helpText}</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label htmlFor="token-input">{hint.label}</Label>
                  <Input
                    id="token-input"
                    type="password"
                    placeholder={hint.placeholder}
                    value={tokenInput}
                    onChange={e => setTokenInput(e.target.value)}
                    autoFocus
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConnectType(null)}>Cancel</Button>
                <Button onClick={() => connectMutation.mutate({ type: connectType, token: tokenInput })} disabled={!tokenInput || connectMutation.isPending}>
                  {connectMutation.isPending ? "Connecting..." : "Connect"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        );
      })()}

      {/* Settings Dialog */}
      {settingsType && (() => {
        const info = getIntegrationInfo(settingsType);
        const healthStatus = getHealthStatus(settingsType);
        return (
          <Dialog open onOpenChange={(open) => !open && setSettingsType(null)}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{info.icon} {info.title} Settings</DialogTitle>
                <DialogDescription>Manage your {info.title} connection.</DialogDescription>
              </DialogHeader>
              {healthStatus && (
                <div className={cn(
                  "p-2 rounded text-sm",
                  healthStatus.status === "error"
                    ? "bg-red-500/10 text-red-700"
                    : "bg-green-500/10 text-green-700"
                )}>
                  Status: {healthStatus.status}
                  {healthStatus.errorMessage && <span className="ml-2 text-xs">({healthStatus.errorMessage})</span>}
                </div>
              )}
              <DialogFooter className="gap-2">
                <Button variant="destructive" size="sm" onClick={() => healthDisconnectMutation.mutate({ integrationId: settingsType }, { onSuccess: () => setSettingsType(null) })}>Disconnect</Button>
                <Button variant="outline" size="sm" onClick={() => syncMutation.mutate({ type: settingsType }, { onSuccess: () => setSettingsType(null) })}>Sync Now</Button>
                <Button size="sm" onClick={() => setSettingsType(null)}>Close</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        );
      })()}
    </div>
  );
}
