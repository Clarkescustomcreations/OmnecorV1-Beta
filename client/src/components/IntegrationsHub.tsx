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
import {
  AlertCircle,
  CheckCircle2,
  Link2,
  Unlink2,
  RefreshCw,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getIntegrationInfo,
  createMockGitHubIntegration,
  createMockNotionIntegration,
  createMockSlackIntegration,
  createMockGoogleDriveIntegration,
  type Integration,
  type GitHubIntegration,
  type NotionIntegration,
  type SlackIntegration,
  type CloudStorageIntegration,
} from "@/lib/integrations";

interface IntegrationsHubProps {
  className?: string;
}

/**
 * Integrations Hub Component
 *
 * Manages OAuth-based account linking for:
 * - GitHub (repositories, code integration)
 * - Notion (knowledge base, documentation)
 * - Slack (team communication, notifications)
 * - Cloud Storage (Google Drive, Dropbox, OneDrive)
 */
export default function IntegrationsHub({ className }: IntegrationsHubProps) {
  const [connectedIntegrations, setConnectedIntegrations] = useState<
    Integration[]
  >([
    createMockGitHubIntegration(),
    createMockNotionIntegration(),
    createMockSlackIntegration(),
    createMockGoogleDriveIntegration(),
  ]);

  const [activeTab, setActiveTab] = useState<"connected" | "available">(
    "connected"
  );

  const handleDisconnect = (integrationId: string) => {
    setConnectedIntegrations(
      connectedIntegrations.map(int =>
        int.id === integrationId
          ? { ...int, isConnected: false, account: undefined, token: undefined }
          : int
      )
    );
  };

  const handleSync = (integrationId: string) => {
    setConnectedIntegrations(
      connectedIntegrations.map(int =>
        int.id === integrationId
          ? { ...int, syncStatus: "syncing" as const }
          : int
      )
    );

    // Simulate sync completion
    setTimeout(() => {
      setConnectedIntegrations(prev =>
        prev.map(int =>
          int.id === integrationId
            ? { ...int, syncStatus: "success" as const, lastSynced: new Date() }
            : int
        )
      );
    }, 2000);
  };

  const renderIntegrationCard = (integration: Integration) => {
    const info = getIntegrationInfo(integration.type);

    return (
      <Card key={integration.id} className="bg-muted/50">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="text-3xl">{info.icon}</div>
              <div>
                <CardTitle className="text-sm">{info.title}</CardTitle>
                <CardDescription className="text-xs">
                  {info.description}
                </CardDescription>
              </div>
            </div>
            <Badge
              variant={integration.isConnected ? "default" : "secondary"}
              className="ml-2"
            >
              {integration.isConnected ? "Connected" : "Disconnected"}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          {integration.isConnected && integration.account && (
            <div className="p-3 rounded-lg bg-background/50 border">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="w-4 h-4 text-accent" />
                <span className="text-sm font-semibold">
                  {integration.account.username}
                </span>
              </div>
              {integration.account.email && (
                <p className="text-xs text-muted-foreground">
                  {integration.account.email}
                </p>
              )}
              {integration.lastSynced && (
                <p className="text-xs text-muted-foreground mt-1">
                  Last synced: {integration.lastSynced.toLocaleString()}
                </p>
              )}
            </div>
          )}

          {/* GitHub Repositories */}
          {integration.type === "github" &&
            "repositories" in integration &&
            (integration as GitHubIntegration).repositories &&
            (integration as GitHubIntegration).repositories!.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground">
                  Repositories
                </p>
                <ScrollArea className="h-24">
                  <div className="space-y-1">
                    {(integration as GitHubIntegration).repositories!.map((repo) => (
                      <div
                        key={repo.id}
                        className="text-xs p-2 rounded bg-background/50"
                      >
                        <p className="font-mono truncate">{repo.name}</p>
                        <p className="text-muted-foreground text-xs truncate">
                          {repo.description || "No description"}
                        </p>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}

          {/* Notion Databases */}
          {integration.type === "notion" &&
            "databases" in integration &&
            (integration as NotionIntegration).databases &&
            (integration as NotionIntegration).databases!.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground">
                  Databases
                </p>
                <ScrollArea className="h-24">
                  <div className="space-y-1">
                    {(integration as NotionIntegration).databases!.map((db) => (
                      <div
                        key={db.id}
                        className="text-xs p-2 rounded bg-background/50"
                      >
                        <p className="font-semibold">
                          {db.icon} {db.title}
                        </p>
                        <p className="text-muted-foreground">
                          {db.itemCount} items
                        </p>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}

          {/* Slack Workspaces */}
          {integration.type === "slack" &&
            "workspaces" in integration &&
            (integration as SlackIntegration).workspaces &&
            (integration as SlackIntegration).workspaces!.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground">
                  Workspaces
                </p>
                <ScrollArea className="h-24">
                  <div className="space-y-1">
                    {(integration as SlackIntegration).workspaces!.map((ws) => (
                      <div
                        key={ws.id}
                        className="text-xs p-2 rounded bg-background/50"
                      >
                        <p className="font-semibold">
                          {ws.icon} {ws.name}
                        </p>
                        <p className="text-muted-foreground">
                          {ws.channels.length} channels
                        </p>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}

          {/* Cloud Storage Quota */}
          {(integration.type === "google-drive" ||
            integration.type === "dropbox" ||
            integration.type === "onedrive") &&
            "storageQuota" in integration &&
            (integration as CloudStorageIntegration).storageQuota && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground">
                  Storage
                </p>
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span>
                      {(
                        (integration as CloudStorageIntegration).storageQuota!.used /
                        1024 /
                        1024 /
                        1024
                      ).toFixed(1)}{" "}
                      GB used
                    </span>
                    <span className="text-muted-foreground">
                      {(
                        (integration as CloudStorageIntegration).storageQuota!.total /
                        1024 /
                        1024 /
                        1024
                      ).toFixed(0)}{" "}
                      GB total
                    </span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-2">
                    <div
                      className="bg-accent h-2 rounded-full"
                      style={{
                        width: `${((integration as CloudStorageIntegration).storageQuota!.used / (integration as CloudStorageIntegration).storageQuota!.total) * 100}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            )}

          {/* Sync Status */}
          {integration.isConnected && integration.syncStatus !== "idle" && (
            <div
              className={cn(
                "p-2 rounded text-xs flex items-center gap-2",
                integration.syncStatus === "syncing" &&
                  "bg-blue-500/10 text-blue-400",
                integration.syncStatus === "success" &&
                  "bg-green-500/10 text-green-400",
                integration.syncStatus === "error" &&
                  "bg-red-500/10 text-red-400"
              )}
            >
              {integration.syncStatus === "syncing" && (
                <>
                  <RefreshCw className="w-3 h-3 animate-spin" />
                  Syncing...
                </>
              )}
              {integration.syncStatus === "success" && (
                <>
                  <CheckCircle2 className="w-3 h-3" />
                  Sync successful
                </>
              )}
              {integration.syncStatus === "error" && (
                <>
                  <AlertCircle className="w-3 h-3" />
                  {integration.error || "Sync failed"}
                </>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            {integration.isConnected ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  onClick={() => handleSync(integration.id)}
                  disabled={integration.syncStatus === "syncing"}
                >
                  <RefreshCw className="w-3 h-3 mr-1" />
                  Sync
                </Button>
                <Button size="sm" variant="outline" className="flex-1">
                  <Settings className="w-3 h-3 mr-1" />
                  Settings
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  className="flex-1"
                  onClick={() => handleDisconnect(integration.id)}
                >
                  <Unlink2 className="w-3 h-3 mr-1" />
                  Disconnect
                </Button>
              </>
            ) : (
              <Button size="sm" className="w-full">
                <Link2 className="w-3 h-3 mr-2" />
                Connect Account
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  };

  const connectedCount = connectedIntegrations.filter(
    i => i.isConnected
  ).length;

  return (
    <div className={cn("space-y-4", className)}>
      <Tabs
        value={activeTab}
        onValueChange={v => setActiveTab(v as "connected" | "available")}
      >
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="connected">
            Connected ({connectedCount})
          </TabsTrigger>
          <TabsTrigger value="available">Available</TabsTrigger>
        </TabsList>

        <TabsContent value="connected" className="space-y-4">
          {connectedIntegrations.filter(i => i.isConnected).length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {connectedIntegrations
                .filter(i => i.isConnected)
                .map(integration => renderIntegrationCard(integration))}
            </div>
          ) : (
            <Card>
              <CardContent className="flex items-center justify-center h-32">
                <div className="text-center text-muted-foreground">
                  <Link2 className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p>No integrations connected yet</p>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="available" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {connectedIntegrations
              .filter(i => !i.isConnected)
              .map(integration => renderIntegrationCard(integration))}
          </div>
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
              <div className="text-2xl font-bold text-accent">
                {connectedCount}
              </div>
              <p className="text-xs text-muted-foreground">Connected</p>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-accent">
                {connectedIntegrations.length - connectedCount}
              </div>
              <p className="text-xs text-muted-foreground">Available</p>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-accent">
                {connectedIntegrations.filter(i => i.lastSynced).length}
              </div>
              <p className="text-xs text-muted-foreground">Recently Synced</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
