import OmnecorDashboardLayout from "@/components/OmnecorDashboardLayout";
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
} from "lucide-react";
import { Link } from "wouter";
import ProcessManagerPanel from "@/components/ProcessManagerPanel";
import { trpc } from "@/lib/trpc";
import { useState } from "react";

interface SelectedModel {
  providerId: "ollama" | "anthropic" | "openai" | "gemini" | "grok";
  modelId: string;
}

/**
 * Omnecor Dashboard Home Page
 */
export default function Dashboard() {
  const [selectedModel] = useState<SelectedModel | undefined>(() => {
    try {
      return JSON.parse(localStorage.getItem("omnecor:selectedModel") ?? "");
    } catch {
      return undefined;
    }
  });

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
      title: "Integrations",
      description:
        "Connect third-party apps and services via OAuth and API integrations",
      icon: Plug,
      href: "/integrations",
      badge: kbStatus?.initialized ? "Ready" : "Not configured",
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
          <div className="max-w-7xl mx-auto px-6 py-12 md:py-20">
            <div className="flex items-center gap-2 mb-4">
              <Sparkles className="w-5 h-5 text-accent" />
              <span className="text-sm font-medium text-accent">
                Welcome to Omnecor
              </span>
            </div>
            <h1 className="text-4xl md:text-5xl font-bold mb-4">
              The Ultimate All-in-One AI Workbench
            </h1>
            <p className="text-lg text-muted-foreground max-w-2xl">
              A powerful, elegant, and polished local-first AI workstation
              designed for power users who demand both function and beauty.
            </p>
          </div>
        </div>

        {/* Features Grid */}
        <div className="max-w-7xl mx-auto px-6 py-12">
          <div className="mb-8">
            <h2 className="text-2xl font-bold mb-2">Core Features</h2>
            <p className="text-muted-foreground">
              Explore the powerful capabilities of Omnecor
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map(feature => {
              const Icon = feature.icon;
              return (
                <Link key={feature.href} href={feature.href} className="block">
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
                      >
                        Explore
                        <ArrowRight className="w-4 h-4 group-hover/btn:translate-x-1 transition-transform" />
                      </Button>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </OmnecorDashboardLayout>
  );
}
