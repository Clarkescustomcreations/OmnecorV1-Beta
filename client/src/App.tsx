import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import { useEffect } from "react";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import CommandPalette from "./components/CommandPalette";
import Dashboard from "./pages/Dashboard";
import Chat from "./pages/Chat";
import BrainMap from "./pages/BrainMap";
import ModelHub from "./pages/ModelHub";
import Pipelines from "./pages/Pipelines";
import Integrations from "./pages/Integrations";
import SettingsPage from "./pages/Settings";
import ExternalBrainMapWindow from "./components/window-system/ExternalBrainMapWindow";

function Router() {
  // make sure to consider if you need authentication for certain routes
  return (
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
      // Ctrl+K: Focus search
      if (e.ctrlKey && e.key === "k") {
        e.preventDefault();
        const searchInput = document.querySelector(
          'input[placeholder*="search"]'
        ) as HTMLInputElement;
        if (searchInput) searchInput.focus();
      }
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
