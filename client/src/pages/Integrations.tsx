import OmnecorDashboardLayout from "@/components/OmnecorDashboardLayout";
import IntegrationsHub from "@/components/IntegrationsHub";
import MCPToolDirectory from "@/components/integrations/MCPToolDirectory";
import { Plug } from "lucide-react";

/**
 * Integrations Page
 *
 * Manages OAuth-based account linking for:
 * - GitHub (repositories, code integration)
 * - Notion (knowledge base, documentation)
 * - Slack (team communication, notifications)
 * - Cloud Storage (Google Drive, Dropbox, OneDrive)
 */
export default function Integrations() {
  return (
    <OmnecorDashboardLayout>
      <div className="h-full flex flex-col bg-background">
        <div className="border-b border-border bg-card px-6 py-4">
          <div className="flex items-center gap-3">
            <Plug className="w-6 h-6 text-accent" />
            <div>
              <h1 className="text-xl font-bold">Integrations</h1>
              <p className="text-sm text-muted-foreground">
                Connect third-party apps and services with OAuth
              </p>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-6 space-y-8">
          <IntegrationsHub />
          <div>
            <h2 className="text-lg font-semibold mb-4">MCP Tool Directory</h2>
            <MCPToolDirectory />
          </div>
        </div>
      </div>
    </OmnecorDashboardLayout>
  );
}
