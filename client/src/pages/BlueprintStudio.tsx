/**
 * Blueprint Studio — AI-assisted fabrication planning.
 *
 * The user describes a physical project (carpentry, metal fab, structures,
 * vehicles, 3D printing, multi-part costumes); an agentic planning session
 * (ChatAgentRunner + the Blueprint domain toolset) turns it into a persistent
 * Build Plan — BOM, cut lists, dimensioned drawings, 3D geometry, true-scale
 * patterns, deterministic engineering calcs / FEA, assembly steps — attached
 * to the active Neural Map and exportable as a PDF booklet.
 *
 * Layout: plans rail · planning conversation · Build Plan document tabs.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OmnecorDashboardLayout } from "@/components/OmnecorDashboardLayout";
import { trpc, vanillaTrpc } from "@/lib/trpc";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useNeuralMap } from "@/contexts/NeuralMapContext";
import { applyAgentEvent } from "@/lib/agentStream";
import type { ChatMessage, SelectedModel } from "@/lib/chatContext";
import type { AssistantBlock } from "@shared/chatBlocks";
import { BLUEPRINT_CATEGORIES } from "@shared/blueprint";
import { AssistantStream } from "@/components/chat/agentic/AssistantStream";
import { ModelSelector } from "@/components/chat/ModelSelector";
import { PlanTabs } from "@/components/blueprint/PlanTabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { HowToTooltip } from "@/components/shell/HowToTooltip";
import {
  DraftingCompass,
  FileDown,
  ImagePlus,
  Loader2,
  Plus,
  Send,
  Square,
  Trash2,
} from "lucide-react";

const MODEL_STORAGE_KEY = "omnecor:blueprint:model";

const CATEGORY_LABELS: Record<string, string> = {
  carpentry: "Carpentry / Woodworking",
  metal_fab: "Metal Fabrication",
  structure: "Structure (shed, deck, pergola…)",
  vehicle: "Vehicle / Frame",
  printing: "3D Printing / Prototype",
  costume: "Costume (fabric + foam + printed)",
  mixed: "Mixed materials",
  other: "Other",
};

export function BlueprintStudio() {
  const { activeMap } = useNeuralMap();
  const utils = trpc.useUtils();

  // ── Plans rail ────────────────────────────────────────────────────────────
  const plansQuery = trpc.blueprint.list.useQuery({});
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const engineStatus = trpc.blueprint.engineStatus.useQuery(undefined, { staleTime: 60_000 });

  const plans = plansQuery.data ?? [];
  const activePlanId = selectedPlanId ?? plans[0]?.id ?? null;

  const planQuery = trpc.blueprint.get.useQuery(
    { planId: activePlanId ?? "" },
    { enabled: !!activePlanId },
  );

  // ── New-plan intake ───────────────────────────────────────────────────────
  const [showIntake, setShowIntake] = useState(false);
  const [intake, setIntake] = useState({
    title: "",
    brief: "",
    category: "other" as (typeof BLUEPRINT_CATEGORIES)[number],
    units: "imperial" as "imperial" | "metric",
    cadEngine: "jscad" as "jscad" | "openscad",
  });
  const createPlan = trpc.blueprint.create.useMutation({
    onSuccess: async (res) => {
      setShowIntake(false);
      await utils.blueprint.list.invalidate();
      setSelectedPlanId(res.id);
      setIntake({ title: "", brief: "", category: "other", units: "imperial", cadEngine: "jscad" });
    },
    onError: (e) => toast.error(e.message),
  });
  const deletePlan = trpc.blueprint.delete.useMutation({
    onSuccess: async () => {
      setSelectedPlanId(null);
      await utils.blueprint.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  // ── Conversation ─────────────────────────────────────────────────────────
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const streamRef = useRef<{ unsubscribe: () => void } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [selectedModel, setSelectedModel] = useState<SelectedModel | undefined>(() => {
    try {
      const raw = localStorage.getItem(MODEL_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as SelectedModel) : undefined;
    } catch {
      return undefined;
    }
  });

  const messagesQuery = trpc.blueprint.listMessages.useQuery(
    { planId: activePlanId ?? "" },
    { enabled: !!activePlanId },
  );

  // Seed local messages from persistence whenever the plan (or history) changes
  // while not mid-stream.
  useEffect(() => {
    if (isStreaming || !messagesQuery.data) return;
    setMessages(
      messagesQuery.data.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: new Date(m.createdAt),
        tokens: m.tokenCount ?? undefined,
        blocks: (m.blocks as AssistantBlock[] | null) ?? undefined,
      })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messagesQuery.data, activePlanId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isStreaming]);

  // Tear down a live stream when leaving the page / switching plans.
  useEffect(() => {
    return () => {
      streamRef.current?.unsubscribe();
      streamRef.current = null;
    };
  }, [activePlanId]);

  const refreshPlan = useCallback(() => {
    if (activePlanId) void utils.blueprint.get.invalidate({ planId: activePlanId });
  }, [activePlanId, utils]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || !activePlanId || isStreaming) return;
    if (!selectedModel) {
      toast.error("Pick a model first (top of the conversation pane).");
      return;
    }
    try {
      localStorage.setItem(MODEL_STORAGE_KEY, JSON.stringify(selectedModel));
    } catch {
      /* storage full/blocked — selection just won't persist */
    }

    setInput("");
    setIsStreaming(true);
    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: "user", content: text, timestamp: new Date() };
    const assistantId = crypto.randomUUID();
    let assistantBlocks: AssistantBlock[] = [];
    setMessages((prev) => [
      ...prev,
      userMsg,
      { id: assistantId, role: "assistant", content: "", timestamp: new Date(), blocks: [] },
    ]);

    const writeBlocks = () =>
      setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, blocks: assistantBlocks } : m)));

    const sub = vanillaTrpc.blueprint.agentStream.subscribe(
      {
        planId: activePlanId,
        providerId: selectedModel.providerId,
        modelId: selectedModel.modelId,
        message: text,
        targetNodeId: selectedModel.targetNodeId,
      },
      {
        onData(ev) {
          assistantBlocks = applyAgentEvent(assistantBlocks, ev);
          if (ev.type === "done") {
            setIsStreaming(false);
            streamRef.current = null;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, blocks: assistantBlocks, content: ev.content, tokens: ev.totalTokens } : m,
              ),
            );
            refreshPlan();
          } else if (ev.type === "error") {
            setIsStreaming(false);
            streamRef.current = null;
            toast.error(`Stream error: ${ev.message}`);
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, content: `Error: ${ev.message}`, blocks: assistantBlocks } : m)),
            );
          } else {
            writeBlocks();
            // A finished tool box almost always means the plan document changed
            // — refresh the viewer live rather than waiting for turn end.
            if (ev.type === "block_end" && ev.block.type === "mcp") refreshPlan();
          }
        },
        onError(err) {
          setIsStreaming(false);
          streamRef.current = null;
          toast.error(`Stream failed: ${err.message}`);
        },
      },
    );
    streamRef.current = sub;
  }, [input, activePlanId, isStreaming, selectedModel, refreshPlan]);

  const handleStop = useCallback(() => {
    streamRef.current?.unsubscribe();
    streamRef.current = null;
    setIsStreaming(false);
    refreshPlan();
    void utils.blueprint.listMessages.invalidate({ planId: activePlanId ?? "" });
  }, [refreshPlan, utils, activePlanId]);

  // HITL resolution — blueprint tools don't gate, but a shared component wires
  // these; delegate to the same broker used by chat so nothing dangles.
  const resolveApproval = trpc.aiProvider.resolveToolApproval.useMutation();
  const onApprove = useCallback((id: string) => resolveApproval.mutate({ id, decision: "approve" }), [resolveApproval]);
  const onDeny = useCallback((id: string, reason?: string) => resolveApproval.mutate({ id, decision: "deny", denyReason: reason }), [resolveApproval]);

  // ── Export + concept render ───────────────────────────────────────────────
  const exportPdf = trpc.blueprint.exportPdf.useMutation({
    onSuccess: (res) => {
      const bytes = atob(res.contentBase64);
      const arr = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([arr], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = res.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      refreshPlan();
      toast.success(`Exported ${res.name}`);
    },
    onError: (e) => toast.error(`Export failed: ${e.message}`),
  });

  const [showConcept, setShowConcept] = useState(false);
  const [conceptPrompt, setConceptPrompt] = useState("");
  const [conceptProvider, setConceptProvider] = useState<"local" | "fal" | "openart">("local");
  const generateConcept = trpc.blueprint.generateConcept.useMutation({
    onSuccess: () => {
      setShowConcept(false);
      refreshPlan();
      toast.success("Concept render saved to the plan (Overview tab).");
    },
    onError: (e) => toast.error(e.message),
  });

  const activePlan = planQuery.data?.plan;

  return (
    <OmnecorDashboardLayout>
      <div className="flex h-full min-h-0">
        {/* ── Plans rail ─────────────────────────────────────────────────── */}
        <div className="flex w-60 flex-shrink-0 flex-col border-r border-border/60">
          <div className="flex items-center justify-between border-b border-border/60 p-3">
            <div className="flex items-center gap-2">
              <DraftingCompass className="h-5 w-5 text-primary" />
              <span className="text-sm font-semibold">Blueprints</span>
            </div>
            <HowToTooltip title="New plan" description="Start a new fabrication project plan" side="bottom">
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setShowIntake(true)}>
                <Plus className="h-4 w-4" />
              </Button>
            </HowToTooltip>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {plansQuery.isLoading ? (
              <div className="flex justify-center p-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : plans.length === 0 ? (
              <p className="p-2 text-xs text-muted-foreground">
                No plans yet. Describe any physical project — a workbench, a go-kart frame, a costume — and the AI turns it into a complete build plan.
              </p>
            ) : (
              <div className="space-y-1">
                {plans.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedPlanId(p.id)}
                    className={cn(
                      "group w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                      p.id === activePlanId ? "bg-primary/15 text-foreground" : "hover:bg-muted/60 text-muted-foreground",
                    )}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="truncate font-medium">{p.title}</span>
                      <Trash2
                        className="h-3.5 w-3.5 flex-shrink-0 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`Delete plan "${p.title}" and all its files?`)) deletePlan.mutate({ planId: p.id });
                        }}
                      />
                    </div>
                    <div className="mt-0.5 flex items-center gap-1">
                      <Badge variant="outline" className="px-1 py-0 text-[9px]">{p.category.replace("_", " ")}</Badge>
                      <Badge variant="secondary" className="px-1 py-0 text-[9px]">{p.status}</Badge>
                      {p.mapId && p.mapId === activeMap?.id && (
                        <Badge className="px-1 py-0 text-[9px]">this map</Badge>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {!activePlanId ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
            <DraftingCompass className="h-12 w-12 text-muted-foreground/50" />
            <h2 className="text-lg font-semibold">Blueprint Studio</h2>
            <p className="max-w-md text-sm text-muted-foreground">
              AI-assisted fabrication planning. Describe your project idea — carpentry, metal frames, structures, 3D-printed
              prototypes, multi-part costumes — and get a complete build plan: materials, cut lists with angles, dimensioned
              drawings, printable patterns, stress verification, and step-by-step assembly.
            </p>
            <Button onClick={() => setShowIntake(true)}><Plus className="mr-1 h-4 w-4" /> New plan</Button>
          </div>
        ) : (
          <>
            {/* ── Conversation ────────────────────────────────────────────── */}
            <div className="flex min-w-0 flex-1 basis-2/5 flex-col border-r border-border/60">
              <div className="flex items-center gap-2 border-b border-border/60 p-2">
                <ModelSelector selectedModel={selectedModel} onSelect={setSelectedModel} className="min-w-0 flex-1" />
                {isStreaming && (
                  <Button size="sm" variant="outline" onClick={handleStop}>
                    <Square className="mr-1 h-3.5 w-3.5" /> Stop
                  </Button>
                )}
              </div>
              <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
                {messages.length === 0 && (
                  <Card className="p-3 text-sm text-muted-foreground">
                    Describe your project to start planning. The agent records materials, cut lists, drawings and
                    calculations into the Build Plan on the right as you talk — every structural number is computed
                    deterministically, never guessed.
                  </Card>
                )}
                {messages.map((m, i) =>
                  m.role === "user" ? (
                    <div key={m.id} className="flex justify-end">
                      <div className="max-w-[85%] rounded-lg bg-primary/15 px-3 py-2 text-sm whitespace-pre-wrap">{m.content}</div>
                    </div>
                  ) : (
                    <AssistantStream
                      key={m.id}
                      message={m}
                      isStreaming={isStreaming && i === messages.length - 1}
                      isLast={i === messages.length - 1}
                      onApprove={onApprove}
                      onDeny={onDeny}
                    />
                  ),
                )}
              </div>
              <div className="border-t border-border/60 p-2">
                <div className="flex items-end gap-2">
                  <Textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                    placeholder={activePlan ? `Plan "${activePlan.title}" — describe, refine, or ask to verify…` : "Describe your project…"}
                    className="max-h-40 min-h-[44px] flex-1 resize-none"
                    disabled={isStreaming}
                  />
                  <Button size="icon" onClick={handleSend} disabled={isStreaming || !input.trim()}>
                    {isStreaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            </div>

            {/* ── Build Plan document ─────────────────────────────────────── */}
            <div className="flex min-w-0 flex-1 basis-3/5 flex-col">
              <div className="flex items-center justify-between gap-2 border-b border-border/60 p-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{activePlan?.title ?? "…"}</div>
                </div>
                <div className="flex flex-shrink-0 gap-2">
                  <HowToTooltip title="Concept render" description="Generate an AI concept image of the finished project" side="bottom">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setConceptPrompt(activePlan ? `${activePlan.title}. ${activePlan.brief}`.slice(0, 900) : "");
                        setShowConcept(true);
                      }}
                    >
                      <ImagePlus className="mr-1 h-4 w-4" /> Concept
                    </Button>
                  </HowToTooltip>
                  <HowToTooltip title="Export PDF" description="Export the full build plan as a printable PDF booklet" side="bottom">
                    <Button size="sm" onClick={() => activePlanId && exportPdf.mutate({ planId: activePlanId })} disabled={exportPdf.isPending}>
                      {exportPdf.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FileDown className="mr-1 h-4 w-4" />}
                      Export PDF
                    </Button>
                  </HowToTooltip>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden p-3">
                {planQuery.data ? (
                  <PlanTabs planId={activePlanId} data={planQuery.data} onRefresh={refreshPlan} />
                ) : (
                  <div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── New plan intake ──────────────────────────────────────────────── */}
      <Dialog open={showIntake} onOpenChange={setShowIntake}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New Build Plan</DialogTitle>
            <DialogDescription>
              Describe the project in your own words — the AI handles the math, materials, and drawings.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <label className="block text-sm">Project name
              <Input value={intake.title} onChange={(e) => setIntake({ ...intake, title: e.target.value })} placeholder="e.g. Heavy welding table" />
            </label>
            <label className="block text-sm">Project idea (be detailed — dimensions, purpose, loads, style)
              <Textarea
                value={intake.brief}
                onChange={(e) => setIntake({ ...intake, brief: e.target.value })}
                placeholder="e.g. A 4×2 ft welding table around 36 in tall, steel top, needs to hold ~500 lb, with a lower shelf and casters…"
                className="min-h-[110px]"
              />
            </label>
            <div className="grid grid-cols-3 gap-2">
              <label className="block text-sm">Category
                <Select value={intake.category} onValueChange={(v) => setIntake({ ...intake, category: v as typeof intake.category })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {BLUEPRINT_CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>{CATEGORY_LABELS[c]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="block text-sm">Units
                <Select value={intake.units} onValueChange={(v) => setIntake({ ...intake, units: v as "imperial" | "metric" })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="imperial">Imperial (ft/in)</SelectItem>
                    <SelectItem value="metric">Metric (mm/m)</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <label className="block text-sm">CAD engine
                <Select value={intake.cadEngine} onValueChange={(v) => setIntake({ ...intake, cadEngine: v as "jscad" | "openscad" })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="jscad">JSCAD (built-in)</SelectItem>
                    <SelectItem value="openscad">
                      OpenSCAD {engineStatus.data && !engineStatus.data.openscad.available ? "(not detected)" : ""}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </label>
            </div>
            {intake.cadEngine === "openscad" && engineStatus.data && !engineStatus.data.openscad.available && (
              <p className="text-xs text-accent-danger">
                OpenSCAD binary not found — install it and set its path in Settings → Advanced, or use the built-in JSCAD engine.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowIntake(false)}>Cancel</Button>
            <Button
              disabled={!intake.title.trim() || createPlan.isPending}
              onClick={() =>
                createPlan.mutate({
                  title: intake.title.trim(),
                  brief: intake.brief.trim(),
                  category: intake.category,
                  units: intake.units,
                  cadEngine: intake.cadEngine,
                  mapId: activeMap?.id,
                })
              }
            >
              {createPlan.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Create plan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Concept render dialog ────────────────────────────────────────── */}
      <Dialog open={showConcept} onOpenChange={setShowConcept}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate concept render</DialogTitle>
            <DialogDescription>An illustrative image of the finished project, saved to the plan's Overview.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Textarea value={conceptPrompt} onChange={(e) => setConceptPrompt(e.target.value)} className="min-h-[90px]" />
            <Select value={conceptProvider} onValueChange={(v) => setConceptProvider(v as typeof conceptProvider)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="local">Local (ComfyUI)</SelectItem>
                <SelectItem value="fal">fal.ai (cloud)</SelectItem>
                <SelectItem value="openart">OpenArt (cloud)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConcept(false)}>Cancel</Button>
            <Button
              disabled={!conceptPrompt.trim() || generateConcept.isPending}
              onClick={() => activePlanId && generateConcept.mutate({ planId: activePlanId, prompt: conceptPrompt.trim(), provider: conceptProvider })}
            >
              {generateConcept.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Generate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </OmnecorDashboardLayout>
  );
}
