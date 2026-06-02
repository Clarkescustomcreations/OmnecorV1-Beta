import React, { useState } from "react";
import { trpc } from "../lib/trpc";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "../components/ui/card";
import { Label } from "../components/ui/label";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Switch } from "../components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/tabs";
import { RadioGroup, RadioGroupItem } from "../components/ui/radio-group";
import { Badge } from "../components/ui/badge";
import { ScrollArea } from "../components/ui/scroll-area";
import { Key, Shield, HardDrive, Cpu, Bell, Lock, Zap, Flame, Activity, Users, Download, CheckCircle2, Circle, Route, Sun, Moon, Monitor, Cloud, UserCircle2 } from "lucide-react";
import { useTheme, type Theme } from "../contexts/ThemeContext";
import CloudComputePanel from "../components/settings/CloudComputePanel";
import { toast } from "sonner";
import { useAppStore } from "../lib/store/app.store";
import ValetRouterPanel from "../components/settings/ValetRouterPanel";
import PersonaCreationPanel from "../components/settings/PersonaCreationPanel";

export const Settings: React.FC = () => {
  const saveKeysMutation = trpc.system.saveKeys.useMutation({
    onSuccess: () => toast.success("API keys updated successfully"),
    onError: (err) => toast.error("Failed to save providers: " + err.message),
  });
  const executionMode = useAppStore((s) => s.executionMode);
  const setExecutionMode = useAppStore((s) => s.setExecutionMode);
  const setModeMutation = trpc.system.setExecutionMode.useMutation({
    onSuccess: ({ mode }) => {
      setExecutionMode(mode);
      toast.success(`Execution mode set to ${mode}`);
    },
    onError: (e) => toast.error(e.message),
  });
  const { data: me } = trpc.auth.me.useQuery();
  const isAdmin = me?.role === "admin" || me?.role === "owner";

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">System Settings</h1>
        <p className="text-muted-foreground">Configure your local workstation and external AI providers.</p>
      </div>

      <Tabs defaultValue="api" className="space-y-6">
        <TabsList className="bg-muted/50 p-1">
          <TabsTrigger value="api" id="tab-api"><Key className="w-4 h-4 mr-2" aria-hidden="true" /> API Providers</TabsTrigger>
          <TabsTrigger value="security" id="tab-security"><Shield className="w-4 h-4 mr-2" aria-hidden="true" /> Security</TabsTrigger>
          <TabsTrigger value="hardware" id="tab-hardware"><HardDrive className="w-4 h-4 mr-2" aria-hidden="true" /> Hardware</TabsTrigger>
          <TabsTrigger value="system" id="tab-system"><Cpu className="w-4 h-4 mr-2" aria-hidden="true" /> System</TabsTrigger>
          <TabsTrigger value="accounts" id="tab-accounts"><Users className="w-4 h-4 mr-2" aria-hidden="true" /> Accounts</TabsTrigger>
          <TabsTrigger value="valet" id="tab-valet"><Route className="w-4 h-4 mr-2" aria-hidden="true" /> Valet Router</TabsTrigger>
          <TabsTrigger value="appearance" id="tab-appearance"><Sun className="w-4 h-4 mr-2" aria-hidden="true" /> Appearance</TabsTrigger>
          <TabsTrigger value="cloud" id="tab-cloud"><Cloud className="w-4 h-4 mr-2" aria-hidden="true" /> Cloud Compute</TabsTrigger>
          <TabsTrigger value="personas" id="tab-personas"><UserCircle2 className="w-4 h-4 mr-2" aria-hidden="true" /> Personas</TabsTrigger>
          {isAdmin && <TabsTrigger value="admin" id="tab-admin"><Activity className="w-4 h-4 mr-2" aria-hidden="true" /> Admin</TabsTrigger>}
        </TabsList>

        <TabsContent value="api" role="tabpanel" aria-labelledby="tab-api">
          <Card>
            <CardHeader>
              <CardTitle>Provider Keys</CardTitle>
              <CardDescription>Keys are stored locally and never transmitted to our servers.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="openai">OpenAI API Key</Label>
                <Input id="openai" type="password" placeholder="sk-..." />
              </div>
              <div className="space-y-2">
                <Label htmlFor="anthropic">Anthropic API Key</Label>
                <Input id="anthropic" type="password" placeholder="sk-ant-..." />
              </div>
              <Button onClick={() => saveKeysMutation.mutate({ keys: {} })}>Save Providers</Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="security" role="tabpanel" aria-labelledby="tab-security">
          <Card>
            <CardHeader>
              <CardTitle>Workstation Hardening</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3">
                <Label>Execution Mode</Label>
                <RadioGroup
                  value={executionMode}
                  onValueChange={(v) => setModeMutation.mutate({ mode: v as "sovereign" | "scrapper" | "big_spender" })}
                  className="space-y-2"
                >
                  <div className="flex items-start gap-3 rounded-md border p-3">
                    <RadioGroupItem value="sovereign" id="mode-sovereign" className="mt-0.5" />
                    <div>
                      <Label htmlFor="mode-sovereign" className="font-medium cursor-pointer flex items-center gap-1.5">
                        <Lock className="h-3.5 w-3.5 text-red-500" /> Sovereign
                      </Label>
                      <p className="text-xs text-muted-foreground">Air-gapped lockdown. All cloud provider calls are blocked server-side. For HIPAA/offline use.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 rounded-md border p-3">
                    <RadioGroupItem value="scrapper" id="mode-scrapper" className="mt-0.5" />
                    <div>
                      <Label htmlFor="mode-scrapper" className="font-medium cursor-pointer flex items-center gap-1.5">
                        <Zap className="h-3.5 w-3.5 text-green-500" /> Scrapper <Badge variant="outline" className="text-xs ml-1">Default</Badge>
                      </Label>
                      <p className="text-xs text-muted-foreground">Local-preferred. Ollama runs first; cloud providers available with your own API keys.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 rounded-md border p-3">
                    <RadioGroupItem value="big_spender" id="mode-big_spender" className="mt-0.5" />
                    <div>
                      <Label htmlFor="mode-big_spender" className="font-medium cursor-pointer flex items-center gap-1.5">
                        <Flame className="h-3.5 w-3.5 text-amber-500" /> Big Spender
                      </Label>
                      <p className="text-xs text-muted-foreground">Cloud-first. Prioritizes the highest-capability cloud models regardless of cost.</p>
                    </div>
                  </div>
                </RadioGroup>
              </div>
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="local-encryption">Local Encryption</Label>
                  <p className="text-xs text-muted-foreground">Encrypt projects at rest using system TPM.</p>
                </div>
                <Switch id="local-encryption" aria-label="Enable local encryption" />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="hardware" role="tabpanel" aria-labelledby="tab-hardware">
          <HardwarePanel />
        </TabsContent>

        <TabsContent value="system" role="tabpanel" aria-labelledby="tab-system">
          <SystemHealth />
        </TabsContent>

        <TabsContent value="accounts" role="tabpanel" aria-labelledby="tab-accounts">
          <ConnectedAccounts loginMethod={me?.loginMethod ?? null} />
        </TabsContent>

        <TabsContent value="valet" role="tabpanel" aria-labelledby="tab-valet">
          <ValetRouterPanel />
        </TabsContent>

        <TabsContent value="appearance" role="tabpanel" aria-labelledby="tab-appearance">
          <AppearancePanel />
        </TabsContent>

        <TabsContent value="cloud" role="tabpanel" aria-labelledby="tab-cloud">
          <CloudComputePanel />
        </TabsContent>

        <TabsContent value="personas" role="tabpanel" aria-labelledby="tab-personas">
          <PersonaCreationPanel />
        </TabsContent>

        {isAdmin && (
          <TabsContent value="admin" role="tabpanel" aria-labelledby="tab-admin">
            <div className="space-y-6">
              <UserManagementPanel />
              <AuditLogPanel />
            </div>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
};

const THEME_OPTIONS: { value: Theme; label: string; icon: React.ReactNode; description: string }[] = [
  { value: "dark", label: "Dark", icon: <Moon className="h-5 w-5" />, description: "Dark background, optimized for low-light environments." },
  { value: "light", label: "Light", icon: <Sun className="h-5 w-5" />, description: "Light background, best for bright environments." },
];

const AppearancePanel: React.FC = () => {
  const { theme, setTheme } = useTheme();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Monitor className="w-4 h-4" /> Theme</CardTitle>
          <CardDescription>Choose the color scheme for the Omnecor interface. Your preference is saved locally.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 max-w-md">
            {THEME_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setTheme(opt.value)}
                aria-pressed={theme === opt.value}
                className={`flex flex-col items-center gap-2 rounded-lg border-2 p-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
                  ${theme === opt.value
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-background hover:border-muted-foreground text-muted-foreground hover:text-foreground"
                  }`}
              >
                {opt.icon}
                <span>{opt.label}</span>
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Current theme: <span className="font-semibold capitalize">{theme}</span>
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

const SystemHealth: React.FC = () => {
  const healthQuery = trpc.system.health.useQuery(undefined, {
    refetchInterval: 10000
  });

  return (
    <Card className="border-none bg-muted/30">
      <CardHeader>
        <CardTitle className="text-sm font-bold flex items-center gap-2">
          <Bell className="w-4 h-4" /> Live System Monitor
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 pb-6">
        <HealthMetric label="CPU Usage" value={`${healthQuery.data?.cpu.percent || 0}%`} status="ok" />
        <HealthMetric label="VRAM" value="8.2 GB" status="ok" />
        <HealthMetric label="Ollama" value={healthQuery.data?.ollama.status || "Checking..."} status="ok" />
        <HealthMetric label="ChromaDB" value={healthQuery.data?.chromadb.status || "Checking..."} status="ok" />
      </CardContent>
    </Card>
  );
};

const HealthMetric = ({ label, value, status }: { label: string, value: string, status: string }) => (
  <div className="p-4 bg-background rounded-lg border flex flex-col gap-1 shadow-sm">
    <span className="text-[10px] font-bold uppercase text-muted-foreground">{label}</span>
    <div className="flex items-center gap-2">
      <div className={`w-2 h-2 rounded-full ${status === 'ok' ? 'bg-green-500' : 'bg-red-500'}`} />
      <span className="text-lg font-mono font-bold tracking-tighter">{value}</span>
    </div>
  </div>
);

const HardwarePanel: React.FC = () => {
  const [blenderPath, setBlenderPath] = React.useState("/usr/bin/blender");
  const [kicadPath, setKicadPath] = React.useState("/usr/bin/kicad-cli");

  const detectMutation = trpc.system.detectHardware.useMutation({
    onSuccess: (data) => {
      if (data.blenderPath) setBlenderPath(data.blenderPath);
      if (data.kicadPath) setKicadPath(data.kicadPath);
      const found = [
        data.blenderPath && `Blender: ${data.blenderPath}`,
        data.kicadPath && `KiCad: ${data.kicadPath}`,
        data.gpuInfo && `GPU: ${data.gpuInfo}`,
        data.ollamaVersion && `Ollama: v${data.ollamaVersion}`,
      ].filter(Boolean);
      if (found.length > 0) {
        toast.success(`Detected: ${found.join(" | ")}`);
      } else {
        toast.info("No additional tools auto-detected. Enter paths manually.");
      }
    },
    onError: (err) => toast.error("Detection failed: " + err.message),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Tool Paths</CardTitle>
          <CardDescription>Configure paths to external tools. Click "Detect Hardware" to auto-discover installed applications.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="blender-path">Blender Executable</Label>
            <Input id="blender-path" value={blenderPath} onChange={e => setBlenderPath(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="kicad-path">KiCad CLI Path</Label>
            <Input id="kicad-path" value={kicadPath} onChange={e => setKicadPath(e.target.value)} />
          </div>
          <Button
            variant="outline"
            onClick={() => detectMutation.mutate()}
            disabled={detectMutation.isPending}
          >
            {detectMutation.isPending ? "Detecting..." : "Detect Hardware"}
          </Button>
        </CardContent>
      </Card>

      {detectMutation.data && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Detected System Info</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Platform</p>
              <p className="font-mono">{detectMutation.data.platform}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">CPU Cores</p>
              <p className="font-mono">{detectMutation.data.cpuCount}</p>
            </div>
            {detectMutation.data.cpuModel && (
              <div className="col-span-2">
                <p className="text-xs text-muted-foreground">CPU Model</p>
                <p className="font-mono text-xs truncate">{detectMutation.data.cpuModel}</p>
              </div>
            )}
            <div>
              <p className="text-xs text-muted-foreground">Total RAM</p>
              <p className="font-mono">{detectMutation.data.totalMemoryGB} GB</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Free RAM</p>
              <p className="font-mono">{detectMutation.data.freeMemoryGB} GB</p>
            </div>
            {detectMutation.data.gpuInfo && (
              <div className="col-span-2">
                <p className="text-xs text-muted-foreground">GPU</p>
                <p className="font-mono text-xs">{detectMutation.data.gpuInfo}</p>
              </div>
            )}
            {detectMutation.data.ollamaVersion && (
              <div>
                <p className="text-xs text-muted-foreground">Ollama Version</p>
                <p className="font-mono">v{detectMutation.data.ollamaVersion}</p>
              </div>
            )}
            <div>
              <p className="text-xs text-muted-foreground">Blender</p>
              <p className="font-mono text-xs">{detectMutation.data.blenderPath ?? "Not found"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">KiCad CLI</p>
              <p className="font-mono text-xs">{detectMutation.data.kicadPath ?? "Not found"}</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

const ConnectedAccounts: React.FC<{ loginMethod: string | null }> = ({ loginMethod }) => {
  const { data: providers } = trpc.system.loginProviders.useQuery();

  const providerList = [
    { id: "google", label: "Google", configured: providers?.google ?? false },
    { id: "microsoft", label: "Microsoft", configured: providers?.microsoft ?? false },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connected Accounts</CardTitle>
        <CardDescription>OAuth providers configured for sign-in. Your current session method is shown below.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md bg-muted/40 border px-4 py-3 text-sm">
          <span className="text-muted-foreground">Signed in via: </span>
          <Badge variant="outline" className="ml-1 capitalize">{loginMethod ?? "—"}</Badge>
        </div>
        <div role="list" className="space-y-2" aria-label="Available OAuth providers">
          {providerList.map(p => (
            <div key={p.id} role="listitem" className="flex items-center justify-between rounded-md border px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                {p.configured
                  ? <CheckCircle2 className="h-4 w-4 text-green-500" aria-hidden="true" />
                  : <Circle className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                }
                {p.label}
              </div>
              <Badge variant={p.configured ? "default" : "secondary"} className="text-xs">
                {p.configured ? "Configured" : "Not configured"}
              </Badge>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          To enable a provider, add its client ID and secret to your <code className="font-mono bg-muted px-1 rounded">.env</code> file and restart the server.
        </p>
      </CardContent>
    </Card>
  );
};

const AuditLogPanel: React.FC = () => {
  const [offset, setOffset] = useState(0);
  const limit = 50;
  const { data, isLoading } = trpc.audit.getAuditLog.useQuery({ limit, offset });
  const exportQuery = trpc.audit.exportAuditLog.useQuery({ limit: 5000 }, { enabled: false });

  const handleExport = async () => {
    const result = await exportQuery.refetch();
    if (!result.data?.csv) return;
    const blob = new Blob([result.data.csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div>
          <CardTitle>Audit Log</CardTitle>
          <CardDescription>Immutable record of all authenticated actions. Admin-only.</CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={handleExport} disabled={exportQuery.isFetching} aria-label="Export audit log as CSV">
          <Download className="h-4 w-4 mr-2" aria-hidden="true" />
          Export CSV
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground py-4 text-center" role="status" aria-live="polite">Loading audit log…</p>
        ) : (
          <>
            <ScrollArea className="h-96 rounded-md border">
              <table className="w-full text-xs" aria-label="Audit log entries">
                <thead className="sticky top-0 bg-muted">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold">Event</th>
                    <th className="text-left px-3 py-2 font-semibold">Actor</th>
                    <th className="text-left px-3 py-2 font-semibold">Procedure</th>
                    <th className="text-left px-3 py-2 font-semibold">IP</th>
                    <th className="text-left px-3 py-2 font-semibold">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.entries ?? []).map(entry => (
                    <tr key={entry.id} className="border-t border-border hover:bg-muted/40">
                      <td className="px-3 py-2 font-mono">{entry.eventType}</td>
                      <td className="px-3 py-2 text-muted-foreground">{entry.actorId ?? "—"} <span className="text-xs opacity-60">({entry.actorType})</span></td>
                      <td className="px-3 py-2 font-mono text-muted-foreground truncate max-w-[180px]">{entry.procedure ?? "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{entry.ipAddress ?? "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{new Date(entry.createdAt).toLocaleString()}</td>
                    </tr>
                  ))}
                  {(data?.entries ?? []).length === 0 && (
                    <tr><td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">No audit events recorded yet.</td></tr>
                  )}
                </tbody>
              </table>
            </ScrollArea>
            <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
              <span>{data?.entries?.length ?? 0} entries shown</span>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))} aria-label="Previous page">
                  Previous
                </Button>
                <Button variant="ghost" size="sm" disabled={(data?.entries?.length ?? 0) < limit} onClick={() => setOffset(offset + limit)} aria-label="Next page">
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};

const UserManagementPanel: React.FC = () => {
  const { data, isLoading, refetch } = trpc.system.listUsers.useQuery();
  const setRoleMutation = trpc.system.setUserRole.useMutation({
    onSuccess: () => { toast.success("Role updated"); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>User Management</CardTitle>
        <CardDescription>Manage user roles across the system. You cannot change your own role.</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground py-4 text-center" role="status" aria-live="polite">Loading users…</p>
        ) : (
          <div role="list" className="space-y-2" aria-label="User list">
            {(data?.users ?? []).map(user => (
              <div key={user.id} role="listitem" className="flex items-center justify-between rounded-md border px-4 py-3">
                <div>
                  <p className="text-sm font-medium">{user.name ?? "—"}</p>
                  <p className="text-xs text-muted-foreground">{user.email ?? user.loginMethod ?? "—"}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs capitalize">{user.loginMethod ?? "—"}</Badge>
                  <select
                    className="text-xs rounded border bg-background px-2 py-1"
                    value={user.role}
                    aria-label={`Role for ${user.name ?? user.id}`}
                    onChange={e => setRoleMutation.mutate({ userId: user.id, role: e.target.value as "viewer" | "user" | "admin" | "owner" })}
                  >
                    <option value="viewer">Viewer</option>
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                    <option value="owner">Owner</option>
                  </select>
                </div>
              </div>
            ))}
            {(data?.users ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No users found.</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default Settings;
