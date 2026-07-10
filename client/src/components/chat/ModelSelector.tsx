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
import { useState, useEffect } from "react";
import { ChevronDown, Cpu, Cloud, Network, Check, Sparkles, Boxes } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SelectedModel } from "@/lib/chatContext";
import { trpc } from "@/lib/trpc";
import { getActiveModels } from "@/lib/aiModels";
import { describeCatalogHost, type CatalogEntry, type CatalogHostBrand } from "@shared/types/modelCatalog";

interface ModelSelectorProps {
  selectedModel: SelectedModel | undefined;
  onSelect: (model: SelectedModel) => void;
  className?: string;
}

type ProviderId = SelectedModel["providerId"];

interface CatalogGroup {
  label: string;
  brand: CatalogHostBrand;
  /** Node type drives the icon: local nodes get a chip, mesh nodes a network glyph. */
  isMesh: boolean;
  order: number;
  entries: CatalogEntry[];
}

/**
 * Icon per group. Omnecor's own runtime is the hero host (Sparkles, matching
 * the Auto·Valet mark), split by node type; Ollama is the muted fallback box;
 * cloud is the cloud glyph. Mesh Omnecor nodes still read as a network target.
 */
function groupIcon(g: CatalogGroup) {
  if (g.brand === "cloud") return Cloud;
  if (g.brand === "ollama") return Boxes;
  // Omnecor: distinguish this-PC from a mesh peer.
  return g.isMesh ? Network : Cpu;
}

