/**
 * Blueprint Studio (mobile) — AI-assisted fabrication planning.
 *
 * Core-depth native port of `client/src/pages/BlueprintStudio.tsx`. Describe a
 * physical project; an agentic planning session (the desktop `ChatAgentRunner`
 * + the Blueprint domain toolset, streamed over `blueprint.agentStream`) turns
 * it into a persistent Build Plan — BOM, cut lists, drawings, calcs, steps —
 * rendered read-only here and exportable as a PDF. The planning conversation
 * reuses the app's shared agentic stream infra (`getAgentTrpc`, `applyAgentEvent`,
 * `AssistantStream`); every other `blueprint.*` call goes through the untyped
 * HTTP helpers. On phones the two web panes become a "Planning | Build Plan"
 * segmented control.
 */
import { View, Text, TextInput, ScrollView, ActivityIndicator, Alert, Modal, KeyboardAvoidingView, Platform } from "react-native";
import { Pressable } from "@/components/pressable";
import { useCallback, useEffect, useRef, useState } from "react";
import { router, useLocalSearchParams, useFocusEffect } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { trpcQuery, trpcMutate } from "@/lib/_core/trpc-fetch";
import { isServerConfigured } from "@/lib/_core/server-config";
import { getAgentTrpc } from "@/lib/trpc";
import { applyAgentEvent } from "@/lib/_core/agent-stream";
import { type AssistantBlock } from "@/lib/_core/agent-blocks";
import { AssistantStream } from "@/components/agentic/assistant-stream";
import { listCatalogGroups, PHONE_PROVIDER_ID, type ChatModel, type ModelGroup } from "@/lib/_core/ai-models";
import { saveBase64File } from "@/lib/_core/file-export";
import { PlanDocument, type PlanData, type PlanFile } from "@/components/blueprint/PlanDocument";
import { useChatDisplaySettings } from "@/hooks/use-chat-display-settings";
import AsyncStorage from "@react-native-async-storage/async-storage";

const MODEL_KEY = "omnecor:blueprint:model";
const CATEGORIES = ["carpentry", "metal_fab", "structure", "vehicle", "printing", "costume", "mixed", "other"] as const;
const CATEGORY_LABELS: Record<string, string> = {
  carpentry: "Carpentry", metal_fab: "Metal Fab", structure: "Structure", vehicle: "Vehicle",
  printing: "3D Printing", costume: "Costume", mixed: "Mixed", other: "Other",
};

interface PlanRow { id: string; title: string; category: string; status: string; mapId: string | null }
interface SelectedModel { providerId: string; modelId: string; name: string; targetNodeId?: string }
interface UiMessage { id: string; role: "user" | "assistant"; content: string; blocks?: AssistantBlock[] }
interface MapRow { id: string; name: string }

