import React from "react";
import { trpc } from "../lib/trpc";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "../components/ui/card";
import { Label } from "../components/ui/label";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Switch } from "../components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/tabs";
import { Key, Shield, HardDrive, Cpu, Bell } from "lucide-react";
import { toast } from "sonner";

export const Settings: React.FC = () => {
  const saveKeysMutation = trpc.settings.saveKeys.useMutation({
    onSuccess: () => toast.success("API keys updated successfully")
  });

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">System Settings</h1>
        <p className="text-muted-foreground">Configure your local workstation and external AI providers.</p>
      </div>

      <Tabs defaultValue="api" className="space-y-6">
        <TabsList className="bg-muted/50 p-1">
          <TabsTrigger value="api"><Key className="w-4 h-4 mr-2" /> API Providers</TabsTrigger>
          <TabsTrigger value="security"><Shield className="w-4 h-4 mr-2" /> Security</TabsTrigger>
          <TabsTrigger value="hardware"><HardDrive className="w-4 h-4 mr-2" /> Hardware</TabsTrigger>
          <TabsTrigger value="system"><Cpu className="w-4 h-4 mr-2" /> System</TabsTrigger>
        </TabsList>

        <TabsContent value="api">
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

        <TabsContent value="security">
          <Card>
            <CardHeader>
              <CardTitle>Workstation Hardening</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Sovereign Mode</Label>
                  <p className="text-xs text-muted-foreground">Disable all external network calls entirely.</p>
                </div>
                <Switch defaultChecked />
              </div>
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Local Encryption</Label>
                  <p className="text-xs text-muted-foreground">Encrypt projects at rest using system TPM.</p>
                </div>
                <Switch />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="hardware">
           <Card>
            <CardHeader>
              <CardTitle>Tool Paths</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Blender Executable</Label>
                <Input defaultValue="/usr/bin/blender" />
              </div>
              <div className="space-y-2">
                <Label>KiCad CLI Path</Label>
                <Input defaultValue="/usr/bin/kicad-cli" />
              </div>
              <Button variant="outline">Detect Hardware</Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="system">
          <SystemHealth />
        </TabsContent>
      </Tabs>
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

export default Settings;
