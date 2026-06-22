import React, { useState, useEffect, useMemo } from "react";
import { trpc } from "../lib/trpc";
import { Card, CardHeader, CardTitle, CardContent, CardDescription, CardFooter } from "../components/ui/card";
import { Label } from "../components/ui/label";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Switch } from "../components/ui/switch";
import { Slider } from "../components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/tabs";
import { RadioGroup, RadioGroupItem } from "../components/ui/radio-group";
import { Badge } from "../components/ui/badge";
import { Progress } from "../components/ui/progress";
import { ScrollArea } from "../components/ui/scroll-area";
import {
  Key, Shield, HardDrive, Cpu, Bell, Lock, Zap, Flame, Activity, Users,
  Download, CheckCircle2, Circle, Route, Sun, Moon, Monitor, Cloud,
  UserCircle2, CheckCircle, ArrowLeft, Wallet, Settings as SettingsIcon,
  FolderOpen, Settings2, Trash2, Plus, AlertCircle, Upload, Save, Loader2,
  Search, Share2, Mic2, History, FileJson, Server, Globe, Database, ShieldAlert,
  Eye, Layout, Clock, Coins, Brain, Copy, RefreshCw, Usb, Rocket, Smartphone
} from "lucide-react";
import { useTheme, type Theme } from "../contexts/ThemeContext";
import { CloudComputePanel } from "../components/settings/CloudComputePanel";
import { toast } from "sonner";
import { useAppStore } from "../lib/store/app.store";
import { ValetRouterPanel } from "../components/settings/ValetRouterPanel";
import { AuditRetentionPanel } from "../components/settings/AuditRetentionPanel";
import { AgenticWalletPanel } from "../components/settings/AgenticWalletPanel";
import { PairDevicePanel } from "../components/settings/PairDevicePanel";
import { advancedSettings } from "../lib/advancedSettings";
import { OmnecorDashboardLayout } from "../components/OmnecorDashboardLayout";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { applyFontSize, getStoredFontSize } from "@/lib/fontSize";

interface DisplayPeer {
  id?: string; name: string; address: string; port: number;
  fingerprint: string; isApproved?: boolean; vramMb?: number;
}

interface SavedSettings {
  localEncryption?: boolean; hitlCommandExecution?: boolean; hitlFileDeletion?: boolean;
  hitlInternetAccess?: boolean; hitlFinancialTransactions?: boolean; maliciousFileScan?: boolean;
  scanOnUpload?: boolean; encryptApiKeys?: boolean; sessionTimeout?: number;
  vram?: number; cpuThreads?: number; inferenceTimeout?: number; autoRestart?: boolean;
  offloadLatency?: number; poolVram?: boolean;
  sttModel?: string; ttsEngine?: string; comfyUrl?: string;
  fontSize?: number;
  autoSave?: boolean; notifications?: boolean; portableMode?: boolean;
  startupBehavior?: string; autoBackup?: boolean; backupFrequency?: string;
  googleClientId?: string; googleClientSecret?: string; microsoftClientId?: string; microsoftClientSecret?: string;
  autoIndex?: boolean; indexInterval?: number; maxFileSize?: number;
  zeroLoginMode?: boolean; telemetry?: boolean; crashReports?: boolean; analytics?: boolean; cloudSync?: boolean;
  sovereignBlockAiOnly?: boolean;
  temperature?: number; topP?: number; apiServerEnabled?: boolean; apiPort?: number;
  requireAuthToken?: boolean; debugMode?: boolean; devTools?: boolean; cacheEnabled?: boolean; logLevel?: string;
}

