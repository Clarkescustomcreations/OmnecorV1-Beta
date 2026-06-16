import { useState, useEffect } from "react";
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
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import {
  AlertCircle,
  Download,
  Upload,
  Trash2,
  Plus,
  FolderOpen,
  Shield,
  Lock,
  Eye,
  Settings,
  Zap,
  Save,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getDefaultSettings, type AppSettings } from "@/lib/settings";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useAppStore } from "@/lib/store/app.store";

interface SettingsPanelProps {
  className?: string;
}

/**
 * Settings Panel Component
 *
 * Comprehensive settings interface with:
 * - Knowledge base management
 * - Security settings
 * - Privacy settings
 * - General preferences
 * - Advanced configuration
 */
export default function SettingsPanel({ className }: SettingsPanelProps) {
  const { data: savedSettings } = trpc.system.getSettings.useQuery(undefined, {
    staleTime: Infinity, // only fetch once per session
  });
  const saveSettingsMutation = trpc.system.saveSettings.useMutation({
    onSuccess: () => toast.success("Settings saved"),
    onError: (err) => toast.error("Failed to save: " + err.message),
  });

  const [settings, setSettings] = useState<AppSettings>(getDefaultSettings());
  const [activeTab, setActiveTab] = useState<string>("general");
  const [hasChanges, setHasChanges] = useState(false);

  // Populate from backend when loaded:
  useEffect(() => {
    if (savedSettings) {
      setSettings(savedSettings as AppSettings);
    }
  }, [savedSettings]);

  const handleSettingChange = () => {
    setHasChanges(true);
  };

  const handleSave = () => {
    setHasChanges(false);
    saveSettingsMutation.mutate({ settings: settings as unknown as Record<string, unknown> });
  };

  const handleExport = () => {
    const json = JSON.stringify(settings, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `omnecor-settings-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
  };

  const handleImport = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const imported = JSON.parse(e.target?.result as string);
          setSettings(imported);
          setHasChanges(true);
          toast.success("Settings imported. Click Save to apply.");
        } catch (err) {
          toast.error("Invalid settings file");
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const handleAddFolder = () => {
    const name = window.prompt("Folder Name:");
    const path = window.prompt("Folder Path:");
    if (name && path) {
      const newFolder = {
        id: Math.random().toString(36).substring(7),
        name,
        path,
        enabled: true,
        fileCount: 0,
        totalSize: 0
      };
      setSettings({
        ...settings,
        knowledge: {
          ...settings.knowledge,
          folders: [...settings.knowledge.folders, newFolder]
        }
      });
      handleSettingChange();
    }
  };

  const handleRemoveFolder = (id: string) => {
    setSettings({
      ...settings,
      knowledge: {
        ...settings.knowledge,
        folders: settings.knowledge.folders.filter(f => f.id !== id)
      }
    });
    handleSettingChange();
  };

  const handleToggleFolder = (id: string, enabled: boolean) => {
    setSettings({
      ...settings,
      knowledge: {
        ...settings.knowledge,
        folders: settings.knowledge.folders.map(f =>
          f.id === id ? { ...f, enabled } : f
        )
      }
    });
    handleSettingChange();
  };

  return (
    <div className={cn("space-y-4", className)}>
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="general">
            <Settings className="w-4 h-4 mr-2" />
            General
          </TabsTrigger>
          <TabsTrigger value="knowledge">
            <FolderOpen className="w-4 h-4 mr-2" />
            Knowledge
          </TabsTrigger>
          <TabsTrigger value="security">
            <Shield className="w-4 h-4 mr-2" />
            Security
          </TabsTrigger>
          <TabsTrigger value="privacy">
            <Lock className="w-4 h-4 mr-2" />
            Privacy
          </TabsTrigger>
          <TabsTrigger value="advanced">
            <Zap className="w-4 h-4 mr-2" />
            Advanced
          </TabsTrigger>
        </TabsList>

        {/* GENERAL SETTINGS */}
        <TabsContent value="general" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Appearance</CardTitle>
              <CardDescription>
                Customize how Omnecor looks and feels
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-semibold">Theme</label>
                <Select
                  value={settings.general.theme}
                  onValueChange={value => {
                    setSettings({ ...settings, general: { ...settings.general, theme: value as AppSettings["general"]["theme"] } });
                    handleSettingChange();
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dark">Dark</SelectItem>
                    <SelectItem value="light">Light</SelectItem>
                    <SelectItem value="auto">Auto</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold">Font Size</label>
                <div className="flex items-center gap-4">
                  <Slider
                    value={[settings.general.fontSize]}
                    min={12}
                    max={18}
                    step={1}
                    className="flex-1"
                    onValueChange={v => {
                      setSettings({
                        ...settings,
                        general: { ...settings.general, fontSize: v[0] },
                      });
                      handleSettingChange();
                    }}
                  />
                  <span className="text-sm font-mono w-12">
                    {settings.general.fontSize}px
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold">Language</label>
                <Select
                  value={settings.general.language}
                  onValueChange={value => {
                    setSettings({ ...settings, general: { ...settings.general, language: value as AppSettings["general"]["language"] } });
                    handleSettingChange();
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="en">English</SelectItem>
                    <SelectItem value="es">Español</SelectItem>
                    <SelectItem value="fr">Français</SelectItem>
                    <SelectItem value="de">Deutsch</SelectItem>
                    <SelectItem value="zh">中文</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Behavior</CardTitle>
              <CardDescription>Configure application behavior</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <label className="text-sm font-semibold">Auto-Save</label>
                <Switch
                  checked={settings.general.autoSave}
                  onCheckedChange={checked => {
                    setSettings({
                      ...settings,
                      general: { ...settings.general, autoSave: checked },
                    });
                    handleSettingChange();
                  }}
                />
              </div>

              <div className="flex items-center justify-between">
                <label className="text-sm font-semibold">Notifications</label>
                <Switch
                  checked={settings.general.notificationsEnabled}
                  onCheckedChange={checked => {
                    setSettings({
                      ...settings,
                      general: {
                        ...settings.general,
                        notificationsEnabled: checked,
                      },
                    });
                    handleSettingChange();
                  }}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <label className="text-sm font-semibold">Global "How To" Tooltips</label>
                  <p className="text-xs text-muted-foreground">Show helpful hints on UI elements</p>
                </div>
                <Switch
                  checked={useAppStore((s) => s.showTooltips)}
                  onCheckedChange={(checked) => useAppStore.setState({ showTooltips: checked })}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold">
                  Startup Behavior
                </label>
                <Select
                  value={settings.general.startupBehavior}
                  onValueChange={value => {
                    setSettings({ ...settings, general: { ...settings.general, startupBehavior: value as AppSettings["general"]["startupBehavior"] } });
                    handleSettingChange();
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="last-session">
                      Restore Last Session
                    </SelectItem>
                    <SelectItem value="blank">Blank Workspace</SelectItem>
                    <SelectItem value="dashboard">Dashboard</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* KNOWLEDGE BASE SETTINGS */}
        <TabsContent value="knowledge" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-sm">
                    Knowledge Base Folders
                  </CardTitle>
                  <CardDescription>
                    Manage indexed project folders
                  </CardDescription>
                </div>
                <Button size="sm" onClick={handleAddFolder}>
                  <Plus className="w-4 h-4 mr-2" />
                  Add Folder
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <ScrollArea className="h-64">
                <div className="space-y-2">
                  {settings.knowledge.folders.map(folder => (
                    <div
                      key={folder.id}
                      className="p-3 rounded-lg border bg-muted/50 flex items-center justify-between"
                    >
                      <div className="flex-1">
                        <p className="text-sm font-semibold">{folder.name}</p>
                        <p className="text-xs text-muted-foreground font-mono truncate">
                          {folder.path}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {folder.fileCount} files •{" "}
                          {(folder.totalSize / 1024 / 1024).toFixed(1)} MB
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch checked={folder.enabled} onCheckedChange={checked => handleToggleFolder(folder.id, checked)} />
                        <Button size="sm" variant="ghost" onClick={() => handleRemoveFolder(folder.id)}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Indexing Settings</CardTitle>
              <CardDescription>
                Configure automatic indexing behavior
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <label className="text-sm font-semibold">Auto-Index</label>
                <Switch
                  checked={settings.knowledge.autoIndex}
                  onCheckedChange={checked => {
                    setSettings({ ...settings, knowledge: { ...settings.knowledge, autoIndex: checked } });
                    handleSettingChange();
                  }}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold">
                  Index Interval (minutes)
                </label>
                <Slider
                  value={[settings.knowledge.indexInterval]}
                  min={5}
                  max={240}
                  step={5}
                  onValueChange={v => {
                    setSettings({
                      ...settings,
                      knowledge: { ...settings.knowledge, indexInterval: v[0] },
                    });
                    handleSettingChange();
                  }}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold">
                  Max File Size (MB)
                </label>
                <Slider
                  value={[settings.knowledge.maxFileSize]}
                  min={10}
                  max={500}
                  step={10}
                  onValueChange={v => {
                    setSettings({
                      ...settings,
                      knowledge: { ...settings.knowledge, maxFileSize: v[0] },
                    });
                    handleSettingChange();
                  }}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* SECURITY SETTINGS */}
        <TabsContent value="security" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">File Security</CardTitle>
              <CardDescription>Protect against malicious files</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <label className="text-sm font-semibold">
                  Malicious File Scan
                </label>
                <Switch
                  checked={settings.security.maliciousFileScan}
                  onCheckedChange={checked => {
                    setSettings({ ...settings, security: { ...settings.security, maliciousFileScan: checked } });
                    handleSettingChange();
                  }}
                />
              </div>

              <div className="flex items-center justify-between">
                <label className="text-sm font-semibold">Scan on Upload</label>
                <Switch
                  checked={settings.security.scanOnUpload}
                  onCheckedChange={checked => {
                    setSettings({ ...settings, security: { ...settings.security, scanOnUpload: checked } });
                    handleSettingChange();
                  }}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold">
                  Blacklisted File Types
                </label>
                <div className="flex flex-wrap gap-2">
                  {settings.security.fileTypeBlacklist.map(type => (
                    <Badge
                      key={type}
                      variant="secondary"
                      className="cursor-pointer"
                      onClick={() => {
                        const updated = settings.security.fileTypeBlacklist.filter(t => t !== type);
                        setSettings({
                          ...settings,
                          security: { ...settings.security, fileTypeBlacklist: updated }
                        });
                        handleSettingChange();
                        saveSettingsMutation.mutate({ settings: { ...settings, security: { ...settings.security, fileTypeBlacklist: updated } } as unknown as Record<string, unknown> });
                      }}
                    >
                      {type}
                      <Trash2 className="w-3 h-3 ml-1" />
                    </Badge>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Encryption</CardTitle>
              <CardDescription>Secure sensitive data</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <label className="text-sm font-semibold">Encryption</label>
                <Switch
                  checked={settings.security.encryptionEnabled}
                  onCheckedChange={checked => {
                    setSettings({ ...settings, security: { ...settings.security, encryptionEnabled: checked } });
                    handleSettingChange();
                  }}
                />
              </div>

              <div className="flex items-center justify-between">
                <label className="text-sm font-semibold">
                  Encrypt API Keys
                </label>
                <Switch
                  checked={settings.security.apiKeyEncryption}
                  onCheckedChange={checked => {
                    setSettings({ ...settings, security: { ...settings.security, apiKeyEncryption: checked } });
                    handleSettingChange();
                  }}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold">
                  Session Timeout (minutes)
                </label>
                <Slider
                  value={[settings.security.sessionTimeout]}
                  min={5}
                  max={480}
                  step={5}
                  onValueChange={v => {
                    setSettings({
                      ...settings,
                      security: { ...settings.security, sessionTimeout: v[0] },
                    });
                    handleSettingChange();
                  }}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* PRIVACY SETTINGS */}
        <TabsContent value="privacy" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Data Privacy</CardTitle>
              <CardDescription>
                Control how your data is handled
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-sm font-semibold">
                    Zero-Login Mode
                  </label>
                  <p className="text-xs text-muted-foreground">
                    All data stays local
                  </p>
                </div>
                <Switch
                  checked={settings.privacy.zeroLoginMode}
                  onCheckedChange={checked => {
                    setSettings({ ...settings, privacy: { ...settings.privacy, zeroLoginMode: checked } });
                    handleSettingChange();
                  }}
                />
              </div>

              <div className="flex items-center justify-between">
                <label className="text-sm font-semibold">Telemetry</label>
                <Switch
                  checked={settings.privacy.telemetryEnabled}
                  onCheckedChange={checked => {
                    setSettings({ ...settings, privacy: { ...settings.privacy, telemetryEnabled: checked } });
                    handleSettingChange();
                  }}
                />
              </div>

              <div className="flex items-center justify-between">
                <label className="text-sm font-semibold">Crash Reports</label>
                <Switch
                  checked={settings.privacy.crashReportsEnabled}
                  onCheckedChange={checked => {
                    setSettings({ ...settings, privacy: { ...settings.privacy, crashReportsEnabled: checked } });
                    handleSettingChange();
                  }}
                />
              </div>

              <div className="flex items-center justify-between">
                <label className="text-sm font-semibold">Analytics</label>
                <Switch
                  checked={settings.privacy.analyticsEnabled}
                  onCheckedChange={checked => {
                    setSettings({ ...settings, privacy: { ...settings.privacy, analyticsEnabled: checked } });
                    handleSettingChange();
                  }}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Cloud Sync</CardTitle>
              <CardDescription>Optional encrypted cloud backup</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <label className="text-sm font-semibold">
                  Enable Cloud Sync
                </label>
                <Switch
                  checked={settings.privacy.cloudSyncEnabled}
                  onCheckedChange={checked => {
                    setSettings({ ...settings, privacy: { ...settings.privacy, cloudSyncEnabled: checked } });
                    handleSettingChange();
                  }}
                />
              </div>

              {settings.privacy.cloudSyncEnabled && (
                <>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold">Provider</label>
                    <Select
                      value={settings.privacy.cloudSyncProvider || ""}
                      onValueChange={value => {
                        setSettings({ ...settings, privacy: { ...settings.privacy, cloudSyncProvider: value } });
                        handleSettingChange();
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="google-drive">
                          Google Drive
                        </SelectItem>
                        <SelectItem value="dropbox">Dropbox</SelectItem>
                        <SelectItem value="onedrive">OneDrive</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 flex gap-2">
                    <AlertCircle className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-blue-400">
                      Data is encrypted before upload. Only you can decrypt it.
                    </p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ADVANCED SETTINGS */}
        <TabsContent value="advanced" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">AI Model Defaults</CardTitle>
              <CardDescription>
                Configure default model parameters
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-semibold">Temperature</label>
                <div className="flex items-center gap-4">
                  <Slider
                    value={[settings.advanced.temperatureDefault]}
                    min={0}
                    max={2}
                    step={0.1}
                    className="flex-1"
                    onValueChange={v => {
                      setSettings({
                        ...settings,
                        advanced: {
                          ...settings.advanced,
                          temperatureDefault: v[0],
                        },
                      });
                      handleSettingChange();
                    }}
                  />
                  <span className="text-sm font-mono w-8">
                    {settings.advanced.temperatureDefault.toFixed(1)}
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold">Top P</label>
                <div className="flex items-center gap-4">
                  <Slider
                    value={[settings.advanced.topPDefault]}
                    min={0}
                    max={1}
                    step={0.05}
                    className="flex-1"
                    onValueChange={v => {
                      setSettings({
                        ...settings,
                        advanced: { ...settings.advanced, topPDefault: v[0] },
                      });
                      handleSettingChange();
                    }}
                  />
                  <span className="text-sm font-mono w-8">
                    {settings.advanced.topPDefault.toFixed(2)}
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold">
                  Max Context Tokens
                </label>
                <Slider
                  value={[settings.advanced.maxContextTokens]}
                  min={1000}
                  max={32000}
                  step={1000}
                  onValueChange={v => {
                    setSettings({
                      ...settings,
                      advanced: {
                        ...settings.advanced,
                        maxContextTokens: v[0],
                      },
                    });
                    handleSettingChange();
                  }}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Developer Options</CardTitle>
              <CardDescription>
                Advanced debugging and performance tuning
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <label className="text-sm font-semibold">Debug Mode</label>
                <Switch
                  checked={settings.advanced.debugMode}
                  onCheckedChange={checked => {
                    setSettings({ ...settings, advanced: { ...settings.advanced, debugMode: checked } });
                    handleSettingChange();
                  }}
                />
              </div>

              <div className="flex items-center justify-between">
                <label className="text-sm font-semibold">
                  Enable Dev Tools
                </label>
                <Switch
                  checked={settings.advanced.enableDevTools}
                  onCheckedChange={checked => {
                    setSettings({ ...settings, advanced: { ...settings.advanced, enableDevTools: checked } });
                    handleSettingChange();
                  }}
                />
              </div>

              <div className="flex items-center justify-between">
                <label className="text-sm font-semibold">Enable Cache</label>
                <Switch
                  checked={settings.advanced.cacheEnabled}
                  onCheckedChange={checked => {
                    setSettings({ ...settings, advanced: { ...settings.advanced, cacheEnabled: checked } });
                    handleSettingChange();
                  }}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold">Log Level</label>
                <Select
                  value={settings.advanced.logLevel}
                  onValueChange={value => {
                    setSettings({ ...settings, advanced: { ...settings.advanced, logLevel: value as AppSettings["advanced"]["logLevel"] } });
                    handleSettingChange();
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="debug">Debug</SelectItem>
                    <SelectItem value="info">Info</SelectItem>
                    <SelectItem value="warn">Warning</SelectItem>
                    <SelectItem value="error">Error</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* SETTINGS ACTIONS */}
      <div className="flex gap-2 justify-between">
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
          <Button variant="outline" size="sm" onClick={handleImport}>
            <Upload className="w-4 h-4 mr-2" />
            Import
          </Button>
        </div>
        <Button size="sm" disabled={!hasChanges || saveSettingsMutation.isPending} onClick={handleSave}>
          {saveSettingsMutation.isPending
            ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving…</>
            : <><Save className="w-4 h-4 mr-2" />Save Changes</>
          }
        </Button>
      </div>
    </div>
  );
}
