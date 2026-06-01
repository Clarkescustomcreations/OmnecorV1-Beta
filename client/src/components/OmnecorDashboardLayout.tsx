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
  Sparkles,
  BookOpenText,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import HITLAlertPanel from "./HITLAlertPanel";
import { useFictionMode } from "@/contexts/FictionModeContext";
import ExecutionModeBadge from "@/components/shell/ExecutionModeBadge";
import ZeroLoginBanner from "@/components/shell/ZeroLoginBanner";
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
export default function OmnecorDashboardLayout({
  children,
}: OmnecorDashboardLayoutProps) {
  const [location] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const { user, logout } = useAuth();
  const { isFictionMode, toggleFictionMode } = useFictionMode();
  const { data: me } = trpc.auth.me.useQuery();
  const setExecutionMode = useAppStore((s) => s.setExecutionMode);
  useEffect(() => {
    if (me?.executionMode) setExecutionMode(me.executionMode);
  }, [me?.executionMode]);

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
      label: "Integrations",
      href: "/integrations",
      icon: Plug,
      description: "Third-party connections",
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
      <div className="flex flex-1 overflow-hidden">
      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-64 bg-sidebar border-r border-sidebar-border transition-transform duration-300 ease-in-out lg:relative lg:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex flex-col h-full">
          {/* Logo / Header */}
          <div className="flex items-center justify-between p-6 border-b border-sidebar-border">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center">
                <Brain className="w-5 h-5 text-accent-foreground" />
              </div>
              <h1 className="text-xl font-bold text-sidebar-foreground">
                Omnecor
              </h1>
            </div>
            <button
              onClick={() => setSidebarOpen(false)}
              className="lg:hidden p-1 hover:bg-sidebar-hover rounded-md transition-colors"
              aria-label="Close sidebar"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Navigation Items */}
          <ScrollArea className="flex-1 px-3 py-4">
            <nav className="space-y-2">
              {navItems.map(item => {
                const Icon = item.icon;
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setSidebarOpen(false)}
                    className={cn(
                      "flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 group",
                      active
                        ? "bg-accent text-accent-foreground shadow-md"
                        : "text-sidebar-foreground hover:bg-surface-hover"
                    )}
                    title={item.description}
                  >
                    <Icon className="w-5 h-5 flex-shrink-0" />
                    <span className="font-medium text-sm">{item.label}</span>
                    {active && (
                      <ChevronRight className="w-4 h-4 ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
                    )}
                  </Link>
                );
              })}
            </nav>
          </ScrollArea>

          {/* User Profile & Logout */}
          <div className="border-t border-sidebar-border p-4 space-y-3">
            {user && (
              <div className="px-3 py-2 rounded-lg bg-sidebar-hover">
                <p className="text-xs text-sidebar-foreground/70">
                  Logged in as
                </p>
                <p className="text-sm font-medium text-sidebar-foreground truncate">
                  {user.name || user.email || "User"}
                </p>
              </div>
            )}
            <Button
              onClick={logout}
              variant="outline"
              size="sm"
              className="w-full justify-start gap-2"
            >
              <LogOut className="w-4 h-4" />
              Logout
            </Button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Bar */}
        <header className="border-b border-border bg-card px-6 py-4 flex items-center justify-between">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="lg:hidden p-2 hover:bg-muted rounded-lg transition-colors"
            aria-label="Toggle sidebar"
          >
            <Menu className="w-6 h-6" />
          </button>
          <div className="flex-1" />

          <ExecutionModeBadge />

          <Button
            variant={isFictionMode ? "default" : "outline"}
            size="sm"
            onClick={toggleFictionMode}
            className={cn(
              "gap-2",
              isFictionMode && "bg-accent text-accent-foreground"
            )}
            title="Toggle Fiction Mode"
          >
            {isFictionMode ? (
              <BookOpenText className="w-4 h-4" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            <span>{isFictionMode ? "Fiction Mode" : "Standard Mode"}</span>
          </Button>
        </header>

        {/* Content Area */}
        <main className="flex-1 overflow-auto relative">
          <div className="h-full">{children}</div>

          {/* Global Floating Alerts */}
          <div className="fixed bottom-6 right-6 z-[100] w-full max-w-md pointer-events-none">
            <div className="pointer-events-auto">
              <HITLAlertPanel className="shadow-2xl border-accent/20" />
            </div>
          </div>
        </main>
      </div>

      {/* Mobile Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}
      </div>
    </div>
  );
}
