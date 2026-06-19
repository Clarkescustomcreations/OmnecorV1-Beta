import { OmnecorDashboardLayout } from "@/components/OmnecorDashboardLayout";
import { BudgetPanel } from "@/components/wallet/BudgetPanel";
import logoMark from "../../../assets/logo_mark_256.png";
import { HowToTooltip } from "@/components/shell/HowToTooltip";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  MessageCircle,
  Brain,
  Zap,
  GitBranch,
  Plug,
  Settings,
  ArrowRight,
  Sparkles,
  Share2,
  Box,
  UserCircle2,
  Wallet,
  Activity,
} from "lucide-react";
import { Link } from "wouter";
import { ProcessManagerPanel } from "@/components/ProcessManagerPanel";
import { trpc } from "@/lib/trpc";
import { useState, useCallback, useEffect } from "react";
import { useOmnecorSocket } from "@/hooks/useOmnecorSocket";

interface SelectedModel {
  providerId: "ollama" | "anthropic" | "openai" | "gemini" | "grok";
  modelId: string;
}

interface SystemMetrics {
  cpu: number;
  ram: { usedGb: number; totalGb: number; percent: number };
  gpu: { usedGb: number; totalGb: number; percent: number; name: string } | null;
}

/**
 * Omnecor Dashboard Home Page
 */
