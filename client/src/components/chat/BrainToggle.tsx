/**
 * BrainToggle — per-chat Brain Pack selector (Brains-Upgrade Phase 8).
 *
 * A compact toolbar control above the chat input that lets the user toggle which
 * of their Brain Packs augment the current chat. The selection lives in the app
 * store (`activeBrainIds`) and is read at stream time in Chat.tsx, threaded to
 * `aiProvider.agentChatStream` as `brainIds` — the server injects each brain's
 * charter + retrieves its top-k corpus, unioned with any persona-durable brains.
 *
 * Incompatible brains (embedder mismatch) are shown but disabled: their corpus
 * isn't indexed, so per-chat retrieval can't use them here (their charter still
 * applies when attached durably to a persona). Follows Context/UI-Rules.md
 * (unique ids, hover transitions).
 */
import { trpc } from "@/lib/trpc";
import { useAppStore } from "@/lib/store/app.store";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BrainCircuit, AlertTriangle } from "lucide-react";

export function BrainToggle() {
  const { data: rawBrains = [] } = trpc.brains.list.useQuery();
  const brains = rawBrains.filter((b): b is NonNullable<typeof b> => b !== null);
  const activeBrainIds = useAppStore((s) => s.activeBrainIds);
  const toggleActiveBrain = useAppStore((s) => s.toggleActiveBrain);

  // Nothing to offer until the user has imported at least one brain.
  if (brains.length === 0) return null;

  const activeCount = brains.filter((b) => activeBrainIds.includes(b.id)).length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          id="btn-chat-brains-toggle"
          type="button"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors cursor-pointer",
            activeCount > 0
              ? "border-accent-purple/50 bg-accent-purple/10 text-accent-purple"
              : "border-border bg-muted/40 text-muted-foreground hover:bg-bg-elevated/50",
          )}
          title="Attach Brain Packs to this chat"
        >
          <BrainCircuit className="w-3.5 h-3.5" />
          Brains
          {activeCount > 0 && (
            <Badge className="ml-0.5 h-4 min-w-4 justify-center px-1 text-[10px] bg-accent-purple text-white border-transparent">
              {activeCount}
            </Badge>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Attach brains to this chat</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {brains.map((brain) => {
          const usable = brain.status === "ready" && brain.embedderMatch;
          return (
            <DropdownMenuCheckboxItem
              key={brain.id}
              id={`chk-chat-brain-${brain.id}`}
              checked={activeBrainIds.includes(brain.id)}
              disabled={!usable}
              onCheckedChange={() => toggleActiveBrain(brain.id)}
              onSelect={(e) => e.preventDefault()}
              className="cursor-pointer"
            >
              <span className="flex items-center gap-1.5 min-w-0">
                <span className="truncate">{brain.name}</span>
                {!usable && (
                  <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0" aria-label="Embedder incompatible — corpus not indexed" />
                )}
              </span>
            </DropdownMenuCheckboxItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
