import React, { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import logoMark from "../../../assets/logo_mark_256.png";
import { useLocation } from "wouter";
import { Card, CardHeader, CardTitle, CardContent, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Sparkles, Shield, Key, Share2, FolderOpen, Mic2, Cpu, HardDrive,
  ChevronRight, ArrowRight, CheckCircle2, Lock, Zap, Flame, Monitor,
  Sun, Moon, Globe, Database, Volume2, Save, Rocket, SkipForward, CheckCircle,
  Package, AlertCircle, RefreshCw, ExternalLink, Download, Loader2,
  Bot, Layers, BrainCircuit, Box, Wrench, Palette, Radio,
} from "lucide-react";
import { toast } from "sonner";
import { useAppStore } from "@/lib/store/app.store";
import { setSessionToken } from "@/lib/desktopAuth";
import { useTheme } from "@/contexts/ThemeContext";
import { cn } from "@/lib/utils";
import { useRef } from "react";

interface WizardSettings {
  vram?: number; ttsEngine?: string; mDnsEnabled?: boolean; discoveryPort?: string;
  autoIndex?: boolean; maxFileSize?: number; language?: string; defaultModel?: string; kbPath?: string;
}

const STEPS = [
  { id: "welcome", title: "Welcome", description: "Let's configure your sovereign AI workstation." },
  { id: "account", title: "Sign In", description: "Create or sign in to your Omnecor account." },
  { id: "mode", title: "Execution Mode", description: "Choose how you want Omnecor to handle AI requests." },
  { id: "providers", title: "AI Providers", description: "Configure your cloud API keys (optional)." },
  { id: "mesh", title: "OMMESH Network", description: "Setup local connectivity and peer discovery." },
  { id: "knowledge", title: "Knowledge Base", description: "Initialize your personal memory and RAG system." },
  { id: "hardware", title: "Hardware & Voice", description: "Optimize performance for your local hardware." },
  { id: "personalization", title: "Personalization", description: "Make Omnecor look and feel like yours." },
  { id: "checklist", title: "Launch Checklist", description: "Confirm your tools are ready before launch." },
  { id: "finish", title: "Ready to Launch", description: "Your workstation is fully configured." },
];

export function SetupWizard() {
  const [, setLocation] = useLocation();
  const [currentStep, setCurrentStep] = useState(0);
  const progress = ((currentStep + 1) / STEPS.length) * 100;
  const folderInputRef = useRef<HTMLInputElement>(null);

  // --- Theme ---
  const { theme, setTheme } = useTheme();

  // If the user is already authenticated (e.g. returned from OAuth redirect),
  // skip the account step and land on the mode step instead.
  const { data: me } = trpc.auth.me.useQuery();
  useEffect(() => {
    if (me && currentStep === 0) {
      setCurrentStep(STEPS.findIndex(s => s.id === "mode"));
    }
  }, [me, currentStep]);

  // --- Backend Data ---
  const { data: aiProviders, refetch: refetchAiProviders } = trpc.system.aiProviders.useQuery();
  const { data: settings, refetch: refetchSettings } = trpc.system.getSettings.useQuery();
  const executionMode = useAppStore((s) => s.executionMode);
  const setExecutionMode = useAppStore((s) => s.setExecutionMode);

  // --- Launch Checklist ---
  const currentStepId = STEPS[currentStep]?.id;
  const depsQuery = trpc.system.checkDependencies.useQuery(
    undefined,
    { enabled: currentStepId === "checklist", staleTime: 0 }
  );
  const utils = trpc.useUtils();
  const installOllamaMutation = trpc.system.installOllama.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      // Re-check after a short delay to let the installer start
      setTimeout(() => utils.system.checkDependencies.invalidate(), 4000);
    },
    onError: (e) => toast.error(e.message),
  });

  // --- Mutations ---
  const detectHardwareMutation = trpc.system.detectHardware.useMutation();
  const setModeMutation = trpc.system.setExecutionMode.useMutation({
    onSuccess: ({ mode }) => setExecutionMode(mode),
    onError: (e) => toast.error(e.message),
  });

  const handleBrowse = () => {
    folderInputRef.current?.click();
  };

  const handleFolderSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      // Extract the folder path from the first file's path
      const firstFile = files[0];
      const fullPath = (firstFile as File & { webkitRelativePath?: string }).webkitRelativePath || firstFile.name;
      const folderPath = fullPath.split("/")[0] || "/";
      setKbPath(folderPath);
      toast.success(`Folder selected: ${folderPath}`);
    }
    // Reset the input so it can be re-used
    if (folderInputRef.current) {
      folderInputRef.current.value = "";
    }
  };

  const handleRunScan = () => {
    // detectHardware is a protectedProcedure — guard against an unauthenticated
    // run so the user gets a clear prompt instead of a raw 401 error toast.
    if (!me) {
      toast.error("Sign in first to scan local hardware.");
      return;
    }
    toast.promise(
      detectHardwareMutation.mutateAsync().then((hw) => {
        // Persist the real scan result alongside its timestamp. Pre-fill the VRAM
        // slider from detected GPU memory when available (rounded to whole GB).
        saveSettingsMutation.mutate({
          settings: {
            lastHardwareScan: new Date().toISOString(),
            detectedGpu: hw.gpuInfo,
            detectedCpu: hw.cpuModel,
            totalMemoryGB: hw.totalMemoryGB,
          },
        });
        return hw;
      }),
      {
        loading: 'Scanning local hardware…',
        success: (hw) => {
          const gpu = hw.gpuInfo ?? 'No discrete GPU detected (CPU inference)';
          return `Scan complete — GPU: ${gpu} · CPU: ${hw.cpuModel ?? 'unknown'} (${hw.cpuCount} cores) · ${hw.totalMemoryGB}GB RAM`;
        },
        error: (e: unknown) => `Scan failed: ${e instanceof Error ? e.message : String(e)}`,
      }
    );
  };

  const saveKeysMutation = trpc.system.saveKeys.useMutation({
    onSuccess: () => {
      toast.success("API keys saved");
      setKeys({ openai: "", anthropic: "", gemini: "", grok: "", huggingface: "", elevenlabs: "", falai: "", forge: "" });
      refetchAiProviders();
    },
    onError: (err) => toast.error("Failed to save keys: " + err.message),
  });

  // Gated on `me` so this doesn't fire an unauthenticated 401 at step 0.
  const kaggleStatusQuery = trpc.training.kaggleStatus.useQuery(undefined, { enabled: !!me });
  const saveKaggleMutation = trpc.training.saveKaggleKey.useMutation({
    onSuccess: () => { toast.success("Kaggle credentials saved"); kaggleStatusQuery.refetch(); },
    onError: (e) => toast.error("Kaggle save failed: " + e.message),
  });

  const autoSaveKey = (field: string, value: string) => {
    if (!value) return;
    saveKeysMutation.mutate({ keys: { [field]: value } }, {
      onSuccess: () => refetchAiProviders(),
      onError: (e) => toast.error(`Failed to save ${field} key: ${e.message}`),
    });
  };

  const saveSettingsMutation = trpc.system.saveSettings.useMutation({
    onSuccess: () => refetchSettings(),
    onError: (e) => toast.error(e.message),
  });

  // --- Auth step state ---
  const [authView, setAuthView] = useState<"choose" | "local-register" | "local-login">("choose");
  const [localName, setLocalName] = useState("");
  const [localPassword, setLocalPassword] = useState("");
  const [localPassword2, setLocalPassword2] = useState("");
  const [authBusy, setAuthBusy] = useState(false);

  const windowApi = (window as Window & { api?: { backendBase?: string; openOAuthPopup?: (url: string) => Promise<{ token?: string; error?: string }> } }).api;
  const apiBase = windowApi?.backendBase ?? "";

  const handleOAuth = async (provider: 'google' | 'microsoft') => {
    if (authBusy) return;
    if (!apiBase) {
      toast.error("Desktop bridge not ready. If this persists, restart Omnecor.");
      return;
    }
    setAuthBusy(true);
    try {
      // Pre-check whether this provider is configured on the backend before
      // opening any popup, so the user gets a clear message instead of seeing
      // raw JSON error or a hanging popup.
      const statusRes = await fetch(`${apiBase}/api/oauth/status`).catch(() => null);
      if (statusRes?.ok) {
        const status = await statusRes.json() as { google?: boolean; microsoft?: boolean };
        if (!status[provider]) {
          toast.error(
            provider === 'google'
              ? "Google OAuth isn't configured. Add GOOGLE_CLIENT_ID and restart, or use a local account."
              : "Microsoft OAuth isn't configured. Add MICROSOFT_CLIENT_ID and restart, or use a local account."
          );
          return;
        }
      }

      const url = `${apiBase}/api/oauth/${provider}/login`;
      // In Electron, use the IPC popup so the main window never navigates away.
      if (windowApi?.openOAuthPopup) {
        const result = await windowApi.openOAuthPopup(url);
        if (result?.token) {
          setSessionToken(result.token);
          toast.success("Signed in!");
          setCurrentStep(s => s + 1);
        } else if (result?.error) {
          toast.error(`Sign-in window failed to open: ${result.error}`);
        } else {
          toast.error("Sign-in was cancelled. Try again or use a local account.");
        }
        return;
      }
      // Web browser fallback: navigate to backend OAuth initiation URL.
      window.open(url, '_self');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`OAuth error: ${msg}`);
    } finally {
      setAuthBusy(false);
    }
  };

  const handleLocalRegister = async () => {
    if (localPassword !== localPassword2) { toast.error("Passwords do not match"); return; }
    if (localPassword.length < 8) { toast.error("Password must be at least 8 characters"); return; }
    if (!localName.trim()) { toast.error("Name is required"); return; }
    if (!apiBase) { toast.error("Desktop bridge not ready. Restart Omnecor and try again."); return; }
    setAuthBusy(true);
    try {
      const res = await fetch(`${apiBase}/api/auth/local/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: localName.trim(), password: localPassword }),
      });
      const data = await res.json() as { ok?: boolean; error?: string; sessionToken?: string };
      if (!res.ok) { toast.error(data.error ?? `Registration failed (${res.status})`); return; }
      // Desktop app is cross-origin and can't use the SameSite cookie — persist
      // the returned token so subsequent tRPC calls authenticate via Bearer.
      if (data.sessionToken) setSessionToken(data.sessionToken);
      toast.success("Account created!");
      setCurrentStep(s => s + 1);
    } catch (err) {
      const msg = err instanceof TypeError ? "Cannot connect to backend — check ~/omnecor-debug.log (Linux) or %APPDATA%\\omnecor-debug.log (Windows)" : String(err);
      toast.error(msg);
    }
    finally { setAuthBusy(false); }
  };

  const handleLocalLogin = async () => {
    if (!apiBase) { toast.error("Desktop bridge not ready. Restart Omnecor and try again."); return; }
    setAuthBusy(true);
    try {
      const res = await fetch(`${apiBase}/api/auth/local/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ password: localPassword }),
      });
      const data = await res.json() as { ok?: boolean; error?: string; sessionToken?: string };
      if (!res.ok) { toast.error(data.error ?? `Login failed (${res.status})`); return; }
      if (data.sessionToken) setSessionToken(data.sessionToken);
      toast.success("Signed in!");
      setCurrentStep(s => s + 1);
    } catch (err) {
      const msg = err instanceof TypeError ? "Cannot connect to backend — check ~/omnecor-debug.log (Linux) or %APPDATA%\\omnecor-debug.log (Windows)" : String(err);
      toast.error(msg);
    }
    finally { setAuthBusy(false); }
  };

  // --- Step States ---
  const [selectedMode, setSelectedMode] = useState<"sovereign" | "scrapper" | "big_spender">("scrapper");
  const [keys, setKeys] = useState({ openai: "", anthropic: "", gemini: "", grok: "", huggingface: "", elevenlabs: "", falai: "", forge: "" });
  const [kaggleUsername, setKaggleUsername] = useState("");
  const [kaggleApiKey, setKaggleApiKey] = useState("");
  const [ollamaUrl, setOllamaUrl] = useState("http://localhost:11434");
  const [kbPath, setKbPath] = useState("");
  const [vram, setVram] = useState(8);
  const [ttsEngine, setTtsEngine] = useState("local");
  const [mDnsEnabled, setMDnsEnabled] = useState(true);
  const [discoveryPort, setDiscoveryPort] = useState("5353");
  const [kbAutoIndex, setKbAutoIndex] = useState(true);
  const [kbMaxFileSize, setKbMaxFileSize] = useState(50);
  const [language, setLanguage] = useState("en");
  const [defaultModel, setDefaultModel] = useState("auto");

  useEffect(() => {
    if (executionMode) setSelectedMode(executionMode);
  }, [executionMode]);

  useEffect(() => {
    if (aiProviders) {
      setOllamaUrl(aiProviders?.ollamaUrl || "http://localhost:11434");
    }
  }, [aiProviders]);

  useEffect(() => {
    if (settings) {
      const s = settings as WizardSettings;
      setVram(s.vram ?? 8);
      setTtsEngine(s.ttsEngine || "local");
      setMDnsEnabled(s.mDnsEnabled !== false);
      setDiscoveryPort(s.discoveryPort || "5353");
      setKbAutoIndex(s.autoIndex !== false);
      setKbMaxFileSize(s.maxFileSize ?? 50);
      setLanguage(s.language || "en");
      setDefaultModel(s.defaultModel || "auto");
      setKbPath(s.kbPath || "");
    }
  }, [settings]);

  const nextStep = () => {
    if (currentStep < STEPS.length - 1) {
      const stepId = STEPS[currentStep].id;
      if (stepId === "mode") {
        setModeMutation.mutate({ mode: selectedMode });
      } else if (stepId === "providers") {
        const payload: Record<string, string> = {};
        Object.entries(keys).forEach(([k, v]) => { if (v) payload[k] = v; });
        if (ollamaUrl) payload.ollamaUrl = ollamaUrl;
        if (Object.keys(payload).length > 0) saveKeysMutation.mutate({ keys: payload });
      } else if (stepId === "mesh") {
        saveSettingsMutation.mutate({ settings: { mDnsEnabled, discoveryPort } });
      } else if (stepId === "knowledge") {
        saveSettingsMutation.mutate({ settings: { kbPath, autoIndex: kbAutoIndex, maxFileSize: kbMaxFileSize } });
      } else if (stepId === "hardware") {
        saveSettingsMutation.mutate({ settings: { vram, ttsEngine } });
      } else if (stepId === "personalization") {
        saveSettingsMutation.mutate({ settings: { language, defaultModel } });
      }
      setCurrentStep(currentStep + 1);
    }
  };

  const prevStep = () => {
    if (currentStep > 0) setCurrentStep(currentStep - 1);
  };

  const handleFinish = () => {
    saveSettingsMutation.mutate({ settings: { vram, ttsEngine, mDnsEnabled, discoveryPort, kbPath, autoIndex: kbAutoIndex, maxFileSize: kbMaxFileSize, language, defaultModel } });
    localStorage.setItem("omnecor:setup_complete", "true");
    toast.success("Setup complete! Welcome to Omnecor.");
    setLocation("/");
  };

  const handleSkip = () => {
    localStorage.setItem("omnecor:setup_complete", "true");
    toast.info("Setup skipped — configure API keys anytime in Settings → AI Providers.");
    setLocation("/");
  };

  const renderStepContent = () => {
    switch (STEPS[currentStep].id) {
      case "welcome":
        return (
          <div className="flex flex-col items-center justify-center space-y-8 py-10 animate-in fade-in zoom-in duration-500">
            <div className="relative">
              <div className="absolute -inset-4 bg-primary/20 rounded-full blur-2xl animate-pulse" />
              <img src={logoMark} alt="Omnecor Logo" className="w-32 h-32 relative drop-shadow-2xl object-contain" />
            </div>
            <div className="text-center space-y-4 max-w-lg">
              <h2 className="text-4xl font-black tracking-tighter">OMNECOR HMCI</h2>
              <p className="text-muted-foreground text-lg leading-relaxed">
                Welcome to the ultimate sovereign AI workstation. We'll guide you through a quick setup to ensure your local-first experience is optimized for your hardware and privacy.
              </p>
              <div className="flex items-center justify-center gap-4 pt-4">
                <Badge variant="outline" className="px-3 py-1 border-primary/30 text-primary">v2.3.0 Sovereign</Badge>
                <Badge variant="outline" className="px-3 py-1 border-primary/30 text-primary">Neural Mesh Ready</Badge>
              </div>
            </div>
          </div>
        );

      case "account":
        return (
          <div className="space-y-6 py-4 animate-in fade-in duration-300">
            {authView === "choose" && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Choose how you want to sign in. Your account unlocks all workstation features and keeps your settings secure.
                </p>
                <div className="grid gap-3">
                  <Button
                    variant="outline"
                    disabled={authBusy}
                    className="w-full h-14 gap-3 text-base font-semibold justify-start px-5 border-2 hover:border-primary/30 hover:bg-primary/5"
                    onClick={() => handleOAuth('google')}
                  >
                    <svg className="w-5 h-5" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                    {authBusy ? "Signing in…" : "Continue with Google"}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={authBusy}
                    className="w-full h-14 gap-3 text-base font-semibold justify-start px-5 border-2 hover:border-primary/30 hover:bg-primary/5"
                    onClick={() => handleOAuth('microsoft')}
                  >
                    <svg className="w-5 h-5" viewBox="0 0 24 24"><path fill="#F25022" d="M1 1h10v10H1z"/><path fill="#7FBA00" d="M13 1h10v10H13z"/><path fill="#00A4EF" d="M1 13h10v10H1z"/><path fill="#FFB900" d="M13 13h10v10H13z"/></svg>
                    {authBusy ? "Signing in…" : "Continue with Microsoft"}
                  </Button>
                  <div className="relative my-2"><div className="absolute inset-0 flex items-center"><div className="w-full border-t" /></div><div className="relative flex justify-center"><span className="bg-card px-3 text-xs text-muted-foreground">or</span></div></div>
                  <Button
                    variant="outline"
                    className="w-full h-14 gap-3 text-base font-semibold justify-start px-5 border-2 hover:border-primary/30 hover:bg-primary/5"
                    onClick={async () => {
                      if (!apiBase) {
                        toast.error("Desktop bridge not ready. If this persists, restart Omnecor.");
                        return;
                      }
                      try {
                        const res = await fetch(`${apiBase}/api/auth/local/exists`);
                        if (!res.ok) {
                          const body = await res.json().catch(() => ({})) as { error?: string };
                          toast.error(`Backend error ${res.status}${body.error ? `: ${body.error}` : " — try restarting Omnecor."}`);
                          return;
                        }
                        const { exists } = await res.json() as { exists: boolean };
                        setAuthView(exists ? "local-login" : "local-register");
                      } catch (err) {
                        const msg = err instanceof TypeError
                          ? "Cannot connect to backend — check ~/omnecor-debug.log (Linux) or %APPDATA%\\omnecor-debug.log (Windows)"
                          : String(err);
                        toast.error(msg);
                      }
                    }}
                  >
                    <Lock className="w-5 h-5" />
                    Create local account (no cloud required)
                  </Button>
                </div>
              </div>
            )}

            {authView === "local-register" && (
              <div className="space-y-4">
                <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground -ml-1" onClick={() => setAuthView("choose")}>
                  <ChevronRight className="w-4 h-4 rotate-180" /> Back
                </Button>
                <div className="space-y-1">
                  <h2 className="text-lg font-bold">Create local account</h2>
                  <p className="text-xs text-muted-foreground">Stored on this machine only. No cloud sign-in needed.</p>
                </div>
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label>Your name</Label>
                    <Input placeholder="e.g. Alex" value={localName} onChange={e => setLocalName(e.target.value)} autoFocus />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Password</Label>
                    <Input type="password" placeholder="Min 8 characters" value={localPassword} onChange={e => setLocalPassword(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Confirm password</Label>
                    <Input type="password" placeholder="Repeat password" value={localPassword2} onChange={e => setLocalPassword2(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && handleLocalRegister()} />
                  </div>
                  <Button className="w-full bg-primary/10 text-accent-foreground hover:bg-primary/90 font-bold" disabled={authBusy} onClick={handleLocalRegister}>
                    {authBusy ? "Creating account…" : "Create account & continue"}
                  </Button>
                </div>
              </div>
            )}

            {authView === "local-login" && (
              <div className="space-y-4">
                <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground -ml-1" onClick={() => setAuthView("choose")}>
                  <ChevronRight className="w-4 h-4 rotate-180" /> Back
                </Button>
                <div className="space-y-1">
                  <h2 className="text-lg font-bold">Sign in to local account</h2>
                  <p className="text-xs text-muted-foreground">Enter your password to continue.</p>
                </div>
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label>Password</Label>
                    <Input type="password" placeholder="Your password" value={localPassword} onChange={e => setLocalPassword(e.target.value)} autoFocus
                      onKeyDown={e => e.key === "Enter" && handleLocalLogin()} />
                  </div>
                  <Button className="w-full bg-primary/10 text-accent-foreground hover:bg-primary/90 font-bold" disabled={authBusy} onClick={handleLocalLogin}>
                    {authBusy ? "Signing in…" : "Sign in & continue"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        );

      case "mode":
        return (
          <div className="space-y-6 py-4">
            <div className="grid gap-4">
              {[
                { id: "sovereign", label: "Sovereign", icon: Lock, color: "text-red-500", desc: "AI-inference lockdown. External AI API calls (OpenAI, Anthropic, etc.) are blocked server-side. OAuth, email, and other cloud services still work." },
                { id: "scrapper", label: "Scrapper", icon: Zap, color: "text-green-500", desc: "Local-preferred. Ollama runs first; cloud providers available if keys are provided." },
                { id: "big_spender", label: "Big Spender", icon: Flame, color: "text-amber-500", desc: "Cloud-first. Prioritizes the highest-capability cloud models regardless of cost." },
              ].map((mode) => (
                <div 
                  key={mode.id}
                  onClick={() => setSelectedMode(mode.id as "sovereign" | "scrapper" | "big_spender")}
                  className={cn(
                    "flex items-start gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all hover:bg-muted/50",
                    selectedMode === mode.id ? "border-primary/30 bg-primary/5 ring-1 ring-primary/30" : "border-border"
                  )}
                >
                  <div className={cn("p-2 rounded-lg bg-background border shadow-sm", mode.color)}>
                    <mode.icon className="w-6 h-6" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <Label className="text-lg font-bold cursor-pointer">{mode.label}</Label>
                      {selectedMode === mode.id && <CheckCircle2 className="w-5 h-5 text-primary" />}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{mode.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );

      case "providers":
        return (
          <div className="space-y-5 py-4">
            <div className="p-4 border rounded-xl bg-blue-500/5 border-blue-500/20 flex gap-3">
              <Shield className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-blue-400">
                Omnecor is local-first. Cloud keys are optional — leave any field blank to configure later in <strong>Settings → AI Providers</strong>. Keys are stored locally, never sent to our servers.
              </p>
            </div>

            {/* ── Local AI ─────────────────────────────────────────── */}
            <div className="space-y-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Local AI — No Key Required</p>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-2 text-sm">🖥️ Ollama Base URL</Label>
                  <Badge variant="secondary" className="bg-green-500/10 text-green-500 border-none h-5 px-2 text-[10px] gap-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-500" /> Local
                  </Badge>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Runs Llama 3, Mistral, Phi, Gemma — any model pulled via <code className="font-mono">ollama pull</code>
                </p>
                <Input
                  type="url"
                  placeholder="http://localhost:11434"
                  value={ollamaUrl}
                  onChange={(e) => setOllamaUrl(e.target.value)}
                  onBlur={(e) => autoSaveKey("ollamaUrl", e.target.value)}
                  className="bg-background/50 focus-visible:ring-primary/30 font-mono text-xs"
                />
              </div>
            </div>

            <div className="border-t" />

            {/* ── Cloud AI Providers ───────────────────────────────── */}
            <div className="space-y-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Cloud AI Providers</p>
              {[
                { id: "openai",      label: "OpenAI",               placeholder: "sk-...",      icon: "🤖", desc: "GPT-4o, o1, o3" },
                { id: "anthropic",   label: "Anthropic (Claude)",    placeholder: "sk-ant-...",  icon: "🧠", desc: "Claude 3.5, Claude 4" },
                { id: "gemini",      label: "Google Gemini",         placeholder: "AIza...",     icon: "✨", desc: "Gemini 2.5 Flash / Pro" },
                { id: "grok",        label: "xAI Grok",              placeholder: "xai-...",     icon: "🌌", desc: "Grok-3, Grok-2" },
                { id: "huggingface", label: "Hugging Face",          placeholder: "hf_...",      icon: "🤗", desc: "Llama 3, Mistral, Phi via HF Inference API" },
              ].map((p) => (
                <div key={p.id} className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-2 text-sm">
                      <span>{p.icon}</span>
                      {p.label}
                      <span className="text-[10px] text-muted-foreground font-normal">{p.desc}</span>
                    </Label>
                    {!!(aiProviders as Record<string, unknown>)?.[p.id] && (
                      <Badge variant="secondary" className="bg-green-500/10 text-green-500 border-none h-5 px-2 text-[10px] gap-1">
                        <CheckCircle className="w-3 h-3" /> Configured
                      </Badge>
                    )}
                  </div>
                  <Input
                    type="password"
                    placeholder={(aiProviders as Record<string, unknown>)?.[p.id] ? "••••••••••••••••" : p.placeholder}
                    value={keys[p.id as keyof typeof keys]}
                    onChange={(e) => setKeys({ ...keys, [p.id]: e.target.value })}
                    onBlur={(e) => autoSaveKey(p.id, e.target.value)}
                    className="bg-background/50 focus-visible:ring-primary/30"
                  />
                </div>
              ))}
            </div>

            <div className="border-t" />

            {/* ── Kaggle GPU Training ───────────────────────────────── */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Kaggle GPU Training (Free)</p>
                {kaggleStatusQuery.data?.connected && (
                  <Badge variant="secondary" className="bg-green-500/10 text-green-500 border-none h-5 px-2 text-[10px] gap-1">
                    <CheckCircle className="w-3 h-3" /> Connected as {kaggleStatusQuery.data.username}
                  </Badge>
                )}
              </div>
              <div className="p-3 rounded-lg bg-muted/20 border border-border/50 text-[11px] text-muted-foreground space-y-1">
                <p>🎓 Train your Valet Router on free Kaggle T4 GPUs — no credit card needed.</p>
                <p>1. Create a free account at <strong>kaggle.com</strong> and verify your phone number (required for GPU access).</p>
                <p>2. Go to <strong>kaggle.com/settings</strong> → API → <strong>Create New Token</strong> → download <code className="font-mono">kaggle.json</code>.</p>
                <p>3. Copy the <strong>username</strong> and <strong>key</strong> from that file into the fields below.</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">🐎 Kaggle Username</Label>
                <Input
                  placeholder="your_kaggle_username"
                  value={kaggleUsername}
                  onChange={(e) => setKaggleUsername(e.target.value)}
                  className="bg-background/50 focus-visible:ring-primary/30 font-mono text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">🔑 Kaggle API Key</Label>
                <div className="flex gap-2">
                  <Input
                    type="password"
                    placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    value={kaggleApiKey}
                    onChange={(e) => setKaggleApiKey(e.target.value)}
                    className="bg-background/50 focus-visible:ring-primary/30 font-mono text-xs"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!kaggleUsername || !kaggleApiKey || saveKaggleMutation.isPending}
                    onClick={() => saveKaggleMutation.mutate({ username: kaggleUsername, key: kaggleApiKey })}
                  >
                    {saveKaggleMutation.isPending ? "Saving..." : "Connect"}
                  </Button>
                </div>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-muted/30 border border-border/50 text-[11px] text-muted-foreground">
              💡 <strong>ElevenLabs</strong> (TTS), <strong>fal.ai</strong> (Image Gen), <strong>Forge API</strong>, and local service URLs (n8n, ComfyUI) are configurable in <span className="font-semibold">Settings → AI Providers</span>.
            </div>
          </div>
        );

      case "mesh":
        return (
          <div className="space-y-8 py-4">
            <div className="flex flex-col items-center text-center space-y-4">
              <div className="p-4 rounded-2xl bg-primary/10 border border-primary/20">
                <Share2 className="w-12 h-12 text-primary" />
              </div>
              <h3 className="text-xl font-bold">Neural Mesh Discovery</h3>
              <p className="text-sm text-muted-foreground max-w-md">
                Enable OMMESH to automatically discover and link with other Omnecor nodes on your local network. This enables VRAM pooling and distributed inference.
              </p>
            </div>
            <div className="space-y-6">
              <div className="flex items-center justify-between p-4 rounded-xl border bg-muted/30">
                <div className="space-y-0.5">
                  <Label className="text-base font-semibold">Enable mDNS Discovery</Label>
                  <p className="text-xs text-muted-foreground">Find local peers automatically</p>
                </div>
                <Switch checked={mDnsEnabled} onCheckedChange={setMDnsEnabled} />
              </div>
              <div className="space-y-2">
                <Label>Discovery Port</Label>
                <div className="flex gap-4">
                   <Input value={discoveryPort} onChange={(e) => setDiscoveryPort(e.target.value)} className="max-w-[120px]" />
                   <div className="p-2 px-3 rounded-lg border bg-muted/50 text-[10px] font-mono text-muted-foreground flex items-center">
                     UDP Traffic must be allowed on this port
                   </div>
                </div>
              </div>
            </div>
          </div>
        );

      case "knowledge":
        return (
          <div className="space-y-6 py-4">
             <div className="flex items-center gap-4 mb-4">
                <div className="p-3 rounded-xl bg-primary/10">
                  <FolderOpen className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <h3 className="text-lg font-bold">Initial Context</h3>
                  <p className="text-sm text-muted-foreground">Select a primary folder to index for local RAG.</p>
                </div>
             </div>
             <div className="space-y-4">
               <div className="space-y-2">
                 <Label>Primary Folder Path</Label>
                 <div className="flex gap-2">
                   <Input value={kbPath} onChange={(e) => setKbPath(e.target.value)} placeholder={navigator.userAgent.includes("Windows") ? "C:\\Users\\you\\Documents\\Omnecor" : "/home/you/Documents/Omnecor"} className="font-mono text-xs" />
                   <Button variant="outline" onClick={handleBrowse}>Browse</Button>
                 </div>
               </div>
               <div className="p-4 rounded-xl border bg-muted/30 space-y-4">
                 <div className="flex items-center justify-between">
                   <Label>Auto-Indexing</Label>
                   <Switch checked={kbAutoIndex} onCheckedChange={setKbAutoIndex} />
                 </div>
                 <div className="space-y-2 pt-2">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Max File Size</span>
                      <span>{kbMaxFileSize}MB</span>
                    </div>
                    <Slider value={[kbMaxFileSize]} onValueChange={([v]) => setKbMaxFileSize(v)} min={10} max={500} step={10} />
                 </div>
               </div>
             </div>
          </div>
        );

      case "hardware":
        return (
          <div className="space-y-8 py-4">
            <div className="grid grid-cols-2 gap-6">
               <div className="space-y-4">
                  <div className="flex items-center gap-2 mb-2">
                    <HardDrive className="w-4 h-4 text-primary" />
                    <Label className="font-bold">Model Memory</Label>
                  </div>
                  <div className="space-y-3">
                    <Label className="text-xs">Max VRAM Allocation: {vram}GB</Label>
                    <Slider value={[vram]} onValueChange={([v]) => setVram(v)} min={2} max={48} step={1} />
                    <p className="text-[10px] text-muted-foreground italic">Recommended: 80% of total GPU memory.</p>
                  </div>
               </div>
               <div className="space-y-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Mic2 className="w-4 h-4 text-primary" />
                    <Label className="font-bold">Voice Engine</Label>
                  </div>
                  <div className="space-y-3">
                    <Label className="text-xs">TTS Provider</Label>
                    <Select value={ttsEngine} onValueChange={setTtsEngine}>
                      <SelectTrigger className="text-xs h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="local">Local (XTTS-v2)</SelectItem>
                        <SelectItem value="elevenlabs">ElevenLabs</SelectItem>
                        <SelectItem value="openai">OpenAI</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
               </div>
            </div>
            <div className="pt-6 border-t">
              <div className="p-4 rounded-xl border bg-primary/5 border-primary/10 flex items-center justify-between">
                 <div className="flex items-center gap-3">
                    <Cpu className="w-5 h-5 text-primary" />
                    <div>
                      <p className="text-sm font-bold">Hardware Discovery</p>
                      <p className="text-xs text-muted-foreground">Auto-detect local Blender, KiCad, and GPUs.</p>
                    </div>
                 </div>
                 <Button size="sm" variant="outline" onClick={handleRunScan}>Run Scan</Button>
              </div>
            </div>
          </div>
        );

      case "personalization":
        return (
          <div className="space-y-8 py-4">
            <div className="space-y-4">
              <Label className="text-lg font-bold">Interface Style</Label>
              <div className="grid grid-cols-2 gap-4">
                {[
                  { id: "dark", label: "Deep Space", icon: Moon, desc: "OLED optimized dark mode." },
                  { id: "light", label: "Polaris", icon: Sun, desc: "High contrast light mode." },
                ].map((opt) => (
                  <div 
                    key={opt.id}
                    onClick={() => setTheme(opt.id as Parameters<typeof setTheme>[0])}
                    className={cn(
                      "flex flex-col items-center gap-3 p-6 rounded-2xl border-2 cursor-pointer transition-all",
                      theme === opt.id ? "border-primary/30 bg-primary/5" : "border-border hover:border-primary/30"
                    )}
                  >
                    <opt.icon className={cn("w-10 h-10", theme === opt.id ? "text-primary" : "text-muted-foreground")} />
                    <div className="text-center">
                      <p className="font-bold">{opt.label}</p>
                      <p className="text-[10px] text-muted-foreground mt-1">{opt.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="pt-6 border-t grid grid-cols-2 gap-8">
               <div className="space-y-3">
                 <Label className="text-sm">Language</Label>
                 <Select value={language} onValueChange={setLanguage}>
                   <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                   <SelectContent>
                     <SelectItem value="en">English</SelectItem>
                     <SelectItem value="es">Español</SelectItem>
                     <SelectItem value="fr">Français</SelectItem>
                     <SelectItem value="de">Deutsch</SelectItem>
                   </SelectContent>
                 </Select>
               </div>
               <div className="space-y-3">
                 <Label className="text-sm">Default Model</Label>
                 <Select value={defaultModel} onValueChange={setDefaultModel}>
                   <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                   <SelectContent>
                     <SelectItem value="auto">Auto (Best Available)</SelectItem>
                     <SelectItem value="llama3">Llama 3 (Local)</SelectItem>
                     <SelectItem value="mistral">Mistral (Local)</SelectItem>
                   </SelectContent>
                 </Select>
               </div>
            </div>
          </div>
        );

      case "finish":
        return (
          <div className="flex flex-col items-center justify-center space-y-8 py-10 animate-in fade-in slide-in-from-bottom-4 duration-700">
             <div className="w-24 h-24 rounded-full bg-primary/10 border-2 border-primary/20 flex items-center justify-center animate-bounce">
                <Rocket className="w-12 h-12 text-primary" />
             </div>
             <div className="text-center space-y-2">
                <h3 className="text-3xl font-black italic italic">SYSTEM READY</h3>
                <p className="text-muted-foreground max-w-sm mx-auto">
                   Configuration complete. Your local AI workstation is now optimized and connected.
                </p>
             </div>
             <div className="grid grid-cols-3 gap-8 pt-4">
                <div className="text-center">
                  <p className="text-xl font-bold text-primary">✓</p>
                  <p className="text-[10px] uppercase font-bold text-muted-foreground">Privacy</p>
                </div>
                <div className="text-center">
                  <p className="text-xl font-bold text-primary">✓</p>
                  <p className="text-[10px] uppercase font-bold text-muted-foreground">Mesh</p>
                </div>
                <div className="text-center">
                  <p className="text-xl font-bold text-primary">✓</p>
                  <p className="text-[10px] uppercase font-bold text-muted-foreground">Neural</p>
                </div>
             </div>
          </div>
        );

      case "checklist": {
        const deps = depsQuery.data;
        const isLoading = depsQuery.isLoading;

        // Helper: open a URL using the OS default browser via a hidden anchor
        const openUrl = (url: string) => {
          const a = document.createElement("a");
          a.href = url;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          a.click();
        };

        const StatusBadge = ({ ok, loading }: { ok: boolean; loading: boolean }) => {
          if (loading) return <span className="inline-flex items-center gap-1 text-[10px] font-bold text-muted-foreground"><Loader2 className="w-3 h-3 animate-spin" />Checking…</span>;
          return ok
            ? <span className="inline-flex items-center gap-1 text-[10px] font-bold text-primary"><CheckCircle className="w-3 h-3" />Detected</span>
            : <span className="inline-flex items-center gap-1 text-[10px] font-bold text-destructive"><AlertCircle className="w-3 h-3" />Not found</span>;
        };

        interface GroupProps {
          icon: React.ReactNode;
          label: string;
          groupKey: keyof NonNullable<typeof deps>;
          tools: { name: string; key: keyof NonNullable<typeof deps>; desc: string }[];
          installNode?: React.ReactNode;
          getItUrl: string;
          getItLabel?: string;
        }

        const DepsGroup = ({ icon, label, groupKey, tools, installNode, getItUrl, getItLabel }: GroupProps) => {
          const allOk = deps && tools.every(t => deps[t.key]);
          return (
            <div className={cn(
              "rounded-xl border p-4 transition-colors",
              allOk ? "border-primary/30 bg-primary/5" : "border-border bg-muted/20"
            )}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className={cn("text-base", allOk ? "text-primary" : "text-muted-foreground")}>{icon}</span>
                  <span className="text-sm font-bold">{label}</span>
                  {allOk && <CheckCircle2 className="w-3.5 h-3.5 text-primary" />}
                </div>
                <div className="flex items-center gap-2">
                  {!allOk && (
                    installNode ?? (
                      <button
                        id={`checklist-get-${String(groupKey)}`}
                        onClick={() => openUrl(getItUrl)}
                        className="inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-md border border-border hover:border-primary/30 hover:text-primary transition-colors text-muted-foreground"
                      >
                        <ExternalLink className="w-3 h-3" />
                        {getItLabel ?? "Get It"}
                      </button>
                    )
                  )}
                  <button
                    id={`checklist-recheck-${String(groupKey)}`}
                    onClick={() => utils.system.checkDependencies.invalidate()}
                    className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors px-1.5 py-1"
                  >
                    <RefreshCw className="w-3 h-3" />
                  </button>
                </div>
              </div>
              <div className="space-y-1.5">
                {tools.map(t => (
                  <div key={t.key} className="flex items-center justify-between text-xs">
                    <span className="text-foreground font-medium">{t.name}<span className="ml-1.5 text-[10px] text-muted-foreground font-normal">{t.desc}</span></span>
                    <StatusBadge ok={!!deps?.[t.key]} loading={isLoading} />
                  </div>
                ))}
              </div>
            </div>
          );
        };

        const ollamaInstallNode = (
          <div className="flex items-center gap-1.5">
            <button
              id="checklist-install-ollama"
              disabled={installOllamaMutation.isPending}
              onClick={() => installOllamaMutation.mutate()}
              className="inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-md bg-primary/10 text-accent-foreground hover:bg-primary/90 disabled:opacity-60 transition-colors"
            >
              {installOllamaMutation.isPending
                ? <><Loader2 className="w-3 h-3 animate-spin" />Installing…</>
                : <><Download className="w-3 h-3" />Install Now</>}
            </button>
            <button
              id="checklist-get-ollama"
              onClick={() => openUrl("https://ollama.com")}
              className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground px-1.5 py-1 transition-colors"
            >
              <ExternalLink className="w-3 h-3" />
            </button>
          </div>
        );

        return (
          <div className="space-y-3 animate-in fade-in duration-300">
            <p className="text-sm text-muted-foreground pb-1">
              Optional tools extend what Omnecor can do. Install anything that looks useful — you can always add them later from <strong>Settings → Hardware</strong>.
            </p>

            {/* ── Core AI ──────────────────────────────── */}
            <DepsGroup
              icon={<Bot className="w-4 h-4" />}
              label="Core AI"
              groupKey="ollama"
              tools={[
                { key: "ollama", name: "Ollama", desc: "Local LLM runtime — Llama 3, Mistral, Phi, Gemma" },
                { key: "python", name: "Python 3.10+", desc: "Required for all AI bridges" },
              ]}
              installNode={(!deps?.ollama && !deps?.python) || !deps?.ollama ? ollamaInstallNode : undefined}
              getItUrl="https://ollama.com"
            />

            {/* ── Voice STT ────────────────────────────── */}
            <DepsGroup
              icon={<Mic2 className="w-4 h-4" />}
              label="Voice & STT"
              groupKey="whisper"
              tools={[
                { key: "whisper", name: "Whisper Server", desc: "Speech-to-text bridge on :8001" },
              ]}
              getItUrl="https://github.com/openai/whisper"
              getItLabel="View Docs"
            />

            {/* ── Podcast / TTS ─────────────────────────── */}
            <DepsGroup
              icon={<Volume2 className="w-4 h-4" />}
              label="Podcast & TTS"
              groupKey="tts"
              tools={[
                { key: "tts", name: "TTS / XTTS-v2 Server", desc: "Text-to-speech bridge on :8002" },
              ]}
              getItUrl="https://github.com/coqui-ai/TTS"
              getItLabel="View Docs"
            />

            {/* ── 3D Design ─────────────────────────────── */}
            <DepsGroup
              icon={<Box className="w-4 h-4" />}
              label="3D Design"
              groupKey="blender"
              tools={[
                { key: "blender", name: "Blender", desc: "3D modelling, render, and mesh export" },
              ]}
              getItUrl="https://www.blender.org/download/"
            />

            {/* ── PCB Design ────────────────────────────── */}
            <DepsGroup
              icon={<Layers className="w-4 h-4" />}
              label="PCB Design"
              groupKey="kicad"
              tools={[
                { key: "kicad", name: "KiCad CLI", desc: "Schematic and PCB layout toolchain" },
              ]}
              getItUrl="https://www.kicad.org/download/"
            />

            {/* ── AI Training ───────────────────────────── */}
            <DepsGroup
              icon={<BrainCircuit className="w-4 h-4" />}
              label="AI Training"
              groupKey="llamaCpp"
              tools={[
                { key: "llamaCpp", name: "llama-cpp", desc: "Local LoRA fine-tuning for Valet Router" },
              ]}
              getItUrl="https://github.com/ggerganov/llama.cpp"
            />

            {/* ── Image Generation ──────────────────────── */}
            <DepsGroup
              icon={<Palette className="w-4 h-4" />}
              label="Image Generation"
              groupKey="comfyui"
              tools={[
                { key: "comfyui", name: "ComfyUI", desc: "Stable Diffusion node editor on :8188" },
              ]}
              getItUrl="https://github.com/comfyanonymous/ComfyUI"
            />

            {/* ── Hardware Flash ────────────────────────── */}
            <DepsGroup
              icon={<Radio className="w-4 h-4" />}
              label="Hardware Flash"
              groupKey="esptool"
              tools={[
                { key: "esptool", name: "esptool", desc: "ESP32/ESP8266 firmware flashing" },
              ]}
              getItUrl="https://github.com/espressif/esptool"
            />

            <p className="text-[10px] text-muted-foreground pt-1">
              Server-based tools (Whisper, TTS, ComfyUI) show as detected only when their bridge server is running.
              Start them before launch or after setup via <strong>Settings → Hardware → Bridges</strong>.
            </p>
          </div>
        );
      }

      default:
        return null;
    }
  };


  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 relative overflow-hidden">
      {/* Hidden folder input */}
      <input
        ref={folderInputRef}
        type="file"
        multiple
        className="sr-only"
        onChange={handleFolderSelect}
        {...({ webkitdirectory: "true" } as React.InputHTMLAttributes<HTMLInputElement>)}
      />

      {/* Background Ambience */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/5 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-primary/5 rounded-full blur-[120px] pointer-events-none" />

      {/* Main Container */}
      <div className="w-full max-w-5xl flex flex-col md:flex-row gap-8 relative z-10">
        
        {/* Left: Sidebar Branding */}
        <div className="w-full md:w-1/3 flex flex-col justify-between py-6">
           <div className="space-y-12">
             <div className="flex items-center gap-3">
               <img src={logoMark} alt="Logo" className="w-8 h-8 object-contain" />
               <span className="text-xl font-black tracking-tighter">OMNECOR</span>
             </div>

             <nav className="space-y-6">
                {STEPS.map((step, idx) => (
                  <div 
                    key={step.id} 
                    className={cn(
                      "flex items-center gap-4 transition-all duration-300",
                      idx === currentStep ? "opacity-100 translate-x-2" : "opacity-40"
                    )}
                  >
                    <div className={cn(
                      "w-8 h-8 rounded-full border-2 flex items-center justify-center text-xs font-bold",
                      idx === currentStep ? "border-primary/30 bg-primary/10 text-accent-foreground" : 
                      idx < currentStep ? "border-primary/30 text-primary" : "border-muted-foreground"
                    )}>
                      {idx < currentStep ? "✓" : idx + 1}
                    </div>
                    <div>
                      <p className={cn("text-sm font-bold uppercase tracking-wider", idx === currentStep ? "text-primary" : "text-foreground")}>
                        {step.title}
                      </p>
                      {idx === currentStep && (
                        <p className="text-[10px] text-muted-foreground animate-in slide-in-from-left-1">{step.description}</p>
                      )}
                    </div>
                  </div>
                ))}
             </nav>
           </div>

           <div className="pt-12 border-t border-border/50">
              <div className="flex items-center gap-2 text-muted-foreground">
                 <Shield className="w-4 h-4" />
                 <span className="text-[10px] uppercase font-bold tracking-widest">End-to-End Encryption Active</span>
              </div>
           </div>
        </div>

        {/* Right: Card Content */}
        <Card className="flex-1 shadow-2xl border-border/50 bg-card/80 backdrop-blur-xl flex flex-col overflow-hidden rounded-3xl">
          <CardHeader className="border-b bg-muted/20 p-8">
            <div className="flex items-center justify-between mb-6">
               <div className="flex items-center gap-2">
                 <div className="w-2 h-2 rounded-full bg-primary/10 animate-pulse" />
                 <span className="text-[10px] uppercase font-black tracking-[0.2em] text-primary">Configuration Sequence</span>
               </div>
               <span className="text-xs font-mono text-muted-foreground">STEP_0{currentStep + 1} / 0{STEPS.length}</span>
            </div>
            <Progress value={progress} className="h-1 bg-muted" />
          </CardHeader>

          <ScrollArea className="min-h-0 flex-1 px-8 py-10">
            <div className="min-h-[450px]">
              <div className="mb-8">
                <h1 className="text-3xl font-black tracking-tight">{STEPS[currentStep].title}</h1>
                <p className="text-muted-foreground mt-2">{STEPS[currentStep].description}</p>
              </div>
              {renderStepContent()}
            </div>
          </ScrollArea>

          <CardFooter className="p-8 border-t bg-muted/20 flex justify-between items-center">
            <Button
              variant="ghost"
              onClick={prevStep}
              disabled={currentStep === 0 || STEPS[currentStep].id === "account"}
              className="gap-2 text-muted-foreground hover:text-foreground"
            >
              <ChevronRight className="w-4 h-4 rotate-180" />
              Previous
            </Button>

            <div className="flex items-center gap-3">
              {/* Skip button — visible on all middle steps (not welcome, not account, not finish) */}
              {currentStep > 0 && STEPS[currentStep].id !== "account" && currentStep < STEPS.length - 1 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleSkip}
                  className="gap-1.5 text-muted-foreground hover:text-foreground text-xs font-normal"
                >
                  <SkipForward className="w-3.5 h-3.5" />
                  Skip Setup
                </Button>
              )}

              {STEPS[currentStep].id === "account" ? null : currentStep === STEPS.length - 1 ? (
                <Button
                  onClick={handleFinish}
                  size="lg"
                  className="bg-primary/10 text-accent-foreground hover:bg-primary/90 shadow-[0_0_20px_rgba(var(--accent),0.3)] gap-2 px-8 font-bold"
                >
                  Launch Workstation
                  <ArrowRight className="w-5 h-5" />
                </Button>
              ) : (
                <Button
                  onClick={nextStep}
                  size="lg"
                  className="bg-foreground text-background hover:bg-foreground/90 gap-2 px-8 font-bold transition-all"
                >
                  Next Step
                  <ChevronRight className="w-5 h-5" />
                </Button>
              )}
            </div>
          </CardFooter>
        </Card>

      </div>
    </div>
  );
}
