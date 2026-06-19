import { useState, useEffect } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  MessageCircle,
  Brain,
  Zap,
  GitBranch,
  Plug,
  Settings,
  Menu,
  X,
  LogOut,
  ChevronRight,
  ChevronLeft,
  Sparkles,
  BookOpenText,
  Share2,
  Box,
  Network,
  Mic2,
  Lock,
  Bell,
} from "lucide-react";
import { Wallet } from "lucide-react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { HITLAlertPanel } from "./HITLAlertPanel";
import { useFictionMode } from "@/contexts/FictionModeContext";
import { ExecutionModeBadge } from "@/components/shell/ExecutionModeBadge";
import { ZeroLoginBanner } from "@/components/shell/ZeroLoginBanner";
import { PeerCard } from "@/components/shell/PeerCard";
import { UserIdentityCard } from "@/components/shell/UserIdentityCard";
import { HowToTooltip } from "@/components/shell/HowToTooltip";
import { useAppStore } from "@/lib/store/app.store";
import { trpc } from "@/lib/trpc";

interface OmnecorDashboardLayoutProps {
  children: React.ReactNode;
}

/**
 * Omnecor Dashboard Layout Component
 *
 * Provides a dark-themed, refined sidebar navigation with the following sections:
 * - Chat: AI conversation interface
 * - Neural Brain Map: Spatial project organization with node-based visualization
 * - Model Hub: Local and API model management
 * - Project Pipelines: Multi-step workflow orchestration
 * - Integrations: Third-party app connections
 * - Settings: Configuration and knowledge base management
 *
 * Features:
 * - Collapsible sidebar for mobile responsiveness
 * - Active route highlighting
 * - User profile and logout button
 * - Refined OKLCH color palette
 */
