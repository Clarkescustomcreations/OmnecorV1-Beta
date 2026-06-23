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
import { ChevronDown, Cpu, Cloud, Check, Sparkles } from "lucide-react";
import { getAllModels, API_MODEL_CATALOG, type AIModel } from "@/lib/aiModels";
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

export function ModelSelector({
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

  // Expand each online cloud provider into its concrete models (one row per
  // model), gated by live provider health. Providers not representable as a
  // chat providerId (forge/huggingface/llamacpp/custom) are intentionally
  // excluded — they aren't selectable as a chat model.
  const apiModels: AIModel[] = providerHealth
    .filter(p => p.status === "online" && p.id in API_MODEL_CATALOG)
    .flatMap(p => {
      const source = p.id as keyof typeof API_MODEL_CATALOG;
      return API_MODEL_CATALOG[source].map<AIModel>(model => ({
        id: model.id,
        name: model.name,
        displayName: model.name,
        type: "api" as const,
        source,
        status: "available" as const,
        costPer1kTokens: model.costPer1kTokens,
        capabilities: {
          chat: true,
          completion: true,
          embedding: source === "openai",
          vision: source === "openai" || source === "gemini",
          functionCalling: source === "openai" || source === "anthropic",
        },
      }));
    });

  const fetchedModels = [...localModels, ...apiModels];

  const models = fetchedModels.length > 0
    ? getAllModels(selectedModel?.modelId, fetchedModels)
    : getAllModels(selectedModel?.modelId);
  const local = models.filter(m => m.type === "local");
  const api = models.filter(m => m.type === "api");

  const isAuto = selectedModel?.modelId === "auto-valet";
  const label = isAuto
    ? "Auto · Valet Router"
    : selectedModel
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
        <DropdownMenuGroup>
          <DropdownMenuItem
            className={cn("text-xs font-semibold text-accent-purple", isAuto && "bg-accent-purple/10")}
            onClick={() => onSelect({ providerId: "system", modelId: "auto-valet" })}
          >
            <Check
              className={cn(
                "w-3 h-3 mr-1.5 flex-shrink-0",
                !isAuto && "opacity-0"
              )}
            />
            <Sparkles className="w-3.5 h-3.5 mr-2 text-accent-purple" />
            <div className="flex flex-col min-w-0">
              <span>Auto — Valet Router</span>
            </div>
          </DropdownMenuItem>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

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
              const isActive =
                selectedModel?.modelId === m.id &&
                selectedModel?.providerId === providerId;
              return (
                <DropdownMenuItem
                  key={m.id}
                  className={cn("text-xs", isActive && "bg-primary/30")}
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
          {api.length === 0 ? (
            <DropdownMenuItem disabled className="text-xs text-muted-foreground">
              No API providers online
            </DropdownMenuItem>
          ) : api.map(m => {
            const providerId = (SOURCE_TO_PROVIDER[m.source] ?? "openai") as ProviderId;
            const isActive =
              selectedModel?.modelId === m.id &&
              selectedModel?.providerId === providerId;
            return (
              <DropdownMenuItem
                key={m.id}
                className={cn("text-xs", isActive && "bg-primary/30")}
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
