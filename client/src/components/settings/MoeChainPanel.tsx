/**
 * MoeChainPanel — Settings UI for configuring MoE Chain local and cloud chains.
 *
 * Two cards (Local Chain / Cloud Chain). Each shows an ordered list of steps.
 * Users can add, remove, reorder, enable/disable, and assign models per step.
 * Changes are saved via valetRouter.saveMoeChain.
 */
import { useState, useCallback, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  ChevronUp, ChevronDown, Plus, Trash2, Loader2,
  Cpu, Cloud, CheckCircle2, AlertCircle,
} from "lucide-react";
import { toast } from "sonner";

// ── Types ────────────────────────────────────────────────────────────────────

interface StepDraft {
  _id: string;        // client-only stable React key — never sent to server
  order: number;
  label: string;
  taskCategories: string[];
  modelPath?: string;
  ggufFile?: string;
  providerId?: string;
  modelId?: string;
  enabled: boolean;
}

function withId(step: Omit<StepDraft, "_id">): StepDraft {
  return { _id: crypto.randomUUID(), ...step };
}

// ── Step editor row ───────────────────────────────────────────────────────────

function StepRow({
  step,
  index,
  total,
  chainType,
  onChange,
  onMove,
  onRemove,
}: {
  step: StepDraft;
  index: number;
  total: number;
  chainType: "local" | "cloud";
  onChange: (updated: StepDraft) => void;
  onMove: (from: number, to: number) => void;
  onRemove: (index: number) => void;
}) {
  const set = (patch: Partial<StepDraft>) => onChange({ ...step, ...patch });

  return (
    <div className="border rounded-lg p-3 space-y-2 bg-card/50">
      <div className="flex items-center gap-2">
        <div className="flex flex-col gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            disabled={index === 0}
            onClick={() => onMove(index, index - 1)}
          >
            <ChevronUp className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            disabled={index === total - 1}
            onClick={() => onMove(index, index + 1)}
          >
            <ChevronDown className="h-3 w-3" />
          </Button>
        </div>

        <div className="flex-1 min-w-0">
          <Input
            value={step.label}
            onChange={e => set({ label: e.target.value })}
            placeholder="Step label"
            className="h-7 text-sm"
          />
        </div>

        <div className="flex items-center gap-1.5">
          <Switch
            id={`step-enabled-${index}`}
            checked={step.enabled}
            onCheckedChange={v => set({ enabled: v })}
          />
          <Label htmlFor={`step-enabled-${index}`} className="text-xs text-muted-foreground">
            {step.enabled ? "On" : "Off"}
          </Label>
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-destructive hover:text-destructive"
          onClick={() => onRemove(index)}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {chainType === "local" ? (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs text-muted-foreground mb-0.5 block">Model directory</Label>
            <Input
              value={step.modelPath ?? ""}
              onChange={e => set({ modelPath: e.target.value })}
              placeholder="~/.omnecor/models/specialist"
              className="h-7 text-xs"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground mb-0.5 block">GGUF file</Label>
            <Input
              value={step.ggufFile ?? ""}
              onChange={e => set({ ggufFile: e.target.value })}
              placeholder="model.gguf"
              className="h-7 text-xs"
            />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs text-muted-foreground mb-0.5 block">Provider ID</Label>
            <Input
              value={step.providerId ?? ""}
              onChange={e => set({ providerId: e.target.value })}
              placeholder="anthropic / openai / ollama"
              className="h-7 text-xs"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground mb-0.5 block">Model ID</Label>
            <Input
              value={step.modelId ?? ""}
              onChange={e => set({ modelId: e.target.value })}
              placeholder="claude-sonnet-4-6"
              className="h-7 text-xs"
            />
          </div>
        </div>
      )}

      <div>
        <Label className="text-xs text-muted-foreground mb-0.5 block">
          Task categories (comma-separated — leave blank to run on every task)
        </Label>
        <Input
          value={step.taskCategories.join(", ")}
          onChange={e =>
            set({
              taskCategories: e.target.value
                .split(",")
                .map(s => s.trim())
                .filter(Boolean),
            })
          }
          placeholder="code_generation, code_review"
          className="h-7 text-xs"
        />
      </div>
    </div>
  );
}

// ── Chain card ────────────────────────────────────────────────────────────────

