/**
 * Mobile bridge to the desktop's integrationsRouter (Gmail / Outlook / GitHub /
 * Notion / Slack / Drive). Per product decision we REUSE the PC's existing
 * connectors rather than reimplement OAuth on the phone — the phone supplies a
 * token, the PC validates + stores it encrypted and fetches live data, and the
 * model can then analyze that data in chat.
 *
 * All calls require a reachable PC (these are protected desktop procedures).
 */
import { trpcQuery, trpcMutate } from "./trpc-fetch";
import { askAi } from "./ai-chat";

export type IntegrationType =
  | "outlook" | "gmail" | "github" | "notion" | "slack"
  | "google-drive" | "dropbox" | "onedrive" | "generic";

/** Sources the mobile UI surfaces for chat analysis. */
export const CHAT_SOURCES: { type: IntegrationType; label: string; hint: string }[] = [
  { type: "github", label: "GitHub", hint: "Personal access token (repo scope)" },
  { type: "gmail", label: "Gmail", hint: "OAuth access token" },
  { type: "outlook", label: "Outlook", hint: "Microsoft Graph access token" },
];

export interface IntegrationStatus {
  type: IntegrationType;
  isConnected: boolean;
  connectedAt: string | null;
  metadata: Record<string, unknown> | null;
}

export async function listIntegrations(): Promise<IntegrationStatus[]> {
  return trpcQuery<IntegrationStatus[]>("integrations.getIntegrations");
}

export async function connectIntegration(type: IntegrationType, token: string) {
  return trpcMutate<{ success: boolean; metadata: Record<string, unknown> }>(
    "integrations.connect",
    { type, token }
  );
}

export async function syncIntegration(type: IntegrationType) {
  return trpcMutate<{ success: boolean; type: string; data: Record<string, unknown> }>(
    "integrations.sync",
    { type }
  );
}

export async function disconnectIntegration(type: IntegrationType) {
  return trpcMutate<{ success: boolean }>("integrations.disconnect", { type });
}

/**
 * Pull the latest data for a source and ask the model to analyze it.
 * Returns the assistant's analysis text. The desktop can additionally use the
 * detected content to auto-link chats to projects/neural maps.
 */
export async function analyzeSource(type: IntegrationType, question?: string): Promise<string> {
  const synced = await syncIntegration(type);
  const summary = JSON.stringify(synced?.data ?? {}, null, 2).slice(0, 6000);
  return askAi({
    prompt: question?.trim() || `Analyze my latest ${type} data and summarize what's important, plus anything that may need action.`,
    context: `Source: ${type}\nLatest data pulled from the connected ${type} account:\n${summary}`,
    systemPrompt: "You are an assistant analyzing the user's connected email/repository data. Be concise and actionable.",
  });
}
