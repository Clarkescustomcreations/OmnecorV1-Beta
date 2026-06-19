import { OmnecorDashboardLayout } from "@/components/OmnecorDashboardLayout";
import { IntegrationsHub } from "@/components/IntegrationsHub";
import { MCPToolDirectory } from "@/components/integrations/MCPToolDirectory";
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
export function Integrations() {
  return (
    <OmnecorDashboardLayout>
      <div className="h-full flex flex-col bg-background">
        <div className="border-b border-border bg-card px-4 sm:px-6 py-3 sm:py-4">
          <div className="flex items-center gap-3 min-w-0">
            <Plug className="w-6 h-6 text-accent flex-shrink-0" />
            <div className="min-w-0">
              <h1 className="text-xl font-bold truncate">Integrations</h1>
              <p className="text-sm text-muted-foreground truncate">
                Connect third-party apps and services with OAuth
              </p>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6 space-y-8">
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
