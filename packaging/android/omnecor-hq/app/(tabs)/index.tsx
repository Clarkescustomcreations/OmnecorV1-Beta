import { Text, View, TextInput, FlatList, ActivityIndicator, Share, Modal, Alert, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { WebView } from "react-native-webview";
import { Pressable } from "@/components/pressable";
import { useState, useRef, useCallback, useEffect } from "react";
import { useFocusEffect } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Clipboard from "expo-clipboard";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useVoice } from "@/hooks/use-voice";
import { getServerBaseUrl, isServerConfigured } from "@/lib/_core/server-config";
import { runInference, getStatus as getGgufStatus } from "@/lib/_core/local-inference";
import { generateTask, isMediapipeAvailable, getMpStatus } from "@/lib/_core/mediapipe-inference";
import {
  ensurePhoneModel, loadPhoneModel, subscribePhoneModel, getPhoneModelStatus,
  type PhoneModelStatus,
} from "@/lib/_core/phone-model";
import { trpcQuery, trpcMutate } from "@/lib/_core/trpc-fetch";
import { getAgentTrpc } from "@/lib/trpc";
import { applyAgentEvent, applyJobCompletion } from "@/lib/_core/agent-stream";
import { flattenBlocksToText, type AssistantBlock } from "@/lib/_core/agent-blocks";
import { subscribeChannel } from "@/lib/_core/ws-channels";
import { AssistantStream } from "@/components/agentic/assistant-stream";
import {
  listCatalogGroups, listPhoneModels, type ChatModel, type ModelGroup,
  PHONE_PROVIDER, PHONE_PROVIDER_ID, parsePhoneModelId,
} from "@/lib/_core/ai-models";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { loadChats, saveChats, type StoredChatSession } from "@/lib/_core/chat-store";
import { useChatDisplaySettings } from "@/hooks/use-chat-display-settings";
import { useConnection } from "@/hooks/use-connection";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  /** Agentic render source of truth (ephemeral — only `content` is persisted). */
  blocks?: AssistantBlock[];
  /** Terminal stream error, surfaced under the message. */
  error?: string;
}

interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  /** Mesh-Delegation.md — set when this is a managed sub-agent chat (a task
   *  delegated to a peer). Its turns route to the peer via `delegation.sendTurn`
   *  and stream in over `delegation.stream`, not the local model path. */
  delegatedNodeName?: string;
}

interface QueuedMessage {
  id: string;
  content: string;
}

interface NeuralMapEntry {
  id: string;
  name: string;
  mode: string;
  rootDirectories?: string[];
}

/**
 * Split a leading `<think>…</think>` region out of an on-device model's output so
 * reasoning renders in its own collapsible section (never as part of the answer),
 * mirroring the server's handling for the PC path. Handles a still-open `<think>`
 * during streaming (no closing tag yet).
 */
function splitThinking(text: string): { thinking: string; body: string; done: boolean } {
  const open = text.indexOf("<think>");
  if (open === -1) return { thinking: "", body: text, done: true };
  const close = text.indexOf("</think>", open);
  if (close === -1) {
    return { thinking: text.slice(open + 7), body: text.slice(0, open), done: false };
  }
  const thinking = text.slice(open + 7, close);
  const body = (text.slice(0, open) + text.slice(close + 8)).trim();
  return { thinking, body, done: true };
}

/** Fold on-device output text into blocks (a thinking block + a prose block). */
function phoneBlocks(msgId: string, full: string, done: boolean): AssistantBlock[] {
  const parsed = splitThinking(full);
  const out: AssistantBlock[] = [];
  if (parsed.thinking) {
    out.push({ id: `${msgId}-think`, type: "thinking", text: parsed.thinking, done: done || parsed.done });
  }
  out.push({ id: `${msgId}-text`, type: "text", text: parsed.body });
  return out;
}

