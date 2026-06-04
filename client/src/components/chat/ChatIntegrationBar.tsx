import { trpc } from "@/lib/trpc";
import { type IntegrationType, INTEGRATION_FEATURES } from "@/lib/integrations";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";

const CHAT_INTEGRATION_ICONS: Partial<Record<IntegrationType, string>> = {
  outlook: "📧",
  gmail:   "✉️",
  github:  "🐙",
};

interface ChatIntegrationBarProps {
  onInjectContext: (snippet: string) => void;
}

export default function ChatIntegrationBar({ onInjectContext }: ChatIntegrationBarProps) {
  const { data: integrations } = trpc.integrations.getIntegrations.useQuery(undefined, {
    staleTime: 60_000,
  });

  const chatEnabled = integrations?.filter(i =>
    i.isConnected && INTEGRATION_FEATURES[i.type as IntegrationType]?.includes("chat")
  ) ?? [];

  if (chatEnabled.length === 0) return null;

  const handleUse = (type: string, name: string) => {
    const snippet = `Use my connected ${name} account to assist with this conversation. Pull relevant context (recent emails, repo info, etc.) as needed.`;
    onInjectContext(snippet);
    toast.success(`${name} context injected`);
  };

  return (
    <div className="flex items-center gap-2 px-1 flex-shrink-0">
      <span className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">
        Integrations
      </span>
      {chatEnabled.map(i => {
        const icon = CHAT_INTEGRATION_ICONS[i.type as IntegrationType] ?? "🔌";
        const meta = i.metadata as Record<string, unknown> | null;
        const label = String(meta?.username ?? i.type);
        return (
          <Tooltip key={i.type}>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-[11px] gap-1"
                onClick={() => handleUse(i.type, String(i.type).replace("-", " ").replace(/\b\w/g, c => c.toUpperCase()))}
              >
                <span>{icon}</span>
                <span className="truncate max-w-[80px]">{label}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              Inject {i.type} context into chat
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
