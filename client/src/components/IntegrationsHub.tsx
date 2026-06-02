import { useState } from "react";
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getIntegrationInfo, type IntegrationType } from "@/lib/integrations";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

const ALL_INTEGRATION_TYPES: IntegrationType[] = ["github", "notion", "slack", "google-drive"];

const TOKEN_HINTS: Record<string, { label: string; placeholder: string; helpUrl: string; helpText: string }> = {
  github: {
    label: "Personal Access Token",
    placeholder: "ghp_...",
    helpUrl: "https://github.com/settings/tokens/new",
    helpText: "Create a token at GitHub → Settings → Developer settings → Personal access tokens (classic). Required scopes: repo, user.",
  },
  notion: {
    label: "Integration Token",
    placeholder: "secret_...",
    helpUrl: "https://www.notion.com/my-integrations",
    helpText: "Create an integration at notion.com/my-integrations and copy the Internal Integration Token. Then share your databases with the integration.",
  },
  slack: {
    label: "Bot Token",
    placeholder: "xoxb-...",
    helpUrl: "https://api.slack.com/apps",
    helpText: "Create a Slack app at api.slack.com/apps, add Bot Token Scopes (channels:read, users:read), install to workspace, and copy the Bot User OAuth Token.",
  },
  "google-drive": {
    label: "OAuth Access Token",
    placeholder: "ya29...",
    helpUrl: "https://developers.google.com/oauthplayground/",
    helpText: "Use OAuth Playground at developers.google.com/oauthplayground to generate an access token with the https://www.googleapis.com/auth/drive.readonly scope.",
  },
};

interface IntegrationsHubProps {
  className?: string;
}

