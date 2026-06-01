import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch } from "wouter";
import { useEffect, Suspense, lazy } from "react";
import ErrorBoundary from "./components/ErrorBoundary";
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
const NotFound = lazy(() => import("@/pages/NotFound"));
const ExternalBrainMapWindow = lazy(() => import("./components/window-system/ExternalBrainMapWindow"));

function Router() {
  // make sure to consider if you need authentication for certain routes
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/chat" component={Chat} />
        <Route path="/brain-map" component={BrainMap} />
        <Route path="/brain-map-external" component={ExternalBrainMapWindow} />
        <Route path="/model-hub" component={ModelHub} />
        <Route path="/pipelines" component={Pipelines} />
        <Route path="/integrations" component={Integrations} />
        <Route path="/settings" component={SettingsPage} />
        <Route path="/404" component={NotFound} />
        {/* Final fallback route */}
        <Route component={NotFound} />
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

  return (
    <ErrorBoundary>
      <ThemeProvider
        defaultTheme="dark"
        // switchable
      >
        <TooltipProvider>
          <CommandPalette />
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