export default function BlueprintScreen() {
  const params = useLocalSearchParams<{ planId?: string }>();
  const { settings } = useChatDisplaySettings();
  const colors = useColors();

  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [activePlanId, setActivePlanId] = useState<string | null>(null);
  const [planData, setPlanData] = useState<PlanData | null>(null);
  const [docError, setDocError] = useState(false);
  const [conceptUri, setConceptUri] = useState<string | null>(null);
  const [tab, setTab] = useState<"chat" | "doc">("chat");
  const [loadingPlans, setLoadingPlans] = useState(true);

  // Conversation
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const streamRef = useRef<{ unsubscribe: () => void } | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  // Model
  const [selectedModel, setSelectedModel] = useState<SelectedModel | null>(null);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [groups, setGroups] = useState<ModelGroup[]>([]);
  const [modelsByGroup, setModelsByGroup] = useState<Record<string, ChatModel[]>>({});

  // Intake + concept
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [conceptOpen, setConceptOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [maps, setMaps] = useState<MapRow[]>([]);
  const [activeMapId, setActiveMapId] = useState<string | null>(null);

  // ── load plans ─────────────────────────────────────────────────────────────
  const loadPlans = useCallback(async () => {
    if (!isServerConfigured()) { setLoadingPlans(false); return; }
    try {
      const rows = await trpcQuery<PlanRow[]>("blueprint.list", {}).catch((): PlanRow[] => []);
      setPlans(rows);
      setActivePlanId((cur) => cur ?? (typeof params.planId === "string" ? params.planId : null) ?? rows[0]?.id ?? null);
    } finally { setLoadingPlans(false); }
  }, [params.planId]);
  useEffect(() => { void loadPlans(); }, [loadPlans]);
  useFocusEffect(useCallback(() => { void loadPlans(); }, [loadPlans]));

  // Restore persisted model + fetch the catalog (phone models excluded — the
  // planning loop runs on the desktop, not the on-device engine).
  useEffect(() => {
    AsyncStorage.getItem(MODEL_KEY).then((raw) => { if (raw) try { setSelectedModel(JSON.parse(raw)); } catch { /* ignore */ } });
    if (!isServerConfigured()) return;
    void (async () => {
      try {
        const { groups: g, modelsByGroup: m } = await listCatalogGroups();
        setGroups(g.filter((x) => x.id !== PHONE_PROVIDER_ID));
        setModelsByGroup(m);
      } catch { /* offline — picker stays empty */ }
    })();
  }, []);

  // ── load the active plan document + history ──────────────────────────────────
  const loadPlanDoc = useCallback(async (planId: string) => {
    setDocError(false);
    let data: PlanData;
    try {
      data = await trpcQuery<PlanData>("blueprint.get", { planId });
    } catch {
      setPlanData(null);
      setDocError(true);
      return;
    }
    setPlanData(data);
    // Best-effort concept image for the Overview.
    const concept = data.files?.filter((f) => f.kind === "concept_image").slice(-1)[0];
    if (concept) {
      trpcQuery<{ contentBase64: string; mimeType: string }>("blueprint.getFile", { planId, fileId: concept.id })
        .then((r) => setConceptUri(`data:${r.mimeType};base64,${r.contentBase64}`))
        .catch(() => setConceptUri(null));
    } else setConceptUri(null);
  }, []);

  useEffect(() => {
    if (!activePlanId) { setPlanData(null); setMessages([]); return; }
    void loadPlanDoc(activePlanId);
    if (!isStreaming) {
      trpcQuery<{ id: string; role: "user" | "assistant"; content: string; blocks: AssistantBlock[] | null }[]>("blueprint.listMessages", { planId: activePlanId })
        .then((rows) => setMessages(rows.map((m) => ({ id: m.id, role: m.role, content: m.content, blocks: m.blocks ?? undefined }))))
        .catch(() => setMessages([]));
    }
    return () => { streamRef.current?.unsubscribe(); streamRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePlanId]);

  useEffect(() => { scrollRef.current?.scrollToEnd({ animated: true }); }, [messages, isStreaming]);

  // ── HITL (blueprint tools don't gate; wire the shared broker anyway) ─────────
  const onApprove = useCallback((id: string) => { void trpcMutate("aiProvider.resolveToolApproval", { id, decision: "approve" }); }, []);
  const onDeny = useCallback((id: string, reason?: string) => { void trpcMutate("aiProvider.resolveToolApproval", { id, decision: "deny", denyReason: reason }); }, []);

  // ── send a planning turn ─────────────────────────────────────────────────────
  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || !activePlanId || isStreaming) return;
    if (!selectedModel) { Alert.alert("Pick a model", "Choose a model at the top of the planning pane first."); return; }
    setInput("");
    setIsStreaming(true);
    setTab("chat");
    const assistantId = `a-${Date.now()}`;
    let blocks: AssistantBlock[] = [];
    setMessages((prev) => [
      ...prev,
      { id: `u-${Date.now()}`, role: "user", content: text },
      { id: assistantId, role: "assistant", content: "", blocks: [] },
    ]);
    const writeBlocks = () => setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, blocks } : m)));

    let client: ReturnType<typeof getAgentTrpc>;
    try { client = getAgentTrpc(); }
    catch (e) { setIsStreaming(false); Alert.alert("Not connected", e instanceof Error ? e.message : String(e)); return; }

    const sub = client.blueprint.agentStream.subscribe(
      { planId: activePlanId, providerId: selectedModel.providerId, modelId: selectedModel.modelId, message: text, targetNodeId: selectedModel.targetNodeId },
      {
        onData(ev) {
          blocks = applyAgentEvent(blocks, ev);
          if (ev.type === "done") {
            setIsStreaming(false); streamRef.current = null;
            setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, blocks, content: ev.content } : m)));
            void loadPlanDoc(activePlanId);
          } else if (ev.type === "error") {
            setIsStreaming(false); streamRef.current = null;
            setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: `Error: ${ev.message}`, blocks } : m)));
          } else {
            writeBlocks();
            // A finished tool box almost always changed the plan — refresh live.
            if (ev.type === "block_end" && ev.block.type === "mcp") void loadPlanDoc(activePlanId);
          }
        },
        onError(err) { setIsStreaming(false); streamRef.current = null; Alert.alert("Stream failed", err.message); },
      },
    );
    streamRef.current = sub;
  }, [input, activePlanId, isStreaming, selectedModel, loadPlanDoc]);

  const handleStop = useCallback(() => {
    streamRef.current?.unsubscribe(); streamRef.current = null; setIsStreaming(false);
    if (activePlanId) void loadPlanDoc(activePlanId);
  }, [activePlanId, loadPlanDoc]);

  // ── plan CRUD + export ───────────────────────────────────────────────────────
  const pickModel = (m: ChatModel) => {
    if (!m.providerId) return;
    const sel: SelectedModel = { providerId: m.providerId, modelId: m.id, name: m.name, targetNodeId: m.targetNodeId };
    setSelectedModel(sel);
    void AsyncStorage.setItem(MODEL_KEY, JSON.stringify(sel));
    setModelPickerOpen(false);
  };

  const openIntake = () => {
    setIntakeOpen(true);
    trpcQuery<MapRow[]>("neuralMaps.list").then(setMaps).catch(() => setMaps([]));
    trpcQuery<{ activeMapId: string | null }>("neuralMaps.getActiveMapId").then((r) => setActiveMapId(r.activeMapId)).catch(() => {});
  };

  const exportPdf = useCallback(async () => {
    if (!activePlanId) return;
    setExporting(true);
    try {
      const r = await trpcMutate<{ name: string; contentBase64: string }>("blueprint.exportPdf", { planId: activePlanId });
      const saved = await saveBase64File(r.contentBase64, r.name, "application/pdf");
      if (saved.ok) Alert.alert("Exported", `Saved ${r.name}.`);
      else if (saved.reason !== "cancelled") Alert.alert("Export failed", saved.message ?? "Could not save the PDF.");
      void loadPlanDoc(activePlanId);
    } catch (e) { Alert.alert("Export failed", e instanceof Error ? e.message : String(e)); }
    finally { setExporting(false); }
  }, [activePlanId, loadPlanDoc]);

  const openFile = useCallback(async (file: PlanFile) => {
    if (!activePlanId) return;
    try {
      const r = await trpcQuery<{ contentBase64: string; mimeType: string; name: string }>("blueprint.getFile", { planId: activePlanId, fileId: file.id });
      const saved = await saveBase64File(r.contentBase64, r.name, r.mimeType);
      if (saved.ok) Alert.alert("Saved", r.name);
      else if (saved.reason !== "cancelled") Alert.alert("Save failed", saved.message ?? "Could not save the file.");
    } catch (e) { Alert.alert("Failed", e instanceof Error ? e.message : String(e)); }
  }, [activePlanId]);

  // Fetch a file's bytes for inline rendering (SVG drawings/patterns in the doc).
  const getFileContent = useCallback(async (fileId: string): Promise<{ contentBase64: string; mimeType: string } | null> => {
    if (!activePlanId) return null;
    try {
      const r = await trpcQuery<{ contentBase64: string; mimeType: string }>("blueprint.getFile", { planId: activePlanId, fileId });
      return { contentBase64: r.contentBase64, mimeType: r.mimeType };
    } catch { return null; }
  }, [activePlanId]);

  const deletePlan = (plan: PlanRow) => Alert.alert("Delete plan", `Delete "${plan.title}" and all its files?`, [
    { text: "Cancel", style: "cancel" },
    { text: "Delete", style: "destructive", onPress: async () => {
      await trpcMutate("blueprint.delete", { planId: plan.id }).catch(() => {});
      setActivePlanId((cur) => (cur === plan.id ? null : cur));
      void loadPlans();
    } },
  ]);

  const activePlan = plans.find((p) => p.id === activePlanId);

  return (
    <ScreenContainer>
      {/* Header */}
      <View className="flex-row items-center gap-2 px-4 py-3 border-b border-border">
        <Pressable testID="btn-blueprint-back" onPress={() => router.back()} className="w-9 h-9 items-center justify-center rounded-lg active:opacity-60">
          <Text className="text-foreground text-xl">‹</Text>
        </Pressable>
        <View className="flex-1 min-w-0">
          <Text className="text-lg font-bold text-foreground" numberOfLines={1}>{activePlan?.title ?? "Blueprint Studio"}</Text>
          <Text className="text-xs text-muted" numberOfLines={1}>AI-assisted fabrication planning</Text>
        </View>
        {activePlan && (
          <Pressable testID="btn-blueprint-delete" onPress={() => deletePlan(activePlan)} className="w-9 h-9 items-center justify-center rounded-lg active:opacity-60">
            <Text className="text-destructive text-base">🗑</Text>
          </Pressable>
        )}
        {activePlanId && (
          <Pressable testID="btn-blueprint-export" disabled={exporting} onPress={exportPdf} className="rounded-lg bg-primary px-3 py-2 active:opacity-60">
            {exporting ? <ActivityIndicator size="small" color={colors.background} /> : <Text className="text-xs font-semibold text-background">Export PDF</Text>}
          </Pressable>
        )}
      </View>

      {/* Plans rail */}
      <View className="flex-row items-center border-b border-border">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8, gap: 8 }} className="flex-1">
          {plans.map((p) => (
            <Pressable key={p.id} testID={`chip-plan-select-${p.id}`} onPress={() => setActivePlanId(p.id)} onLongPress={() => deletePlan(p)}
              className={`rounded-full px-3 py-1.5 ${p.id === activePlanId ? "bg-primary" : "bg-surface border border-border"}`}>
              <Text className={`text-xs font-semibold ${p.id === activePlanId ? "text-background" : "text-foreground"}`} numberOfLines={1}>{p.title}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <Pressable testID="btn-blueprint-new" onPress={openIntake} className="px-4 py-2 border-l border-border active:opacity-60">
          <Text className="text-primary text-lg font-bold">＋</Text>
        </Pressable>
      </View>

      {loadingPlans ? (
        <View className="flex-1 items-center justify-center"><ActivityIndicator /></View>
      ) : !activePlanId ? (
        <View className="flex-1 items-center justify-center gap-3 px-8">
          <Text className="text-4xl">📐</Text>
          <Text className="text-base font-semibold text-foreground text-center">Blueprint Studio</Text>
          <Text className="text-sm text-muted text-center">
            Describe a project — carpentry, metal frames, structures, 3D prints, costumes — and get a complete build plan: materials, cut lists with angles, drawings, stress checks and assembly steps.
          </Text>
          <Pressable testID="btn-blueprint-empty-new" onPress={openIntake} className="rounded-lg bg-primary px-4 py-2.5 active:opacity-60">
            <Text className="text-sm font-semibold text-background">＋ New plan</Text>
          </Pressable>
        </View>
      ) : (
        <>
          {/* Planning | Build Plan segmented control */}
          <View className="flex-row gap-2 px-4 py-2 border-b border-border">
            {(["chat", "doc"] as const).map((t) => (
              <Pressable key={t} testID={`seg-blueprint-${t}`} onPress={() => setTab(t)}
                className={`flex-1 rounded-lg py-2 items-center ${tab === t ? "bg-primary" : "bg-surface border border-border"}`}>
                <Text className={`text-sm font-semibold ${tab === t ? "text-background" : "text-foreground"}`}>{t === "chat" ? "Planning" : "Build Plan"}</Text>
              </Pressable>
            ))}
          </View>

          {tab === "chat" ? (
            <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "ios" ? "padding" : undefined}>
              {/* Model picker row */}
              <View className="flex-row items-center gap-2 px-4 py-2 border-b border-border">
                <Pressable testID="btn-blueprint-model" onPress={() => setModelPickerOpen(true)} className="flex-1 rounded-lg border border-border bg-background px-3 py-2 active:opacity-60">
                  <Text className="text-xs text-muted">Model</Text>
                  <Text className="text-sm text-foreground" numberOfLines={1}>{selectedModel?.name ?? "Pick a model…"}</Text>
                </Pressable>
                {isStreaming && (
                  <Pressable testID="btn-blueprint-stop" onPress={handleStop} className="rounded-lg border border-border bg-surface px-3 py-2.5 active:opacity-60">
                    <Text className="text-xs font-semibold text-foreground">Stop</Text>
                  </Pressable>
                )}
              </View>

              <ScrollView ref={scrollRef} className="flex-1" contentContainerStyle={{ padding: 12, gap: 12 }}>
                {messages.length === 0 && (
                  <Text className="text-sm text-muted">Describe your project to start planning. The agent records materials, cut lists, drawings and calcs into the Build Plan as you talk — every structural number is computed, never guessed.</Text>
                )}
                {messages.map((m, i) => m.role === "user" ? (
                  <View key={m.id} className="items-end">
                    <View className="max-w-[85%] rounded-2xl bg-primary/15 px-3 py-2"><Text className="text-sm text-foreground">{m.content}</Text></View>
                  </View>
                ) : (
                  <AssistantStream
                    key={m.id}
                    messageId={m.id}
                    blocks={m.blocks}
                    content={m.content}
                    isStreaming={isStreaming && i === messages.length - 1}
                    showQuotes={settings.showThinkingQuotes}
                    quoteStyle={settings.quoteStyle}
                    onApprove={onApprove}
                    onDeny={onDeny}
                    onRunCode={() => {}}
                    onPreviewCode={() => {}}
                  />
                ))}
              </ScrollView>

              <View className="flex-row items-end gap-2 px-3 py-2 border-t border-border">
                <TextInput
                  testID="input-blueprint-message"
                  value={input}
                  onChangeText={setInput}
                  placeholder={activePlan ? `Refine "${activePlan.title}"…` : "Describe your project…"}
                  placeholderTextColor={colors.muted}
                  multiline
                  editable={!isStreaming}
                  className="flex-1 max-h-32 rounded-2xl border border-border bg-background px-3 py-2 text-foreground"
                />
                <Pressable testID="btn-blueprint-send" onPress={handleSend} disabled={isStreaming || !input.trim()}
                  className={`rounded-full w-11 h-11 items-center justify-center ${isStreaming || !input.trim() ? "bg-surface border border-border" : "bg-primary"}`}>
                  {isStreaming ? <ActivityIndicator size="small" /> : <Text className="text-background text-lg">↑</Text>}
                </Pressable>
              </View>
            </KeyboardAvoidingView>
          ) : (
            <View className="flex-1">
              <View className="flex-row justify-end px-4 py-2 gap-2 border-b border-border">
                <Pressable testID="btn-blueprint-concept" onPress={() => setConceptOpen(true)} className="rounded-lg border border-border bg-surface px-3 py-2 active:opacity-60">
                  <Text className="text-xs font-semibold text-foreground">＋ Concept render</Text>
                </Pressable>
              </View>
              {planData ? (
                <PlanDocument data={planData} conceptDataUri={conceptUri} onOpenFile={openFile} getFileContent={getFileContent} />
              ) : docError ? (
                <View className="flex-1 items-center justify-center gap-3 px-8">
                  <Text className="text-sm text-muted text-center">{"Couldn't load this Build Plan."}</Text>
                  <Pressable testID="btn-blueprint-doc-retry" onPress={() => activePlanId && loadPlanDoc(activePlanId)} className="rounded-lg border border-border bg-surface px-4 py-2 active:opacity-60">
                    <Text className="text-sm font-semibold text-foreground">Retry</Text>
                  </Pressable>
                </View>
              ) : (
                <View className="flex-1 items-center justify-center"><ActivityIndicator /></View>
              )}
            </View>
          )}
        </>
      )}

      {/* Model picker */}
      <ModelPicker open={modelPickerOpen} onClose={() => setModelPickerOpen(false)} groups={groups} modelsByGroup={modelsByGroup} selected={selectedModel} onPick={pickModel} />
      {/* New plan intake */}
      <IntakeModal open={intakeOpen} onClose={() => setIntakeOpen(false)} maps={maps} activeMapId={activeMapId}
        onCreated={async (planId) => { setIntakeOpen(false); await loadPlans(); setActivePlanId(planId); setTab("chat"); }} />
      {/* Concept render */}
      <ConceptModal open={conceptOpen} onClose={() => setConceptOpen(false)} planId={activePlanId} plan={activePlan}
        onDone={() => { setConceptOpen(false); if (activePlanId) void loadPlanDoc(activePlanId); }} />
    </ScreenContainer>
  );
}

