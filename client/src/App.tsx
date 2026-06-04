import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Router, Switch } from "wouter";
import { useEffect, Suspense, lazy, ComponentType, Component, ReactNode } from "react";
import ErrorBoundary from "./components/ErrorBoundary";
import { RouteErrorBoundary } from "./components/RouteErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import CommandPalette from "./components/shell/CommandPalette";
import PageSkeleton from "./components/PageSkeleton";

// Lazy-load each page so Vite splits it into its own chunk.
// Only the shell (CommandPalette, toaster, theme) loads eagerly.
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const Chat = lazy(() => import("@/pages/Chat"));
const BrainMap = lazy(() => import("@/pages/BrainMap"));
const ModelHub = lazy(() => import("@/pages/ModelHub"));
const Pipelines = lazy(() => import("@/pages/Pipelines"));
const Integrations = lazy(() => import("@/pages/Integrations"));
const SettingsPage = lazy(() => import("@/pages/Settings"));
const AgentNetworking = lazy(() => import("@/pages/AgentNetworking"));
const NotFound = lazy(() => import("@/pages/NotFound"));
const ExternalBrainMapWindow = lazy(() => import("./components/window-system/ExternalBrainMapWindow"));

/** Per-route error boundary that renders RouteErrorBoundary on failure. */
class RouteBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <RouteErrorBoundary
          error={this.state.error}
          resetErrorBoundary={() => this.setState({ error: null })}
        />
      );
    }
    return this.props.children;
  }
}

/** Wraps a page component in its own RouteBoundary so one broken route doesn't crash the whole app. */
function withBoundary(Page: ComponentType) {
  return function BoundedPage() {
    return (
      <RouteBoundary>
        <Page />
      </RouteBoundary>
    );
  };
}

function RouterRoutes() {
  // make sure to consider if you need authentication for certain routes
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Switch>
        <Route path="/" component={withBoundary(Dashboard)} />
        <Route path="/chat" component={withBoundary(Chat)} />
        <Route path="/brain-map" component={withBoundary(BrainMap)} />
        <Route path="/brain-map-external" component={withBoundary(ExternalBrainMapWindow)} />
        <Route path="/model-hub" component={withBoundary(ModelHub)} />
        <Route path="/pipelines" component={withBoundary(Pipelines)} />
        <Route path="/integrations" component={withBoundary(Integrations)} />
        <Route path="/agent-networking" component={withBoundary(AgentNetworking)} />
        <Route path="/settings" component={withBoundary(SettingsPage)} />
        <Route path="/404" component={withBoundary(NotFound)} />
        {/* Final fallback route */}
        <Route component={withBoundary(NotFound)} />
      </Switch>
    </Suspense>
  );
}

// NOTE: About Theme
// - First choose a default theme according to your design style (dark or light bg), than change color palette in index.css
//   to keep consistent foreground/background color across components
// - If you want to make theme switchable, pass `switchable` ThemeProvider and use `useTheme` hook

function App() {
  useEffect(() => {
    // Initialize keyboard shortcuts on mount
    const handleKeyDown = (e: KeyboardEvent) => {
      // Shift+?: Show help
      if (e.shiftKey && e.key === "?") {
        e.preventDefault();
        alert("Keyboard shortcuts help - see documentation for full list");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

  return (
    <ErrorBoundary>
      <ThemeProvider
        defaultTheme="dark"
        switchable
      >
        <TooltipProvider>
          <Router base={base}>
            <CommandPalette />
            <Toaster />
            <RouterRoutes />
          </Router>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
