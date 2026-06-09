import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { ChevronDown, Cpu, Cloud, Check } from "lucide-react";
import { getAllModels, type AIModel } from "@/lib/aiModels";
import { cn } from "@/lib/utils";
import type { SelectedModel } from "@/lib/chatContext";
import { trpc } from "@/lib/trpc";

interface ModelSelectorProps {
  selectedModel: SelectedModel | undefined;
  onSelect: (model: SelectedModel) => void;
  className?: string;
}

type ProviderId = SelectedModel["providerId"];

const SOURCE_TO_PROVIDER: Record<string, ProviderId> = {
  ollama: "ollama",
  llamacpp: "ollama",
  anthropic: "anthropic",
  openai: "openai",
  gemini: "gemini",
  grok: "grok",
  custom: "openai",
};

export default function ModelSelector({
  selectedModel,
  onSelect,
  className,
}: ModelSelectorProps) {
  const { data: ollamaModels = [] } = trpc.aiProvider.discoverOllamaModels.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const { data: providerHealth = [] } = trpc.aiProvider.getProviders.useQuery(undefined, {
    refetchInterval: 60_000,
  });

  const localModels: AIModel[] = ollamaModels.map(m => ({
    id: m.name,
    name: m.name,
    displayName: m.name,
    type: "local" as const,
    source: "ollama" as const,
    status: "available" as const,
    metadata: { size: m.size ?? 0 },
    capabilities: {
      chat: true,
      completion: true,
      embedding: false,
      vision: false,
      functionCalling: false,
    },
  }));

  const apiModels: AIModel[] = providerHealth
    .filter(p => p.id !== "ollama" && p.status === "online")
    .map(p => ({
      id: p.id,
      name: p.name,
      displayName: p.name,
      type: "api" as const,
      source: p.id as AIModel["source"],
      status: "available" as const,
      capabilities: {
        chat: true,
        completion: true,
        embedding: p.id === "openai",
        vision: p.id === "openai" || p.id === "gemini",
        functionCalling: p.id === "openai" || p.id === "anthropic",
      },
    }));

  const fetchedModels = [...localModels, ...apiModels];

  const models = fetchedModels.length > 0
    ? getAllModels(selectedModel?.modelId, fetchedModels)
    : getAllModels(selectedModel?.modelId);
  const local = models.filter(m => m.type === "local");
  const api = models.filter(m => m.type === "api");

  const label = selectedModel
    ? `${selectedModel.modelId} · ${selectedModel.providerId}`
    : "No model selected";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn("h-7 text-xs gap-1 max-w-[200px]", className)}
        >
          <span className="truncate">{label}</span>
          <ChevronDown className="w-3 h-3 flex-shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuLabel className="flex items-center gap-1.5 text-xs py-1">
          <Cpu className="w-3 h-3" />
          Local Models
        </DropdownMenuLabel>
        <DropdownMenuGroup>
          {local.length === 0 ? (
            <DropdownMenuItem disabled className="text-xs text-muted-foreground">
              No local models configured
            </DropdownMenuItem>
          ) : (
            local.map(m => {
              const providerId = SOURCE_TO_PROVIDER[m.source] ?? "ollama";
              const isActive = selectedModel?.modelId === m.id;
              return (
                <DropdownMenuItem
                  key={m.id}
                  className={cn("text-xs", isActive && "bg-accent/30")}
                  onClick={() => onSelect({ providerId, modelId: m.id })}
                >
                  <Check
                    className={cn(
                      "w-3 h-3 mr-1.5 flex-shrink-0",
                      !isActive && "opacity-0"
                    )}
                  />
                  <div className="flex flex-col min-w-0">
                    <span className="font-medium truncate">{m.name}</span>
                    <span className="text-[10px] text-muted-foreground truncate">
                      {m.source}
                    </span>
                  </div>
                </DropdownMenuItem>
              );
            })
          )}
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        <DropdownMenuLabel className="flex items-center gap-1.5 text-xs py-1">
          <Cloud className="w-3 h-3" />
          API Models
        </DropdownMenuLabel>
        <DropdownMenuGroup>
          {api.map(m => {
            const providerId = (SOURCE_TO_PROVIDER[m.source] ?? "openai") as ProviderId;
            const isActive = selectedModel?.modelId === m.id;
            return (
              <DropdownMenuItem
                key={m.id}
                className={cn("text-xs", isActive && "bg-accent/30")}
                onClick={() => onSelect({ providerId, modelId: m.id })}
              >
                <Check
                  className={cn(
                    "w-3 h-3 mr-1.5 flex-shrink-0",
                    !isActive && "opacity-0"
                  )}
                />
                <div className="flex flex-col min-w-0">
                  <span className="font-medium truncate">{m.name}</span>
                  <span className="text-[10px] text-muted-foreground truncate">
                    {m.source}
                    {m.costPer1kTokens &&
                      ` · $${m.costPer1kTokens.input}/1k in`}
                  </span>
                </div>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuGroup>

        {!selectedModel && (
          <>
            <DropdownMenuSeparator />
            <div className="px-2 py-1.5 text-[10px] text-muted-foreground">
              Configure API keys in Model Hub
            </div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