// ── Model picker modal ─────────────────────────────────────────────────────────
function ModelPicker({ open, onClose, groups, modelsByGroup, selected, onPick }: {
  open: boolean; onClose: () => void; groups: ModelGroup[]; modelsByGroup: Record<string, ChatModel[]>;
  selected: { modelId: string; providerId: string } | null; onPick: (m: ChatModel) => void;
}) {
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/50 justify-end" onPress={onClose}>
        <Pressable className="bg-card rounded-t-2xl border-t border-border max-h-[70%]" onPress={() => {}}>
          <Text className="text-base font-bold text-foreground p-4 pb-2">Pick a planning model</Text>
          <ScrollView contentContainerStyle={{ padding: 12, paddingTop: 0, gap: 10 }}>
            {groups.length === 0 && <Text className="text-sm text-muted p-3">No PC/mesh/cloud models available — connect to your PC in Settings.</Text>}
            {groups.map((g) => (
              <View key={g.id} className="gap-1">
                <Text className="text-xs font-semibold text-muted px-1">{g.name}</Text>
                {(modelsByGroup[g.id] ?? []).map((m) => {
                  const isSel = selected?.modelId === m.id && selected?.providerId === m.providerId;
                  return (
                    <Pressable key={`${g.id}-${m.id}`} testID={`item-bp-model-${m.id}`} onPress={() => onPick(m)}
                      className={`rounded-lg px-3 py-3 ${isSel ? "bg-primary/10" : "bg-surface border border-border"} active:opacity-60`}>
                      <Text className={`text-sm ${isSel ? "text-primary font-semibold" : "text-foreground"}`} numberOfLines={1}>{m.name}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ── New plan intake modal ────────────────────────────────────────────────────
function IntakeModal({ open, onClose, maps, activeMapId, onCreated }: {
  open: boolean; onClose: () => void; maps: MapRow[]; activeMapId: string | null; onCreated: (planId: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("other");
  const [units, setUnits] = useState<"imperial" | "metric">("imperial");
  const [cadEngine, setCadEngine] = useState<"jscad" | "openscad">("jscad");
  const [newProject, setNewProject] = useState(true);
  const [busy, setBusy] = useState(false);
  const colors = useColors();

  useEffect(() => { if (open) { setTitle(""); setBrief(""); setCategory("other"); setUnits("imperial"); setCadEngine("jscad"); setNewProject(!activeMapId); } }, [open, activeMapId]);

  const create = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      const r = await trpcMutate<{ id: string }>("blueprint.create", {
        title: title.trim(), brief: brief.trim(), category, units, cadEngine,
        mapId: newProject ? undefined : (activeMapId ?? undefined),
        newMapName: newProject ? (title.trim() || "New Project") : undefined,
      });
      onCreated(r.id);
    } catch (e) { Alert.alert("Failed", e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/50 justify-end" onPress={onClose}>
        <Pressable className="bg-card rounded-t-2xl border-t border-border max-h-[85%]" onPress={() => {}}>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
            <Text className="text-base font-bold text-foreground">New Build Plan</Text>
            <TextInput testID="input-plan-title" value={title} onChangeText={setTitle} placeholder="Project name (e.g. Heavy welding table)" placeholderTextColor={colors.muted}
              className="rounded-lg border border-border bg-background px-3 py-2.5 text-foreground" />
            <TextInput testID="input-plan-brief" value={brief} onChangeText={setBrief} multiline placeholder="Describe it — dimensions, purpose, loads, style…" placeholderTextColor={colors.muted}
              className="rounded-lg border border-border bg-background px-3 py-2.5 text-foreground min-h-[90px]" />
            <Text className="text-xs font-semibold text-muted">Category</Text>
            <View className="flex-row flex-wrap gap-2">
              {CATEGORIES.map((c) => (
                <Pressable key={c} testID={`chip-cat-${c}`} onPress={() => setCategory(c)} className={`rounded-full px-3 py-1.5 ${category === c ? "bg-primary" : "bg-surface border border-border"}`}>
                  <Text className={`text-xs ${category === c ? "text-background font-semibold" : "text-foreground"}`}>{CATEGORY_LABELS[c]}</Text>
                </Pressable>
              ))}
            </View>
            <View className="flex-row gap-4">
              <View className="flex-1 gap-1">
                <Text className="text-xs font-semibold text-muted">Units</Text>
                <View className="flex-row gap-2">
                  {(["imperial", "metric"] as const).map((u) => (
                    <Pressable key={u} testID={`chip-units-${u}`} onPress={() => setUnits(u)} className={`flex-1 rounded-lg py-2 items-center ${units === u ? "bg-primary" : "bg-surface border border-border"}`}>
                      <Text className={`text-xs ${units === u ? "text-background font-semibold" : "text-foreground"} capitalize`}>{u}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
              <View className="flex-1 gap-1">
                <Text className="text-xs font-semibold text-muted">CAD engine</Text>
                <View className="flex-row gap-2">
                  {(["jscad", "openscad"] as const).map((e) => (
                    <Pressable key={e} testID={`chip-cad-${e}`} onPress={() => setCadEngine(e)} className={`flex-1 rounded-lg py-2 items-center ${cadEngine === e ? "bg-primary" : "bg-surface border border-border"}`}>
                      <Text className={`text-xs ${cadEngine === e ? "text-background font-semibold" : "text-foreground"}`}>{e === "jscad" ? "JSCAD" : "OpenSCAD"}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            </View>
            <Pressable testID="toggle-plan-newproject" onPress={() => setNewProject((v) => !v)} className="flex-row items-center justify-between rounded-lg border border-border bg-background p-3">
              <View className="flex-1 pr-2">
                <Text className="text-sm text-foreground">New project</Text>
                <Text className="text-xs text-muted">{newProject ? "A fresh Project is created for this plan." : activeMapId ? "Attaches to your active project." : "No active project — turn on to create one."}</Text>
              </View>
              <Text className="text-base">{newProject ? "✅" : "⬜"}</Text>
            </Pressable>
            <View className="flex-row gap-2 pt-1">
              <Pressable testID="btn-intake-cancel" onPress={onClose} className="flex-1 rounded-lg border border-border bg-surface py-3 items-center active:opacity-60"><Text className="text-sm font-semibold text-foreground">Cancel</Text></Pressable>
              <Pressable testID="btn-intake-create" disabled={!title.trim() || busy} onPress={create} className={`flex-1 rounded-lg py-3 items-center ${!title.trim() || busy ? "bg-surface border border-border" : "bg-primary"}`}>
                {busy ? <ActivityIndicator size="small" /> : <Text className="text-sm font-semibold text-background">Create plan</Text>}
              </Pressable>
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ── Concept render modal ─────────────────────────────────────────────────────
function ConceptModal({ open, onClose, planId, plan, onDone }: {
  open: boolean; onClose: () => void; planId: string | null; plan?: PlanRow; onDone: () => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [provider, setProvider] = useState<"local" | "fal" | "openart">("local");
  const [busy, setBusy] = useState(false);
  const colors = useColors();
  useEffect(() => { if (open) setPrompt(plan?.title ?? ""); }, [open, plan?.title]);

  const generate = async () => {
    if (!planId || !prompt.trim()) return;
    setBusy(true);
    try {
      await trpcMutate("blueprint.generateConcept", { planId, prompt: prompt.trim(), provider });
      Alert.alert("Concept saved", "The render was saved to the plan's Overview.");
      onDone();
    } catch (e) { Alert.alert("Failed", e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/50 justify-end" onPress={onClose}>
        <Pressable className="bg-card rounded-t-2xl border-t border-border p-4 gap-3" onPress={() => {}}>
          <Text className="text-base font-bold text-foreground">Generate concept render</Text>
          <TextInput testID="input-concept-prompt" value={prompt} onChangeText={setPrompt} multiline placeholder="Describe the finished project…" placeholderTextColor={colors.muted}
            className="rounded-lg border border-border bg-background px-3 py-2.5 text-foreground min-h-[80px]" />
          <View className="flex-row gap-2">
            {(["local", "fal", "openart"] as const).map((p) => (
              <Pressable key={p} testID={`chip-concept-${p}`} onPress={() => setProvider(p)} className={`flex-1 rounded-lg py-2 items-center ${provider === p ? "bg-primary" : "bg-surface border border-border"}`}>
                <Text className={`text-xs ${provider === p ? "text-background font-semibold" : "text-foreground"}`}>{p === "local" ? "Local" : p === "fal" ? "fal.ai" : "OpenArt"}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable testID="btn-concept-generate" disabled={!prompt.trim() || busy} onPress={generate} className={`rounded-lg py-3 items-center ${!prompt.trim() || busy ? "bg-surface border border-border" : "bg-primary"}`}>
            {busy ? <ActivityIndicator size="small" /> : <Text className="text-sm font-semibold text-background">Generate</Text>}
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