export const Settings: React.FC = () => {
  const [, setLocation] = useLocation();
  const { data: aiProviders, refetch: refetchAiProviders } = trpc.system.aiProviders.useQuery();
  const [keys, setKeys] = useState({
    openai: "",
    anthropic: "",
    gemini: "",
    grok: "",
    huggingface: "",
    elevenlabs: "",
    falai: "",
    forge: "",
  });
  const [ollamaUrl, setOllamaUrl] = useState("");
  const [n8nUrl, setN8nUrl] = useState("");
  const [comfyUrl, setComfyUrl] = useState("");

  useEffect(() => {
    if (aiProviders) {
      setOllamaUrl(aiProviders.ollamaUrl || "http://localhost:11434");
      setN8nUrl(aiProviders.n8nUrl || "http://localhost:5678");
      setComfyUrl(aiProviders.comfyUrl || "");
    }
  }, [aiProviders]);
  const [searchQuery, setSearchQuery] = useState("");
  // Deep-linkable: /settings?tab=hardware opens the Hardware tab directly.
  const [activeTab, setActiveTab] = useState(() => {
    const requested = new URLSearchParams(window.location.search).get("tab");
    const known = ["api", "wallet", "ommesh", "security", "hardware", "voice", "system", "accounts", "valet", "appearance", "cloud", "general", "knowledge", "privacy", "advanced", "admin"];
    return requested && known.includes(requested) ? requested : "api";
  });

  const saveKeysMutation = trpc.system.saveKeys.useMutation({
    onSuccess: () => {
      toast.success("API keys saved successfully");
      setKeys({ openai: "", anthropic: "", gemini: "", grok: "", huggingface: "", elevenlabs: "", falai: "", forge: "" });
      refetchAiProviders();
    },
    onError: (err) => toast.error("Failed to save: " + err.message),
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
  // Admin-only — this toggle relaxes Sovereign mode, so it's persisted through a
  // dedicated adminProcedure (NOT the public saveSettings endpoint).
  const setSovereignAiOnlyMutation = trpc.system.setSovereignBlockAiOnly.useMutation({
    onSuccess: ({ enabled }) => {
      toast.success(`Sovereign "block AI only" ${enabled ? "enabled" : "disabled"}`);
      refetchSettings();
    },
    onError: (e) => toast.error(e.message),
  });

  const [selectedMode, setSelectedMode] = useState<"sovereign" | "scrapper" | "big_spender">("scrapper");
  useEffect(() => {
    if (executionMode) {
      setSelectedMode(executionMode);
    }
  }, [executionMode]);

  const { data: settings, refetch: refetchSettings } = trpc.system.getSettings.useQuery();
  const saveSettingsMutation = trpc.system.saveSettings.useMutation({
    onSuccess: () => {
      toast.success("Security settings saved successfully");
      refetchSettings();
    },
    onError: (e) => toast.error(e.message),
  });

  const [localEncryption, setLocalEncryption] = useState(false);
  const [hitlCommandExecution, setHitlCommandExecution] = useState(true);
  const [hitlFileDeletion, setHitlFileDeletion] = useState(true);
  const [hitlInternetAccess, setHitlInternetAccess] = useState(false);
  const [hitlFinancialTransactions, setHitlFinancialTransactions] = useState(true);
  const [maliciousFileScan, setMaliciousFileScan] = useState(true);
  const [scanOnUpload, setScanOnUpload] = useState(true);
  const [encryptApiKeys, setEncryptApiKeys] = useState(true);
  const [sessionTimeout, setSessionTimeout] = useState(30);
  const [sovereignBlockAiOnly, setSovereignBlockAiOnly] = useState(false);

  useEffect(() => {
    if (settings) {
      const s = settings as SavedSettings;
      setLocalEncryption(!!s.localEncryption);
      setSovereignBlockAiOnly(!!s.sovereignBlockAiOnly);
      setHitlCommandExecution(s.hitlCommandExecution !== false);
      setHitlFileDeletion(s.hitlFileDeletion !== false);
      setHitlInternetAccess(!!s.hitlInternetAccess);
      setHitlFinancialTransactions(s.hitlFinancialTransactions !== false);
      setMaliciousFileScan(s.maliciousFileScan !== false);
      setScanOnUpload(s.scanOnUpload !== false);
      setEncryptApiKeys(s.encryptApiKeys !== false);
      setSessionTimeout(typeof s.sessionTimeout === 'number' ? s.sessionTimeout : 30);
    }
  }, [settings]);
  const { data: me } = trpc.auth.me.useQuery();
  const isAdmin = me?.role === "admin" || me?.role === "owner";
  // In zero-login the execution mode is fixed by the ZERO_LOGIN_EXECUTION_MODE
  // env var (server-forced on every request), so the selector below can't change
  // it — disable it and explain, rather than letting the change silently revert.
  const isZeroLogin = me?.loginMethod === "zero-login";

  const handleSaveKeys = () => {
    const payload: Record<string, string> = { ...keys };
    if (ollamaUrl) payload.ollamaUrl = ollamaUrl;
    if (n8nUrl) payload.n8nUrl = n8nUrl;
    if (comfyUrl) payload.comfyUrl = comfyUrl;
    saveKeysMutation.mutate({ keys: payload });
  };

  const tabs = useMemo(() => [
    { id: "api", label: "AI Providers", icon: Key },
    { id: "wallet", label: "Agentic Wallet", icon: Wallet },
    { id: "ommesh", label: "OMMESH", icon: Share2 },
    { id: "security", label: "Security", icon: Shield },
    { id: "hardware", label: "Hardware", icon: HardDrive },
    { id: "voice", label: "Voice & Media", icon: Mic2 },
    { id: "offline_voices", label: "Offline Voices", icon: Download },
    { id: "system", label: "System", icon: Cpu },
    { id: "accounts", label: "Accounts", icon: Users },
    { id: "devices", label: "Devices", icon: Smartphone },
    { id: "valet", label: "Valet Router", icon: Route },
    { id: "appearance", label: "Appearance", icon: Sun },
    { id: "cloud", label: "Cloud Compute", icon: Cloud },
    { id: "general", label: "General", icon: SettingsIcon },
    { id: "knowledge", label: "Knowledge Base", icon: FolderOpen },
    { id: "privacy", label: "Privacy", icon: Lock },
    { id: "advanced", label: "Advanced", icon: Settings2 },
    ...(isAdmin ? [{ id: "admin", label: "Admin", icon: Activity }] : []),
  ], [isAdmin]);

  const filteredTabs = useMemo(() => {
    if (!searchQuery) return tabs;
    return tabs.filter(tab =>
      tab.label.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [tabs, searchQuery]);

  // Auto-switch to first match when search narrows the sidebar list
  useEffect(() => {
    if (!searchQuery || filteredTabs.length === 0) return;
    const currentStillVisible = filteredTabs.some(t => t.id === activeTab);
    if (!currentStillVisible) {
      setActiveTab(filteredTabs[0].id);
    }
  }, [filteredTabs, searchQuery]);

  // Show "no results" label when search matches nothing
  const noResults = searchQuery.length > 0 && filteredTabs.length === 0;

  return (
    <OmnecorDashboardLayout>
      <div className="flex flex-col h-full bg-background">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-6 border-b bg-muted/30">
          <div className="flex items-center gap-4 min-w-0">
            <SettingsIcon className="w-6 h-6 text-accent flex-shrink-0" />
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight truncate">Settings</h1>
              <p className="text-sm text-muted-foreground truncate">Manage your workstation and AI behavior.</p>
            </div>
          </div>
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search settings..."
                className="pl-9 bg-background/50"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
          {/* Sidebar Tabs — horizontal scroll on mobile, vertical list on desktop */}
          <aside className="min-h-0 md:w-56 border-b md:border-b-0 md:border-r bg-muted/10 flex-shrink-0">
            <ScrollArea className="h-auto md:h-full">
              <div className="flex md:flex-col flex-row p-2 md:p-4 gap-1 overflow-x-auto md:overflow-x-visible">
                {noResults ? (
                  <div className="px-3 py-4 text-center whitespace-nowrap">
                    <Search className="w-5 h-5 text-muted-foreground/40 mx-auto mb-2" />
                    <p className="text-xs text-muted-foreground">No settings match</p>
                    <p className="text-[10px] text-muted-foreground/60 mt-0.5">"{searchQuery}"</p>
                  </div>
                ) : (
                  filteredTabs.map((tab) => {
                    const Icon = tab.icon;
                    return (
                      <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={cn(
                          "flex items-center gap-2 md:gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap md:whitespace-normal md:w-full",
                          activeTab === tab.id
                            ? "bg-accent text-accent-foreground shadow-sm"
                            : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                        )}
                      >
                        <Icon className="w-4 h-4 flex-shrink-0" />
                        {tab.label}
                      </button>
                    );
                  })
                )}
              </div>
            </ScrollArea>
          </aside>

          {/* Content Area */}
          <main className="min-h-0 flex-1 overflow-auto bg-muted/5 p-4 sm:p-6 md:p-8">
            <div className="max-w-4xl mx-auto w-full">
              <Tabs value={activeTab} className="w-full">
                <TabsContent value="api">
                  <div className="space-y-6">
                    {/* ── Section 1: Local AI ─────────────────────────────── */}
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                          <Server className="w-4 h-4 text-accent-success" /> Local AI (No Key Required)
                        </CardTitle>
                        <CardDescription>
                          Local inference engines running on your machine. Configure the base URL if non-default.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-5">
                        {/* Ollama */}
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <Label htmlFor="ollama-url" className="font-semibold">
                              Ollama — Base URL
                            </Label>
                            <Badge variant="secondary" className="bg-accent-success/10 text-accent-success border-accent-success/20 gap-1.5 py-0.5 text-[10px]">
                              <div className="w-1.5 h-1.5 rounded-full bg-green-500" /> Local
                            </Badge>
                          </div>
                          <p className="text-[11px] text-muted-foreground">
                            Runs Llama 3, Mistral, Phi, Gemma, and any other model installed via <code className="font-mono">ollama pull</code>.
                          </p>
                          <Input
                            id="ollama-url"
                            type="url"
                            placeholder="http://localhost:11434"
                            value={ollamaUrl}
                            onChange={(e) => setOllamaUrl(e.target.value)}
                          />
                        </div>
                      </CardContent>
                    </Card>

                    {/* ── Section 2: Cloud AI Providers ───────────────────── */}
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                          <Brain className="w-4 h-4 text-accent-cyan" /> Cloud AI Providers
                        </CardTitle>
                        <CardDescription>
                          API keys are stored locally in <code className="font-mono text-[11px]">~/.omnecor/settings.json</code> and never sent to our servers.
                          Leave a field blank to keep the existing key.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-5">
                        {/* OpenAI */}
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <Label htmlFor="key-openai" className="font-semibold">OpenAI</Label>
                            {aiProviders?.openai ? (
                              <Badge variant="secondary" className="bg-accent-success/10 text-accent-success border-accent-success/20 gap-1.5 py-0.5 text-[10px]">
                                <CheckCircle className="w-3 h-3" /> Configured
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px] py-0.5 text-muted-foreground">Not set</Badge>
                            )}
                          </div>
                          <p className="text-[11px] text-muted-foreground">GPT-4o, GPT-4o-mini, o1, o3 — OpenAI platform.openai.com</p>
                          <Input
                            id="key-openai"
                            type="password"
                            placeholder={aiProviders?.openai ? "••••••••••••••••" : "sk-..."}
                            value={keys.openai}
                            onChange={(e) => setKeys({ ...keys, openai: e.target.value })}
                          />
                        </div>

                        <div className="border-t" />

                        {/* Anthropic */}
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <Label htmlFor="key-anthropic" className="font-semibold">Anthropic (Claude)</Label>
                            {aiProviders?.anthropic ? (
                              <Badge variant="secondary" className="bg-accent-success/10 text-accent-success border-accent-success/20 gap-1.5 py-0.5 text-[10px]">
                                <CheckCircle className="w-3 h-3" /> Configured
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px] py-0.5 text-muted-foreground">Not set</Badge>
                            )}
                          </div>
                          <p className="text-[11px] text-muted-foreground">Claude 3.5, Claude 4 Sonnet/Opus — console.anthropic.com</p>
                          <Input
                            id="key-anthropic"
                            type="password"
                            placeholder={aiProviders?.anthropic ? "••••••••••••••••" : "sk-ant-..."}
                            value={keys.anthropic}
                            onChange={(e) => setKeys({ ...keys, anthropic: e.target.value })}
                          />
                        </div>

                        <div className="border-t" />

                        {/* Google Gemini */}
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <Label htmlFor="key-gemini" className="font-semibold">Google Gemini</Label>
                            {aiProviders?.gemini ? (
                              <Badge variant="secondary" className="bg-accent-success/10 text-accent-success border-accent-success/20 gap-1.5 py-0.5 text-[10px]">
                                <CheckCircle className="w-3 h-3" /> Configured
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px] py-0.5 text-muted-foreground">Not set</Badge>
                            )}
                          </div>
                          <p className="text-[11px] text-muted-foreground">Gemini 2.5 Flash/Pro — aistudio.google.com</p>
                          <Input
                            id="key-gemini"
                            type="password"
                            placeholder={aiProviders?.gemini ? "••••••••••••••••" : "AIza..."}
                            value={keys.gemini}
                            onChange={(e) => setKeys({ ...keys, gemini: e.target.value })}
                          />
                        </div>

                        <div className="border-t" />

                        {/* xAI Grok */}
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <Label htmlFor="key-grok" className="font-semibold">xAI Grok</Label>
                            {aiProviders?.grok ? (
                              <Badge variant="secondary" className="bg-accent-success/10 text-accent-success border-accent-success/20 gap-1.5 py-0.5 text-[10px]">
                                <CheckCircle className="w-3 h-3" /> Configured
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px] py-0.5 text-muted-foreground">Not set</Badge>
                            )}
                          </div>
                          <p className="text-[11px] text-muted-foreground">Grok-3, Grok-2 — console.x.ai</p>
                          <Input
                            id="key-grok"
                            type="password"
                            placeholder={aiProviders?.grok ? "••••••••••••••••" : "xai-..."}
                            value={keys.grok}
                            onChange={(e) => setKeys({ ...keys, grok: e.target.value })}
                          />
                        </div>

                        <div className="border-t" />

                        {/* Hugging Face */}
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <Label htmlFor="key-hf" className="font-semibold">Hugging Face</Label>
                            {aiProviders?.huggingface ? (
                              <Badge variant="secondary" className="bg-accent-success/10 text-accent-success border-accent-success/20 gap-1.5 py-0.5 text-[10px]">
                                <CheckCircle className="w-3 h-3" /> Configured
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px] py-0.5 text-muted-foreground">Not set</Badge>
                            )}
                          </div>
                          <p className="text-[11px] text-muted-foreground">
                            Llama 3.x, Mistral, Phi, Falcon via HF Inference API — huggingface.co/settings/tokens
                          </p>
                          <Input
                            id="key-hf"
                            type="password"
                            placeholder={aiProviders?.huggingface ? "••••••••••••••••" : "hf_..."}
                            value={keys.huggingface}
                            onChange={(e) => setKeys({ ...keys, huggingface: e.target.value })}
                          />
                        </div>
                      </CardContent>
                    </Card>

                    {/* ── Section 3: Specialty & Media Services ───────────── */}
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                          <Zap className="w-4 h-4 text-amber-500" /> Specialty & Media Services
                        </CardTitle>
                        <CardDescription>
                          Voice synthesis, image generation, and automation integrations.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-5">
                        {/* ElevenLabs */}
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <Label htmlFor="key-elevenlabs" className="font-semibold">ElevenLabs (TTS)</Label>
                            {aiProviders?.elevenlabs ? (
                              <Badge variant="secondary" className="bg-accent-success/10 text-accent-success border-accent-success/20 gap-1.5 py-0.5 text-[10px]">
                                <CheckCircle className="w-3 h-3" /> Configured
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px] py-0.5 text-muted-foreground">Not set</Badge>
                            )}
                          </div>
                          <p className="text-[11px] text-muted-foreground">High-quality text-to-speech — elevenlabs.io</p>
                          <Input
                            id="key-elevenlabs"
                            type="password"
                            placeholder={aiProviders?.elevenlabs ? "••••••••••••••••" : "sk_..."}
                            value={keys.elevenlabs}
                            onChange={(e) => setKeys({ ...keys, elevenlabs: e.target.value })}
                          />
                        </div>

                        <div className="border-t" />

                        {/* fal.ai */}
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <Label htmlFor="key-falai" className="font-semibold">fal.ai (Image Gen)</Label>
                            {aiProviders?.falai ? (
                              <Badge variant="secondary" className="bg-accent-success/10 text-accent-success border-accent-success/20 gap-1.5 py-0.5 text-[10px]">
                                <CheckCircle className="w-3 h-3" /> Configured
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px] py-0.5 text-muted-foreground">Not set</Badge>
                            )}
                          </div>
                          <p className="text-[11px] text-muted-foreground">FLUX, ControlNet, video generation — fal.ai/dashboard/keys</p>
                          <Input
                            id="key-falai"
                            type="password"
                            placeholder={aiProviders?.falai ? "••••••••••••••••" : "fal-..."}
                            value={keys.falai}
                            onChange={(e) => setKeys({ ...keys, falai: e.target.value })}
                          />
                        </div>

                        <div className="border-t" />

                        {/* Forge API */}
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <Label htmlFor="key-forge" className="font-semibold">Forge API</Label>
                            {aiProviders?.forge ? (
                              <Badge variant="secondary" className="bg-accent-success/10 text-accent-success border-accent-success/20 gap-1.5 py-0.5 text-[10px]">
                                <CheckCircle className="w-3 h-3" /> Configured
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px] py-0.5 text-muted-foreground">Not set</Badge>
                            )}
                          </div>
                          <p className="text-[11px] text-muted-foreground">OpenAI-compatible proxy aggregator — forge.manus.im</p>
                          <Input
                            id="key-forge"
                            type="password"
                            placeholder={aiProviders?.forge ? "••••••••••••••••" : "Bearer ..."}
                            value={keys.forge}
                            onChange={(e) => setKeys({ ...keys, forge: e.target.value })}
                          />
                        </div>
                      </CardContent>
                    </Card>

                    {/* ── Section 4: Local Service URLs ───────────────────── */}
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                          <Globe className="w-4 h-4 text-purple-500" /> Local Service Endpoints
                        </CardTitle>
                        <CardDescription>
                          URLs for local services running on your machine or LAN. No API key required.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-5">
                        {/* n8n */}
                        <div className="space-y-1.5">
                          <Label htmlFor="url-n8n" className="font-semibold">n8n Automation URL</Label>
                          <p className="text-[11px] text-muted-foreground">Workflow automation server — default: http://localhost:5678</p>
                          <Input
                            id="url-n8n"
                            type="url"
                            placeholder="http://localhost:5678"
                            value={n8nUrl}
                            onChange={(e) => setN8nUrl(e.target.value)}
                          />
                        </div>

                        <div className="border-t" />

                        {/* ComfyUI */}
                        <div className="space-y-1.5">
                          <Label htmlFor="url-comfy" className="font-semibold">ComfyUI Host URL</Label>
                          <p className="text-[11px] text-muted-foreground">Stable Diffusion / FLUX image generation node — default: http://127.0.0.1:8188</p>
                          <Input
                            id="url-comfy"
                            type="url"
                            placeholder="http://127.0.0.1:8188"
                            value={comfyUrl}
                            onChange={(e) => setComfyUrl(e.target.value)}
                          />
                        </div>
                      </CardContent>
                    </Card>

                    {/* Save button */}
                    <div className="flex justify-end pt-2">
                      <Button
                        onClick={handleSaveKeys}
                        disabled={saveKeysMutation.isPending}
                        className="gap-2"
                      >
                        {saveKeysMutation.isPending
                          ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</>
                          : <><Save className="w-4 h-4" /> Save API Configuration</>
                        }
                      </Button>
                    </div>

                    <KaggleKeyCard />
                  </div>
                </TabsContent>

                <TabsContent value="wallet">
                  <AgenticWalletPanel />
                </TabsContent>

                <TabsContent value="ommesh">
                  <OMMESHPanel />
                </TabsContent>
                <TabsContent value="devices">
                  <PairDevicePanel />
                </TabsContent>

                <TabsContent value="security">
                  <Card>
                    <CardHeader>
                      <CardTitle>Workstation Hardening</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      <div className="space-y-3">
                        <Label>Execution Mode</Label>
                        <RadioGroup
                          value={selectedMode}
                          onValueChange={(v) => setSelectedMode(v as "sovereign" | "scrapper" | "big_spender")}
                          disabled={isZeroLogin}
                          className={isZeroLogin ? "opacity-60" : undefined}
                        >
                          <div className="flex items-start gap-3 rounded-md border p-3">
                            <RadioGroupItem value="sovereign" id="mode-sovereign" className="mt-0.5" />
                            <div>
                              <Label htmlFor="mode-sovereign" className="font-medium cursor-pointer flex items-center gap-1.5">
                                <Lock className="h-3.5 w-3.5 text-destructive" /> Sovereign
                              </Label>
                              <p className="text-xs text-muted-foreground">Air-gapped lockdown. Cloud AI inference is blocked server-side (and other external services too, unless "block AI providers only" is on below).</p>
                            </div>
                          </div>
                          <div className="flex items-start gap-3 rounded-md border p-3">
                            <RadioGroupItem value="scrapper" id="mode-scrapper" className="mt-0.5" />
                            <div>
                              <Label htmlFor="mode-scrapper" className="font-medium cursor-pointer flex items-center gap-1.5">
                                <Zap className="h-3.5 w-3.5 text-accent-success" /> Scrapper
                              </Label>
                              <p className="text-xs text-muted-foreground">Local-preferred. Ollama runs first; cloud providers available with keys.</p>
                            </div>
                          </div>
                          <div className="flex items-start gap-3 rounded-md border p-3">
                            <RadioGroupItem value="big_spender" id="mode-big-spender" className="mt-0.5" />
                            <div>
                              <Label htmlFor="mode-big-spender" className="font-medium cursor-pointer flex items-center gap-1.5">
                                <Flame className="h-3.5 w-3.5 text-amber-500" /> Big Spender
                              </Label>
                              <p className="text-xs text-muted-foreground">Cloud-first. Prioritizes the highest-capability cloud models regardless of cost.</p>
                            </div>
                          </div>
                        </RadioGroup>
                        {isZeroLogin && (
                          <p className="text-xs text-accent-warning">
                            Zero-login session: the execution mode is fixed by the <code>ZERO_LOGIN_EXECUTION_MODE</code> environment variable and can't be changed here. Set it in <code>.env</code> and restart the server.
                          </p>
                        )}
                        <div className="flex items-start justify-between gap-4 rounded-md border border-accent-danger/30 bg-accent-danger/5 p-3">
                          <div className="space-y-0.5">
                            <Label htmlFor="sovereign-ai-only" className="font-medium">In Sovereign mode, block AI providers only</Label>
                            <p className="text-xs text-muted-foreground">When on, Sovereign blocks only cloud <strong>AI model</strong> calls (OpenAI, Anthropic, Gemini, Fal, voice, training). Non-AI external services — GitHub/Notion/Drive sync, email, web search — keep working so research can continue. When off, Sovereign blocks all external calls (strict air-gap).</p>
                            {!isAdmin && (
                              <p className="text-xs text-accent-warning">Requires an admin or owner account to change.</p>
                            )}
                          </div>
                          <Switch id="sovereign-ai-only" checked={sovereignBlockAiOnly} onCheckedChange={setSovereignBlockAiOnly} disabled={!isAdmin} />
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <Label>Local Encryption</Label>
                          <p className="text-xs text-muted-foreground">Encrypt projects at rest using system TPM.</p>
                        </div>
                        <Switch id="local-encryption" checked={localEncryption} onCheckedChange={setLocalEncryption} />
                      </div>
                      <div className="pt-6 border-t space-y-6">
                        <h3 className="text-lg font-semibold flex items-center gap-2">
                          <ShieldAlert className="w-5 h-5 text-destructive" /> Agent Safety (HITL)
                        </h3>
                        <p className="text-xs text-muted-foreground">Require human-in-the-loop approval before agents perform critical actions.</p>
                        
                        <div className="space-y-4">
                          <div className="flex items-center justify-between">
                            <Label>Command Execution</Label>
                            <Switch checked={hitlCommandExecution} onCheckedChange={setHitlCommandExecution} />
                          </div>
                          <div className="flex items-center justify-between">
                            <Label>File Deletion / Overwrite</Label>
                            <Switch checked={hitlFileDeletion} onCheckedChange={setHitlFileDeletion} />
                          </div>
                          <div className="flex items-center justify-between">
                            <Label>Internet Access</Label>
                            <Switch checked={hitlInternetAccess} onCheckedChange={setHitlInternetAccess} />
                          </div>
                          <div className="flex items-center justify-between">
                            <Label>Financial Transactions</Label>
                            <Switch checked={hitlFinancialTransactions} onCheckedChange={setHitlFinancialTransactions} />
                          </div>
                        </div>
                      </div>

                      <div className="pt-6 border-t space-y-6">
                        <h3 className="text-lg font-semibold">File Security</h3>
                        <div className="flex items-center justify-between">
                          <div className="space-y-0.5">
                            <Label>Malicious File Scan</Label>
                            <p className="text-xs text-muted-foreground">Scan uploaded files for threats.</p>
                          </div>
                          <Switch checked={maliciousFileScan} onCheckedChange={setMaliciousFileScan} />
                        </div>
                        <div className="flex items-center justify-between">
                          <Label>Scan on Upload</Label>
                          <Switch checked={scanOnUpload} onCheckedChange={setScanOnUpload} />
                        </div>
                        <div className="space-y-2">
                          <Label>Blacklisted File Types</Label>
                          <div className="flex flex-wrap gap-2">
                            {['.exe', '.bat', '.sh'].map(type => (
                              <Badge key={type} variant="secondary" className="cursor-pointer">
                                {type}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      </div>
                      <AuditRetentionPanel />

                      <div className="pt-6 border-t space-y-6">
                        <h3 className="text-lg font-semibold">Encryption Settings</h3>
                        <div className="flex items-center justify-between">
                          <Label>Encrypt API Keys</Label>
                          <Switch checked={encryptApiKeys} onCheckedChange={setEncryptApiKeys} />
                        </div>
                        <div className="space-y-2">
                          <Label>Session Timeout (minutes): {sessionTimeout}</Label>
                          <Slider value={[sessionTimeout]} onValueChange={([v]) => setSessionTimeout(v)} min={5} max={480} step={5} />
                        </div>
                      </div>

                      <div className="pt-6 border-t flex justify-end">
                        <Button 
                          onClick={() => {
                            saveSettingsMutation.mutate({
                              settings: {
                                localEncryption,
                                hitlCommandExecution,
                                hitlFileDeletion,
                                hitlInternetAccess,
                                hitlFinancialTransactions,
                                maliciousFileScan,
                                scanOnUpload,
                                encryptApiKeys,
                                sessionTimeout,
                              }
                            });
                            // sovereignBlockAiOnly is admin-gated and persisted via
                            // its own mutation — only fire it when it actually
                            // changed, so a non-admin saving other settings doesn't
                            // hit a FORBIDDEN they didn't ask for.
                            if (sovereignBlockAiOnly !== !!(settings as SavedSettings | undefined)?.sovereignBlockAiOnly) {
                              setSovereignAiOnlyMutation.mutate({ enabled: sovereignBlockAiOnly });
                            }
                            // In zero-login the mode is fixed by the server env
                            // var; firing this would write a value that's instantly
                            // overridden and show a misleading toast.
                            if (!isZeroLogin) setModeMutation.mutate({ mode: selectedMode });
                          }}
                          disabled={setModeMutation.isPending || saveSettingsMutation.isPending}
                          className="gap-2"
                        >
                          <Save className="w-4 h-4" />
                          {(setModeMutation.isPending || saveSettingsMutation.isPending) ? "Saving..." : "Save Security Settings"}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="hardware">
                  <HardwarePanel />
                </TabsContent>

                <TabsContent value="voice">
                  <VoiceMediaPanel />
                </TabsContent>

                <TabsContent value="offline_voices">
                  <OfflineVoicesPanel />
                </TabsContent>

                <TabsContent value="system">
                  <div className="space-y-6">
                    <WorkstationOptimizationPanel />
                    <ContextSettingsPanel />
                    <SystemHealth />
                  </div>
                </TabsContent>

                <TabsContent value="accounts">
                  <div className="space-y-6">
                    <SocialLoginCard />
                    <ServiceConnectionsCard />
                    <ConnectedAccounts loginMethod={me?.loginMethod ?? null} />
                  </div>
                </TabsContent>

                <TabsContent value="valet">
                  <ValetRouterPanel />
                </TabsContent>

                <TabsContent value="appearance">
                  <AppearancePanel />
                </TabsContent>

                <TabsContent value="general">
                  <GeneralPanel />
                </TabsContent>

                <TabsContent value="knowledge">
                  <KnowledgePanel />
                </TabsContent>

                <TabsContent value="privacy">
                  <PrivacyPanel />
                </TabsContent>

                <TabsContent value="advanced">
                  <AdvancedPanel />
                </TabsContent>

                <TabsContent value="cloud">
                  <CloudComputePanel />
                </TabsContent>

                {isAdmin && (
                  <TabsContent value="admin">
                    <div className="space-y-6">
                      <UserManagementPanel />
                      <AuditLogPanel />
                    </div>
                  </TabsContent>
                )}
              </Tabs>
            </div>
          </main>
        </div>
      </div>
    </OmnecorDashboardLayout>
  );
};

const OMMESHPanel: React.FC = () => {
  const utils = trpc.useUtils();
  const { data: identity } = trpc.ommesh.getIdentity.useQuery();
  const { data: peers, isLoading: loadingPeers } = trpc.ommesh.discover.useQuery(undefined, {
    refetchInterval: 5000,
  });

  const approveMutation = trpc.ommesh.approvePeer.useMutation({
    onSuccess: () => {
      toast.success("Peer approved and linked to mesh");
      utils.ommesh.discover.invalidate();
    },
    onError: (e) => toast.error(`Approval failed: ${e.message}`),
  });

  const rotateMutation = trpc.ommesh.rotateCert.useMutation({
    onSuccess: () => {
      toast.success("Security certificates rotated successfully");
      utils.ommesh.getIdentity.invalidate();
    },
    onError: (e) => toast.error(`Rotation failed: ${e.message}`),
  });

  const { data: ommeshSettings, refetch: refetchOmmesh } = trpc.system.getSettings.useQuery();
  const saveOmmeshMutation = trpc.system.saveSettings.useMutation({
    onSuccess: () => { toast.success("OMMESH config saved"); refetchOmmesh(); },
    onError: (e) => toast.error(e.message),
  });
  const [offloadLatency, setOffloadLatency] = React.useState(150);
  const [poolVram, setPoolVram] = React.useState(false);
  React.useEffect(() => {
    if (ommeshSettings) {
      const s = ommeshSettings as SavedSettings;
      setOffloadLatency(s.offloadLatency ?? 150);
      setPoolVram(!!s.poolVram);
    }
  }, [ommeshSettings]);

  return (
    <div className="space-y-6">
      {/* Node Identity */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Shield className="w-4 h-4 text-accent" /> Local Node Identity
          </CardTitle>
          <CardDescription>Your node's unique signature on the Neural Mesh.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="p-3 rounded-lg bg-muted/50 border">
              <p className="text-[10px] uppercase font-bold text-muted-foreground mb-1">Node Name</p>
              <p className="font-mono text-sm">{identity?.hostname || "Detecting..."}</p>
            </div>
            <div className="p-3 rounded-lg bg-muted/50 border">
              <p className="text-[10px] uppercase font-bold text-muted-foreground mb-1">Status</p>
              <Badge variant="outline" className="bg-accent-success/10 text-accent-success border-accent-success/20 gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-accent-success animate-pulse" />
                Active
              </Badge>
            </div>
          </div>
          <div className="p-3 rounded-lg bg-muted/50 border">
            <div className="flex items-center justify-between mb-1">
              <p className="text-[10px] uppercase font-bold text-muted-foreground">Certificate Fingerprint</p>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-4 w-4" 
                onClick={() => {
                  navigator.clipboard.writeText(identity?.fingerprint || "");
                  toast.success("Fingerprint copied");
                }}
              >
                <Copy className="w-3 h-3" />
              </Button>
            </div>
            <p className="font-mono text-[10px] break-all">{identity?.fingerprint || "---"}</p>
          </div>
          <div className="pt-2">
            <Button 
              variant="outline" 
              size="sm" 
              className="gap-2" 
              onClick={() => rotateMutation.mutate({ force: true })}
              disabled={rotateMutation.isPending}
            >
              <RefreshCw className={cn("w-3 h-3", rotateMutation.isPending && "animate-spin")} />
              Rotate Mesh Certificates
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Peer Discovery */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Neural Mesh Discovery</CardTitle>
              <CardDescription>Authorize other nodes to pool VRAM and process tasks.</CardDescription>
            </div>
            {loadingPeers && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
            {(!peers || peers.length === 0) ? (
              <div className="p-8 text-center border-2 border-dashed rounded-xl bg-muted/20">
                <Globe className="w-8 h-8 mx-auto mb-2 opacity-20" />
                <p className="text-sm font-medium">Scanning for local peers...</p>
                <p className="text-xs text-muted-foreground">Make sure other Omnecor nodes are on the same WiFi/LAN.</p>
              </div>
            ) : (
              (peers as unknown as DisplayPeer[]).map((peer) => (
                <div key={peer.id} className="flex items-center justify-between p-4 rounded-xl border bg-card/50 transition-all hover:border-accent/30">
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="p-2 rounded-full bg-accent/10 flex-shrink-0">
                      <Server className="w-5 h-5 text-accent" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-bold text-sm truncate">{peer.name}</p>
                        {peer.isApproved ? (
                          <Badge variant="secondary" className="bg-accent-cyan/10 text-accent-cyan text-[10px] h-4 px-1.5">Linked</Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] h-4 px-1.5">Pending</Badge>
                        )}
                      </div>
                      <p className="text-[10px] font-mono text-muted-foreground truncate">{peer.address}:{peer.port}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {!peer.isApproved ? (
                      <Button 
                        size="sm" 
                        className="bg-accent text-accent-foreground hover:bg-accent/90 gap-1.5 h-8"
                        onClick={() => approveMutation.mutate({ fingerprint: peer.fingerprint })}
                        disabled={approveMutation.isPending}
                      >
                        <Zap className="w-3.5 h-3.5" />
                        Authorize
                      </Button>
                    ) : (
                      <Button variant="ghost" size="sm" className="h-8 text-muted-foreground" disabled>
                        <CheckCircle2 className="w-4 h-4 mr-1.5" />
                        Active
                      </Button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      {/* Advanced Routing */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base text-sm">Distributed Inference Rules</CardTitle>
          <CardDescription>Control how tasks are offloaded to the mesh.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-xs">Offload Latency Threshold (ms): {offloadLatency}ms</Label>
            <Slider value={[offloadLatency]} onValueChange={([v]) => setOffloadLatency(v)} min={10} max={500} step={10} />
            <p className="text-[10px] text-muted-foreground italic">Tasks are only offloaded if peer latency is below this limit.</p>
          </div>
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-sm">Pool Local VRAM</Label>
              <p className="text-[10px] text-muted-foreground">Allow other nodes to use this workstation's idle GPU.</p>
            </div>
            <Switch checked={poolVram} onCheckedChange={setPoolVram} />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end pt-2">
        <Button
          onClick={() => saveOmmeshMutation.mutate({ settings: { offloadLatency, poolVram } })}
          disabled={saveOmmeshMutation.isPending}
          className="gap-2"
        >
          <Save className="w-4 h-4" /> {saveOmmeshMutation.isPending ? "Saving..." : "Save OMMESH Config"}
        </Button>
      </div>
    </div>
  );
};

const VoiceMediaPanel: React.FC = () => {
  const { data: settings, refetch } = trpc.system.getSettings.useQuery();
  const saveMutation = trpc.system.saveSettings.useMutation({
    onSuccess: () => {
      toast.success("Voice & Media settings saved successfully");
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const [sttModel, setSttModel] = useState("base");
  const [ttsEngine, setTtsEngine] = useState("local");
  const [comfyUrl, setComfyUrl] = useState("");

  useEffect(() => {
    if (settings) {
      const s = settings as SavedSettings;
      setSttModel(s.sttModel || "base");
      setTtsEngine(s.ttsEngine || "local");
      setComfyUrl(s.comfyUrl || "");
    }
  }, [settings]);

  const handleSave = () => {
    saveMutation.mutate({
      settings: {
        sttModel,
        ttsEngine,
        comfyUrl,
      },
    });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Speech Engines</CardTitle>
          <CardDescription>Configure STT and TTS providers.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>STT Model (Whisper)</Label>
            <Select value={sttModel} onValueChange={setSttModel}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="tiny">Tiny (Fastest)</SelectItem>
                <SelectItem value="base">Base (Balanced)</SelectItem>
                <SelectItem value="medium">Medium (Accurate)</SelectItem>
                <SelectItem value="large">Large (Best)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>TTS Engine</Label>
            <Select value={ttsEngine} onValueChange={setTtsEngine}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="local">Local (XTTS-v2)</SelectItem>
                <SelectItem value="elevenlabs">ElevenLabs (Cloud)</SelectItem>
                <SelectItem value="openai">OpenAI (Cloud)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Media Servers</CardTitle>
          <CardDescription>External media generation hosts.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>ComfyUI Host URL</Label>
            <Input placeholder="http://127.0.0.1:8188" value={comfyUrl} onChange={e => setComfyUrl(e.target.value)} />
          </div>
        </CardContent>
      </Card>
      <div className="flex justify-end pt-2">
        <Button onClick={handleSave} disabled={saveMutation.isPending} className="gap-2">
          <Save className="w-4 h-4" /> {saveMutation.isPending ? "Saving..." : "Save Voice & Media Settings"}
        </Button>
      </div>
    </div>
  );
};

const OfflineVoicesPanel: React.FC = () => {
  const { data: offlineVoices, refetch } = trpc.voice.listOfflineVoices.useQuery();
  const downloadMutation = trpc.voice.downloadVoice.useMutation({
    onSuccess: (res) => {
      toast.success(res.message || "Download started");
      refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const jobsQuery = trpc.jobs.list.useQuery(undefined, { refetchInterval: 3000 });
  const activeDownloads = (jobsQuery.data?.jobs ?? []).filter(j => j.state === "running" && j.label?.startsWith("Download Voice"));

  const availableVoices = [
    { id: "kokoro", name: "Kokoro 82M ONNX", desc: "Super lightweight & ultra-fast local TTS engine model (Kokoro v1.0)", url: "https://huggingface.co/hexgrad/Kokoro-82M/resolve/main/kokoro-v1.0.onnx" },
    { id: "xtts", name: "XTTS v2 Multilingual Model", desc: "High-quality local cloned speech synthesis weights (XTTS-v2)", url: "https://huggingface.co/coqui/XTTS-v2/resolve/main/model.pth" },
    { id: "assistant_voice", name: "Assistant Reference Profile (WAV)", desc: "Reference voice file for local cloning", url: "https://github.com/coqui-ai/TTS/raw/main/tests/data/ljspeech/wavs/LJ001-0001.wav" },
  ];

  const getFilenameFromUrl = (url: string) => {
    try {
      return url.substring(url.lastIndexOf('/') + 1);
    } catch {
      return "model.onnx";
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Downloaded Offline Voices</CardTitle>
          <CardDescription>Local voice models and speaker reference profiles cached in data/voices/.</CardDescription>
        </CardHeader>
        <CardContent>
          {offlineVoices && offlineVoices.length > 0 ? (
            <div className="space-y-2">
              {offlineVoices.map((v, idx) => (
                <div key={idx} className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
                  <div className="flex items-center gap-2">
                    <Mic2 className="w-4 h-4 text-accent" />
                    <div>
                      <p className="text-sm font-semibold">{v.name}</p>
                      <p className="text-xs text-muted-foreground truncate max-w-lg">{v.path}</p>
                    </div>
                  </div>
                  <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20">Active</Badge>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-6 text-sm text-muted-foreground">
              No offline voices downloaded yet. Select a model below to install it.
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Available Local Voices & Models</CardTitle>
          <CardDescription>Install local models and references to run voice generation completely offline.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {availableVoices.map((v) => {
            const isDownloading = activeDownloads.some(j => j.label?.includes(v.name));
            const filename = getFilenameFromUrl(v.url);
            const isDownloaded = offlineVoices?.some(ov => ov.name === filename || ov.name === `${filename}.wav`);

            return (
              <div key={v.id} className="flex items-center justify-between p-4 rounded-xl border bg-card hover:border-accent/30 transition-all">
                <div className="space-y-1">
                  <p className="text-sm font-semibold">{v.name}</p>
                  <p className="text-xs text-muted-foreground">{v.desc}</p>
                </div>
                <Button
                  size="sm"
                  onClick={() => downloadMutation.mutate({ voiceUrl: v.url, voiceName: filename.replace(/\.[^/.]+$/, "") })}
                  disabled={isDownloading || isDownloaded || downloadMutation.isPending}
                  className="gap-1.5"
                >
                  {isDownloading ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Downloading...
                    </>
                  ) : isDownloaded ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
                      Installed
                    </>
                  ) : (
                    <>
                      <Download className="w-3.5 h-3.5" />
                      Download
                    </>
                  )}
                </Button>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Kaggle API key card
// ---------------------------------------------------------------------------

function KaggleKeyCard() {
  const [username, setUsername] = useState("");
  const [apiKey, setApiKey] = useState("");
  const statusQuery = trpc.training.kaggleStatus.useQuery(undefined, { refetchOnWindowFocus: false });

  const saveMutation = trpc.training.saveKaggleKey.useMutation({
    onSuccess: () => {
      toast.success("Kaggle API key saved");
      setApiKey("");
      statusQuery.refetch();
    },
    onError: (e) => toast.error("Failed to save Kaggle key: " + e.message),
  });

  const isConnected = statusQuery.data?.connected;
  const connectedAs = statusQuery.data?.username;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Download className="w-4 h-4 text-primary" />
          Kaggle — Free GPU Training
          {isConnected
            ? <Badge className="ml-auto bg-green-600 text-white border-transparent text-xs"><CheckCircle2 className="w-3 h-3 mr-1" />Connected as {connectedAs}</Badge>
            : <Badge variant="secondary" className="ml-auto text-xs"><AlertCircle className="w-3 h-3 mr-1" />Not connected</Badge>
          }
        </CardTitle>
        <CardDescription>
          Train custom AI models on a free Kaggle GPU (T4/P100, 16 GB VRAM) — no credit card.
          Used by the Valet Router trainer for machines with weak or no GPU.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md bg-accent-cyan/5 border border-accent-cyan/20 px-4 py-3 text-xs text-accent-cyan space-y-1">
          <p className="font-medium">How to get your Kaggle API key (2 min):</p>
          <ol className="list-decimal list-inside space-y-0.5 text-accent-cyan/80">
            <li>Create a free account at <span className="font-mono">kaggle.com</span></li>
            <li>Go to <span className="font-mono">kaggle.com/settings</span> → Phone Verification → verify your phone (required for GPU)</li>
            <li>Still in Settings → API section → click <strong>Create New Token</strong> → <span className="font-mono">kaggle.json</span> downloads</li>
            <li>Open that file and paste the <span className="font-mono">username</span> and <span className="font-mono">key</span> below</li>
          </ol>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="kaggle-username">Kaggle Username</Label>
            <Input id="kaggle-username" placeholder="your-kaggle-username" value={username}
              onChange={e => setUsername(e.target.value)} autoComplete="off" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="kaggle-key">Kaggle API Key</Label>
            <Input id="kaggle-key" type="password" placeholder="Paste key from kaggle.json"
              value={apiKey} onChange={e => setApiKey(e.target.value)} autoComplete="off" />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button size="sm" disabled={!username || !apiKey || saveMutation.isPending}
            onClick={() => saveMutation.mutate({ username, key: apiKey })}>
            {saveMutation.isPending ? "Saving…" : isConnected ? "Update Key" : "Connect Kaggle"}
          </Button>
          {isConnected && (
            <p className="text-xs text-muted-foreground">
              Connected. Go to <strong>Settings → Valet Router</strong> to train on Kaggle GPU.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

const THEME_OPTIONS: { value: Theme; label: string; icon: React.ReactNode }[] = [
  { value: "dark", label: "Dark", icon: <Moon className="h-5 w-5" /> },
  { value: "light", label: "Light", icon: <Sun className="h-5 w-5" /> },
];

const AppearancePanel: React.FC = () => {
  const { theme, setTheme } = useTheme();
  const { data: settings, refetch } = trpc.system.getSettings.useQuery();
  const saveMutation = trpc.system.saveSettings.useMutation({
    onSuccess: () => {
      toast.success("Appearance settings saved successfully");
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const [fontSize, setFontSize] = useState(getStoredFontSize);

  // Live-apply the font size to the document root as the slider moves so the
  // user sees the change immediately; persist it so it survives a reload.
  const handleFontSizeChange = (size: number) => {
    setFontSize(size);
    applyFontSize(size);
  };

  useEffect(() => {
    if (settings) {
      const s = settings as SavedSettings;
      const nextFontSize = s.fontSize || getStoredFontSize();
      setFontSize(nextFontSize);
      applyFontSize(nextFontSize);
    }
  }, [settings]);

  const handleSave = () => {
    saveMutation.mutate({
      settings: {
        fontSize,
      },
    });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Monitor className="w-4 h-4" /> Theme</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 max-w-md">
            {THEME_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setTheme(opt.value)}
                className={cn(
                  "flex flex-col items-center gap-2 rounded-lg border-2 p-4 text-sm font-medium transition-colors",
                  theme === opt.value ? "border-primary bg-primary/10 text-primary" : "border-border bg-background"
                )}
              >
                {opt.icon}
                <span>{opt.label}</span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Display Preferences</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between max-w-md">
            <div className="space-y-0.5">
              <Label>Global "How To" Tooltips</Label>
              <p className="text-xs text-muted-foreground">Show detailed explanations when hovering over UI elements</p>
            </div>
            <Switch 
              checked={useAppStore(s => s.showTooltips)} 
              onCheckedChange={useAppStore(s => s.setShowTooltips)} 
            />
          </div>
          <div className="space-y-2 max-w-md pt-2">
            <Label>Font Size (px): {fontSize}</Label>
            <Slider value={[fontSize]} onValueChange={([v]) => handleFontSizeChange(v)} min={12} max={18} step={1} />
          </div>
        </CardContent>
      </Card>
      <div className="flex justify-end pt-2">
        <Button onClick={handleSave} disabled={saveMutation.isPending} className="gap-2">
          <Save className="w-4 h-4" /> {saveMutation.isPending ? "Saving..." : "Save Appearance Settings"}
        </Button>
      </div>
    </div>
  );
};

const WorkstationOptimizationPanel: React.FC = () => {
  const { data: settings, refetch } = trpc.system.getSettings.useQuery();
  const saveMutation = trpc.system.saveSettings.useMutation({
    onSuccess: () => { toast.success("Settings saved"); refetch(); },
    onError: (err) => toast.error("Failed to save: " + err.message),
  });
  const applyMutation = trpc.system.applyOptimizations.useMutation({
    onSuccess: () => toast.success("Optimizations applied"),
    onError: (err) => toast.error("Failed to apply: " + err.message),
  });

  const [local, setLocal] = useState({ gpuBypass: false, zramEnabled: false, zramSizeGB: 4 });
  useEffect(() => { if (settings) setLocal(prev => ({ ...prev, ...settings })); }, [settings]);

  const toggle = (key: string, val: boolean) => {
    const next = { ...local, [key]: val };
    setLocal(next);
    saveMutation.mutate({ settings: next });
  };

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><Zap className="w-4 h-4 text-amber-500" /> Optimization</CardTitle></CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between">
          <Label>GPU Bypass</Label>
          <Switch checked={local.gpuBypass} onCheckedChange={(v) => toggle("gpuBypass", v)} />
        </div>
        <div className="flex items-center justify-between">
          <Label>ZRAM Enabled</Label>
          <Switch checked={local.zramEnabled} onCheckedChange={(v) => toggle("zramEnabled", v)} />
        </div>
        <Button variant="outline" className="w-full" onClick={() => applyMutation.mutate()} disabled={applyMutation.isPending}>Apply Changes</Button>
      </CardContent>
    </Card>
  );
};

const ContextSettingsPanel: React.FC = () => {
  const [ctx, setCtx] = useState(() => advancedSettings.getSettings().contextLimit);
  const apply = (p: Partial<typeof ctx>) => {
    const next = { ...ctx, ...p };
    setCtx(next);
    advancedSettings.updateSettings({ contextLimit: next });
  };
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><Zap className="w-4 h-4" /> Context Window</CardTitle></CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label>Max Context Tokens: {ctx.maxContextTokens.toLocaleString()}</Label>
          <Slider min={4000} max={128000} step={1000} value={[ctx.maxContextTokens]} onValueChange={([v]) => apply({ maxContextTokens: v })} />
        </div>
      </CardContent>
    </Card>
  );
};

const SystemHealth: React.FC = () => {
  const q = trpc.system.health.useQuery(undefined, { refetchInterval: 10000 });
  return (
    <Card className="border-none bg-muted/30">
      <CardHeader><CardTitle className="text-sm font-bold flex items-center gap-2"><Bell className="w-4 h-4" /> Monitor</CardTitle></CardHeader>
      <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-4 pb-6">
        <div className="p-4 bg-background border rounded-lg">
          <p className="text-[10px] font-bold text-muted-foreground uppercase">CPU</p>
          <p className="text-lg font-mono">{q.data?.cpu.percent || 0}%</p>
        </div>
        <div className="p-4 bg-background border rounded-lg">
          <p className="text-[10px] font-bold text-muted-foreground uppercase">Ollama</p>
          <p className="text-lg font-mono">{q.data?.ollama.status || "..."}</p>
        </div>
        <div className="p-4 bg-background border rounded-lg">
          <p className="text-[10px] font-bold text-muted-foreground uppercase">ChromaDB</p>
          <p className="text-lg font-mono">{q.data?.chromadb.status || "..."}</p>
        </div>
      </CardContent>
    </Card>
  );
};

const HardwarePanel: React.FC = () => {
  const utils = trpc.useUtils();
  const detectHardwareMutation = trpc.system.detectHardware.useMutation({
    onSuccess: () => {
      toast.success("Hardware profile updated");
      utils.system.getSettings.invalidate();
      gpuStatusQuery.refetch();
    },
    onError: (err) => toast.error("Hardware detection failed: " + err.message),
  });

  const { data: settings, refetch } = trpc.system.getSettings.useQuery();
  const gpuStatusQuery = trpc.valet.gpuStatus.useQuery();
  const mlVenvQuery = trpc.valet.mlVenvStatus.useQuery();

  const saveMutation = trpc.system.saveSettings.useMutation({
    onSuccess: () => {
      toast.success("Hardware settings saved successfully");
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  // ESP Tooling
  const { data: espPorts } = trpc.esp.detectPorts.useQuery(undefined, { refetchInterval: 5000 });
  const [selectedPort, setSelectedPort] = useState<string>("");
  const chipInfoMutation = trpc.esp.getChipInfo.useMutation({
    onSuccess: (info) => toast.success(`Chip: ${info.chipType}, MAC: ${info.macAddress}`),
    onError: (e) => toast.error(`Port Error: ${e.message}`),
  });
  const flashMutation = trpc.esp.flash.useMutation({
    onSuccess: () => toast.success("Flash job queued"),
    onError: (err) => toast.error("Flash failed: " + err.message),
  });
  const eraseMutation = trpc.esp.erase.useMutation({
    onSuccess: () => toast.success("Erase job queued"),
    onError: (err) => toast.error("Erase failed: " + err.message),
  });

  const [vram, setVram] = useState(8);
  const [cpuThreads, setCpuThreads] = useState(4);
  const [inferenceTimeout, setInferenceTimeout] = useState(300);
  const [autoRestart, setAutoRestart] = useState(true);

  useEffect(() => {
    if (settings) {
      const s = settings as SavedSettings;
      setVram(s.vram || 8);
      setCpuThreads(s.cpuThreads || 4);
      setInferenceTimeout(s.inferenceTimeout || 300);
      setAutoRestart(s.autoRestart !== false);
    }
  }, [settings]);

  const handleSave = () => {
    saveMutation.mutate({
      settings: {
        vram,
        cpuThreads,
        inferenceTimeout,
        autoRestart,
      },
    });
  };

  return (
    <div className="space-y-6 pb-20">
      {/* GPU & ML Acceleration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-amber-500" /> GPU Acceleration
          </CardTitle>
          <CardDescription>Detected hardware and environment status for local inference.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 rounded-xl border bg-muted/30">
              <p className="text-[10px] font-bold text-muted-foreground uppercase mb-1">Detected GPU</p>
              <p className="font-bold text-sm truncate">{gpuStatusQuery.data?.name || "None"}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {gpuStatusQuery.data?.vramMb ? `${(gpuStatusQuery.data.vramMb / 1024).toFixed(1)} GB VRAM` : "No VRAM info"}
              </p>
            </div>
            <div className="p-4 rounded-xl border bg-muted/30">
              <p className="text-[10px] font-bold text-muted-foreground uppercase mb-1">Training Venv</p>
              <div className="flex items-center gap-2">
                <div className={cn("w-2 h-2 rounded-full", mlVenvQuery.data?.installed ? "bg-accent-success" : "bg-destructive")} />
                <p className="font-bold text-sm">{mlVenvQuery.data?.installed ? "Ready" : "Missing"}</p>
              </div>
              <p className="text-xs text-muted-foreground mt-1 truncate">{mlVenvQuery.data?.path || "Not installed"}</p>
            </div>
          </div>

          <Button 
            variant="outline" 
            onClick={() => detectHardwareMutation.mutate()} 
            disabled={detectHardwareMutation.isPending} 
            className="w-full gap-2"
          >
            {detectHardwareMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Activity className="w-4 h-4" />}
            Refresh Hardware Profile
          </Button>

          <div className="space-y-4 pt-4 border-t">
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label className="text-sm font-semibold">Max VRAM Allocation</Label>
                <Badge variant="secondary" className="font-mono">{vram}GB</Badge>
              </div>
              <Slider value={[vram]} onValueChange={([v]) => setVram(v)} min={2} max={48} step={1} />
              <p className="text-[10px] text-muted-foreground italic">Limits memory used by Ollama/Local backends. Recommended: Total VRAM - 2GB.</p>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label className="text-sm font-semibold">CPU Thread Limit</Label>
                <Badge variant="secondary" className="font-mono">{cpuThreads}</Badge>
              </div>
              <Slider value={[cpuThreads]} onValueChange={([v]) => setCpuThreads(v)} min={1} max={32} step={1} />
              <p className="text-[10px] text-muted-foreground italic">Number of logical cores to use for non-GPU inference tasks.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Microcontroller Tools */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Usb className="w-5 h-5 text-accent-cyan" /> Neural-Link Hardware
          </CardTitle>
          <CardDescription>Manage connected ESP32 microcontrollers and sensors.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label>Active Serial Port</Label>
            <div className="flex gap-2">
              <Select value={selectedPort} onValueChange={setSelectedPort}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Select Device" />
                </SelectTrigger>
                <SelectContent>
                  {espPorts?.map((p) => (
                    <SelectItem key={p.path} value={p.path}>{p.path}</SelectItem>
                  ))}
                  {(!espPorts || espPorts.length === 0) && (
                    <SelectItem value="none" disabled>No devices found</SelectItem>
                  )}
                </SelectContent>
              </Select>
              <Button 
                variant="outline" 
                size="icon" 
                onClick={() => chipInfoMutation.mutate({ port: selectedPort })}
                disabled={!selectedPort || chipInfoMutation.isPending}
              >
                <Search className="w-4 h-4" />
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Button 
              variant="outline" 
              className="gap-2 border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
              onClick={() => {
                if (window.confirm("Erase all flash memory? This cannot be undone.")) {
                  eraseMutation.mutate({ port: selectedPort });
                }
              }}
              disabled={!selectedPort || eraseMutation.isPending}
            >
              <Trash2 className="w-4 h-4" /> Erase Flash
            </Button>
            <Button 
              className="gap-2 bg-blue-600 hover:bg-blue-700 text-white border-none"
              onClick={() => flashMutation.mutate({ port: selectedPort, firmwarePath: "bin/neural_link_v1.bin" })}
              disabled={!selectedPort || flashMutation.isPending}
            >
              <Upload className="w-4 h-4" /> Flash Firmware
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Service Control</CardTitle>
          <CardDescription>Backend service lifecycle settings</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Inference Timeout (seconds)</Label>
            <Input type="number" value={inferenceTimeout} onChange={e => setInferenceTimeout(parseInt(e.target.value) || 300)} className="max-w-[120px]" />
          </div>
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Auto-Restart Services</Label>
              <p className="text-xs text-muted-foreground">Restart crashed local backends automatically</p>
            </div>
            <Switch checked={autoRestart} onCheckedChange={setAutoRestart} />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end pt-2">
        <Button onClick={handleSave} disabled={saveMutation.isPending} className="gap-2">
          <Save className="w-4 h-4" /> {saveMutation.isPending ? "Saving..." : "Save Hardware Settings"}
        </Button>
      </div>
    </div>
  );
};
// ---------------------------------------------------------------------------
// Service Connections (System B) — OAuth client credentials for the
// integrations that power Drive/OneDrive, YouTube, Gmail send and social
// publishing. Independent of the Google/Microsoft *login* clients above.
// ---------------------------------------------------------------------------

interface IntegrationProvider {
  /** Provider key as used by oauthClients.ts / integrationsStatus.configured. */
  platform: string;
  label: string;
  /** Settings keys the credentials are persisted under (must match server). */
  idKey: string;
  secretKey: string;
}

// Source-of-truth pair: keep this list in sync with PROVIDER_CREDENTIALS in
// server/oauth/oauthClients.ts (same platform keys + settings-key names).
const INTEGRATION_PROVIDERS: IntegrationProvider[] = [
  { platform: "youtube", label: "YouTube", idKey: "youtubeClientId", secretKey: "youtubeClientSecret" },
  { platform: "gmail", label: "Gmail (send)", idKey: "gmailClientId", secretKey: "gmailClientSecret" },
  { platform: "google_drive", label: "Google Drive", idKey: "googleDriveClientId", secretKey: "googleDriveClientSecret" },
  { platform: "onedrive", label: "OneDrive", idKey: "oneDriveClientId", secretKey: "oneDriveClientSecret" },
  { platform: "dropbox", label: "Dropbox", idKey: "dropboxClientId", secretKey: "dropboxClientSecret" },
  { platform: "twitter", label: "X / Twitter", idKey: "twitterClientId", secretKey: "twitterClientSecret" },
  { platform: "linkedin", label: "LinkedIn", idKey: "linkedinClientId", secretKey: "linkedinClientSecret" },
  { platform: "facebook", label: "Facebook", idKey: "facebookClientId", secretKey: "facebookClientSecret" },
  { platform: "instagram", label: "Instagram", idKey: "instagramClientId", secretKey: "instagramClientSecret" },
  { platform: "tiktok", label: "TikTok", idKey: "tiktokClientId", secretKey: "tiktokClientSecret" },
];

const ServiceConnectionsCard: React.FC = () => {
  const { data: me } = trpc.auth.me.useQuery();
  const isAdmin = me?.role === "admin" || me?.role === "owner";
  const { data: status, refetch } = trpc.system.integrationsStatus.useQuery();
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const saveKeysMut = trpc.system.saveKeys.useMutation({
    onSuccess: () => {
      toast.success("Service connection credentials saved");
      setInputs({});
      refetch();
    },
    onError: (e) => toast.error("Failed to save: " + e.message),
  });

  const callbackBase = status?.callbackBase ?? "";

  const handleCopy = (text: string) =>
    navigator.clipboard.writeText(text).then(() => toast.success("Redirect URI copied"));

  const handleSave = () => {
    const keys: Record<string, string> = {};
    for (const [k, v] of Object.entries(inputs)) {
      if (v.trim()) keys[k] = v.trim();
    }
    if (Object.keys(keys).length === 0) {
      toast.error("Nothing to save — enter at least one credential");
      return;
    }
    saveKeysMut.mutate({ keys });
  };

  const hasInput = Object.values(inputs).some((v) => v.trim().length > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Share2 className="w-4 h-4 text-accent" /> Service Connections
        </CardTitle>
        <CardDescription>
          Optional. To connect Drive / OneDrive / Dropbox, post to social platforms, upload to YouTube,
          or send mail via Gmail, register an OAuth app for each provider and paste its client ID and
          secret below. Stored locally in <span className="font-mono">~/.omnecor/settings.json</span>,
          never committed. Then connect an account from the Integrations page.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {callbackBase && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Register this redirect URI with every provider (append the provider key)
            </p>
            <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
              <span className="text-[11px] font-mono flex-1 break-all text-foreground/80">
                {callbackBase}/&lt;provider&gt;
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 flex-shrink-0"
                onClick={() => handleCopy(callbackBase)}
              >
                <Copy className="w-3 h-3" />
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              e.g. <span className="font-mono">{callbackBase}/youtube</span>,{" "}
              <span className="font-mono">{callbackBase}/gmail</span>
            </p>
          </div>
        )}

        <div className="border-t" />

        <div className="space-y-5">
          {INTEGRATION_PROVIDERS.map((p) => {
            const configured = status?.configured?.[p.platform];
            return (
              <div key={p.platform} className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">{p.label}</p>
                  {configured ? (
                    <Badge variant="secondary" className="gap-1.5 py-0.5 px-2 text-accent">
                      <CheckCircle className="w-3 h-3" /> Configured
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="gap-1.5 py-0.5 px-2 text-muted-foreground">
                      <Circle className="w-3 h-3" /> Not configured
                    </Badge>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Input
                    aria-label={`${p.label} client ID`}
                    placeholder={configured ? "•••••••• (set)" : "Client ID"}
                    value={inputs[p.idKey] ?? ""}
                    onChange={(e) => setInputs({ ...inputs, [p.idKey]: e.target.value })}
                    disabled={!isAdmin}
                    autoComplete="off"
                  />
                  <Input
                    aria-label={`${p.label} client secret`}
                    type="password"
                    placeholder={configured ? "•••••••• (set)" : "Client secret"}
                    value={inputs[p.secretKey] ?? ""}
                    onChange={(e) => setInputs({ ...inputs, [p.secretKey]: e.target.value })}
                    disabled={!isAdmin}
                    autoComplete="off"
                  />
                </div>
              </div>
            );
          })}
        </div>

        {isAdmin ? (
          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={!hasInput || saveKeysMut.isPending} className="gap-2">
              <Save className="w-4 h-4" />
              {saveKeysMut.isPending ? "Saving..." : "Save Connections"}
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-right">
            Admin or Owner role required to change service-connection credentials.
          </p>
        )}
      </CardContent>
    </Card>
  );
};

// ---------------------------------------------------------------------------
// Social Login (OAuth) card — operator pastes their own OAuth credentials
// ---------------------------------------------------------------------------

const SocialLoginCard: React.FC = () => {
  const { data: oauthStatus, refetch: refetchOauthStatus } = trpc.system.oauthStatus.useQuery();
  const saveKeysMut = trpc.system.saveKeys.useMutation({
    onSuccess: () => {
      toast.success("Social login credentials saved");
      setOauthInputs({ googleClientId: "", googleClientSecret: "", microsoftClientId: "", microsoftClientSecret: "" });
      refetchOauthStatus();
    },
    onError: (e) => toast.error("Failed to save: " + e.message),
  });

  const [oauthInputs, setOauthInputs] = useState({
    googleClientId: "",
    googleClientSecret: "",
    microsoftClientId: "",
    microsoftClientSecret: "",
  });
  const [howToOpen, setHowToOpen] = useState(false);

  const googleRedirectUri = `${window.location.origin}/api/oauth/google/callback`;
  const microsoftRedirectUri = `${window.location.origin}/api/oauth/microsoft/callback`;

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => toast.success(`${label} copied to clipboard`));
  };

  const handleSave = () => {
    const keys: Record<string, string> = {};
    if (oauthInputs.googleClientId.trim()) keys.googleClientId = oauthInputs.googleClientId.trim();
    if (oauthInputs.googleClientSecret.trim()) keys.googleClientSecret = oauthInputs.googleClientSecret.trim();
    if (oauthInputs.microsoftClientId.trim()) keys.microsoftClientId = oauthInputs.microsoftClientId.trim();
    if (oauthInputs.microsoftClientSecret.trim()) keys.microsoftClientSecret = oauthInputs.microsoftClientSecret.trim();
    saveKeysMut.mutate({ keys });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Globe className="w-4 h-4 text-accent-cyan" /> Social Login (OAuth)
        </CardTitle>
        <CardDescription>
          Optional. Local accounts work with no setup. To enable Google / Microsoft sign-in for all your devices
          (desktop + Omnecor HQ app), register an OAuth app and paste the credentials below — they're stored
          locally, never committed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">

        {/* Status badges */}
        <div className="flex flex-wrap gap-3">
          {oauthStatus?.google ? (
            <Badge variant="secondary" className="bg-accent-success/10 text-accent-success border-accent-success/20 gap-1.5 py-1 px-2.5">
              <CheckCircle className="w-3 h-3" /> Google: Configured
            </Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground gap-1.5 py-1 px-2.5">
              <Circle className="w-3 h-3" /> Google: Not configured
            </Badge>
          )}
          {oauthStatus?.microsoft ? (
            <Badge variant="secondary" className="bg-accent-success/10 text-accent-success border-accent-success/20 gap-1.5 py-1 px-2.5">
              <CheckCircle className="w-3 h-3" /> Microsoft: Configured
            </Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground gap-1.5 py-1 px-2.5">
              <Circle className="w-3 h-3" /> Microsoft: Not configured
            </Badge>
          )}
        </div>

        {/* Redirect URIs */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Add these redirect URIs in the Google Cloud / Azure console
          </p>
          <div className="space-y-2">
            <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
              <span className="text-[11px] font-mono flex-1 break-all text-foreground/80">{googleRedirectUri}</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 flex-shrink-0"
                onClick={() => handleCopy(googleRedirectUri, "Google redirect URI")}
              >
                <Copy className="w-3 h-3" />
              </Button>
            </div>
            <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
              <span className="text-[11px] font-mono flex-1 break-all text-foreground/80">{microsoftRedirectUri}</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 flex-shrink-0"
                onClick={() => handleCopy(microsoftRedirectUri, "Microsoft redirect URI")}
              >
                <Copy className="w-3 h-3" />
              </Button>
            </div>
          </div>
        </div>

        <div className="border-t" />

        {/* Google credentials */}
        <div className="space-y-3">
          <p className="text-sm font-semibold flex items-center gap-1.5">
            <span className="inline-block w-4 h-4 rounded-full bg-accent-cyan/20 text-accent-cyan text-[9px] font-bold flex items-center justify-center">G</span>
            Google OAuth
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="oauth-google-id" className="text-xs">Google Client ID</Label>
              <Input
                id="oauth-google-id"
                placeholder={oauthStatus?.google ? "••••••••" : "Paste your client ID"}
                value={oauthInputs.googleClientId}
                onChange={(e) => setOauthInputs({ ...oauthInputs, googleClientId: e.target.value })}
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="oauth-google-secret" className="text-xs">Google Client Secret</Label>
              <Input
                id="oauth-google-secret"
                type="password"
                placeholder={oauthStatus?.google ? "••••••••" : "Paste your client secret"}
                value={oauthInputs.googleClientSecret}
                onChange={(e) => setOauthInputs({ ...oauthInputs, googleClientSecret: e.target.value })}
                autoComplete="off"
              />
            </div>
          </div>
        </div>

        {/* Microsoft credentials */}
        <div className="space-y-3">
          <p className="text-sm font-semibold flex items-center gap-1.5">
            <span className="inline-block w-4 h-4 rounded-full bg-sky-500/20 text-sky-500 text-[9px] font-bold flex items-center justify-center">M</span>
            Microsoft OAuth
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="oauth-ms-id" className="text-xs">Microsoft Client ID</Label>
              <Input
                id="oauth-ms-id"
                placeholder={oauthStatus?.microsoft ? "••••••••" : "Paste your application (client) ID"}
                value={oauthInputs.microsoftClientId}
                onChange={(e) => setOauthInputs({ ...oauthInputs, microsoftClientId: e.target.value })}
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="oauth-ms-secret" className="text-xs">Microsoft Client Secret</Label>
              <Input
                id="oauth-ms-secret"
                type="password"
                placeholder={oauthStatus?.microsoft ? "••••••••" : "Paste your client secret value"}
                value={oauthInputs.microsoftClientSecret}
                onChange={(e) => setOauthInputs({ ...oauthInputs, microsoftClientSecret: e.target.value })}
                autoComplete="off"
              />
            </div>
          </div>
        </div>

        {/* How-to helper */}
        <div className="rounded-md border border-muted bg-muted/20">
          <button
            type="button"
            className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setHowToOpen((v) => !v)}
          >
            <span className="flex items-center gap-1.5">
              <Eye className="w-3.5 h-3.5" /> How to register an OAuth app
            </span>
            <span className="text-[10px]">{howToOpen ? "▲" : "▼"}</span>
          </button>
          {howToOpen && (
            <div className="px-4 pb-4 pt-1 space-y-3 text-xs text-muted-foreground border-t border-muted">
              <div>
                <p className="font-semibold text-foreground/70 mb-1">Google</p>
                <ol className="list-decimal list-inside space-y-0.5">
                  <li>Open <span className="font-mono">console.cloud.google.com</span></li>
                  <li>APIs &amp; Services → Credentials → Create Credentials → OAuth client ID</li>
                  <li>Application type: <strong>Web application</strong></li>
                  <li>Paste the redirect URI above into "Authorized redirect URIs"</li>
                  <li>Copy the Client ID and Client Secret here</li>
                </ol>
              </div>
              <div>
                <p className="font-semibold text-foreground/70 mb-1">Microsoft</p>
                <ol className="list-decimal list-inside space-y-0.5">
                  <li>Open <span className="font-mono">portal.azure.com</span> → Azure Active Directory → App registrations</li>
                  <li>New registration → choose "Accounts in any organizational directory and personal accounts"</li>
                  <li>Redirect URI: Web → paste the Microsoft redirect URI above</li>
                  <li>Certificates &amp; secrets → New client secret → copy the <strong>Value</strong></li>
                  <li>Paste the Application (client) ID and the secret value here</li>
                </ol>
              </div>
            </div>
          )}
        </div>
      </CardContent>
      <CardFooter className="border-t pt-4">
        <Button
          onClick={handleSave}
          disabled={saveKeysMut.isPending || (!oauthInputs.googleClientId && !oauthInputs.googleClientSecret && !oauthInputs.microsoftClientId && !oauthInputs.microsoftClientSecret)}
          className="gap-2"
        >
          {saveKeysMut.isPending
            ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</>
            : <><Save className="w-4 h-4" /> Save OAuth Credentials</>
          }
        </Button>
      </CardFooter>
    </Card>
  );
};

const ConnectedAccounts: React.FC<{ loginMethod: string | null }> = ({ loginMethod }) => {
  const { data: providers, refetch } = trpc.system.loginProviders.useQuery();
  const { data: settings } = trpc.system.getSettings.useQuery();
  const [mode, setMode] = useState<"managed" | "custom">("managed");
  const [keys, setKeys] = useState({ googleClientId: "", googleClientSecret: "", microsoftClientId: "", microsoftClientSecret: "" });
  const m = trpc.system.saveKeys.useMutation({ onSuccess: () => { toast.success("Saved"); refetch(); }, onError: (err) => toast.error(err.message) });

  useEffect(() => {
    if (settings) {
      const s = settings as SavedSettings;
      setKeys({
        googleClientId: s.googleClientId || "",
        googleClientSecret: s.googleClientSecret || "",
        microsoftClientId: s.microsoftClientId || "",
        microsoftClientSecret: s.microsoftClientSecret || "",
      });
      if (s.googleClientId || s.microsoftClientId) {
        setMode("custom");
      }
    }
  }, [settings]);

  return (
    <Card>
      <CardHeader><CardTitle>OAuth</CardTitle></CardHeader>
      <CardContent className="space-y-6">
        <RadioGroup value={mode} onValueChange={(v) => setMode(v as "managed" | "custom")} className="grid grid-cols-2 gap-4">
          <div className={cn("p-3 border rounded-md cursor-pointer", mode === "managed" && "bg-primary/5")} onClick={() => setMode("managed")}>
            <RadioGroupItem value="managed" id="m-managed" />
            <Label htmlFor="m-managed" className="ml-2">Managed</Label>
          </div>
          <div className={cn("p-3 border rounded-md cursor-pointer", mode === "custom" && "bg-primary/5")} onClick={() => setMode("custom")}>
            <RadioGroupItem value="custom" id="m-custom" />
            <Label htmlFor="m-custom" className="ml-2">Custom</Label>
          </div>
        </RadioGroup>
        {mode === "custom" && (
          <div className="space-y-4 pt-4 border-t">
            <div className="space-y-2">
              <Label>Google Client ID</Label>
              <Input placeholder="Google Client ID" value={keys.googleClientId} onChange={e => setKeys({ ...keys, googleClientId: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Google Client Secret</Label>
              <Input type="password" placeholder="Google Client Secret" value={keys.googleClientSecret} onChange={e => setKeys({ ...keys, googleClientSecret: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Microsoft Client ID</Label>
              <Input placeholder="Microsoft Client ID" value={keys.microsoftClientId} onChange={e => setKeys({ ...keys, microsoftClientId: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Microsoft Client Secret</Label>
              <Input type="password" placeholder="Microsoft Client Secret" value={keys.microsoftClientSecret} onChange={e => setKeys({ ...keys, microsoftClientSecret: e.target.value })} />
            </div>
            <Button size="sm" onClick={() => m.mutate({ keys })} disabled={m.isPending}>{m.isPending ? "Saving..." : "Save"}</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

const AuditLogPanel: React.FC = () => {
  const { data, isLoading } = trpc.audit.getAuditLog.useQuery({ limit: 50, offset: 0 });
  return (
    <Card>
      <CardHeader><CardTitle>Audit</CardTitle></CardHeader>
      <CardContent>
        {isLoading ? <p>Loading...</p> : <ScrollArea className="h-64 border rounded-md">
          <table className="w-full text-xs"><tbody>{(data?.entries ?? []).map(e => (<tr key={e.id} className="border-t"><td>{e.eventType}</td><td>{new Date(e.createdAt).toLocaleString()}</td></tr>))}</tbody></table>
        </ScrollArea>}
      </CardContent>
    </Card>
  );
};

const UserManagementPanel: React.FC = () => {
  const { data, isLoading, refetch } = trpc.system.listUsers.useQuery();
  const m = trpc.system.setUserRole.useMutation({ onSuccess: () => { toast.success("Updated"); refetch(); }, onError: (err) => toast.error("Role update failed: " + err.message) });
  return (
    <Card>
      <CardHeader><CardTitle>Users</CardTitle></CardHeader>
      <CardContent>
        {isLoading ? <p>Loading...</p> : <div className="space-y-2">
          {(data?.users ?? []).map(u => (<div key={u.id} className="flex items-center justify-between border p-2 rounded-md"><span>{u.email || u.name}</span><select value={u.role} onChange={e => m.mutate({ userId: u.id, role: e.target.value as "viewer" | "user" | "admin" | "owner" })}><option value="viewer">Viewer</option><option value="user">User</option><option value="admin">Admin</option><option value="owner">Owner</option></select></div>))}
        </div>}
      </CardContent>
    </Card>
  );
};


const GeneralPanel: React.FC = () => {
  const { data: settings, refetch } = trpc.system.getSettings.useQuery();
  const saveMutation = trpc.system.saveSettings.useMutation({
    onSuccess: () => { toast.success("General settings saved"); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const [autoSave, setAutoSave] = React.useState(true);
  const [notifications, setNotifications] = React.useState(true);
  const [portableMode, setPortableMode] = React.useState(false);
  const [startupBehavior, setStartupBehavior] = React.useState("dashboard");
  const [autoBackup, setAutoBackup] = React.useState(true);
  const [backupFrequency, setBackupFrequency] = React.useState("daily");

  React.useEffect(() => {
    if (settings) {
      const s = settings as SavedSettings;
      setAutoSave(s.autoSave !== false);
      setNotifications(s.notifications !== false);
      setPortableMode(!!s.portableMode);
      setStartupBehavior(s.startupBehavior || "dashboard");
      setAutoBackup(s.autoBackup !== false);
      setBackupFrequency(s.backupFrequency || "daily");
    }
  }, [settings]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Behavior</CardTitle>
          <CardDescription>Configure application behavior</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label>Auto-Save</Label>
            <Switch checked={autoSave} onCheckedChange={setAutoSave} />
          </div>
          <div className="flex items-center justify-between">
            <Label>Notifications</Label>
            <Switch checked={notifications} onCheckedChange={setNotifications} />
          </div>
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Portable Mode</Label>
              <p className="text-xs text-muted-foreground">Store all data in the application directory</p>
            </div>
            <Switch checked={portableMode} onCheckedChange={setPortableMode} />
          </div>
          <div className="space-y-2">
            <Label>Startup Behavior</Label>
            <Select value={startupBehavior} onValueChange={setStartupBehavior}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="last-session">Restore Last Session</SelectItem>
                <SelectItem value="blank">Blank Workspace</SelectItem>
                <SelectItem value="dashboard">Dashboard</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="pt-4 border-t space-y-4">
            <Label className="text-base font-bold">System Maintenance</Label>
            <p className="text-xs text-muted-foreground">Re-run the initial configuration sequence to re-calibrate your workstation.</p>
            <Button
              variant="outline"
              className="w-full gap-2 border-accent/30 hover:bg-accent/10 hover:text-accent"
              onClick={() => {
                localStorage.removeItem("omnecor:setup_complete");
                window.location.href = "/setup";
              }}
            >
              <Rocket className="w-4 h-4" />
              Re-run Setup Wizard
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="w-4 h-4" /> Backup & Sync
          </CardTitle>
          <CardDescription>Protect your workspace data</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Automatic Backups</Label>
              <p className="text-xs text-muted-foreground">Regularly snapshot your database</p>
            </div>
            <Switch checked={autoBackup} onCheckedChange={setAutoBackup} />
          </div>
          <div className="space-y-2">
            <Label>Backup Frequency</Label>
            <Select value={backupFrequency} onValueChange={setBackupFrequency}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="hourly">Hourly</SelectItem>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => {
                const config = { version: "1.0", exportedAt: new Date().toISOString(), settings: Object.entries(localStorage).reduce((acc, [k, v]) => { if (k.startsWith("omnecor")) acc[k] = v; return acc; }, {} as Record<string, string>) };
                const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a"); a.href = url; a.download = "omnecor-config.json"; a.click();
                URL.revokeObjectURL(url);
                toast.success("Config exported");
              }}
            >
              <Upload className="w-4 h-4" /> Export Config
            </Button>
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => {
                const input = document.createElement("input");
                input.type = "file"; input.accept = ".json";
                input.onchange = (e) => {
                  const file = (e.target as HTMLInputElement).files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = (ev) => {
                    try { JSON.parse(ev.target?.result as string); toast.success("Config imported — restart to apply"); }
                    catch { toast.error("Invalid config file"); }
                  };
                  reader.readAsText(file);
                };
                input.click();
              }}
            >
              <Download className="w-4 h-4" /> Import Config
            </Button>
          </div>
          <Button
            className="w-full gap-2"
            onClick={() => {
              const backup: Record<string, string> = {};
              for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key) backup[key] = localStorage.getItem(key) ?? "";
              }
              const blob = new Blob(
                [JSON.stringify({ version: "2.3.0-beta.1", backupAt: new Date().toISOString(), localStorage: backup }, null, 2)],
                { type: "application/json" }
              );
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `omnecor-backup-${new Date().toISOString().slice(0,10)}.json`;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
              toast.success("Workspace backup downloaded");
            }}
          >
            <FileJson className="w-4 h-4" /> Full Workspace Backup
          </Button>
        </CardContent>
      </Card>
      <div className="flex justify-end pt-2">
        <Button
          onClick={() => saveMutation.mutate({ settings: { autoSave, notifications, portableMode, startupBehavior, autoBackup, backupFrequency } })}
          disabled={saveMutation.isPending}
          className="gap-2"
        >
          <Save className="w-4 h-4" /> {saveMutation.isPending ? "Saving..." : "Save General Settings"}
        </Button>
      </div>
    </div>
  );
};

const KnowledgePanel: React.FC = () => {
  const [folderPath, setFolderPath] = React.useState("");
  const [showAddForm, setShowAddForm] = React.useState(false);
  const { data: kbSettings, refetch: refetchKb } = trpc.system.getSettings.useQuery();
  const saveKbMutation = trpc.system.saveSettings.useMutation({
    onSuccess: () => { toast.success("Knowledge settings saved"); refetchKb(); },
    onError: (e) => toast.error(e.message),
  });

  const [autoIndex, setAutoIndex] = React.useState(true);
  const [indexInterval, setIndexInterval] = React.useState(15);
  const [maxFileSize, setMaxFileSize] = React.useState(50);

  React.useEffect(() => {
    if (kbSettings) {
      const s = kbSettings as SavedSettings;
      setAutoIndex(s.autoIndex !== false);
      setIndexInterval(s.indexInterval ?? 15);
      setMaxFileSize(s.maxFileSize ?? 50);
    }
  }, [kbSettings]);

  const ingestMutation = trpc.knowledgeBase.ingestDirectory.useMutation({
    onSuccess: () => { setShowAddForm(false); setFolderPath(""); toast.success("Folder indexed into knowledge base"); },
    onError: (e) => toast.error("Indexing failed: " + e.message),
  });
  const deleteCollectionMutation = trpc.knowledgeBase.deleteCollection.useMutation({
    onSuccess: () => toast.success("Knowledge base collection cleared"),
    onError: (e) => toast.error("Failed to remove: " + e.message),
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Knowledge Base Folders</CardTitle>
              <CardDescription>Manage indexed project folders</CardDescription>
            </div>
            <Button size="sm" onClick={() => setShowAddForm(v => !v)}>
              <Plus className="w-4 h-4 mr-2" />Add Folder
            </Button>
          </div>
          {showAddForm && (
            <div className="mt-3 flex gap-2">
              <Input
                placeholder="/path/to/folder"
                value={folderPath}
                onChange={(e) => setFolderPath(e.target.value)}
                className="text-sm"
              />
              <Button
                size="sm"
                disabled={!folderPath || ingestMutation.isPending}
                onClick={() => ingestMutation.mutate({ projectId: "default", directoryPath: folderPath, recursive: true })}
              >
                {ingestMutation.isPending ? "Indexing..." : "Index"}
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-64">
            <div className="space-y-2">
              <div className="p-3 rounded-lg border bg-muted/50 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">Omnecor Source</p>
                  <p className="text-xs text-muted-foreground font-mono">/home/linux/Documents/Omnecor</p>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={autoIndex} onCheckedChange={setAutoIndex} />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => { if (confirm("Remove this collection from the knowledge base?")) deleteCollectionMutation.mutate({ projectId: "default" }); }}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Indexing Settings</CardTitle>
          <CardDescription>Configure automatic indexing behavior</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label>Auto-Index</Label>
            <Switch checked={autoIndex} onCheckedChange={setAutoIndex} />
          </div>
          <div className="space-y-2">
            <Label>Index Interval (minutes): {indexInterval}</Label>
            <Slider value={[indexInterval]} onValueChange={([v]) => setIndexInterval(v)} min={5} max={240} step={5} />
          </div>
          <div className="space-y-2">
            <Label>Max File Size (MB): {maxFileSize}</Label>
            <Slider value={[maxFileSize]} onValueChange={([v]) => setMaxFileSize(v)} min={10} max={500} step={10} />
          </div>
        </CardContent>
      </Card>
      <div className="flex justify-end pt-2">
        <Button
          onClick={() => saveKbMutation.mutate({ settings: { autoIndex, indexInterval, maxFileSize } })}
          disabled={saveKbMutation.isPending}
          className="gap-2"
        >
          <Save className="w-4 h-4" /> {saveKbMutation.isPending ? "Saving..." : "Save Knowledge Settings"}
        </Button>
      </div>
    </div>
  );
};

const PrivacyPanel: React.FC = () => {
  const { data: settings, refetch } = trpc.system.getSettings.useQuery();
  const saveMutation = trpc.system.saveSettings.useMutation({
    onSuccess: () => { toast.success("Privacy settings saved"); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const [zeroLoginMode, setZeroLoginMode] = React.useState(false);
  const [telemetry, setTelemetry] = React.useState(false);
  const [crashReports, setCrashReports] = React.useState(false);
  const [analytics, setAnalytics] = React.useState(false);
  const [cloudSync, setCloudSync] = React.useState(false);

  React.useEffect(() => {
    if (settings) {
      const s = settings as SavedSettings;
      setZeroLoginMode(!!s.zeroLoginMode);
      setTelemetry(!!s.telemetry);
      setCrashReports(!!s.crashReports);
      setAnalytics(!!s.analytics);
      setCloudSync(!!s.cloudSync);
    }
  }, [settings]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Data Privacy</CardTitle>
          <CardDescription>Control how your data is handled</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>Zero-Login Mode</Label>
              <p className="text-xs text-muted-foreground">All data stays local</p>
            </div>
            <Switch checked={zeroLoginMode} onCheckedChange={setZeroLoginMode} />
          </div>
          <div className="flex items-center justify-between">
            <Label>Telemetry</Label>
            <Switch checked={telemetry} onCheckedChange={setTelemetry} />
          </div>
          <div className="flex items-center justify-between">
            <Label>Crash Reports</Label>
            <Switch checked={crashReports} onCheckedChange={setCrashReports} />
          </div>
          <div className="flex items-center justify-between">
            <Label>Analytics</Label>
            <Switch checked={analytics} onCheckedChange={setAnalytics} />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Cloud Sync</CardTitle>
          <CardDescription>Optional encrypted cloud backup</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label>Enable Cloud Sync</Label>
            <Switch checked={cloudSync} onCheckedChange={setCloudSync} />
          </div>
        </CardContent>
      </Card>
      <div className="flex justify-end pt-2">
        <Button
          onClick={() => saveMutation.mutate({ settings: { zeroLoginMode, telemetry, crashReports, analytics, cloudSync } })}
          disabled={saveMutation.isPending}
          className="gap-2"
        >
          <Save className="w-4 h-4" /> {saveMutation.isPending ? "Saving..." : "Save Privacy Settings"}
        </Button>
      </div>
    </div>
  );
};

const AdvancedPanel: React.FC = () => {
  const { data: settings, refetch } = trpc.system.getSettings.useQuery();
  const saveMutation = trpc.system.saveSettings.useMutation({
    onSuccess: () => { toast.success("Advanced settings saved"); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const [temperature, setTemperature] = React.useState(0.7);
  const [topP, setTopP] = React.useState(1);
  const [apiServerEnabled, setApiServerEnabled] = React.useState(false);
  const [apiPort, setApiPort] = React.useState(4444);
  const [requireAuthToken, setRequireAuthToken] = React.useState(true);
  const [debugMode, setDebugMode] = React.useState(false);
  const [devTools, setDevTools] = React.useState(false);
  const [cacheEnabled, setCacheEnabled] = React.useState(true);
  const [logLevel, setLogLevel] = React.useState("info");

  React.useEffect(() => {
    if (settings) {
      const s = settings as SavedSettings;
      setTemperature(s.temperature ?? 0.7);
      setTopP(s.topP ?? 1);
      setApiServerEnabled(!!s.apiServerEnabled);
      setApiPort(s.apiPort ?? 4444);
      setRequireAuthToken(s.requireAuthToken !== false);
      setDebugMode(!!s.debugMode);
      setDevTools(!!s.devTools);
      setCacheEnabled(s.cacheEnabled !== false);
      setLogLevel(s.logLevel || "info");
    }
  }, [settings]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>AI Model Defaults</CardTitle>
          <CardDescription>Configure default model parameters</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Temperature: {temperature.toFixed(1)}</Label>
            <Slider value={[temperature]} onValueChange={([v]) => setTemperature(v)} min={0} max={2} step={0.1} />
          </div>
          <div className="space-y-2">
            <Label>Top P: {topP.toFixed(2)}</Label>
            <Slider value={[topP]} onValueChange={([v]) => setTopP(v)} min={0} max={1} step={0.05} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="w-4 h-4" /> Local API Server
          </CardTitle>
          <CardDescription>Expose Omnecor services via REST API</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label>Enable API Server</Label>
            <Switch checked={apiServerEnabled} onCheckedChange={setApiServerEnabled} />
          </div>
          <div className="space-y-2">
            <Label>API Port</Label>
            <Input type="number" value={apiPort} onChange={e => setApiPort(parseInt(e.target.value) || 4444)} className="max-w-[120px]" />
          </div>
          <div className="flex items-center justify-between">
            <Label>Require Auth Token</Label>
            <Switch checked={requireAuthToken} onCheckedChange={setRequireAuthToken} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Developer Options</CardTitle>
          <CardDescription>Advanced debugging and performance tuning</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label>Debug Mode</Label>
            <Switch checked={debugMode} onCheckedChange={setDebugMode} />
          </div>
          <div className="flex items-center justify-between">
            <Label>Enable Dev Tools</Label>
            <Switch checked={devTools} onCheckedChange={setDevTools} />
          </div>
          <div className="flex items-center justify-between">
            <Label>Enable Cache</Label>
            <Switch checked={cacheEnabled} onCheckedChange={setCacheEnabled} />
          </div>
          <div className="space-y-2">
            <Label>Log Level</Label>
            <Select value={logLevel} onValueChange={setLogLevel}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="debug">Debug</SelectItem>
                <SelectItem value="info">Info</SelectItem>
                <SelectItem value="warn">Warning</SelectItem>
                <SelectItem value="error">Error</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="pt-4 border-t">
            <Button
              variant="outline"
              className="w-full gap-2"
              onClick={() => {
                toast.info("Generating diagnostic bundle...");
                const info = { timestamp: new Date().toISOString(), userAgent: navigator.userAgent, url: window.location.href, localStorage: Object.keys(localStorage).filter(k => k.startsWith("omnecor")) };
                const blob = new Blob([JSON.stringify(info, null, 2)], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a"); a.href = url; a.download = "omnecor-diagnostics.json"; a.click();
                URL.revokeObjectURL(url);
                toast.success("Diagnostic bundle downloaded");
              }}
            >
              <Activity className="w-4 h-4" /> Generate Diagnostic Bundle
            </Button>
          </div>
        </CardContent>
      </Card>
      <div className="flex justify-end pt-2">
        <Button
          onClick={() => saveMutation.mutate({ settings: { temperature, topP, apiServerEnabled, apiPort, requireAuthToken, debugMode, devTools, cacheEnabled, logLevel } })}
          disabled={saveMutation.isPending}
          className="gap-2"
        >
          <Save className="w-4 h-4" /> {saveMutation.isPending ? "Saving..." : "Save Advanced Settings"}
        </Button>
      </div>
    </div>
  );
};