export default function ChatScreen() {
  const colors = useColors();
  const voice  = useVoice();
  const insets = useSafeAreaInsets();
  const { height: winHeight } = useWindowDimensions();
  const flatListRef = useRef<FlatList>(null);
  const { settings: chatDisplaySettings, updateSettings } = useChatDisplaySettings();
  // Live PC-reachability state (health-probed), NOT just "is an IP saved".
  const { configured: pcConfigured, online: pcOnline, checking: pcChecking } = useConnection();

  const [hydrated, setHydrated] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>([
    { id: "1", title: "New Conversation", messages: [
      { id: "welcome", role: "assistant", content: "Hello! I'm Omnecor HQ. Connect to your PC in Settings, then start chatting.", timestamp: new Date() },
    ]},
  ]);
  const [activeSessionId, setActiveSessionId]               = useState("1");
  const [messageInput, setMessageInput]                     = useState("");
  const [isSending, setIsSending]                           = useState(false);
  const [isUploading, setIsUploading]                       = useState(false);
  const [showSessionSelector, setShowSessionSelector]       = useState(false);
  const [showNeuralMapSelector, setShowNeuralMapSelector]   = useState(false);
  const [showAgentSelector, setShowAgentSelector]           = useState(false);
  const [selectedNeuralMap, setSelectedNeuralMap]           = useState("Default");
  const [selectedAgent, setSelectedAgent]                   = useState("Default Agent");
  const [autoRead, setAutoRead]                             = useState(false);
  const [actionSheetTarget, setActionSheetTarget]           = useState<ChatMessage | null>(null);
  // Type-ahead FIFO queue (unpersisted) + live HTML preview overlay.
  const [messageQueue, setMessageQueue]                     = useState<QueuedMessage[]>([]);
  const [previewHtml, setPreviewHtml]                       = useState<string | null>(null);

  const [neuralMapList, setNeuralMapList] = useState<NeuralMapEntry[]>([]);
  const [personaList, setPersonaList]     = useState<{ id: string; name: string }[]>([]);
  const [selectedNeuralMapId, setSelectedNeuralMapId] = useState<string | null>(null);
  const [selectedPersonaId, setSelectedPersonaId]     = useState<string | null>(null);
  // ── Model selection (Model-Fabric Phase 5: unified catalog — Phone / This PC /
  //    Mesh:<node> / Cloud groups, each a real, tool-capable agentChatStream target) ──
  const [providers, setProviders] = useState<ModelGroup[]>([]);
  const [modelsByGroup, setModelsByGroup] = useState<Record<string, ChatModel[]>>({});
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [models, setModels]                         = useState<ChatModel[]>([]);
  const [selectedModelId, setSelectedModelId]       = useState<string | null>(null);
  const [showModelSelector, setShowModelSelector]   = useState(false);
  const [showOptions, setShowOptions]               = useState(false);
  const [phoneModel, setPhoneModel] = useState<PhoneModelStatus>(getPhoneModelStatus());
  useEffect(() => subscribePhoneModel(setPhoneModel), []);

  const activeSession = sessions.find((s) => s.id === activeSessionId);

  const selectedModel  = models.find((m) => m.id === selectedModelId);
  const phoneSelected  = selectedProviderId === PHONE_PROVIDER_ID;
  const canAttachFiles = !phoneSelected || (selectedModel?.capabilities?.files  ?? false);
  const canAttachPhoto = !phoneSelected || (selectedModel?.capabilities?.images ?? false);

  // ── Streaming refs — the agentic turn lifecycle lives outside React state so
  //    async callbacks never read stale closures. ──
  const streamSubRef   = useRef<{ unsubscribe: () => void } | null>(null);
  const streamMsgRef   = useRef<{ sessionId: string; msgId: string } | null>(null);
  const streamEndRef   = useRef<"done" | "error" | "stopped">("done");
  const isSendingRef   = useRef(false);
  const sessionsRef    = useRef(sessions);
  sessionsRef.current  = sessions;
  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;
  // All the selection state a send needs, mirrored into a ref so `sendMessage`
  // stays stable (identity) — the queue drain fires it from an effect.
  const sendCtxRef = useRef({
    selectedProviderId, selectedModelId, selectedNeuralMapId, neuralMapList,
    selectedNeuralMap, selectedAgent, autoApprove: chatDisplaySettings.autoApproveTools,
    autoRead, providers, phoneModel, voice, models,
  });
  sendCtxRef.current = {
    selectedProviderId, selectedModelId, selectedNeuralMapId, neuralMapList,
    selectedNeuralMap, selectedAgent, autoApprove: chatDisplaySettings.autoApproveTools,
    autoRead, providers, phoneModel, voice, models,
  };

  // ── Session management (new chat / delete) ──
  const createNewChat = useCallback(() => {
    const id = Date.now().toString();
    const fresh: ChatSession = {
      id,
      title: "New Conversation",
      messages: [
        { id: "welcome", role: "assistant", content: "New chat started. Ask me anything.", timestamp: new Date() },
      ],
    };
    setSessions((prev) => [fresh, ...prev]);
    setActiveSessionId(id);
    setShowSessionSelector(false);
  }, []);

  const deleteChat = useCallback((id: string) => {
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id);
      if (next.length === 0) {
        const fresh: ChatSession = {
          id: "1",
          title: "New Conversation",
          messages: [
            { id: "welcome", role: "assistant", content: "Hello! I'm Omnecor HQ. Connect to your PC in Settings, then start chatting.", timestamp: new Date() },
          ],
        };
        setActiveSessionId("1");
        return [fresh];
      }
      setActiveSessionId((cur) => (cur === id ? next[0].id : cur));
      return next;
    });
  }, []);

  // ── Load persisted chats on mount ──
  useEffect(() => {
    loadChats()
      .then((snapshot) => {
        if (snapshot && snapshot.sessions.length > 0) {
          const revived = snapshot.sessions.map((s: StoredChatSession) => ({
            ...s,
            delegatedNodeName: s.delegatedNodeName ?? undefined,
            messages: s.messages.map((m) => ({
              ...m,
              timestamp: new Date(m.timestamp),
            })),
          }));
          setSessions(revived);
          const activeExists = revived.some((s) => s.id === snapshot.activeSessionId);
          setActiveSessionId(activeExists ? snapshot.activeSessionId : revived[0].id);
        }
      })
      .finally(() => setHydrated(true));
  }, []);

  // ── Persist chats (debounced) whenever sessions/activeSessionId change ──
  // Streaming updates a message on every token, so a synchronous save-per-change
  // would re-encrypt + rewrite the whole snapshot dozens of times a second.
  // Coalesce into one write shortly after the last change.
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hydratedRef = useRef(hydrated);
  hydratedRef.current = hydrated;

  const persistSnapshot = useCallback((sess: ChatSession[], activeId: string) => {
    const serialized: StoredChatSession[] = sess.map((s) => {
      const ext = s as unknown as { neuralMapId?: string | null; personaId?: string | null };
      return {
        id: s.id,
        title: s.title,
        neuralMapId: ext.neuralMapId,
        personaId: ext.personaId,
        delegatedNodeName: s.delegatedNodeName,
        messages: s.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          timestamp: new Date(m.timestamp).toISOString(),
        })),
      };
    });
    saveChats({ sessions: serialized, activeSessionId: activeId });
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => persistSnapshot(sessions, activeSessionId), 600);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [sessions, activeSessionId, hydrated, persistSnapshot]);

  // Flush the latest snapshot on unmount so a change inside the 600 ms debounce
  // window (e.g. the final token of a stream as the app backgrounds) isn't lost.
  // Reads refs so it always sees the newest state.
  useEffect(() => () => {
    if (hydratedRef.current) persistSnapshot(sessionsRef.current, activeSessionIdRef.current);
  }, [persistSnapshot]);

  // Load saved neural map and persona from AsyncStorage on mount
  useEffect(() => {
    (async () => {
      try {
        const savedMapId = await AsyncStorage.getItem("omnecor:selected_map_id");
        const savedPersonaId = await AsyncStorage.getItem("omnecor:selected_persona_id");
        if (savedMapId) setSelectedNeuralMapId(savedMapId);
        if (savedPersonaId) setSelectedPersonaId(savedPersonaId);
      } catch (e) {
        console.error(e);
      }
    })();
  }, []);

  useEffect(() => {
    if (selectedNeuralMapId !== null) {
      AsyncStorage.setItem("omnecor:selected_map_id", selectedNeuralMapId).catch(console.error);
    } else {
      AsyncStorage.removeItem("omnecor:selected_map_id").catch(console.error);
    }
  }, [selectedNeuralMapId]);

  useEffect(() => {
    if (selectedPersonaId !== null) {
      AsyncStorage.setItem("omnecor:selected_persona_id", selectedPersonaId).catch(console.error);
    } else {
      AsyncStorage.removeItem("omnecor:selected_persona_id").catch(console.error);
    }
  }, [selectedPersonaId]);

  useEffect(() => {
    if (selectedNeuralMapId && neuralMapList.length) {
      const found = neuralMapList.find(m => m.id === selectedNeuralMapId);
      if (found) setSelectedNeuralMap(found.name);
    }
  }, [selectedNeuralMapId, neuralMapList]);

  useEffect(() => {
    if (selectedPersonaId && personaList.length) {
      const found = personaList.find(p => p.id === selectedPersonaId);
      if (found) setSelectedAgent(found.name);
    }
  }, [selectedPersonaId, personaList]);

  // Unified catalog fetch (Model-Fabric Phase 5): one call gets every
  // tool-capable model this session can reach — This PC / Mesh:<node> / Cloud
  // — grouped and ready to select. Runs alongside the existing neural-map /
  // persona / active-map fetch on mount.
  useEffect(() => {
    if (!isServerConfigured()) return;
    (async () => {
      try {
        const [maps, personas, catalog, activeMapResult] = await Promise.all([
          trpcQuery<NeuralMapEntry[]>("neuralMaps.list"),
          trpcQuery<{ id: string; name: string }[]>("personas.list"),
          listCatalogGroups(),
          trpcQuery<{ activeMapId: string | null }>("neuralMaps.getActiveMapId"),
        ]);
        const activeMapId = activeMapResult?.activeMapId ?? null;
        if (maps?.length)        setNeuralMapList(maps);
        if (personas?.length)    setPersonaList(personas);
        setProviders(catalog.groups);
        setModelsByGroup(catalog.modelsByGroup);
        setSelectedProviderId((cur) => {
          if (cur && catalog.groups.some((g) => g.id === cur)) return cur;
          const pick = catalog.groups.find((g) => g.id !== PHONE_PROVIDER_ID) ?? catalog.groups[0];
          return pick?.id ?? cur;
        });
        if (activeMapId) {
          setSelectedNeuralMapId(activeMapId);
          await AsyncStorage.setItem("omnecor:selected_map_id", activeMapId);
          const found = maps?.find(m => m.id === activeMapId);
          if (found) setSelectedNeuralMap(found.name);
        }
      } catch {
        // Server offline — leave lists empty; the UI shows truthful empty states.
      }
    })();
  }, []);

  // Seed the Phone group immediately (no server needed) so the picker is
  // usable offline; the catalog fetch above adds This PC / Mesh / Cloud once
  // the server responds.
  useEffect(() => {
    setProviders((prev) => prev.some((p) => p.id === PHONE_PROVIDER_ID) ? prev : [...prev, PHONE_PROVIDER]);
    setSelectedProviderId((cur) => cur ?? PHONE_PROVIDER_ID);
  }, []);

  // Selecting a group is a local lookup, not a network call — every group's
  // models arrived together in the one catalog fetch above.
  useEffect(() => {
    if (!selectedProviderId) return;
    const list = modelsByGroup[selectedProviderId] ?? [];
    setModels(list);
    setSelectedModelId((cur) => (cur && list.some((m) => m.id === cur) ? cur : list[0]?.id ?? null));
  }, [selectedProviderId, modelsByGroup]);

  // Re-scan on-device models on every focus (e.g. returning from Settings
  // after a download) regardless of which group is currently selected, so
  // switching to Phone always shows fresh data.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      listPhoneModels().then((list) => {
        if (cancelled) return;
        setModelsByGroup((prev) => ({ ...prev, [PHONE_PROVIDER_ID]: list }));
      });
      return () => { cancelled = true; };
    }, [])
  );

  const appendMessage = useCallback((sessionId: string, msg: ChatMessage) => {
    setSessions((prev) =>
      prev.map((s) => s.id === sessionId ? { ...s, messages: [...s.messages, msg] } : s)
    );
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
  }, []);

  // Selection is the lifecycle verb: picking a phone model loads it right away.
  const handleSelectModel = useCallback((modelId: string) => {
    setSelectedModelId(modelId);
    setShowModelSelector(false);
    const parsed = parsePhoneModelId(modelId);
    if (!parsed) return;
    if (parsed.engine === "litert" && !isMediapipeAvailable()) {
      Alert.alert("Engine missing", "The LiteRT-LM engine isn't in this build.");
      return;
    }
    loadPhoneModel(parsed.engine, parsed.path).catch((err) => {
      Alert.alert("Load failed", err instanceof Error ? err.message : String(err));
    });
  }, []);

  // ── Streaming turn lifecycle ──
  const setMsgBlocks = useCallback((sessionId: string, msgId: string, blocks: AssistantBlock[]) => {
    setSessions((prev) => prev.map((s) => s.id === sessionId
      ? { ...s, messages: s.messages.map((m) => m.id === msgId ? { ...m, blocks } : m) }
      : s));
  }, []);

  const finalizeStream = useCallback((sessionId: string, msgId: string, blocks: AssistantBlock[], content: string, _tokens?: number) => {
    streamEndRef.current = "done";
    streamSubRef.current = null;
    streamMsgRef.current = null;
    isSendingRef.current = false;
    setIsSending(false);
    setSessions((prev) => prev.map((s) => s.id === sessionId
      ? { ...s, messages: s.messages.map((m) => m.id === msgId ? { ...m, blocks, content, error: undefined } : m) }
      : s));
    const ctx = sendCtxRef.current;
    if (ctx.autoRead && content) ctx.voice.speak(content);
  }, []);

  const failStream = useCallback((sessionId: string, msgId: string, message: string) => {
    streamEndRef.current = "error";
    streamSubRef.current = null;
    streamMsgRef.current = null;
    isSendingRef.current = false;
    setIsSending(false);
    setSessions((prev) => prev.map((s) => s.id === sessionId
      ? { ...s, messages: s.messages.map((m) => m.id === msgId ? { ...m, content: m.content || `⚠ ${message}`, error: message } : m) }
      : s));
  }, []);

  /** Guard for async on-device callbacks — bail if this turn was stopped/superseded. */
  const isCurrent = useCallback((msgId: string) => streamMsgRef.current?.msgId === msgId, []);

  const startPcStream = useCallback((sessionId: string, msgId: string, providerId: string, modelId: string, apiMessages: { role: "user" | "assistant" | "system"; content: string }[], targetNodeId?: string) => {
    const ctx = sendCtxRef.current;
    let client: ReturnType<typeof getAgentTrpc>;
    try {
      client = getAgentTrpc();
    } catch (e) {
      failStream(sessionId, msgId, e instanceof Error ? e.message : String(e));
      return;
    }
    const map = ctx.neuralMapList.find((m) => m.id === ctx.selectedNeuralMapId);
    let blocks: AssistantBlock[] = [];
    const sub = client.aiProvider.agentChatStream.subscribe(
      {
        providerId,
        modelId,
        messages: apiMessages,
        mapId: ctx.selectedNeuralMapId ?? undefined,
        ragMapId: ctx.selectedNeuralMapId ?? undefined,
        rootDirectories: map?.rootDirectories,
        autoApprove: ctx.autoApprove,
        conversationId: sessionId,
        // Model-Fabric Phase 5 — pins mesh routing to the exact peer the user
        // picked in the catalog (undefined for This PC / Cloud selections,
        // which never go through mesh offload anyway).
        targetNodeId,
      },
      {
        onData(ev) {
          blocks = applyAgentEvent(blocks, ev);
          if (ev.type === "done") finalizeStream(sessionId, msgId, blocks, ev.content, ev.totalTokens);
          else if (ev.type === "error") failStream(sessionId, msgId, ev.message);
          else setMsgBlocks(sessionId, msgId, blocks);
        },
        onError(err) { failStream(sessionId, msgId, err.message); },
      },
    );
    streamSubRef.current = sub;
  }, [failStream, finalizeStream, setMsgBlocks]);

  const startPhoneStream = useCallback(async (sessionId: string, msgId: string, modelId: string | null, text: string) => {
    const ctx = sendCtxRef.current;
    try {
      let engine: "gguf" | "litert";
      let path: string;
      if (modelId) {
        const parsed = parsePhoneModelId(modelId);
        if (!parsed) throw new Error("Pick a phone model first — download one in Settings → Phone AI Model.");
        engine = parsed.engine;
        path = parsed.path;
      } else if (ctx.phoneModel.engine && ctx.phoneModel.path) {
        engine = ctx.phoneModel.engine;
        path = ctx.phoneModel.path;
      } else {
        throw new Error("No on-device model is loaded. Pick one in Settings → Phone AI Model.");
      }

      // Serialize on-device generation. A prior turn that was Stopped keeps its
      // native completion running (llama.rn / LiteRT can't be aborted), and
      // starting a second on the single engine — or releasing a context while a
      // completion is in flight — can SIGSEGV Hermes. Wait for both engines to go
      // idle before touching the model (bounded, and abandons if superseded).
      const engineBusy = () => getGgufStatus() === "running" || getMpStatus() === "running";
      const waitStart = Date.now();
      while (engineBusy() && Date.now() - waitStart < 30_000) {
        await new Promise((r) => setTimeout(r, 100));
        if (!isCurrent(msgId)) return; // stopped / superseded while waiting
      }

      let full = "";
      const render = () => { if (isCurrent(msgId)) setMsgBlocks(sessionId, msgId, phoneBlocks(msgId, full, false)); };

      if (engine === "gguf") {
        await ensurePhoneModel("gguf", path);
        full = await runInference(`User: ${text}\nAssistant:`, { onToken: (tok) => { full += tok; render(); } });
      } else {
        if (!isMediapipeAvailable()) throw new Error("The LiteRT-LM engine isn't in this build.");
        await ensurePhoneModel("litert", path);
        full = await generateTask(text, (cumulative) => { full = cumulative; render(); });
      }

      if (!isCurrent(msgId)) return; // stopped / superseded mid-generation
      const body = splitThinking(full).body || "(empty response)";
      finalizeStream(sessionId, msgId, phoneBlocks(msgId, full, true), body);
    } catch (err) {
      if (isCurrent(msgId)) failStream(sessionId, msgId, err instanceof Error ? err.message : String(err));
    }
  }, [failStream, finalizeStream, setMsgBlocks, isCurrent]);

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    // Type-ahead: a turn is already streaming — queue this one instead of dropping it.
    if (isSendingRef.current) {
      setMessageQueue((q) => [...q, { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, content: trimmed }]);
      return;
    }
    const ctx = sendCtxRef.current;
    const sessionId = activeSessionIdRef.current;

    appendMessage(sessionId, { id: Date.now().toString(), role: "user", content: trimmed, timestamp: new Date() });
    setSessions((prev) => prev.map((s) =>
      s.id === sessionId && (s.title === "New Conversation" || !s.title)
        ? { ...s, title: trimmed.length > 40 ? trimmed.slice(0, 40) + "…" : trimmed }
        : s));

    // Managed sub-agent chat (Mesh-Delegation.md, Decision 5 between-turn chat):
    // route the follow-up to the peer; the delegation.stream effect drives the
    // assistant turn. NOT the local model path.
    if (sessionsRef.current.find((s) => s.id === sessionId)?.delegatedNodeName) {
      isSendingRef.current = true;
      setIsSending(true);
      trpcMutate("delegation.sendTurn", { conversationId: sessionId, content: trimmed })
        .catch((e) => {
          isSendingRef.current = false;
          setIsSending(false);
          Alert.alert("Sub-agent busy", e instanceof Error ? e.message : String(e));
        });
      return;
    }

    const assistantId = (Date.now() + 1).toString();
    appendMessage(sessionId, { id: assistantId, role: "assistant", content: "", blocks: [], timestamp: new Date() });
    streamEndRef.current = "done";
    streamMsgRef.current = { sessionId, msgId: assistantId };
    isSendingRef.current = true;
    setIsSending(true);

    // System prompt (map + persona) and prior turns → API messages.
    const systemParts: string[] = [];
    if (ctx.selectedNeuralMap && ctx.selectedNeuralMap !== "Default") systemParts.push(`Neural Map context: ${ctx.selectedNeuralMap}`);
    if (ctx.selectedAgent && ctx.selectedAgent !== "Default Agent") systemParts.push(`Assistant persona: ${ctx.selectedAgent}`);
    const systemPrompt = systemParts.length ? systemParts.join(". ") : undefined;
    const prior = (sessionsRef.current.find((s) => s.id === sessionId)?.messages ?? [])
      .filter((m) => (m.role === "user" || m.role === "assistant") && m.id !== "welcome" && m.id !== assistantId && m.content);
    const apiMessages: { role: "user" | "assistant" | "system"; content: string }[] = [
      ...(systemPrompt ? [{ role: "system" as const, content: systemPrompt }] : []),
      ...prior.map((m) => ({ role: m.role, content: m.content })),
      { role: "user" as const, content: trimmed },
    ];

    const groupId = ctx.selectedProviderId ?? PHONE_PROVIDER_ID;
    const modelId = ctx.selectedModelId;

    if (groupId === PHONE_PROVIDER_ID) {
      await startPhoneStream(sessionId, assistantId, modelId, trimmed);
      return;
    }
    if (isServerConfigured()) {
      // Model-Fabric Phase 5: every non-phone entry in the picker came from
      // the unified catalog, so it always carries a real, tool-capable
      // providerId (and a targetNodeId when it's a specific mesh peer) — no
      // "agent-capable?" branch needed anymore, and no legacy one-shot
      // fallback for a provider the catalog would never emit.
      const chatModel = ctx.models.find((m) => m.id === modelId);
      if (!modelId || !chatModel?.providerId) {
        failStream(sessionId, assistantId, "Pick a model first — install one on the PC or choose one above.");
        return;
      }
      startPcStream(sessionId, assistantId, chatModel.providerId, modelId, apiMessages, chatModel.targetNodeId);
      return;
    }
    // No server: fall back to a resident on-device model, else an honest error.
    if (ctx.phoneModel.state === "ready" || ctx.phoneModel.state === "running") {
      await startPhoneStream(sessionId, assistantId, null, trimmed);
      return;
    }
    failStream(sessionId, assistantId, "No server configured. Go to Settings to connect your PC — or pick 📱 Phone to run a model on-device.");
  }, [appendMessage, startPhoneStream, startPcStream, failStream]);

  const handleSend = useCallback(() => {
    const text = messageInput.trim();
    if (!text) return;
    setMessageInput("");
    sendMessage(text);
  }, [messageInput, sendMessage]);

  const handleStop = useCallback(() => {
    const ref = streamMsgRef.current;
    if (streamSubRef.current) { try { streamSubRef.current.unsubscribe(); } catch { /* ignore */ } streamSubRef.current = null; }
    streamEndRef.current = "stopped";
    streamMsgRef.current = null;
    isSendingRef.current = false;
    setIsSending(false);
    if (ref) {
      setSessions((prev) => prev.map((s) => s.id === ref.sessionId
        ? { ...s, messages: s.messages.map((m) => m.id === ref.msgId ? { ...m, content: m.content || flattenBlocksToText(m.blocks ?? []) } : m) }
        : s));
    }
  }, []);

  // Tap a queued chip → pull it back into the input to edit; Send re-queues/sends it.
  const recallQueued = useCallback((q: QueuedMessage) => {
    setMessageInput(q.content);
    setMessageQueue((qq) => qq.filter((x) => x.id !== q.id));
  }, []);

  // ── HITL approve / deny (plain mutations over HTTP) ──
  const handleApproveTool = useCallback((id: string) => {
    trpcMutate("aiProvider.resolveToolApproval", { id, decision: "approve" })
      .catch((e) => Alert.alert("Approve failed", e instanceof Error ? e.message : String(e)));
  }, []);
  const handleDenyTool = useCallback((id: string, reason?: string) => {
    trpcMutate("aiProvider.resolveToolApproval", { id, decision: "deny", denyReason: reason })
      .catch((e) => Alert.alert("Deny failed", e instanceof Error ? e.message : String(e)));
  }, []);

  // ── Code Run (executes on the PC) / Preview (native WebView) ──
  const handleRunCode = useCallback(async (language: string, code: string) => {
    if (!isServerConfigured()) { Alert.alert("No server", "Connect to your PC in Settings to run code."); return; }
    const ctx = sendCtxRef.current;
    const map = ctx.neuralMapList.find((m) => m.id === ctx.selectedNeuralMapId);
    const sessionId = activeSessionIdRef.current;
    try {
      const res = await trpcMutate<{ jobId: string; label: string }>("aiProvider.runCodeSnippet", {
        language, code,
        mapId: ctx.selectedNeuralMapId ?? undefined,
        rootDirectories: map?.rootDirectories,
        conversationId: sessionId,
      });
      appendMessage(sessionId, {
        id: `run-${res.jobId || Date.now()}`,
        role: "assistant",
        content: "",
        blocks: [{ id: `job-${res.jobId}`, type: "job", jobId: res.jobId, label: res.label || "Run code", status: "running", kind: "process" }],
        timestamp: new Date(),
      });
    } catch (err) {
      Alert.alert("Run failed", err instanceof Error ? err.message : String(err));
    }
  }, [appendMessage]);

  const handlePreviewCode = useCallback((code: string) => { setPreviewHtml(code); }, []);

  // ── Queue drain: on idle, fire the oldest queued turn (FIFO). Held after an
  //    error (don't hammer a failing provider); drains after a user Stop. ──
  useEffect(() => {
    if (isSending) return;
    if (streamEndRef.current === "error") return;
    if (messageQueue.length === 0) return;
    const next = messageQueue[0];
    setMessageQueue((q) => q.slice(1));
    sendMessage(next.content);
  }, [isSending, messageQueue, sendMessage]);

  // Clear the queue when switching conversations (a queued turn belongs to the
  // chat it was typed in).
  const prevSessRef = useRef(activeSessionId);
  useEffect(() => {
    if (prevSessRef.current !== activeSessionId) {
      prevSessRef.current = activeSessionId;
      setMessageQueue([]);
    }
  }, [activeSessionId]);

  // Drive any live JobBlock (or delegated `subagent` chip — correlated by taskId,
  // Mesh-Delegation Decision 6) to its terminal state when the completion ping
  // arrives, across all sessions. The same channel also carries `delegationEvent`
  // lifecycle pings (created / turn-done / failed / cancelled).
  useEffect(() => {
    if (!isServerConfigured()) return;
    const unsub = subscribeChannel("asyncjob:all", (data: any, type: string) => {
      if (type === "delegationEvent") { handleDelegationEventRef.current(data); return; }
      const jobId = typeof data?.jobId === "string" ? data.jobId : "";
      if (!jobId) return;
      const formatted = typeof data?.formatted === "string" ? data.formatted : "";
      const raw = data?.result?.status;
      const status: "completed" | "failed" | "cancelled" =
        raw === "failed" || raw === "cancelled" ? raw : "completed";
      setSessions((prev) => prev.map((s) => ({
        ...s,
        messages: s.messages.map((m) =>
          m.blocks && m.blocks.some((b) => (b.type === "job" && b.jobId === jobId) || (b.type === "subagent" && b.taskId === jobId))
            ? { ...m, blocks: applyJobCompletion(m.blocks, jobId, status, formatted) }
            : m),
      })));
    });
    return unsub;
  }, []);

  // ── Mesh sub-agent delegation (managed chats — Mesh-Delegation.md) ──────────
  // A managed chat was created/advanced on the server. Materialize it as a local
  // session (fetching its DB transcript so the delegated task + any finished
  // turns show) so it appears in the list without a manual refresh, then let the
  // "active session delegated → subscribe" effect below stream its live turn.
  const handleDelegationEvent = useCallback(async (data: any) => {
    const kind = typeof data?.kind === "string" ? data.kind : "";
    const conversationId = typeof data?.conversationId === "string" ? data.conversationId : "";
    const nodeName = typeof data?.nodeName === "string" ? data.nodeName : "mesh peer";
    if (!conversationId) return;
    if (kind === "created") {
      if (sessionsRef.current.some((s) => s.id === conversationId)) return;
      let messages: ChatMessage[] = [];
      try {
        const session = await trpcQuery<{ messages?: { id: string; role: string; content: string; createdAt: string | number }[] }>(
          "chat.getSession", { id: conversationId });
        messages = (session?.messages ?? [])
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({ id: m.id, role: m.role as "user" | "assistant", content: m.content, timestamp: new Date(m.createdAt) }));
      } catch { /* transcript fetch failed — the live stream still populates the turn */ }
      const label = typeof data?.label === "string" ? data.label : "task";
      setSessions((prev) => prev.some((s) => s.id === conversationId) ? prev : [
        { id: conversationId, title: `⇄ ${nodeName} — ${label}`.slice(0, 60), messages, delegatedNodeName: nodeName },
        ...prev,
      ]);
    }
  }, []);
  const handleDelegationEventRef = useRef(handleDelegationEvent);
  handleDelegationEventRef.current = handleDelegationEvent;

  // Live stream of the active managed chat's current turn — the peer's relayed
  // AgentStreamEvents, folded into a streaming assistant message with the same
  // reducer + native block renderers the local agentic chat uses. HITL for a
  // delegated tool box goes through the ordinary resolveToolApproval mutation
  // (the server forwards it to the peer).
  const activeDelegated = !!activeSession?.delegatedNodeName;
  const delegationSubRef = useRef<{ unsubscribe: () => void } | null>(null);
  useEffect(() => {
    if (!isServerConfigured() || !activeDelegated) return;
    const sessionId = activeSessionIdRef.current;
    let client: ReturnType<typeof getAgentTrpc>;
    try { client = getAgentTrpc(); } catch { return; }
    let curId: string | null = null;
    let blocks: AssistantBlock[] = [];
    const ensureTurn = () => {
      if (curId) return;
      curId = `${Date.now()}-sa`;
      blocks = [];
      isSendingRef.current = true;
      setIsSending(true);
      appendMessage(sessionId, { id: curId, role: "assistant", content: "", blocks: [], timestamp: new Date() });
    };
    const sub = client.delegation.stream.subscribe(
      { conversationId: sessionId },
      {
        onData(ev) {
          if (ev.type === "done") {
            if (curId) finalizeStream(sessionId, curId, ev.blocks?.length ? ev.blocks : blocks, ev.content, ev.totalTokens);
            else { isSendingRef.current = false; setIsSending(false); }
            curId = null;
            return;
          }
          if (ev.type === "error") {
            if (curId) failStream(sessionId, curId, ev.message);
            else { isSendingRef.current = false; setIsSending(false); }
            curId = null;
            return;
          }
          ensureTurn();
          blocks = applyAgentEvent(blocks, ev);
          if (curId) setMsgBlocks(sessionId, curId, blocks);
        },
        onError() { isSendingRef.current = false; setIsSending(false); },
      },
    );
    delegationSubRef.current = sub;
    return () => { try { sub.unsubscribe(); } catch { /* ignore */ } delegationSubRef.current = null; };
  }, [activeDelegated, activeSessionId, appendMessage, finalizeStream, failStream, setMsgBlocks]);

  // Cancel the active managed sub-agent run.
  const handleCancelDelegation = useCallback(() => {
    const sessionId = activeSessionIdRef.current;
    trpcMutate("delegation.cancel", { conversationId: sessionId })
      .then(() => { isSendingRef.current = false; setIsSending(false); })
      .catch((e) => Alert.alert("Cancel failed", e instanceof Error ? e.message : String(e)));
  }, []);

  // Tear down an in-flight stream on unmount.
  useEffect(() => () => { if (streamSubRef.current) { try { streamSubRef.current.unsubscribe(); } catch { /* ignore */ } } }, []);

  const handleMicPress = useCallback(async () => {
    if (voice.isRecording) {
      const transcript = await voice.stopAndTranscribe();
      if (transcript) setMessageInput(transcript);
    } else {
      await voice.startRecording();
    }
  }, [voice]);

  const handleAttachPhoto = useCallback(async () => {
    if (!canAttachPhoto) {
      Alert.alert("Text-only model", "The selected on-device model can't read photos. Pick a PC or cloud model to send images.");
      return;
    }
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return;
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: "images", base64: true, quality: 0.7 });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!isServerConfigured()) {
        Alert.alert("Server not configured", "Go to Settings to connect to your Omnecor PC.");
        return;
      }
      const name = asset.fileName ?? "photo.jpg";
      const mimeType = asset.mimeType ?? "image/jpeg";
      const dataUrl = asset.base64;
      setIsUploading(true);
      const res = await trpcMutate<{ filename: string; url: string }>("attachments.uploadFile", { name, mimeType, dataUrl });
      setMessageInput((prev) => `${prev} ![${res.filename}](${getServerBaseUrl()}${res.url})`.trim());
    } catch (err) {
      Alert.alert("Upload failed", "Error uploading photo: " + String(err));
    } finally {
      setIsUploading(false);
    }
  }, [canAttachPhoto]);

  const handleAttachFile = useCallback(async () => {
    if (!canAttachFiles) {
      Alert.alert("Text-only model", "The selected on-device model can't read file attachments. Pick a PC or cloud model to send files.");
      return;
    }
    try {
      const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, type: "*/*" });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!isServerConfigured()) {
        Alert.alert("Server not configured", "Go to Settings to connect to your Omnecor PC.");
        return;
      }
      const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
      const name = asset.name;
      const mimeType = asset.mimeType ?? "application/octet-stream";
      setIsUploading(true);
      const res = await trpcMutate<{ filename: string; url: string }>("attachments.uploadFile", { name, mimeType, dataUrl: base64 });
      setMessageInput((prev) => `${prev} [${res.filename}](${getServerBaseUrl()}${res.url})`.trim());
    } catch (err) {
      Alert.alert("Upload failed", "Error uploading file: " + String(err));
    } finally {
      setIsUploading(false);
    }
  }, [canAttachFiles]);

  return (
    <ScreenContainer className="flex-1 bg-background">
      {/* ── Compact top bar: session picker · new chat · options ── */}
      <View className="bg-surface border-b border-border px-3 py-2 flex-row items-center gap-2">
        <Pressable testID="btn-session-selector" onPress={() => setShowSessionSelector(true)}
          className="flex-1 flex-row items-center gap-2 bg-background border border-border rounded-lg px-3 py-2">
          <Text className="text-sm">{activeDelegated ? "🕸" : "💬"}</Text>
          <Text className="flex-1 text-sm font-semibold text-foreground" numberOfLines={1}>{activeSession?.title ?? "Chat"}</Text>
          <Text className="text-muted text-xs">▾</Text>
        </Pressable>
        {activeDelegated && isSending && (
          <Pressable testID="btn-cancel-delegation" onPress={handleCancelDelegation}
            className="h-10 items-center justify-center bg-background border border-error rounded-lg px-3 active:opacity-70">
            <Text className="text-error text-xs font-semibold">Cancel</Text>
          </Pressable>
        )}
        <Pressable testID="btn-new-chat" onPress={createNewChat}
          className="w-10 h-10 items-center justify-center bg-background border border-border rounded-lg active:opacity-70">
          <Text className="text-primary text-xl leading-none">＋</Text>
        </Pressable>
        <Pressable testID="btn-chat-options" onPress={() => setShowOptions(true)}
          className="w-10 h-10 items-center justify-center bg-background border border-border rounded-lg active:opacity-70">
          <Text className="text-lg leading-none">⚙️</Text>
        </Pressable>
      </View>

      {/* ── Sessions popup: history + New chat ── */}
      <Modal transparent animationType="slide" visible={showSessionSelector} onRequestClose={() => setShowSessionSelector(false)}>
        <GestureHandlerRootView style={{ flex: 1 }}>
        <View className="flex-1 justify-end">
          <Pressable testID="backdrop-sessions" className="absolute inset-0 bg-black/50" onPress={() => setShowSessionSelector(false)} />
          <View className="bg-surface border-t border-border rounded-t-2xl"
            style={{ minHeight: winHeight * 0.5, maxHeight: winHeight * 0.85, paddingBottom: insets.bottom + 20 }}>
            <View className="w-10 h-1 bg-border rounded-full self-center mt-3 mb-2" />
            <View className="flex-row items-center justify-between px-5 py-2">
              <Text className="text-base font-bold text-foreground">Chats</Text>
              <Pressable testID="btn-new-chat-popup" onPress={createNewChat}
                className="flex-row items-center gap-1 bg-primary rounded-lg px-3 py-1.5 active:opacity-80">
                <Text className="text-white text-lg leading-none">＋</Text>
                <Text className="text-white text-sm font-semibold">New chat</Text>
              </Pressable>
            </View>
            <FlatList
              data={sessions}
              keyExtractor={(s) => s.id}
              style={{ flex: 1 }}
              className="px-3"
              renderItem={({ item: s }) => (
                <View className={`flex-row items-center rounded-lg mb-1 ${activeSessionId === s.id ? "bg-primary/10" : ""}`}>
                  <Pressable testID={`item-session-${s.id}`} onPress={() => { setActiveSessionId(s.id); setShowSessionSelector(false); }}
                    className="flex-1 px-3 py-3">
                    <View className="flex-row items-center gap-1.5">
                      {s.delegatedNodeName ? <Text className="text-xs">🕸</Text> : null}
                      <Text className={`flex-1 text-sm ${activeSessionId === s.id ? "text-primary font-semibold" : "text-foreground"}`} numberOfLines={1}>{s.title}</Text>
                      {s.delegatedNodeName ? (
                        <Text className="text-[9px] text-accentCyan" numberOfLines={1}>{s.delegatedNodeName}</Text>
                      ) : null}
                    </View>
                    <Text className="text-xs text-muted mt-0.5">{s.messages.filter(m => m.role !== "assistant" || m.id !== "welcome").length} messages</Text>
                  </Pressable>
                  <Pressable testID={`btn-delete-session-${s.id}`} onPress={() => deleteChat(s.id)} className="px-4 py-3 active:opacity-60">
                    <Text className="text-error text-base">🗑</Text>
                  </Pressable>
                </View>
              )}
            />
          </View>
        </View>
        </GestureHandlerRootView>
      </Modal>

      {/* ── Options popup: Model · Neural Map · Agent · Loading quotes ── */}
      <Modal transparent animationType="slide" visible={showOptions} onRequestClose={() => setShowOptions(false)}>
        <GestureHandlerRootView style={{ flex: 1 }}>
        <View className="flex-1 justify-end">
          <Pressable testID="backdrop-options" className="absolute inset-0 bg-black/50" onPress={() => setShowOptions(false)} />
          <View className="bg-surface border-t border-border rounded-t-2xl"
            style={{ minHeight: winHeight * 0.5, maxHeight: winHeight * 0.85, paddingBottom: insets.bottom + 20 }}>
            <View className="w-10 h-1 bg-border rounded-full self-center mt-3 mb-2" />
            <Text className="text-base font-bold text-foreground px-5 py-2">Chat options</Text>
            <FlatList
              data={[0]}
              keyExtractor={() => "opts"}
              style={{ flex: 1 }}
              className="px-4"
                renderItem={() => (
                  <View className="gap-3 pb-2">
                    {/* Model */}
                    <View>
                      <Pressable testID="btn-model-selector" onPress={() => setShowModelSelector(!showModelSelector)}
                        className="bg-background border border-border rounded-lg p-3">
                        <Text className="text-xs text-muted">Model</Text>
                        <Text className="text-sm font-semibold text-foreground" numberOfLines={1}>
                          {selectedModelId
                            ? `${models.find((m) => m.id === selectedModelId)?.name ?? selectedModelId}`
                              + `${selectedProviderId ? `  ·  ${providers.find((p) => p.id === selectedProviderId)?.name ?? selectedProviderId}` : ""}`
                            : selectedProviderId === PHONE_PROVIDER_ID ? "No on-device model — download one in Settings"
                              : isServerConfigured() ? "No models found — install one on the PC" : "Connect to your PC first"}
                        </Text>
                      </Pressable>
                      {showModelSelector && (
                        <View className="bg-background border border-border rounded-lg overflow-hidden mt-2">
                          {providers.length > 0 && (
                            <View className="flex-row flex-wrap gap-2 p-2 border-b border-border">
                              {providers.map((p) => (
                                <Pressable key={p.id} testID={`chip-provider-${p.id}`} onPress={() => setSelectedProviderId(p.id)}
                                  className={`rounded-lg px-3 py-1 ${selectedProviderId === p.id ? "bg-primary" : "bg-surface border border-border"}`}>
                                  <Text className={`text-xs font-semibold ${selectedProviderId === p.id ? "text-background" : "text-foreground"}`}>{p.name}</Text>
                                </Pressable>
                              ))}
                            </View>
                          )}
                          {models.length > 0 ? (
                            models.map((m) => {
                              const parsed    = parsePhoneModelId(m.id);
                              const isLoaded  = !!parsed && phoneModel.path === parsed.path &&
                                (phoneModel.state === "ready" || phoneModel.state === "running");
                              const isLoading = !!parsed && phoneModel.path === parsed.path &&
                                phoneModel.state === "loading";
                              return (
                                <Pressable key={m.id} testID={`item-model-${m.id}`} onPress={() => handleSelectModel(m.id)}
                                  className={`p-3 border-b border-border ${selectedModelId === m.id ? "bg-primary/10" : ""}`}>
                                  <View className="flex-row items-center gap-2">
                                    <Text className={`text-sm flex-1 ${selectedModelId === m.id ? "text-primary font-semibold" : "text-foreground"}`} numberOfLines={1}>
                                      {m.name}
                                    </Text>
                                    {isLoading && <ActivityIndicator size="small" color={colors.primary} />}
                                    {isLoaded && (
                                      <Text className="text-xs text-success font-semibold">
                                        ✓ Loaded{phoneModel.backend ? ` · ${phoneModel.backend === "npu" ? "⚡NPU" : phoneModel.backend.toUpperCase()}` : ""}
                                      </Text>
                                    )}
                                  </View>
                                </Pressable>
                              );
                            })
                          ) : (
                            <View className="p-3">
                              <Text className="text-sm text-muted">
                                {selectedProviderId === PHONE_PROVIDER_ID
                                  ? "No on-device models yet. Download or import one in Settings → Phone AI Model."
                                  : isServerConfigured()
                                    ? "No models available for this provider. Install an Ollama model on the PC, or add an API key in Settings."
                                    : "Connect to your PC in Settings to load available models."}
                              </Text>
                            </View>
                          )}
                        </View>
                      )}
                    </View>

                    {/* Neural Map */}
                    <View>
                      <Pressable testID="btn-neural-map-selector" onPress={() => setShowNeuralMapSelector(!showNeuralMapSelector)}
                        className="bg-background border border-border rounded-lg p-3">
                        <Text className="text-xs text-muted">Neural Map</Text>
                        <Text className="text-sm font-semibold text-foreground">{selectedNeuralMap}</Text>
                      </Pressable>
                      {showNeuralMapSelector && (
                        <View className="bg-background border border-border rounded-lg overflow-hidden mt-2">
                          {[
                            { key: "__default", label: "Default", onPress: () => { setSelectedNeuralMapId(null); setSelectedNeuralMap("Default"); setShowNeuralMapSelector(false); }, active: selectedNeuralMap === "Default" },
                            ...neuralMapList.map((m) => ({
                              key: m.id, label: m.name,
                              onPress: () => { setSelectedNeuralMapId(m.id); setSelectedNeuralMap(m.name); setShowNeuralMapSelector(false); },
                              active: selectedNeuralMap === m.name,
                            })),
                          ].map((item) => (
                            <Pressable key={item.key} testID={`item-neural-map-${item.key}`} onPress={item.onPress}
                              className={`p-3 border-b border-border ${item.active ? "bg-primary/10" : ""}`}>
                              <Text className={`text-sm ${item.active ? "text-primary font-semibold" : "text-foreground"}`}>{item.label}</Text>
                            </Pressable>
                          ))}
                          {neuralMapList.length === 0 && isServerConfigured() && (
                            <View className="p-3 border-t border-border">
                              <Text className="text-xs text-muted">No neural maps on the PC yet — create one in the desktop app.</Text>
                            </View>
                          )}
                        </View>
                      )}
                    </View>

                    {/* Agent */}
                    <View>
                      <Pressable testID="btn-agent-selector" onPress={() => setShowAgentSelector(!showAgentSelector)}
                        className="bg-background border border-border rounded-lg p-3">
                        <Text className="text-xs text-muted">Agent</Text>
                        <Text className="text-sm font-semibold text-foreground">{selectedAgent}</Text>
                      </Pressable>
                      {showAgentSelector && (
                        <View className="bg-background border border-border rounded-lg overflow-hidden mt-2">
                          {[
                            { key: "__default", label: "Default Agent", onPress: () => { setSelectedPersonaId(null); setSelectedAgent("Default Agent"); setShowAgentSelector(false); }, active: selectedAgent === "Default Agent" },
                            ...personaList.map((a) => ({
                              key: a.id, label: a.name,
                              onPress: () => { setSelectedPersonaId(a.id); setSelectedAgent(a.name); setShowAgentSelector(false); },
                              active: selectedAgent === a.name,
                            })),
                          ].map((item) => (
                            <Pressable key={item.key} testID={`item-agent-${item.key}`} onPress={item.onPress}
                              className={`p-3 border-b border-border ${item.active ? "bg-primary/10" : ""}`}>
                              <Text className={`text-sm ${item.active ? "text-primary font-semibold" : "text-foreground"}`}>{item.label}</Text>
                            </Pressable>
                          ))}
                          {personaList.length === 0 && isServerConfigured() && (
                            <View className="p-3 border-t border-border">
                              <Text className="text-xs text-muted">No personas on the PC yet — create one in the desktop app.</Text>
                            </View>
                          )}
                        </View>
                      )}
                    </View>

                    {/* Loading quotes (mirror the web: show/hide + 3 styles, no-repeat) */}
                    <View>
                      <Text className="text-xs text-muted mb-1 px-1">Loading quotes</Text>
                      <View className="bg-background border border-border rounded-lg p-3 gap-3">
                        <Pressable testID="toggle-show-quotes" onPress={() => updateSettings({ showThinkingQuotes: !chatDisplaySettings.showThinkingQuotes })}
                          className="flex-row items-center justify-between">
                          <Text className="text-sm text-foreground">Show typed quotes while thinking</Text>
                          <Text className="text-base">{chatDisplaySettings.showThinkingQuotes ? "✅" : "⬜"}</Text>
                        </Pressable>
                        <View className="flex-row gap-2">
                          {(["random", "funny", "serious"] as const).map((st) => (
                            <Pressable key={st} testID={`chip-quote-style-${st}`} onPress={() => updateSettings({ quoteStyle: st })}
                              className={`rounded-lg px-3 py-1.5 ${chatDisplaySettings.quoteStyle === st ? "bg-primary" : "bg-surface border border-border"}`}>
                              <Text className={`text-xs font-semibold capitalize ${chatDisplaySettings.quoteStyle === st ? "text-background" : "text-foreground"}`}>{st}</Text>
                            </Pressable>
                          ))}
                        </View>
                      </View>
                    </View>
                  </View>
                )}
              />
            </View>
        </View>
        </GestureHandlerRootView>
      </Modal>

      {/* ── Messages ── */}
      <FlatList
        ref={flatListRef}
        style={{ flex: 1 }}
        data={activeSession?.messages ?? []}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => {
          if (item.role === "user") {
            return (
              <View className="px-4 py-3 items-end">
                <Pressable onLongPress={() => setActionSheetTarget(item)}
                  className="max-w-xs rounded-lg p-3 bg-primary">
                  <Text className="text-sm text-background">{item.content}</Text>
                </Pressable>
              </View>
            );
          }
          return (
            <View className="px-4 py-3">
              <Pressable onLongPress={() => setActionSheetTarget(item)}>
                <AssistantStream
                  messageId={item.id}
                  blocks={item.blocks}
                  content={item.content}
                  isStreaming={isSending && streamMsgRef.current?.msgId === item.id}
                  showQuotes={chatDisplaySettings.showThinkingQuotes}
                  quoteStyle={chatDisplaySettings.quoteStyle}
                  onApprove={handleApproveTool}
                  onDeny={handleDenyTool}
                  onRunCode={handleRunCode}
                  onPreviewCode={handlePreviewCode}
                />
              </Pressable>
              {item.error ? (
                <View className="mt-1 ml-8 p-2 rounded bg-error/10 border border-error/30">
                  <Text className="text-xs text-error">{item.error}</Text>
                </View>
              ) : null}
            </View>
          );
        }}
        contentContainerStyle={{ flexGrow: 1 }}
        ListEmptyComponent={<View className="flex-1 items-center justify-center"><Text className="text-muted">No messages yet</Text></View>}
      />

      {/* ── Long-press Action Sheet ── */}
      <Modal transparent animationType="slide" visible={!!actionSheetTarget} onRequestClose={() => setActionSheetTarget(null)}>
        <GestureHandlerRootView style={{ flex: 1 }}>
        <Pressable className="flex-1 bg-black/40" onPress={() => setActionSheetTarget(null)}>
          <View className="flex-1" />
          <Pressable onPress={() => {/* stop propagation */}}>
            <View className="bg-surface border-t border-border rounded-t-2xl" style={{ paddingBottom: insets.bottom + 16 }}>
              <View className="w-10 h-1 bg-border rounded-full self-center mt-3 mb-4" />
              {[
                {
                  label: "Copy",
                  onPress: async () => {
                    if (actionSheetTarget) await Clipboard.setStringAsync(actionSheetTarget.content || flattenBlocksToText(actionSheetTarget.blocks ?? []));
                    setActionSheetTarget(null);
                  },
                },
                {
                  label: "Read Aloud",
                  onPress: () => {
                    if (actionSheetTarget) voice.speak(actionSheetTarget.content || flattenBlocksToText(actionSheetTarget.blocks ?? []));
                    setActionSheetTarget(null);
                  },
                },
                ...(actionSheetTarget?.role === "user" ? [{
                  label: "Delete",
                  onPress: () => {
                    if (!actionSheetTarget) return;
                    setSessions(prev => prev.map(s =>
                      s.id === activeSessionId
                        ? { ...s, messages: s.messages.filter(m => m.id !== actionSheetTarget.id) }
                        : s
                    ));
                    setActionSheetTarget(null);
                  },
                }] : []),
                {
                  label: "Share",
                  onPress: async () => {
                    if (actionSheetTarget) await Share.share({ message: actionSheetTarget.content || flattenBlocksToText(actionSheetTarget.blocks ?? []) });
                    setActionSheetTarget(null);
                  },
                },
              ].map((action) => (
                <Pressable
                  key={action.label}
                  testID={`btn-message-action-${action.label.toLowerCase().replace(/\s+/g, "-")}`}
                  onPress={action.onPress}
                  className="px-6 py-4 border-b border-border/50 active:bg-muted/20"
                >
                  <Text className="text-base text-foreground">{action.label}</Text>
                </Pressable>
              ))}
              <Pressable testID="btn-message-action-cancel" onPress={() => setActionSheetTarget(null)} className="px-6 py-4 active:bg-muted/20">
                <Text className="text-base text-primary font-semibold text-center">Cancel</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
        </GestureHandlerRootView>
      </Modal>

      {/* ── Live HTML preview overlay (⚡ Preview on a code block) ── */}
      <Modal animationType="slide" visible={previewHtml !== null} onRequestClose={() => setPreviewHtml(null)}>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
            <View className="flex-row items-center justify-between px-4 py-2 border-b border-border">
              <Text className="text-sm font-semibold text-foreground">Preview</Text>
              <Pressable testID="btn-close-preview" onPress={() => setPreviewHtml(null)} className="px-3 py-1 active:opacity-60">
                <Text className="text-primary font-semibold">Close</Text>
              </Pressable>
            </View>
            <WebView originWhitelist={["*"]} source={{ html: previewHtml ?? "" }} style={{ flex: 1 }} />
          </View>
        </GestureHandlerRootView>
      </Modal>

      {/* ── Input area ── */}
      <View className="border-t border-border bg-surface px-3 pt-2 pb-3 gap-2">
        {voice.error && (
          <View className="bg-error/10 border border-error rounded-lg p-2">
            <Text className="text-xs text-error">{voice.error}</Text>
          </View>
        )}

        {/* Queued messages (type-ahead). Tap a chip to edit it; ✕ to drop it. */}
        {messageQueue.length > 0 && (
          <View className="flex-row flex-wrap items-center gap-1.5">
            {messageQueue.map((q, i) => (
              <View key={q.id} className="flex-row items-center gap-1 bg-primary/10 border border-primary/30 rounded-full pl-2 pr-1 py-1">
                <Text className="text-[10px] font-bold text-primary">{i + 1}</Text>
                <Pressable testID={`chip-queued-${q.id}`} onPress={() => recallQueued(q)} style={{ maxWidth: 150 }}>
                  <Text className="text-[11px] text-foreground" numberOfLines={1}>{q.content}</Text>
                </Pressable>
                <Pressable testID={`btn-remove-queued-${q.id}`} onPress={() => setMessageQueue((qq) => qq.filter((x) => x.id !== q.id))} className="px-1 active:opacity-60">
                  <Text className="text-[11px] text-muted">✕</Text>
                </Pressable>
              </View>
            ))}
            <Text className="text-[10px] text-muted self-center">queued · tap to edit</Text>
          </View>
        )}

        {/* Row 1: text input (roomy) + Stop (while streaming) + Send/Queue */}
        <View className="flex-row gap-2 items-end">
          <TextInput testID="input-chat-message" value={messageInput} onChangeText={setMessageInput}
            placeholder={voice.isRecording ? "Recording… tap ⏹ to stop" : isSending ? "Type ahead — queues next…" : "Type a message…"}
            placeholderTextColor={colors.muted}
            className="flex-1 bg-background border border-border rounded-xl px-3 py-2.5 text-foreground"
            style={{ minHeight: 46, maxHeight: 140 }}
            multiline onSubmitEditing={handleSend} />

          {isSending && (
            <Pressable testID="btn-stop-stream" onPress={handleStop}
              className="rounded-xl px-3 items-center justify-center bg-error active:opacity-80" style={{ minHeight: 46 }}>
              <Text className="text-white font-semibold">⏹</Text>
            </Pressable>
          )}

          <Pressable testID="btn-send-message" onPress={handleSend} disabled={!messageInput.trim()}
            className={`rounded-xl px-4 items-center justify-center ${!messageInput.trim() ? "bg-primary/50" : "bg-primary active:opacity-80"}`}
            style={{ minHeight: 46 }}>
            <Text className="text-white font-semibold">{isSending ? "Queue" : "Send"}</Text>
          </Pressable>
        </View>

        {/* Row 2: small icon utilities (mic · file · photo · auto-approve · TTS) + status */}
        <View className="flex-row items-center gap-2">
          <Pressable testID="btn-mic" onPress={handleMicPress} disabled={voice.isTranscribing}
            className={`w-9 h-9 items-center justify-center rounded-lg ${
              voice.isRecording ? "bg-error" : voice.isTranscribing ? "bg-warning/50" : "bg-background border border-border"
            }`}>
            {voice.isTranscribing
              ? <ActivityIndicator size="small" color={colors.primary} />
              : <Text className="text-base leading-none">{voice.isRecording ? "⏹" : "🎤"}</Text>
            }
          </Pressable>
          <Pressable testID="btn-attach-file" onPress={handleAttachFile} disabled={isUploading}
            className={`w-9 h-9 items-center justify-center rounded-lg bg-background border border-border ${isUploading || !canAttachFiles ? "opacity-40" : "active:opacity-70"}`}>
            {isUploading ? <ActivityIndicator size="small" color={colors.primary} /> : <Text className="text-base leading-none">📎</Text>}
          </Pressable>
          <Pressable testID="btn-attach-photo" onPress={handleAttachPhoto} disabled={isUploading}
            className={`w-9 h-9 items-center justify-center rounded-lg bg-background border border-border ${isUploading || !canAttachPhoto ? "opacity-40" : "active:opacity-70"}`}>
            {isUploading ? <ActivityIndicator size="small" color={colors.primary} /> : <Text className="text-base leading-none">📷</Text>}
          </Pressable>
          {/* Auto-approve tool actions within the active map (shield). */}
          <Pressable testID="btn-auto-approve" onPress={() => updateSettings({ autoApproveTools: !chatDisplaySettings.autoApproveTools })}
            className={`w-9 h-9 items-center justify-center rounded-lg ${chatDisplaySettings.autoApproveTools ? "bg-warning" : "bg-background border border-border"}`}>
            <Text className="text-base leading-none">{chatDisplaySettings.autoApproveTools ? "🛡️" : "🔒"}</Text>
          </Pressable>
          {/* TTS auto-read toggle */}
          <Pressable testID="btn-tts-autoread" onPress={() => setAutoRead(!autoRead)}
            className={`w-9 h-9 items-center justify-center rounded-lg ${autoRead ? "bg-primary" : "bg-background border border-border"}`}>
            <Text className={`text-base leading-none ${autoRead ? "" : "opacity-50"}`}>🔊</Text>
          </Pressable>
          {voice.isSpeaking && (
            <Pressable testID="btn-stop-tts" onPress={voice.stopSpeaking}
              className="h-9 px-2 items-center justify-center rounded-lg bg-error/20 border border-error active:opacity-70">
              <Text className="text-error text-xs font-semibold">⏹ Stop</Text>
            </Pressable>
          )}

          <View className="flex-1" />
          <Text className="text-xs text-muted" numberOfLines={1}>
            {!pcConfigured
              ? "🔴 No server"
              : pcOnline
                ? "🟢 Connected"
                : pcChecking
                  ? "🟡 Checking…"
                  : "🔴 PC offline"}
            {phoneModel.state === "loading"
              ? " · 🤖 loading…"
              : phoneModel.engine && (phoneModel.state === "ready" || phoneModel.state === "running")
                ? ` · 🤖 ${phoneModel.backend === "npu" ? "⚡NPU" : (phoneModel.backend ?? "").toUpperCase()}`
                : ""}
          </Text>
        </View>
      </View>
    </ScreenContainer>
  );
}