export default function IntegrationsHub({ className }: IntegrationsHubProps) {
  const [activeTab, setActiveTab] = useState<"connected" | "available">("connected");
  const [connectType, setConnectType] = useState<IntegrationType | null>(null);
  const [tokenInput, setTokenInput] = useState("");
  const [settingsType, setSettingsType] = useState<IntegrationType | null>(null);

  const integrationsQuery = trpc.integrations.getIntegrations.useQuery(undefined, {
    refetchInterval: 30_000,
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

  const integrations = integrationsQuery.data ?? [];
  const connected = integrations.filter(i => i.isConnected);
  const available = integrations.filter(i => !i.isConnected);

  const renderIntegrationCard = (item: typeof integrations[number]) => {
    const info = getIntegrationInfo(item.type as IntegrationType);
    const meta = item.metadata as Record<string, unknown> | null;
    const isSyncing = syncMutation.isPending && syncMutation.variables?.type === item.type;
    const isDisconnecting = disconnectMutation.isPending && disconnectMutation.variables?.type === item.type;

    return (
      <Card key={item.type} className="bg-muted/50">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="text-3xl">{info.icon}</div>
              <div>
                <CardTitle className="text-sm">{info.title}</CardTitle>
                <CardDescription className="text-xs">{info.description}</CardDescription>
              </div>
            </div>
            <Badge variant={item.isConnected ? "default" : "secondary"} className="ml-2">
              {item.isConnected ? "Connected" : "Disconnected"}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          {item.isConnected && meta && (
            <div className="p-3 rounded-lg bg-background/50 border">
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle2 className="w-4 h-4 text-accent" />
                <span className="text-sm font-semibold">{String(meta.username ?? "")}</span>
              </div>
              {meta.email && (
                <p className="text-xs text-muted-foreground">{String(meta.email)}</p>
              )}
              {item.connectedAt && (
                <p className="text-xs text-muted-foreground mt-1">
                  Connected: {new Date(item.connectedAt).toLocaleString()}
                </p>
              )}
              {meta.lastSynced && (
                <p className="text-xs text-muted-foreground">
                  Last synced: {new Date(String(meta.lastSynced)).toLocaleString()}
                </p>
              )}
            </div>
          )}

          {/* GitHub repos summary */}
          {item.type === "github" && meta?.repositories && Array.isArray(meta.repositories) && (
            <div className="space-y-1">
              <p className="text-xs font-semibold text-muted-foreground">
                {meta.repoCount as number} Repositories (last 30)
              </p>
              <ScrollArea className="h-20">
                <div className="space-y-1">
                  {(meta.repositories as Array<{ id: number; name: string; isPrivate: boolean }>)
                    .slice(0, 5)
                    .map(r => (
                      <div key={r.id} className="text-xs p-1.5 rounded bg-background/50 flex items-center gap-2">
                        <span className="font-mono truncate">{r.name}</span>
                        {r.isPrivate && <Badge variant="outline" className="text-[10px] py-0">private</Badge>}
                      </div>
                    ))}
                </div>
              </ScrollArea>
            </div>
          )}

          {/* Notion databases summary */}
          {item.type === "notion" && meta?.databases && Array.isArray(meta.databases) && (
            <div className="space-y-1">
              <p className="text-xs font-semibold text-muted-foreground">
                {meta.dbCount as number} Databases
              </p>
              <ScrollArea className="h-20">
                {(meta.databases as Array<{ id: string; title: string; icon: string | null }>).map(db => (
                  <div key={db.id} className="text-xs p-1.5 rounded bg-background/50">
                    {db.icon} {db.title}
                  </div>
                ))}
              </ScrollArea>
            </div>
          )}

          {/* Slack channels summary */}
          {item.type === "slack" && meta?.channels && Array.isArray(meta.channels) && (
            <div className="space-y-1">
              <p className="text-xs font-semibold text-muted-foreground">
                {meta.channelCount as number} Channels
              </p>
              <ScrollArea className="h-20">
                {(meta.channels as Array<{ id: string; name: string; isPrivate: boolean }>).slice(0, 6).map(c => (
                  <div key={c.id} className="text-xs p-1.5 rounded bg-background/50">
                    #{c.name}{c.isPrivate ? " 🔒" : ""}
                  </div>
                ))}
              </ScrollArea>
            </div>
          )}

          {/* Google Drive storage */}
          {item.type === "google-drive" && meta?.storageTotal && (
            <div className="space-y-1">
              <p className="text-xs font-semibold text-muted-foreground">Storage</p>
              <div className="flex justify-between text-xs">
                <span>{((meta.storageUsed as number) / 1024 / 1024 / 1024).toFixed(1)} GB used</span>
                <span className="text-muted-foreground">
                  {((meta.storageTotal as number) / 1024 / 1024 / 1024).toFixed(0)} GB total
                </span>
              </div>
              <div className="w-full bg-muted rounded-full h-2">
                <div
                  className="bg-accent h-2 rounded-full"
                  style={{
                    width: `${Math.min(100, ((meta.storageUsed as number) / (meta.storageTotal as number)) * 100)}%`,
                  }}
                />
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            {item.isConnected ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  aria-label={`Sync ${info.title}`}
                  onClick={() => syncMutation.mutate({ type: item.type as IntegrationType })}
                  disabled={isSyncing}
                >
                  <RefreshCw className={cn("w-3 h-3 mr-1", isSyncing && "animate-spin")} aria-hidden="true" />
                  {isSyncing ? "Syncing..." : "Sync"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  aria-label={`${info.title} settings`}
                  onClick={() => setSettingsType(item.type as IntegrationType)}
                >
                  <Settings className="w-3 h-3 mr-1" aria-hidden="true" />
                  Settings
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  className="flex-1"
                  aria-label={`Disconnect ${info.title}`}
                  onClick={() => disconnectMutation.mutate({ type: item.type as IntegrationType })}
                  disabled={isDisconnecting}
                >
                  <Unlink2 className="w-3 h-3 mr-1" aria-hidden="true" />
                  {isDisconnecting ? "..." : "Disconnect"}
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                className="w-full"
                aria-label={`Connect ${info.title} account`}
                onClick={() => setConnectType(item.type as IntegrationType)}
              >
                <Link2 className="w-3 h-3 mr-2" aria-hidden="true" />
                Connect Account
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className={cn("space-y-4", className)}>
      {integrationsQuery.isLoading && (
        <p className="text-sm text-muted-foreground text-center py-4">Loading integrations...</p>
      )}

      <Tabs value={activeTab} onValueChange={v => setActiveTab(v as "connected" | "available")}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="connected">Connected ({connected.length})</TabsTrigger>
          <TabsTrigger value="available">Available ({available.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="connected" className="space-y-4">
          {connected.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {connected.map(i => renderIntegrationCard(i))}
            </div>
          ) : (
            <Card>
              <CardContent className="flex items-center justify-center h-32">
                <div className="text-center text-muted-foreground">
                  <Link2 className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p>No integrations connected yet</p>
                  <p className="text-xs mt-1">Go to the Available tab to connect services.</p>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="available" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {available.map(i => renderIntegrationCard(i))}
          </div>
          {available.length === 0 && (
            <Card>
              <CardContent className="flex items-center justify-center h-32">
                <div className="text-center text-muted-foreground">
                  <CheckCircle2 className="w-12 h-12 mx-auto mb-2 opacity-50 text-green-500" />
                  <p>All integrations are connected!</p>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Integration Stats */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Integration Statistics</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-accent">{connected.length}</div>
              <p className="text-xs text-muted-foreground">Connected</p>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-accent">{available.length}</div>
              <p className="text-xs text-muted-foreground">Available</p>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-accent">
                {connected.filter(i => {
                  const meta = i.metadata as Record<string, unknown> | null;
                  return !!meta?.lastSynced;
                }).length}
              </div>
              <p className="text-xs text-muted-foreground">Recently Synced</p>
            </div>
          </div>
        </CardContent>
      </Card>

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
                    onKeyDown={e => e.key === "Enter" && tokenInput && connectMutation.mutate({ type: connectType, token: tokenInput })}
                  />
                </div>
                <p className="text-xs text-muted-foreground flex items-start gap-1">
                  <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
                  Tokens are stored locally in <code className="font-mono bg-muted px-1 rounded">~/.omnecor/integrations.json</code> and never sent to external servers except the connected service.
                </p>
              </div>
              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => { setConnectType(null); setTokenInput(""); }}>
                  Cancel
                </Button>
                <Button
                  onClick={() => connectMutation.mutate({ type: connectType, token: tokenInput })}
                  disabled={!tokenInput || connectMutation.isPending}
                >
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
        const integration = integrations.find(i => i.type === settingsType);
        const meta = integration?.metadata as Record<string, unknown> | null;
        return (
          <Dialog open onOpenChange={(open) => !open && setSettingsType(null)}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{info.icon} {info.title} Settings</DialogTitle>
                <DialogDescription>Manage your {info.title} connection.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2 text-sm">
                {meta?.username && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Account</span>
                    <span className="font-semibold">{String(meta.username)}</span>
                  </div>
                )}
                {meta?.email && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Email</span>
                    <span>{String(meta.email)}</span>
                  </div>
                )}
                {integration?.connectedAt && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Connected</span>
                    <span>{new Date(integration.connectedAt).toLocaleDateString()}</span>
                  </div>
                )}
                {meta?.lastSynced && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Last Synced</span>
                    <span>{new Date(String(meta.lastSynced)).toLocaleString()}</span>
                  </div>
                )}
                <div className="pt-2 border-t">
                  <p className="text-xs text-muted-foreground">
                    To update the token, disconnect and reconnect with a new token.
                  </p>
                </div>
              </div>
              <DialogFooter className="gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    disconnectMutation.mutate({ type: settingsType });
                    setSettingsType(null);
                  }}
                >
                  Disconnect
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    syncMutation.mutate({ type: settingsType });
                    setSettingsType(null);
                  }}
                >
                  Sync Now
                </Button>
                <Button size="sm" onClick={() => setSettingsType(null)}>Close</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        );
      })()}
    </div>
  );
}