function ChainCard({ chainType }: { chainType: "local" | "cloud" }) {
  const isLocal = chainType === "local";
  const { data, isLoading, refetch } = trpc.valet.getMoeChain.useQuery({ chainType });
  const save = trpc.valet.saveMoeChain.useMutation({
    onSuccess: () => toast.success(`${isLocal ? "Local" : "Cloud"} chain saved`),
    onError: e => toast.error(`Save failed: ${e.message}`),
  });

  const [steps, setSteps] = useState<StepDraft[] | undefined>(undefined);
  // hydrated tracks whether we've initialised from server data at least once.
  const [hydrated, setHydrated] = useState(false);

  const init = trpc.valet.initMoeChain.useMutation({
    onSuccess: () => {
      setHydrated(false); // force re-hydration when refetch resolves
      void refetch();
      toast.success("Chain initialised");
    },
    onError: e => toast.error(`Init failed: ${e.message}`),
  });

  // Hydrate from server data. Re-runs whenever data or hydrated changes so
  // that a forced reset (init scan) picks up the freshly seeded steps.
  useEffect(() => {
    if (data !== undefined && !hydrated) {
      const serverSteps = (data?.steps ?? []) as Omit<StepDraft, "_id">[];
      setSteps(serverSteps.map(withId));
      setHydrated(true);
    }
  }, [data, hydrated]);

  const workingSteps: StepDraft[] = steps ?? [];

  const handleChange = useCallback((index: number, updated: StepDraft) => {
    setSteps(prev => {
      if (!prev) return prev;
      const next = [...prev];
      next[index] = updated;
      return next;
    });
  }, []);

  const handleMove = useCallback((from: number, to: number) => {
    setSteps(prev => {
      if (!prev) return prev;
      const next = [...prev];
      [next[from], next[to]] = [next[to]!, next[from]!];
      return next.map((s, i) => ({ ...s, order: i }));
    });
  }, []);

  const handleRemove = useCallback((index: number) => {
    setSteps(prev => {
      if (!prev) return prev;
      return prev
        .filter((_, i) => i !== index)
        .map((s, i) => ({ ...s, order: i }));
    });
  }, []);

  const handleAdd = () => {
    setSteps(prev => {
      const next = prev ?? [];
      return [
        ...next,
        withId({
          order: next.length,
          label: `Step ${next.length + 1}`,
          taskCategories: [],
          enabled: false,
        }),
      ];
    });
  };

  const handleSave = () => {
    // Strip client-only _id before sending to the server schema
    const serverSteps = workingSteps.map(({ _id: _, ...rest }) => rest);
    save.mutate({ chainType, steps: serverSteps });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isLocal ? <Cpu className="h-4 w-4 text-muted-foreground" /> : <Cloud className="h-4 w-4 text-muted-foreground" />}
            <CardTitle className="text-sm">
              {isLocal ? "Local Chain (GGUF)" : "Cloud Chain"}
            </CardTitle>
          </div>
          {data ? (
            <Badge variant="secondary" className="flex items-center gap-1 text-xs">
              <CheckCircle2 className="h-3 w-3 text-green-500" />
              Configured
            </Badge>
          ) : (
            <Badge variant="outline" className="flex items-center gap-1 text-xs">
              <AlertCircle className="h-3 w-3 text-yellow-500" />
              Not set up
            </Badge>
          )}
        </div>
        <CardDescription className="text-xs">
          {isLocal
            ? "GGUF specialist models run sequentially. Only one model is in RAM at a time."
            : "Cloud provider specialists. Blocked in Sovereign mode."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="flex items-center justify-center py-4 text-muted-foreground text-sm gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : workingSteps.length === 0 ? (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              No steps configured yet. Use <strong>Scan models</strong> to auto-discover GGUFs,
              or add steps manually.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              disabled={init.isPending}
              onClick={() => init.mutate({ chainType })}
            >
              {init.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
              {isLocal ? "Scan models directory" : "Seed cloud chain template"}
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {[...workingSteps]
              .sort((a, b) => a.order - b.order)
              .map((step, i) => (
                <StepRow
                  key={step._id}
                  step={step}
                  index={i}
                  total={workingSteps.length}
                  chainType={chainType}
                  onChange={updated => handleChange(i, updated)}
                  onMove={handleMove}
                  onRemove={handleRemove}
                />
              ))}
          </div>
        )}

        <Separator />

        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleAdd} className="flex-1">
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Add step
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={save.isPending || workingSteps.length === 0}
            className="flex-1"
          >
            {save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
            Save chain
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Panel export ─────────────────────────────────────────────────────────────

export function MoeChainPanel() {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">MoE Chain</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Configure ordered chains of specialist models. The Valet Router activates
          chain routing automatically when it classifies a task as <code>moe_chain</code>.
          Use <strong>/MOE-Chain</strong> in chat for quick setup.
        </p>
      </div>
      <ChainCard chainType="local" />
      <ChainCard chainType="cloud" />
    </div>
  );
}