export function OmnecorDashboardLayout({
  children,
}: OmnecorDashboardLayoutProps) {
  const [location] = useLocation();
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  const { user, logout } = useAuth();
  const { isFictionMode, toggleFictionMode } = useFictionMode();
  const { data: me } = trpc.auth.me.useQuery();
  const setExecutionMode = useAppStore((s) => s.setExecutionMode);

  // Unread notification count → nav badge. Polled as a fallback; the
  // Notifications page itself receives live WebSocket pushes.
  const { data: unreadData } = trpc.notifications.unreadCount.useQuery(undefined, {
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
  });
  const unreadCount = unreadData?.unread ?? 0;

  useEffect(() => {
    if (me?.executionMode) setExecutionMode(me.executionMode);
  }, [me?.executionMode]);

  const FICTION_BLOCKED_HREFS = new Set(["/agent-networking", "/wallet"]);

  const navItems = [
    {
      label: "Chat",
      href: "/chat",
      icon: MessageCircle,
      description: "AI conversation interface",
    },
    {
      label: "Neural Brain Map",
      href: "/brain-map",
      icon: Brain,
      description: "Project organization & context",
    },
    {
      label: "Model Hub",
      href: "/model-hub",
      icon: Zap,
      description: "Local & API model management",
    },
    {
      label: "Project Pipelines",
      href: "/pipelines",
      icon: GitBranch,
      description: "Multi-step workflows",
    },
    {
      label: "3D Designer",
      href: "/3d-designer",
      icon: Box,
      description: "Design 3D models, PCBs, and Web UIs",
    },
    {
      label: "Integrations",
      href: "/integrations",
      icon: Plug,
      description: "Third-party connections",
    },
    {
      label: "Agent Networking",
      href: "/agent-networking",
      icon: Share2,
      description: "Automated social media & agent discourse",
    },
    {
      label: "Podcast Studio",
      href: "/podcast-studio",
      icon: Mic2,
      description: "Multi-voice dialogue & podcast generation",
    },
    {
      label: "Agentic Wallet",
      href: "/wallet",
      icon: Wallet,
      description: "Manage autonomous agent budgets",
    },
    {
      label: "Notifications",
      href: "/notifications",
      icon: Bell,
      description: "Alerts & Agent Messenger",
      badge: unreadCount,
    },
    {
      label: "Settings",
      href: "/settings",
      icon: Settings,
      description: "Configuration & knowledge base",
    },
  ];

  const isActive = (href: string) => location === href;

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      {me?.loginMethod === "zero-login" && <ZeroLoginBanner />}
      <div className="flex flex-1 overflow-hidden relative">
      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 bg-sidebar border-r border-sidebar-border transition-all duration-300 ease-in-out lg:relative overflow-hidden",
          sidebarOpen ? "w-64 translate-x-0" : "w-16 translate-x-0"
        )}
      >
        <div className="flex flex-col h-full overflow-hidden">
          {/* Logo / Header */}
          <div className={cn(
            "flex items-center border-b border-sidebar-border h-20 transition-all duration-300 relative group/header",
            sidebarOpen ? "justify-between px-6" : "justify-center px-0"
          )}>
            <Link href="/" className="flex items-center gap-3 cursor-pointer hover:opacity-80 transition-opacity">
              <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center flex-shrink-0">
                <Brain className="w-5 h-5 text-accent-foreground" />
              </div>
              {sidebarOpen && (
                <h1 className="text-xl font-bold text-sidebar-foreground animate-in fade-in slide-in-from-left-2 duration-300">
                  Omnecor
                </h1>
              )}
            </Link>
            
            {/* Expand/Collapse Arrow Handle */}
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className={cn(
                "absolute p-0.5 hover:bg-sidebar-hover rounded-md transition-all duration-300 text-sidebar-foreground/30 hover:text-sidebar-foreground z-20",
                sidebarOpen ? "top-1 right-1" : "top-1.5 right-1.5"
              )}
              title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
            >
              {sidebarOpen ? (
                <ChevronLeft className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 group-hover/header:translate-x-1 transition-transform" />
              )}
            </button>
          </div>

          {/* Navigation Items */}
          <ScrollArea className="min-h-0 flex-1">
            <nav className={cn("py-4 transition-all duration-300", sidebarOpen ? "px-3 space-y-2" : "px-0 space-y-4 flex flex-col items-center")}>
              {navItems.map(item => {
                const Icon = item.icon;
                const active = isActive(item.href);
                const fictionLocked = isFictionMode && FICTION_BLOCKED_HREFS.has(item.href);
                return (
                  <HowToTooltip
                    key={item.href}
                    title={fictionLocked ? `${item.label} — locked in Fiction Mode` : item.label}
                    description={fictionLocked ? "This feature is disabled while Fiction Mode is active." : item.description}
                    side="right"
                  >
                    {fictionLocked ? (
                      <div
                        className={cn(
                          "flex items-center transition-all duration-200 relative opacity-40 cursor-not-allowed select-none",
                          sidebarOpen
                            ? "gap-3 px-4 py-3 rounded-lg"
                            : "justify-center w-10 h-10 rounded-full",
                          "text-sidebar-foreground"
                        )}
                      >
                        <Icon className="flex-shrink-0 w-5 h-5" />
                        {sidebarOpen && (
                          <span className="font-medium text-sm whitespace-nowrap animate-in fade-in slide-in-from-left-1 duration-300">{item.label}</span>
                        )}
                        {sidebarOpen && (
                          <Lock className="w-3 h-3 ml-auto text-purple-400/70" />
                        )}
                        {!sidebarOpen && (
                          <div className="absolute -right-0.5 -top-0.5 w-3.5 h-3.5 bg-purple-900 rounded-full flex items-center justify-center border border-purple-500/40">
                            <Lock className="w-2 h-2 text-purple-400" />
                          </div>
                        )}
                      </div>
                    ) : (
                      <Link
                        href={item.href}
                        onClick={() => {
                          if (window.innerWidth < 1024) setSidebarOpen(false);
                        }}
                        className={cn(
                          "flex items-center transition-all duration-200 group relative",
                          sidebarOpen
                            ? "gap-3 px-4 py-3 rounded-lg"
                            : "justify-center w-10 h-10 rounded-full",
                          active
                            ? "bg-accent text-accent-foreground shadow-md"
                            : "text-sidebar-foreground hover:bg-surface-hover"
                        )}
                      >
                        <Icon className={cn("flex-shrink-0 transition-all", sidebarOpen ? "w-5 h-5" : "w-5 h-5")} />
                        {sidebarOpen && (
                          <span className="font-medium text-sm whitespace-nowrap animate-in fade-in slide-in-from-left-1 duration-300">{item.label}</span>
                        )}
                        {(() => {
                          const badge = (item as { badge?: number }).badge ?? 0;
                          if (badge <= 0) return null;
                          const label = badge > 99 ? "99+" : String(badge);
                          return sidebarOpen ? (
                            <span className="ml-auto min-w-5 h-5 px-1.5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                              {label}
                            </span>
                          ) : (
                            <span className="absolute -right-0.5 -top-0.5 min-w-4 h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center border border-sidebar">
                              {label}
                            </span>
                          );
                        })()}
                        {sidebarOpen && active && (item as { badge?: number }).badge ? null : sidebarOpen && active && (
                          <ChevronRight className="w-4 h-4 ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
                        )}
                        {!sidebarOpen && active && (
                          <div className="absolute -left-1 w-1 h-6 bg-accent rounded-full shadow-[0_0_8px_theme(colors.accent.DEFAULT)]" />
                        )}
                      </Link>
                    )}
                  </HowToTooltip>
                );
              })}
            </nav>
          </ScrollArea>

          {/* Fiction Mode Toggle at bottom of nav selection */}
          <div className={cn("pb-4 transition-all duration-300", sidebarOpen ? "px-4" : "px-0 flex justify-center")}>
            <HowToTooltip 
              title="Fiction Mode" 
              description="Toggle cinematic styling and immersive roleplay features across the workstation." 
              side="right"
            >
              <Button
                variant={isFictionMode ? "default" : "outline"}
                size={sidebarOpen ? "sm" : "icon"}
                onClick={toggleFictionMode}
                className={cn(
                  "transition-all",
                  sidebarOpen 
                    ? "w-full justify-start gap-3 h-11 px-4 rounded-lg border-sidebar-border/50 hover:bg-sidebar-hover" 
                    : "w-10 h-10 rounded-full border-sidebar-border/50",
                  isFictionMode && "bg-accent text-accent-foreground border-transparent"
                )}
                title={sidebarOpen ? "Toggle Fiction Mode" : (isFictionMode ? "Fiction Mode Active" : "Standard Mode")}
              >
                {isFictionMode ? (
                  <BookOpenText className={cn("transition-all", sidebarOpen ? "w-5 h-5" : "w-5 h-5")} />
                ) : (
                  <Sparkles className={cn("transition-all", sidebarOpen ? "w-5 h-5" : "w-5 h-5")} />
                )}
                {sidebarOpen && (
                  <span className="font-medium text-sm animate-in fade-in slide-in-from-left-1 duration-300">
                    {isFictionMode ? "Fiction Mode" : "Standard Mode"}
                  </span>
                )}
              </Button>
            </HowToTooltip>
          </div>

          {/* User Profile & Logout */}
          <div className={cn("border-t border-sidebar-border transition-all duration-300", sidebarOpen ? "p-4 space-y-3" : "p-2 space-y-4 flex flex-col items-center")}>
            {/* Execution Mode Badge at top of footer box */}
            <div className={cn("transition-all duration-300", sidebarOpen ? "w-full mb-2" : "w-10 h-10 flex items-center justify-center")}>
              <HowToTooltip
                title="Execution Mode"
                description="Controls cloud access. Sovereign: Local-only. Scrapper: Local-preferred. Big Spender: Cloud-priority."
                side="right"
              >
                <div className="w-full">
                  <ExecutionModeBadge collapsed={!sidebarOpen} />
                </div>
              </HowToTooltip>
            </div>

            {/* User Identity Card — global peer identity, persists across projects */}
            <HowToTooltip
              title="Your Identity Card"
              description="Your global peer profile. The AI knows your name, role, and preferences in every project."
              side="right"
            >
              <div className={cn("transition-all duration-300", sidebarOpen ? "w-full" : "w-10 h-10 flex items-center justify-center")}>
                <UserIdentityCard collapsed={!sidebarOpen} />
              </div>
            </HowToTooltip>

            {/* Ommesh Peer Status */}
            <HowToTooltip
              title="Ommesh Status"
              description="Monitor connections to other local and remote Omnecor nodes in your mesh network."
              side="right"
            >
              <div className={cn("transition-all duration-300", sidebarOpen ? "w-full" : "w-10 h-10 flex items-center justify-center")}>
                {sidebarOpen ? <PeerCard /> : (
                  <div className="w-10 h-10 rounded-full bg-sidebar-hover flex items-center justify-center border border-sidebar-border/30 cursor-pointer">
                    <Network className="w-5 h-5 text-accent" />
                  </div>
                )}
              </div>
            </HowToTooltip>

            {sidebarOpen && user && (
              <div className="px-3 py-2 rounded-lg bg-sidebar-hover animate-in fade-in duration-300">
                <p className="text-xs text-sidebar-foreground/70">
                  Logged in as
                </p>
                <p className="text-sm font-medium text-sidebar-foreground truncate">
                  {user.name || user.email || "User"}
                </p>
              </div>
            )}
            <HowToTooltip 
              title="Logout" 
              description="Securely sign out of your workstation session." 
              side="right"
            >
              <Button
                onClick={logout}
                variant="outline"
                size={sidebarOpen ? "sm" : "icon"}
                className={cn(
                  "transition-all",
                  sidebarOpen ? "w-full justify-start gap-2" : "w-10 h-10 rounded-full"
                )}
              >
                <LogOut className="w-4 h-4" />
                {sidebarOpen && <span className="animate-in fade-in slide-in-from-left-1 duration-300">Logout</span>}
              </Button>
            </HowToTooltip>
          </div>
        </div>
      </aside>

      {/* Main Content — offset left on mobile to clear the fixed sidebar */}
      <div className={cn(
        "flex-1 flex flex-col overflow-hidden transition-all duration-300 min-w-0",
        sidebarOpen ? "ml-64 lg:ml-0" : "ml-16 lg:ml-0"
      )}>
        {/* Content Area */}
        <main className="min-h-0 flex-1 overflow-auto relative">
          <div className="h-full min-w-0">{children}</div>

          {/* Global Floating Alerts — pinned inside viewport on all screen sizes */}
          <div className="fixed bottom-4 right-4 left-4 sm:left-auto sm:w-full sm:max-w-md z-[100] pointer-events-none">
            <div className="pointer-events-auto">
              <HITLAlertPanel className="shadow-2xl border-accent/20" />
            </div>
          </div>
        </main>
      </div>

      {/* Mobile Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-foreground/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}
      </div>
    </div>
  );
}