export function ModelSelector({
  selectedModel,
  onSelect,
  className,
}: ModelSelectorProps) {
  // Model-Fabric Phase 8: the model we've asked the runtime to warm but that
  // isn't reported `loaded` by the catalog yet — drives the "loading…" hint.
  const [pendingModelId, setPendingModelId] = useState<string | null>(null);

  // Model-Fabric Phase 5: the unified catalog (Omnecor-owned runtime +
  // optional local Ollama + OMMESH mesh peers + configured cloud providers,
  // deduped and every entry already tool-capable) replaces the old
  // discoverOllamaModels + getProviders + hardcoded API_MODEL_CATALOG flow —
  // this is what makes a mesh-peer's model selectable at all. Poll faster while
  // a load is pending so the "loading… → loaded" flip feels responsive.
  const { data: catalog = [], isError: catalogError } = trpc.aiProvider.catalog.useQuery(undefined, {
    refetchInterval: pendingModelId ? 2_500 : 30_000,
  });

  // Model-Fabric Phase 8: selecting an Omnecor-runtime model pre-warms it. The
  // mutation is non-blocking (returns before the load finishes), so completion
  // is observed via the catalog's `loaded` flag, not the request. Clear the
  // pending marker once the catalog confirms it loaded, and give up after a
  // ceiling so a failed load can't leave a stuck "loading…" forever.
  const loadLocalModel = trpc.aiProvider.loadLocalModel.useMutation();
  useEffect(() => {
    if (!pendingModelId) return;
    if (catalog.some((e) => e.modelId === pendingModelId && e.loaded)) {
      setPendingModelId(null);
      return;
    }
    const t = setTimeout(() => setPendingModelId(null), 120_000);
    return () => clearTimeout(t);
  }, [pendingModelId, catalog]);

  // Local runtime + Ollama tags + mesh-peer models are naturally few and
  // every one of them is worth showing. Cloud is different: a provider's raw
  // model list is 100+ entries deep (embeddings, TTS, moderation, legacy
  // snapshots — most of them not chat models at all), so cloud entries are
  // still filtered down to the user's curated "active models" list (Model
  // Hub's existing toggle) — otherwise the catalog dump replaces a ~7-item
  // dropdown with a several-hundred-item one. Local/mesh never had this
  // problem (and no curation UI exists for them), so they stay unfiltered.
  const activeCloud = new Set(getActiveModels().map((m) => `${m.providerId}:${m.modelId}`));
  const visible = catalog.filter(
    (entry) => entry.location.type !== "cloud" || activeCloud.has(`${entry.providerId}:${entry.modelId}`)
  );

  // Model-Fabric follow-up (per-node Omnecor grouping): with Ollama now
  // optional and Omnecor hosting its own runtime — on this PC AND on any
  // number of OMMESH peers — each host node reads as its own distinct group
  // ("Omnecor · This PC", "Omnecor · <peer>"), with Ollama de-emphasized below.
  const groups = new Map<string, CatalogGroup>();
  for (const entry of visible) {
    const host = describeCatalogHost(entry);
    let group = groups.get(host.key);
    if (!group) {
      group = {
        label: host.label,
        brand: host.brand,
        isMesh: entry.location.type === "mesh-peer",
        order: host.order,
        entries: [],
      };
      groups.set(host.key, group);
    }
    group.entries.push(entry);
  }
  // Omnecor nodes first, then Ollama fallback, then cloud (order rank), ties by label.
  const orderedGroups = Array.from(groups.entries()).sort(
    ([, a], [, b]) => a.order - b.order || a.label.localeCompare(b.label)
  );

  const isAuto = selectedModel?.modelId === "auto-valet";
  const label = isAuto
    ? "Auto · Valet Router"
    : selectedModel
    ? `${selectedModel.modelId} · ${selectedModel.providerId}`
    : "No model selected";

  const isEntryActive = (entry: CatalogEntry) =>
    selectedModel?.modelId === entry.modelId &&
    selectedModel?.providerId === entry.providerId &&
    (entry.location.type !== "mesh-peer" || selectedModel?.targetNodeId === entry.location.nodeId);

  const handleSelect = (entry: CatalogEntry) => {
    onSelect({
      providerId: entry.providerId as ProviderId,
      modelId: entry.modelId,
      targetNodeId: entry.location.type === "mesh-peer" ? entry.location.nodeId : undefined,
    });
    // Pre-warm a local Omnecor-runtime model on select (skip if already loaded).
    if (
      entry.location.type === "local" &&
      entry.location.backend === "omnecor-runtime" &&
      !entry.loaded
    ) {
      setPendingModelId(entry.modelId);
      loadLocalModel.mutate({ modelId: entry.modelId });
    }
  };

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

        {groups.size === 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled className="text-xs text-muted-foreground">
              {catalogError
                ? "Couldn't reach the server to load models — check your connection and retry"
                : "No models available — Omnecor's local runtime needs a GGUF model, or add a cloud API key / join an OMMESH peer"}
            </DropdownMenuItem>
          </>
        ) : (
          orderedGroups.map(([key, group]) => {
            const Icon = groupIcon(group);
            const isOmnecor = group.brand === "omnecor";
            return (
              <div key={key}>
                <DropdownMenuSeparator />
                <DropdownMenuLabel
                  className={cn(
                    "flex items-center gap-1.5 text-xs py-1",
                    isOmnecor ? "text-accent-purple font-semibold" : "text-muted-foreground"
                  )}
                >
                  <Icon className="w-3 h-3" />
                  {group.label}
                </DropdownMenuLabel>
                <DropdownMenuGroup>
                  {group.entries.map((entry) => {
                    const active = isEntryActive(entry);
                    // Omnecor-runtime models load on demand: show which one is
                    // warm now vs. mid-swap so the ~10–30s cold load reads as
                    // intentional, not a hang.
                    const isRuntime =
                      entry.location.type === "local" && entry.location.backend === "omnecor-runtime";
                    const isLoadingThis = pendingModelId === entry.modelId && !entry.loaded;
                    return (
                      <DropdownMenuItem
                        key={entry.key}
                        className={cn("text-xs", active && "bg-primary/30")}
                        onClick={() => handleSelect(entry)}
                      >
                        <Check
                          className={cn(
                            "w-3 h-3 mr-1.5 flex-shrink-0",
                            !active && "opacity-0"
                          )}
                        />
                        <div className="flex flex-col min-w-0 flex-1">
                          <span className="font-medium truncate">{entry.name}</span>
                          <span className="text-[10px] text-muted-foreground truncate">
                            {entry.providerId}
                          </span>
                        </div>
                        {isRuntime && (isLoadingThis ? (
                          <span className="ml-2 text-[10px] text-accent-purple flex-shrink-0">loading…</span>
                        ) : entry.loaded ? (
                          <span className="ml-2 h-1.5 w-1.5 rounded-full bg-accent-success flex-shrink-0" title="Loaded" />
                        ) : null)}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuGroup>
              </div>
            );
          })
        )}

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