export function Dashboard() {
  const [selectedModel] = useState<SelectedModel | undefined>(() => {
    let model: SelectedModel | undefined;
    try { model = JSON.parse(localStorage.getItem("omnecor:selectedModel") ?? "null") as SelectedModel | undefined ?? undefined; } catch { model = undefined; }
    return model;
  });

  const [systemMetrics, setSystemMetrics] = useState<SystemMetrics | null>(null);

  const handleWsEvent = useCallback((type: string, data: Record<string, unknown>) => {
    if (type === "systemMetrics") {
      setSystemMetrics(data as unknown as SystemMetrics);
    }
  }, []);

  const { subscribe, unsubscribe } = useOmnecorSocket({
    onEvent: handleWsEvent as (type: import("@/hooks/useOmnecorSocket").OmnecorEventType, data: Record<string, unknown>) => void,
  });

  useEffect(() => {
    subscribe("system:metrics");
    return () => unsubscribe("system:metrics");
  }, [subscribe, unsubscribe]);

  const { data: watcherStatus } = trpc.project.getWatcherStatus.useQuery();
  const { data: kbStatus } = trpc.knowledgeBase.status.useQuery();
  const { data: voiceHealth } = trpc.voice.healthCheck.useQuery();
  const { data: blenderStatus } = trpc.blender.status.useQuery();
  const { data: espStatus } = trpc.esp.status.useQuery();

  const features = [
    {
      title: "Chat",
      description:
        "Conversational AI interface with streaming responses and context transparency",
      icon: MessageCircle,
      href: "/chat",
      badge: selectedModel
        ? `${selectedModel.providerId} / ${selectedModel.modelId}`
        : "No model",
    },
    {
      title: "Neural Brain Map",
      description:
        "Spatial node-based project organization with hierarchical and graph views",
      icon: Brain,
      href: "/brain-map",
      badge:
        (watcherStatus?.length ?? 0) > 0
          ? `Watching ${watcherStatus?.length ?? 0} projects`
          : "Idle",
    },
    {
      title: "Model Hub",
      description:
        "Manage local Ollama/Llama.cpp models and multi-provider API connections",
      icon: Zap,
      href: "/model-hub",
      badge:
        voiceHealth?.whisper && voiceHealth?.tts
          ? "Voice ready"
          : "Voice offline",
    },
    {
      title: "Project Pipelines",
      description:
        "Multi-step workflow orchestration with action hashing and loop detection",
      icon: GitBranch,
      href: "/pipelines",
      badge: blenderStatus?.isInstalled ? "Blender Ready" : "Blender Offline",
    },
    {
      title: "Agent Networking",
      description:
        "Automated social media management and autonomous agent networking",
      icon: Share2,
      href: "/agent-networking",
      badge: "Beta",
    },
    {
      title: "Persona Creation",
      description:
        "Design unique AI identities with custom knowledge and voice cloning",
      icon: UserCircle2,
      href: "/agent-networking?tab=personas",
      badge: "Creative",
    },
    {
      title: "Integrations",
      description:
        "Connect third-party apps and services via OAuth and API integrations",
      icon: Plug,
      href: "/integrations",
      badge: kbStatus?.initialized ? "Ready" : "Not configured",
    },
    {
      title: "3D Designer",
      description:
        "Visual workspace for 3D modeling, PCB schematics, and web app previews",
      icon: Box,
      href: "/3d-designer",
      badge: "Beta",
    },
    {
      title: "Settings",
      description:
        "Configuration, knowledge base management, and security settings",
      icon: Settings,
      href: "/settings",
      badge: espStatus?.isInstalled ? "ESP Ready" : "ESP Offline",
    },
  ];

  return (
    <OmnecorDashboardLayout>
      <div className="min-h-screen bg-background">
        {/* Hero Section */}
        <div className="border-b border-border bg-gradient-to-br from-card to-background">
          <div className="max-w-5xl mx-auto px-6 sm:px-12 py-10 md:py-20 flex flex-col md:flex-row justify-between items-start md:items-center gap-8">
            <div className="max-w-2xl">
              <div className="flex items-center gap-2 mb-4">
                <Sparkles className="w-5 h-5 text-accent" />
                <span className="text-sm font-medium text-accent">
                  Welcome to Omnecor
                </span>
              </div>
              <h1 className="text-4xl md:text-5xl font-bold mb-4">
                The Ultimate All-in-One AI Workbench
              </h1>
              <p className="text-lg text-muted-foreground whitespace-pre-line">
                A powerful, local-first AI workstation designed for Creativity
                <br />
                <span className="text-sm font-medium text-accent/80 tracking-tight">
                  Operational Memory Never Escapes Context Overview Remains
                </span>
              </p>
            </div>
            <div className="hidden md:block flex-shrink-0">
              <img
                id="img-dashboard-hero-logo"
                src={logoMark}
                alt="Omnecor Logo"
                className="w-40 h-40 object-contain opacity-85 hover:opacity-100 hover:scale-105 transition-all duration-300 select-none"
              />
            </div>
          </div>
        </div>

        {/* Features Grid */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 md:py-12">
          <div className="mb-8">
            <h2 className="text-2xl font-bold mb-2">Core Features</h2>
            <p className="text-muted-foreground">
              Explore the powerful capabilities of Omnecor
            </p>
          </div>

          {/* System Hardware Monitor */}
          <div
            id="system-hardware-monitor"
            className="mb-6 p-4 rounded-xl border border-border bg-card/50 backdrop-blur-sm"
          >
            <div className="flex items-center gap-2 mb-3">
              <Activity className="w-4 h-4 text-accent" />
              <span className="text-sm font-semibold">System Monitor</span>
              <div
                className={`ml-auto h-1.5 w-1.5 rounded-full ${systemMetrics ? "bg-accent animate-pulse" : "bg-muted"}`}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <div className="flex justify-between text-xs text-muted-foreground mb-1">
                  <span>CPU</span>
                  <span>{systemMetrics ? `${systemMetrics.cpu}%` : "--"}</span>
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${systemMetrics?.cpu ?? 0}%`, backgroundColor: "var(--accent-cyan)" }}
                  />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-xs text-muted-foreground mb-1">
                  <span>RAM</span>
                  <span>
                    {systemMetrics
                      ? `${systemMetrics.ram.usedGb} / ${systemMetrics.ram.totalGb} GB`
                      : "--"}
                  </span>
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${systemMetrics?.ram.percent ?? 0}%`, backgroundColor: "var(--accent-success)" }}
                  />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-xs text-muted-foreground mb-1">
                  <span>{systemMetrics?.gpu ? `VRAM · ${systemMetrics.gpu.name}` : "VRAM"}</span>
                  <span>
                    {systemMetrics?.gpu
                      ? `${systemMetrics.gpu.usedGb} / ${systemMetrics.gpu.totalGb} GB`
                      : "No GPU"}
                  </span>
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${systemMetrics?.gpu?.percent ?? 0}%`, backgroundColor: "var(--accent-purple)" }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Agentic Wallet Header Block */}
          <HowToTooltip
            title="Agentic Wallet"
            description="A real-time financial monitor for your AI agents. Set hard/soft budgets, track spending by provider, and manage virtual Lithic cards."
          >
            <Link href="/wallet" className="block mb-6">
              <Card className="hover:border-accent/50 hover:shadow-lg transition-all duration-300 cursor-pointer group overflow-hidden">
                <div className="flex flex-col md:flex-row">
                  <div className="flex-1">
                    <CardHeader>
                      <div className="flex items-start justify-between mb-2">
                        <div className="p-2 rounded-lg bg-accent/10 group-hover:bg-accent/20 transition-colors">
                          <Wallet className="w-6 h-6 text-accent" />
                        </div>
                        <Badge className="bg-accent-success/10 text-accent-success border-accent-success/20">Live Monitoring</Badge>
                      </div>
                      <CardTitle className="text-xl">Agentic Wallet</CardTitle>
                      <CardDescription className="text-sm max-w-md">
                        Monitor autonomous agent spending in real-time, manage project budgets, and oversee virtual hardware issuance.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-2 group/btn"
                      >
                        Explore
                        <ArrowRight className="w-4 h-4 group-hover/btn:translate-x-1 transition-transform" />
                      </Button>
                    </CardContent>
                  </div>
                  <div className="p-4 sm:p-6 bg-muted/20 md:border-l border-border w-full md:min-w-[280px] md:max-w-[320px]">
                    <BudgetPanel projectId="default" className="border-none bg-transparent shadow-none p-0" />
                  </div>
                </div>
              </Card>
            </Link>
          </HowToTooltip>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map(feature => {
              const Icon = feature.icon;
              return (
                <HowToTooltip 
                  key={feature.href} 
                  title={feature.title} 
                  description={feature.description}
                >
                  <Link href={feature.href} className="block">
                    <Card className="h-full hover:border-accent/50 hover:shadow-lg transition-all duration-300 cursor-pointer group">
                      <CardHeader>
                        <div className="flex items-start justify-between mb-2">
                          <div className="p-2 rounded-lg bg-accent/10 group-hover:bg-accent/20 transition-colors">
                            <Icon className="w-6 h-6 text-accent" />
                          </div>
                          <Badge variant="secondary" className="text-xs">
                            {feature.badge}
                          </Badge>
                        </div>
                        <CardTitle className="text-lg">{feature.title}</CardTitle>
                        <CardDescription className="text-sm">
                          {feature.description}
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-2 group/btn"
                          aria-label={`Explore ${feature.title}`}
                        >
                          Explore
                          <ArrowRight className="w-4 h-4 group-hover/btn:translate-x-1 transition-transform" aria-hidden="true" />
                        </Button>
                      </CardContent>
                    </Card>
                  </Link>
                </HowToTooltip>
              );
            })}
          </div>
        </div>
      </div>
    </OmnecorDashboardLayout>
  );
}
