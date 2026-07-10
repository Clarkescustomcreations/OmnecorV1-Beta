import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { OmnecorDashboardLayout } from "@/components/OmnecorDashboardLayout";
import { ChatIntegrationBar } from "@/components/chat/ChatIntegrationBar";
import { ChatInterface } from "@/components/ChatInterface";
import { ContextTransparencyIndicator } from "@/components/ContextTransparencyIndicator";
import { VisualContextMap } from "@/components/VisualContextMap";
import { ConversationList } from "@/components/chat/ConversationList";
import { MemoryArchiverPanel } from "@/components/chat/MemoryArchiverPanel";
import { TerminalPanel } from "@/components/chat/TerminalPanel";
import { EmbeddedTerminal } from "@/components/terminal/EmbeddedTerminal";
import { HITLCommandApproval } from "@/components/terminal/HITLCommandApproval";
import { vanillaTrpc, trpc } from "@/lib/trpc";
import { IS_DEMO } from "@/lib/demo";
import { applyAgentEvent, applyJobCompletion } from "@/lib/agentStream";
import type { AssistantBlock } from "@shared/chatBlocks";
import {
  ChatMessage,
  ContextFile,
  SelectedModel,
  StoredConversationMeta,
  calculateContextTransparency,
  createConversation,
  addMessageToConversation,
  addFileToContext,
  removeFileFromContext,
  toggleFileInContext,
  estimateTokens,
  autoGenerateTitle,
  getStoredConversationIndex,
  saveConversationToStorage,
  loadConversationFromStorage,
  deleteConversationFromStorage,
  renameConversationInStorage,
} from "@/lib/chatContext";
import {
  getLegacyLocalScripts,
  clearLegacyLocalScripts,
  type SavedScript,
} from "@/lib/scriptStorage";
import { getContextWindow } from "@/lib/aiModels";
import type { SlashCommand } from "@/components/chat/ChatInput";
import { toast } from "sonner";
import { useAppStore } from "@/lib/store/app.store";
import { useOmnecorSocket } from "@/hooks/useOmnecorSocket";
import { SKILL_WORKFLOWS } from "@/lib/skillWorkflows";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { HowToTooltip } from "@/components/shell/HowToTooltip";
import { useUserPeerCard, buildPeerCardContext } from "@/lib/userPeerCard";
import { useNeuralMap } from "@/contexts/NeuralMapContext";
import { useNeuralContextStore } from "@/lib/neuralContextStore";
import { useFictionMode } from "@/contexts/FictionModeContext";
import { ChevronLeft, ChevronRight, Coins, FolderOpen, Box, Cpu, Globe, Maximize2, X, UserCircle2, Network } from "lucide-react";

import { ThreeViewer } from "@/components/designer/ThreeViewer";
import { EnhancedPCBEditor } from "@/components/pcb/EnhancedPCBEditor";
import { WebPreview } from "@/components/designer/WebPreview";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function exportConversationMd(conv: ReturnType<typeof createConversation>): void {
  const lines = [
    `# ${conv.title}`,
    `> Exported from Omnecor on ${new Date().toLocaleString()}`,
    `> ${conv.messages.length} messages`,
    "",
    "---",
    "",
  ];
  conv.messages.forEach(m => {
    lines.push(`## ${m.role === "user" ? "User" : "Assistant"}`);
    lines.push("");
    lines.push(m.content);
    lines.push("");
    lines.push(
      `*${m.timestamp.toLocaleString()} · ${(m.tokens ?? 0).toLocaleString()} tokens*`
    );
    lines.push("");
    lines.push("---");
    lines.push("");
  });

  const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `omnecor-chat-${conv.id.slice(5, 13)}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve((e.target?.result as string) ?? "");
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve((e.target?.result as string) ?? "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function Chat() {
  const [, setLocation] = useLocation();
  // ── Filter scope ─────────────────────────────────────────────────────────
  const [filterScope, setFilterScope] = useState<"project" | "global">(
    () => (localStorage.getItem("omnecor:chat_filter_scope") as "project" | "global") ?? "project"
  );

  const handleFilterScopeChange = useCallback((scope: "project" | "global") => {
    setFilterScope(scope);
    localStorage.setItem("omnecor:chat_filter_scope", scope);
  }, []);

  // ── Model selection ──────────────────────────────────────────────────────
  const [selectedModel, setSelectedModel] = useState<SelectedModel | undefined>(
    () => {
      try {
        const s = localStorage.getItem("omnecor:selectedModel");
        return s ? (JSON.parse(s) as SelectedModel) : undefined;
      } catch {
        return undefined;
      }
    }
  );

  const handleModelChange = useCallback((model: SelectedModel) => {
    setSelectedModel(model);
    localStorage.setItem("omnecor:selectedModel", JSON.stringify(model));
  }, []);

  const [valetRoutedModel, setValetRoutedModel] = useState<string | null>(null);

  // ── Peer card context ─────────────────────────────────────────────────────
  const { card: userPeerCard } = useUserPeerCard();
  const { activeMap } = useNeuralMap();
  const { entries: neuralContextFiles } = useNeuralContextStore();
  const { isFictionMode } = useFictionMode();

  // Fiction mode persona selector — load from global persona store
  const [fictionPersonaId, setFictionPersonaId] = useState<string>(() =>
    localStorage.getItem("omnecor:fiction_persona_id") ?? ""
  );
  const [fictionPersonas] = useState<Array<{ id: string; name: string; agentSystemPrompt?: string; bio?: string }>>(() => {
    try { return JSON.parse(localStorage.getItem("omnecor_personas") ?? "[]"); } catch { return []; }
  });
  const peerCardContext = buildPeerCardContext(
    userPeerCard,
    activeMap?.settings.enableAIContext ? activeMap.projectContext : null
  );

  // ── System prompt ────────────────────────────────────────────────────────
  const [systemPrompt, setSystemPrompt] = useState(
    () => localStorage.getItem("omnecor:systemPrompt") ?? ""
  );
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);

  // ── Live Terminal (declared early — buildFullSystemPrompt below reads it to
  // decide whether to disclose the <terminal_command> directive to the model) ──
  const [showCliTerminal, setShowCliTerminal] = useState(false);

  // ── Identity (for Honcho memory sync) ────────────────────────────────────
  const { data: me } = trpc.auth.me.useQuery();
  const openId = me?.openId ?? "local-anonymous";

  // ── Honcho facts — long-term memory injected into system prompt ───────────
  const { data: honchoFacts } = trpc.honcho.getFacts.useQuery(
    { openId, limit: 15 },
    { enabled: !!me && !!openId, staleTime: 60_000 }
  );
  const addHonchoFact = trpc.honcho.addFact.useMutation();
  const addHonchoMessage = trpc.honcho.addMessage.useMutation();

  // ── DB-backed chat persistence ────────────────────────────────────────────
  const chatUtils = trpc.useUtils();
  const { data: dbSessions = [], isSuccess: dbSessionsLoaded } = trpc.chat.listSessions.useQuery(
    filterScope === "project" && activeMap?.id ? { projectId: activeMap.id } : {},
    {
      enabled: !IS_DEMO,
      refetchOnWindowFocus: false,
    }
  );
  const createDbSession = trpc.chat.createSession.useMutation();
  const addDbMessage = trpc.chat.addMessage.useMutation();
  const updateDbSession = trpc.chat.updateSession.useMutation();
  const deleteDbSession = trpc.chat.deleteSession.useMutation();
  const bulkImportDb = trpc.chat.bulkImport.useMutation();
  const resolveToolApproval = trpc.aiProvider.resolveToolApproval.useMutation();
  const runCodeSnippet = trpc.aiProvider.runCodeSnippet.useMutation();
  // Mesh-Delegation.md — managed sub-agent chats. `delegatedById` maps every
  // delegated session id → its delegation metadata (node/scope), derived from
  // the DB session list (which carries `metadata.delegation`). `activeDelegation`
  // is the current conversation's, when it is a managed chat.
  const delegationSendTurn = trpc.delegation.sendTurn.useMutation();
  const delegationCancel = trpc.delegation.cancel.useMutation();
  const delegatedById = useMemo(() => {
    const m = new Map<string, { nodeId: string; nodeName: string }>();
    for (const s of dbSessions) {
      const del = (s.metadata as { delegation?: { nodeId: string; nodeName: string } } | null)?.delegation;
      if (del) m.set(s.id, { nodeId: del.nodeId, nodeName: del.nodeName });
    }
    return m;
  }, [dbSessions]);
  // Set of session IDs known to exist in DB (to skip redundant creates)
  const dbSessionIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    dbSessionIds.current = new Set(dbSessions.map(s => s.id));
  }, [dbSessions]);

  // ── BTW notes ────────────────────────────────────────────────────────────
  const [btwNotes, setBtwNotes] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("omnecor:btwNotes") ?? "[]") as string[];
    } catch {
      return [];
    }
  });

  const [identityMap, setIdentityMap] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("omnecor:identity_map") ?? "[]") as string[];
    } catch {
      return [];
    }
  });

  const [gotchas, setGotchas] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("omnecor:gotchas") ?? "[]") as string[];
    } catch {
      return [];
    }
  });

  const handleBtw = useCallback((note: string) => {
    setBtwNotes(prev => {
      const updated = [...prev, note];
      localStorage.setItem("omnecor:btwNotes", JSON.stringify(updated));
      return updated;
    });
    // Also persist to Honcho for cross-session retention
    addHonchoFact.mutate({ openId, content: note });
    toast.success("Context note added — Valet will keep this in mind");
  }, [openId, addHonchoFact]);

  const removeBtwNote = useCallback((idx: number) => {
    setBtwNotes(prev => {
      const updated = prev.filter((_, i) => i !== idx);
      localStorage.setItem("omnecor:btwNotes", JSON.stringify(updated));
      return updated;
    });
  }, []);

  const removeIdentityNote = useCallback((idx: number) => {
    setIdentityMap(prev => {
      const updated = prev.filter((_, i) => i !== idx);
      localStorage.setItem("omnecor:identity_map", JSON.stringify(updated));
      return updated;
    });
  }, []);

  const removeGotchaNote = useCallback((idx: number) => {
    setGotchas(prev => {
      const updated = prev.filter((_, i) => i !== idx);
      localStorage.setItem("omnecor:gotchas", JSON.stringify(updated));
      return updated;
    });
  }, []);

  // ── Per-message context exclusion ────────────────────────────────────────
  const [excludedMessageIds, setExcludedMessageIds] = useState<Set<string>>(new Set());

  const handleToggleExclusion = useCallback((id: string) => {
    setExcludedMessageIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  // ── Skill modal ──────────────────────────────────────────────────────────
  const [showSkillModal, setShowSkillModal] = useState(false);
  const [skillName, setSkillName] = useState("");
  const [skillDesc, setSkillDesc] = useState("");

  const handleSystemPromptChange = useCallback((prompt: string) => {
    setSystemPrompt(prompt);
    localStorage.setItem("omnecor:systemPrompt", prompt);
  }, []);

  // ── Streaming ────────────────────────────────────────────────────────────
  const [isStreaming, setIsStreaming] = useState(false);
  const streamRef = useRef<{ unsubscribe: () => void } | null>(null);
  // How the most recent turn ended, read by the message-queue drain effect:
  // "done"/"stopped" drain the next queued turn; "error" holds it back so a
  // failing provider isn't hammered with the whole queue. Starts "done" so the
  // very first idle state is allowed to drain.
  const streamEndRef = useRef<"done" | "error" | "stopped">("done");

  const handleStop = useCallback(() => {
    streamRef.current?.unsubscribe();
    streamRef.current = null;
    streamEndRef.current = "stopped";
    setIsStreaming(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => streamRef.current?.unsubscribe();
  }, []);

  // ── Conversations ────────────────────────────────────────────────────────
  const [conversationIndex, setConversationIndex] = useState<StoredConversationMeta[]>(
    () => getStoredConversationIndex()
  );

  const [conversation, setConversation] = useState(() => {
    const index = getStoredConversationIndex();
    if (index.length > 0) {
      const loaded = loadConversationFromStorage(index[0].id);
      if (loaded) return loaded;
    }
    return createConversation("New Conversation", "default");
  });

  const conversationRef = useRef(conversation);
  useEffect(() => {
    conversationRef.current = conversation;
  }, [conversation]);

  const isStreamingRef = useRef(isStreaming);
  useEffect(() => {
    isStreamingRef.current = isStreaming;
  }, [isStreaming]);

  const sidebarCollapsed = useAppStore((s) => s.chatHistoryCollapsed);
  const setSidebarCollapsed = useAppStore((s) => s.setChatHistoryCollapsed);

  // Between-turn message queue (type-ahead — ChatInput enqueues while streaming).
  const messageQueue = useAppStore((s) => s.messageQueue);
  const dequeueMessage = useAppStore((s) => s.dequeueMessage);
  const clearMessageQueue = useAppStore((s) => s.clearMessageQueue);

  // When DB sessions load, use them as the authoritative sidebar list
  useEffect(() => {
    if (IS_DEMO || !dbSessionsLoaded) return;
    setConversationIndex(dbSessions.map(s => ({
      id: s.id,
      title: s.title,
      lastMessage: "",
      updatedAt: new Date(s.updatedAt).toISOString(),
      messageCount: 0,
      delegatedNodeName: (s.metadata as { delegation?: { nodeName: string } } | null)?.delegation?.nodeName,
    })));
  }, [dbSessions, dbSessionsLoaded]);



  // One-time migration: if DB is empty on first load and localStorage has conversations, import them
  const migrationRanRef = useRef(false);
  useEffect(() => {
    if (IS_DEMO || !dbSessionsLoaded || migrationRanRef.current) return;
    migrationRanRef.current = true;
    if (dbSessions.length > 0) return;
    const localIndex = getStoredConversationIndex();
    if (localIndex.length === 0) return;
    const sessions = localIndex.flatMap(meta => {
      const conv = loadConversationFromStorage(meta.id);
      if (!conv) return [] as Parameters<typeof bulkImportDb.mutate>[0]["sessions"];
      return [{
        id: conv.id,
        title: conv.title,
        providerId: conv.modelId?.split(":")[0] ?? "default",
        modelId: conv.modelId ?? "default",
        projectId: "",
        messages: conv.messages
          .filter(m => m.role === "user" || m.role === "assistant")
          .map(m => ({
            id: m.id,
            role: m.role as "user" | "assistant",
            content: m.content,
            tokenCount: m.tokens,
          })),
      }];
    });
    if (sessions.length === 0) return;
    bulkImportDb.mutate({ sessions }, {
      onSuccess: (result) => {
        if (result.imported > 0) {
          toast.success(`Migrated ${result.imported} conversation(s) to your account`);
          chatUtils.chat.listSessions.invalidate();
        }
      },
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbSessionsLoaded, dbSessions.length]);

  // Debounced auto-save (localStorage — fast local persistence)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (conversation.messages.length === 0) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveConversationToStorage(conversation);
      setConversationIndex(prev => {
        const updated = getStoredConversationIndex();
        // Prefer DB list if loaded; otherwise use localStorage list
        return dbSessionsLoaded && dbSessions.length > 0 ? prev : updated;
      });
    }, 800);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation]);

  // Ref-based DB persist helper — avoids adding mutation objects to streamResponse deps.
  // Updated every render so it always captures current mutations/model/map without
  // forcing the expensive streamResponse useCallback to recreate.
  const persistToDbRef = useRef<(
    convId: string, convTitle: string,
    userMsg: ChatMessage,
    assistantId: string, assistantContent: string
  ) => void>(() => {});
  persistToDbRef.current = (convId, convTitle, userMsg, assistantId, assistantContent) => {
    if (IS_DEMO) return;
    const saveMessages = () => {
      addDbMessage.mutate({ id: userMsg.id, sessionId: convId, role: "user", content: userMsg.content, tokenCount: userMsg.tokens });
      addDbMessage.mutate({ id: assistantId, sessionId: convId, role: "assistant", content: assistantContent, tokenCount: Math.ceil(assistantContent.length / 4) });
    };
    if (!dbSessionIds.current.has(convId)) {
      dbSessionIds.current.add(convId);
      createDbSession.mutate({
        id: convId,
        title: convTitle || "New Conversation",
        providerId: selectedModel?.providerId ?? "default",
        modelId: selectedModel?.modelId ?? "default",
        projectId: activeMap?.id ?? "",
      }, {
        onSuccess: () => {
          saveMessages();
          chatUtils.chat.listSessions.invalidate();
        },
      });
    } else {
      saveMessages();
    }
  };

  // ── Saved Scripts (server-backed, syncs across devices/projects) ──────────
  const scriptsUtils = trpc.useUtils();
  const { data: scripts = [] } = trpc.scripts.list.useQuery(
    activeMap?.id ? { mapId: activeMap.id } : undefined,
    { enabled: !IS_DEMO }
  );

  const deleteScriptMutation = trpc.scripts.delete.useMutation({
    onSuccess: () => {
      scriptsUtils.scripts.list.invalidate();
      toast.success("Script deleted");
    },
    onError: (err) => toast.error(err.message || "Failed to delete script"),
  });
  const updateScriptMutation = trpc.scripts.update.useMutation({
    onSuccess: () => scriptsUtils.scripts.list.invalidate(),
    onError: (err) => toast.error(err.message || "Failed to rename script"),
  });
  const createScriptMutation = trpc.scripts.create.useMutation();

  const handleSelectScript = useCallback((script: SavedScript) => {
    // Inject script into chat with a request to reuse it
    const injection = `Reuse my saved script "${script.name}" (from project: ${script.project}):\n\n\`\`\`${script.language}\n${script.code}\n\`\`\``;
    // We'll pass this via a ref or state to ChatInterface to populate the input
    window.dispatchEvent(new CustomEvent("omnecor:inject_chat", { detail: injection }));
    toast.success(`Injected script "${script.name}" into input`);
  }, []);

  const handleDeleteScript = useCallback(
    (id: number) => {
      if (!confirm("Are you sure you want to delete this saved script?")) return;
      deleteScriptMutation.mutate({ id });
    },
    [deleteScriptMutation]
  );

  const handleRenameScript = useCallback(
    (id: number, name: string) => {
      updateScriptMutation.mutate({ id, name });
    },
    [updateScriptMutation]
  );

  // One-time migration: lift any scripts left in the old localStorage store up
  // to the server so they are no longer trapped on this browser.
  // Each script is removed from localStorage as soon as it uploads successfully,
  // so a mid-run network failure never causes duplicates on retry.
  useEffect(() => {
    if (IS_DEMO) return;
    const legacy = getLegacyLocalScripts();
    if (legacy.length === 0) return;
    (async () => {
      let migrated = 0;
      for (const s of legacy) {
        try {
          await createScriptMutation.mutateAsync({
            ...s,
            mapId: activeMap?.id
          });
          migrated++;
        } catch (e) {
          console.warn("Saved-script migration failed for script", s.name, e);
        }
      }
      clearLegacyLocalScripts();
      scriptsUtils.scripts.list.invalidate();
      if (migrated > 0) {
        toast.success(`Migrated ${migrated} saved script(s) to your account`);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Conversation actions ─────────────────────────────────────────────────
  const handleNewConversation = useCallback(() => {
    // Auto-title current conversation if it has messages
    if (conversation.messages.length > 0) {
      const titled = {
        ...conversation,
        title: autoGenerateTitle(conversation.messages),
      };
      saveConversationToStorage(titled);
    }
    const fresh = createConversation(
      "New Conversation",
      selectedModel?.modelId ?? "default"
    );
    setConversation(fresh);
    setConversationIndex(getStoredConversationIndex());
  }, [conversation, selectedModel]);

  const handleSelectConversation = useCallback(async (id: string) => {
    if (conversation.messages.length > 0) {
      saveConversationToStorage(conversation);
    }
    const loaded = loadConversationFromStorage(id);
    if (loaded && loaded.messages.length > 0) {
      setConversation(loaded);
      return;
    }
    // localStorage empty or absent — try DB
    if (!IS_DEMO) {
      try {
        const dbSession = await chatUtils.chat.getSession.fetch({ id });
        if (dbSession) {
          const conv = createConversation(dbSession.title, dbSession.modelId ?? "default");
          conv.id = dbSession.id;
          conv.messages = dbSession.messages.map(m => ({
            id: m.id,
            role: m.role as "user" | "assistant" | "system",
            content: m.content,
            tokens: m.tokenCount ?? estimateTokens(m.content),
            timestamp: new Date(m.createdAt),
          }));
          setConversation(conv);
          saveConversationToStorage(conv);
          return;
        }
      } catch {
        // not in DB either — fall through to whatever localStorage has
      }
    }
    if (loaded) setConversation(loaded);
  }, [conversation, chatUtils]);

  // Auto-switch conversation when activeMap or filterScope changes to align with project isolation.
  // Keyed on the map+scope pair (not every session-list refetch) so that persisting the FIRST
  // message of a brand-new conversation — which invalidates listSessions and refetches dbSessions —
  // does not briefly see an empty project list and yank the user out of the chat they just started.
  const prevMapScopeRef = useRef<string>("");
  useEffect(() => {
    if (IS_DEMO || !dbSessionsLoaded) return;

    const key = `${filterScope}:${activeMap?.id ?? ""}`;
    const mapScopeChanged = prevMapScopeRef.current !== key;
    prevMapScopeRef.current = key;

    // On a mere session-list refetch (same map + scope), never abandon a conversation the user is
    // actively using — it may have just been created for THIS project and not yet reappear in the
    // refetched list. Only realign when the map/scope genuinely changed, or the view is empty.
    if (!mapScopeChanged && conversation.messages.length > 0) return;

    if (filterScope === "project" && activeMap?.id) {
      const projectSessions = dbSessions; // already filtered at API layer
      if (projectSessions.length > 0) {
        const currentConvId = conversation.id;
        const currentBelongsToProject = projectSessions.some(s => s.id === currentConvId);

        if (!currentBelongsToProject) {
          handleSelectConversation(projectSessions[0].id);
        }
      } else {
        const hasMessages = conversation.messages.length > 0;
        const isDbSession = dbSessionIds.current.has(conversation.id);

        if (isDbSession || (hasMessages && !isDbSession)) {
          handleNewConversation();
        }
      }
    }
  }, [activeMap?.id, filterScope, dbSessionsLoaded, dbSessions, conversation.id, conversation.messages.length, handleSelectConversation, handleNewConversation]);

  const handleDeleteConversation = useCallback(
    (id: string) => {
      deleteConversationFromStorage(id);
      if (!IS_DEMO && dbSessionIds.current.has(id)) {
        deleteDbSession.mutate({ id }, {
          onSuccess: () => chatUtils.chat.listSessions.invalidate(),
        });
      }
      setConversationIndex(prev => prev.filter(s => s.id !== id));

      if (conversation.id === id) {
        const remaining = getStoredConversationIndex();
        if (remaining.length > 0) {
          const next = loadConversationFromStorage(remaining[0].id);
          if (next) { setConversation(next); return; }
        }
        setConversation(createConversation("New Conversation", "default"));
      }
    },
    [conversation, deleteDbSession, chatUtils]
  );

  const handleRenameConversation = useCallback(
    (id: string, title: string) => {
      renameConversationInStorage(id, title);
      if (!IS_DEMO && dbSessionIds.current.has(id)) {
        updateDbSession.mutate({ id, title }, {
          onSuccess: () => chatUtils.chat.listSessions.invalidate(),
        });
      }
      setConversationIndex(prev => prev.map(s => s.id === id ? { ...s, title } : s));
      if (conversation.id === id) {
        setConversation(prev => ({ ...prev, title }));
      }
    },
    [conversation, updateDbSession, chatUtils]
  );

  const handleTitleChange = useCallback(
    (title: string) => handleRenameConversation(conversation.id, title),
    [conversation.id, handleRenameConversation]
  );

  // ── Clear history ────────────────────────────────────────────────────────
  const handleClearHistory = useCallback(() => {
    if (!confirm("Clear this conversation's history?")) return;
    setConversation(prev => ({
      ...createConversation(prev.title, prev.modelId),
      id: prev.id, // keep ID so storage entry updates rather than duplicates
    }));
  }, []);

  // ── File attachment ──────────────────────────────────────────────────────
  const handleAddFile = useCallback(async (file: File) => {
    try {
      const content = await readFileAsText(file);
      const contextFile: ContextFile = {
        id: `file_${crypto.randomUUID()}`,
        path: file.name,
        name: file.name,
        type: "file",
        size: file.size,
        tokens: estimateTokens(content),
        included: true,
        lastModified: new Date(file.lastModified),
        preview: content.slice(0, 200),
      };
      setConversation(prev => addFileToContext(prev, contextFile));
    } catch {
      toast.error(`Failed to read file: ${file.name}`);
    }
  }, []);

  const handleAddImage = useCallback(async (file: File) => {
    try {
      const dataUrl = await readFileAsDataURL(file);
      const contextFile: ContextFile = {
        id: `img_${crypto.randomUUID()}`,
        path: file.name,
        name: file.name,
        type: "file",
        size: file.size,
        tokens: 85, // rough vision token estimate
        included: true,
        lastModified: new Date(file.lastModified),
        preview: dataUrl.slice(0, 80) + "…",
      };
      setConversation(prev => addFileToContext(prev, contextFile));
      toast.success(`Image attached: ${file.name}`);
    } catch {
      toast.error(`Failed to attach image: ${file.name}`);
    }
  }, []);

  // Assemble the exact system prompt that gets sent to the model. Shared by the
  // streaming sender and the context-transparency panel so the displayed System
  // token count reflects what is actually transmitted (not a fixed placeholder).
  const buildFullSystemPrompt = useCallback((): string => {
    const btwContext = btwNotes.map(n => `[Background context: ${n}]`).join("\n");
    const identityContext = identityMap.length > 0 ? `[User Preferences (Omnecor Identity)]\n${identityMap.map(n => `- ${n}`).join("\n")}` : "";
    const gotchaContext = gotchas.length > 0 ? `[Project Gotchas (Avoid these)]\n${gotchas.map(n => `- ${n}`).join("\n")}` : "";
    const honchoContext = honchoFacts?.length
      ? honchoFacts.map(f => `[Long-term memory: ${f.content}]`).join("\n")
      : "";
    const neuralContext = neuralContextFiles.length > 0
      ? `<neural_map_context>\nThe following files/folders are pinned from the neural map:\n${neuralContextFiles.map(f => `- ${f.nodeType === "folder" ? "📁" : "📄"} ${f.name} (${f.path})`).join("\n")}\n</neural_map_context>`
      : "";
    const activePersona = isFictionMode && fictionPersonaId
      ? fictionPersonas.find(p => p.id === fictionPersonaId)
      : undefined;
    const personaContext = activePersona
      ? `<active_persona>\nYou are roleplaying as: ${activePersona.name}.\n${activePersona.bio ? `Background: ${activePersona.bio}\n` : ""}${activePersona.agentSystemPrompt ? `Persona instructions: ${activePersona.agentSystemPrompt}\n` : ""}</active_persona>`
      : "";
    const fictionGuardrail = isFictionMode
      ? `<fiction_mode_guardrails>\nYou are operating in FICTION MODE. Your role is limited to creative storytelling, roleplay, fiction writing, song lyrics, and poetry.\n\nYou MUST:\n- Stay in character and maintain the current roleplay/fiction narrative at all times\n- Keep all creative work grounded in the active story/fiction world\n- Support the user's storytelling, worldbuilding, and creative writing goals\n\nYou MUST NOT (these capabilities are disabled for this session):\n- Execute terminal commands or access the local filesystem outside the neural fiction map\n- Perform agent networking, post to social media, or run autonomous agents\n- Access wallets, make financial transactions, or manage budgets\n- Spin up cloud compute jobs or perform cloud-side automation\n- Perform system administration tasks on the host machine\n\nWeb search IS permitted to support research for the story.\nFile saves are permitted only within the active neural fiction map.\n\nIf asked to perform any blocked action, gently redirect back to the creative fiction context.\n</fiction_mode_guardrails>`
      : "";
    // Only disclose the terminal-execution directive once the user has actually
    // opened the live terminal — keeps the capability opt-in and avoids spending
    // tokens describing it in ordinary chats that never touch a shell.
    const terminalCapabilityContext = !isFictionMode && showCliTerminal
      ? `<terminal_capability>\nThe user has a live terminal (a real shell on their own machine) open in this session. If running a shell command would help complete the user's request, you may execute ONE by wrapping the exact command like this:\n<terminal_command>the exact shell command</terminal_command>\nThe user must approve every command before it runs (human-in-the-loop) — it will not run silently. Its output will be added back into this conversation as a system message. Issue at most one <terminal_command> per reply and wait for its output before issuing another. Do not use this tag for illustrative or example code that isn't meant to actually run.\n</terminal_capability>`
      : "";
    return [peerCardContext, systemPrompt.trim(), btwContext, identityContext, gotchaContext, honchoContext, neuralContext, personaContext, fictionGuardrail, terminalCapabilityContext].filter(Boolean).join("\n\n");
  }, [btwNotes, identityMap, gotchas, honchoFacts, neuralContextFiles, isFictionMode, fictionPersonaId, fictionPersonas, peerCardContext, systemPrompt, showCliTerminal]);

  // ── Streaming core ───────────────────────────────────────────────────────
  const streamResponse = useCallback(
    (userMsg: ChatMessage, priorMessages: ChatMessage[]) => {
      if (!selectedModel) return;

      const assistantId = crypto.randomUUID();
      // The agentic stream builds an ordered AssistantBlock[]; the client folds
      // each wire event into it (pure reducer) and re-renders. `content` stays
      // the flattened text (from the server's `done`) for persistence/copy.
      let assistantBlocks: AssistantBlock[] = [];

      setConversation(prev => ({
        ...prev,
        messages: [...prev.messages, {
          id: assistantId,
          role: "assistant" as const,
          content: "",
          blocks: [],
          timestamp: new Date(),
          tokens: 0,
        }],
        updatedAt: new Date(),
      }));

      const apiMessages: Array<{ role: "user" | "assistant" | "system"; content: string }> = [];
      const fullSystem = buildFullSystemPrompt();
      if (fullSystem) {
        apiMessages.push({ role: "system", content: fullSystem });
      }
      priorMessages.forEach(m => {
        if ((m.role === "user" || m.role === "assistant") && !excludedMessageIds.has(m.id)) {
          apiMessages.push({ role: m.role, content: m.content });
        }
      });
      apiMessages.push({ role: "user", content: userMsg.content });

      // Push the current block array onto the streaming assistant message.
      const writeBlocks = () => {
        setConversation(prev => ({
          ...prev,
          messages: prev.messages.map(m =>
            m.id === assistantId ? { ...m, blocks: assistantBlocks } : m
          ),
        }));
      };

      const finalize = (content: string, totalTokens?: number) => {
        streamEndRef.current = "done";
        setIsStreaming(false);
        streamRef.current = null;
        setConversation(prev => ({
          ...prev,
          messages: prev.messages.map(m =>
            m.id === assistantId
              ? {
                  ...m,
                  blocks: assistantBlocks,
                  content,
                  // `|| estimate` (not `??`): a provider that reports no usage
                  // sends 0, which must fall back to the char estimate, not stick.
                  tokens: totalTokens || Math.ceil(content.length / 4),
                }
              : m
          ),
        }));

        // Sync both sides of the exchange to Honcho (background, non-blocking)
        const sid = conversationRef.current.id;
        addHonchoMessage.mutate({ openId, sessionId: sid, role: "user", content: userMsg.content });
        addHonchoMessage.mutate({ openId, sessionId: sid, role: "ai", content });
        // Persist to DB (fire-and-forget — also creates session if not yet tracked)
        persistToDbRef.current(conversationRef.current.id, conversationRef.current.title, userMsg, assistantId, content);
        // Rolling buffer: auto-compress when conversation exceeds 50 messages
        setConversation(prev => {
          const ROLLING_BUFFER_LIMIT = 50;
          if (prev.messages.length > ROLLING_BUFFER_LIMIT) {
            const kept = prev.messages.slice(-6);
            const compressed = prev.messages.slice(0, prev.messages.length - 6);
            const summaryMsg: ChatMessage = {
              id: crypto.randomUUID(),
              role: "system" as const,
              content: `[Auto-compressed: ${compressed.length} older messages summarized to manage context. Last 6 messages retained.]`,
              timestamp: new Date(),
              tokens: estimateTokens(`${compressed.length} messages compressed`),
            };
            toast.info(`Context auto-compressed: ${compressed.length} older messages summarized.`, { duration: 4000 });
            return { ...prev, messages: [summaryMsg, ...kept], updatedAt: new Date() };
          }
          return prev;
        });
      };

      const failStream = (message: string) => {
        toast.error(`Stream error: ${message}`);
        setConversation(prev => ({
          ...prev,
          messages: prev.messages.map(m =>
            m.id === assistantId
              ? { ...m, content: `Error: ${message}`, metadata: { error: message } }
              : m
          ),
        }));
        streamEndRef.current = "error";
        setIsStreaming(false);
        streamRef.current = null;
      };

      const startStream = (providerId: SelectedModel["providerId"], modelId: string) => {
        const sub = vanillaTrpc.aiProvider.agentChatStream.subscribe(
          {
            providerId,
            modelId,
            apiKey: selectedModel.apiKey,
            baseUrl: selectedModel.baseUrl,
            messages: apiMessages,
            // Map RAG: anchor the chat to the active map so the server can inject
            // its indexed knowledge. Gated client-side by the same enableAIContext
            // toggle used for projectContext; the server re-checks authoritatively.
            ragMapId: activeMap?.settings.enableAIContext ? activeMap.id : undefined,
            // Tool scope: file edits + command cwd are confined to the active
            // map's roots; the server re-validates every path against them.
            mapId: activeMap?.id,
            rootDirectories: activeMap?.rootDirectories,
            // Session "auto-approve within active map" toggle (chat header).
            autoApprove: useAppStore.getState().chatDisplaySettings.autoApproveTools,
            conversationId: conversationRef.current.id,
            // Model-Fabric Phase 5 — pins mesh routing to the exact peer the
            // user picked in the catalog (undefined for This PC / Cloud /
            // auto-valet selections, which never go through mesh offload).
            targetNodeId: selectedModel.targetNodeId,
          },
          {
            onData(ev) {
              assistantBlocks = applyAgentEvent(assistantBlocks, ev);
              if (ev.type === "done") {
                finalize(ev.content, ev.totalTokens);
              } else if (ev.type === "error") {
                failStream(ev.message);
              } else {
                writeBlocks();
              }
            },
            onError(err) {
              failStream(err.message);
            },
          }
        );

        streamRef.current = sub;
      };

      if (selectedModel.modelId === "auto-valet") {
        const fallback = useAppStore.getState().valetFallbackModel;
        vanillaTrpc.valet.testRoute.mutate({ task: userMsg.content })
          .then(decision => {
            const providerId = decision.primaryProvider || fallback?.providerId || "ollama";
            const modelId = decision.primaryModel || fallback?.modelId || "llama3.2:latest";
            setValetRoutedModel(`${providerId}/${modelId}`);
            startStream(providerId as SelectedModel["providerId"], modelId);
          })
          .catch(err => {
            console.warn("[Chat] Valet route failed, using fallback:", err);
            toast.warning(`Valet Router offline. Falling back to ${fallback?.modelId ?? "default"}`);
            setValetRoutedModel(`Fallback: ${fallback?.modelId ?? "unknown"}`);
            startStream((fallback?.providerId as SelectedModel["providerId"]) ?? "ollama", fallback?.modelId ?? "llama3.2:latest");
          });
      } else {
        setValetRoutedModel(null);
        startStream(selectedModel.providerId, selectedModel.modelId);
      }
    },
    [selectedModel, buildFullSystemPrompt, openId, addHonchoMessage, excludedMessageIds, activeMap?.id, activeMap?.settings.enableAIContext, activeMap?.rootDirectories]
  );

  // ── HITL tool approval (agentic stream) ──────────────────────────────────
  // A pending_approval tool box resolves through the server broker; the block
  // id is the approval key. `resolved: false` means it already expired / was
  // superseded (e.g. the 10-min TTL auto-denied it) — surface that, don't retry.
  const handleApproveTool = useCallback((id: string) => {
    resolveToolApproval.mutate(
      { id, decision: "approve" },
      {
        onSuccess: (r) => { if (!r.resolved) toast.warning("That approval already expired or was handled."); },
        onError: (e) => toast.error(`Approval failed: ${e.message}`),
      }
    );
  }, [resolveToolApproval]);

  const handleDenyTool = useCallback((id: string, reason?: string) => {
    resolveToolApproval.mutate(
      { id, decision: "deny", denyReason: reason },
      {
        onSuccess: (r) => { if (!r.resolved) toast.warning("That approval already expired or was handled."); },
        onError: (e) => toast.error(`Denial failed: ${e.message}`),
      }
    );
  }, [resolveToolApproval]);

  // ── Send message ─────────────────────────────────────────────────────────
  const handleSendMessage = useCallback(
    (content: string, priorMessages?: ChatMessage[]) => {
      if (!content.trim() || isStreaming) return;

      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content,
        timestamp: new Date(),
        tokens: Math.ceil(content.length / 4),
      };

      // Mesh-Delegation.md — a follow-up turn in a managed sub-agent chat routes
      // to the peer (Decision 5, between-turn chat), NOT the local model path.
      // The user bubble is appended optimistically; the peer's live stream drives
      // the assistant turn via the delegation.stream subscription effect below.
      if (delegatedById.has(conversation.id)) {
        setConversation(prev => addMessageToConversation(prev, userMsg));
        setIsStreaming(true);
        streamEndRef.current = "done";
        delegationSendTurn.mutate(
          { conversationId: conversation.id, content },
          {
            onError: (e) => {
              toast.error(`Sub-agent is busy or unreachable: ${e.message}`);
              setIsStreaming(false);
            },
          }
        );
        return;
      }

      const baseMessages = priorMessages ?? conversation.messages;
      setConversation(prev => addMessageToConversation(
        priorMessages
          ? { ...prev, messages: priorMessages, totalTokensUsed: priorMessages.reduce((s, m) => s + (m.tokens ?? 0), 0) }
          : prev,
        userMsg
      ));

      if (!selectedModel) {
        setIsStreaming(true);
        setTimeout(() => {
          const demoMsg: ChatMessage = {
            id: crypto.randomUUID(),
            role: "assistant",
            content:
              "Demo mode — select a model in the dropdown above (or visit Model Hub) to enable real AI responses.",
            timestamp: new Date(),
            tokens: 22,
          };
          setConversation(prev => addMessageToConversation(prev, demoMsg));
          setIsStreaming(false);
        }, 500);
        return;
      }

      setIsStreaming(true);
      streamResponse(userMsg, baseMessages);
    },
    [conversation.messages, conversation.id, isStreaming, selectedModel, streamResponse, delegatedById, delegationSendTurn]
  );

  // ── Retry ────────────────────────────────────────────────────────────────
  const handleRetry = useCallback(() => {
    const msgs = conversation.messages;
    const lastAssistantIdx = msgs.map(m => m.role).lastIndexOf("assistant");
    if (lastAssistantIdx === -1) return;

    const lastUserMsg = msgs
      .slice(0, lastAssistantIdx)
      .reverse()
      .find(m => m.role === "user");
    if (!lastUserMsg) return;

    handleStop();
    const trimmed = msgs.slice(0, lastAssistantIdx);
    handleSendMessage(lastUserMsg.content, trimmed);
  }, [conversation.messages, handleSendMessage, handleStop]);

  // ── Edit message ─────────────────────────────────────────────────────────
  const handleEditMessage = useCallback(
    (messageId: string, newContent: string) => {
      const idx = conversation.messages.findIndex(m => m.id === messageId);
      if (idx === -1) return;
      handleStop();
      const priorMessages = conversation.messages.slice(0, idx);
      handleSendMessage(newContent, priorMessages);
    },
    [conversation.messages, handleSendMessage, handleStop]
  );

  // ── Delete message ───────────────────────────────────────────────────────
  const handleDeleteMessage = useCallback((id: string) => {
    setConversation(prev => ({
      ...prev,
      messages: prev.messages.filter(m => m.id !== id),
      updatedAt: new Date(),
    }));
  }, []);

  // ── Slash commands ───────────────────────────────────────────────────────
  const handleCommand = useCallback(
    async (cmd: SlashCommand, arg?: string) => {
      // Inject a steering/system message (workflow preamble or server result)
      // into the conversation so Valet runs the workflow with it in context.
      const injectSystem = (text: string) =>
        setConversation(prev => ({
          ...prev,
          messages: [
            ...prev.messages,
            {
              id: crypto.randomUUID(),
              role: "system" as const,
              content: text,
              timestamp: new Date(),
              tokens: Math.ceil(text.length / 4),
            },
          ],
          updatedAt: new Date(),
        }));
      switch (cmd) {
        case "clear":
          handleClearHistory();
          break;
        case "new":
          handleNewConversation();
          break;
        case "system":
          setShowSystemPrompt(v => !v);
          break;
        case "export":
          if (conversation.messages.length === 0) {
            toast.info("Nothing to export yet");
          } else {
            exportConversationMd(conversation);
            toast.success("Exported as Markdown");
          }
          break;

        case "compress": {
          const msgs = conversation.messages;
          if (msgs.length <= 6) {
            toast.info("Not enough history to compress — need more than 6 messages");
            break;
          }
          if (!selectedModel) {
            // Fallback: dumb truncation when no model is configured
            const toCompress = msgs.slice(0, -6);
            const kept = msgs.slice(-6);
            const summaryLines = toCompress
              .map(m => `[${m.role}]: ${m.content.slice(0, 140).replace(/\n/g, " ")}${m.content.length > 140 ? "…" : ""}`)
              .join("\n");
            const summaryMsg: ChatMessage = {
              id: crypto.randomUUID(),
              role: "system" as const,
              content: `[Compressed — ${toCompress.length} messages]\n\n${summaryLines}`,
              timestamp: new Date(),
              tokens: estimateTokens(summaryLines),
            };
            setConversation(prev => ({
              ...prev,
              messages: [summaryMsg, ...kept],
              updatedAt: new Date(),
            }));
            toast.success(`Compressed ${toCompress.length} messages (no model — try /compress after selecting one for AI summarization)`);
            break;
          }
          const toCompress = msgs.slice(0, -6);
          const kept = msgs.slice(-6);
          toast.info("Summarizing with AI…", { duration: 10_000 });
          try {
            const transcript = toCompress
              .map(m => `[${m.role.toUpperCase()}]: ${m.content}`)
              .join("\n\n");
            const result = await vanillaTrpc.ai.chat.mutate({
              providerId: selectedModel.providerId,
              modelId: selectedModel.modelId,
              apiKey: selectedModel.apiKey,
              baseUrl: selectedModel.baseUrl,
              targetNodeId: selectedModel.targetNodeId,
              messages: [{
                role: "user",
                content: `Summarize the following conversation history into a single concise paragraph. Preserve all key facts, decisions, file names, and context. Be complete — nothing important should be lost:\n\n${transcript}`,
              }],
            });
            const summaryMsg: ChatMessage = {
              id: crypto.randomUUID(),
              role: "system" as const,
              content: `[AI Summary of ${toCompress.length} messages]\n\n${result.content}`,
              timestamp: new Date(),
              tokens: estimateTokens(result.content),
            };
            setConversation(prev => ({
              ...prev,
              messages: [summaryMsg, ...kept],
              updatedAt: new Date(),
            }));
            toast.success(`Compressed ${toCompress.length} messages into AI summary`);
          } catch (err) {
            toast.error(`Compress failed: ${(err as Error).message}`);
          }
          break;
        }

        case "skill":
          if (conversation.messages.length === 0) {
            toast.info("No conversation to save as a skill yet");
            break;
          }
          setSkillName("");
          setSkillDesc("");
          setShowSkillModal(true);
          break;

        case "plan":
          injectSystem(SKILL_WORKFLOWS[cmd].preamble);
          toast.info(
            "Plan mode active — Valet will guide project setup. Start by describing your goal.",
            { duration: 5000 }
          );
          break;

        case "architect":
        case "recover": {
          injectSystem(SKILL_WORKFLOWS[cmd].preamble);
          toast.info(
            cmd === "architect"
              ? "Architect mode — describe what you want to build."
              : "Recover mode — describe what went wrong and how many fixes you've tried.",
            { duration: 6000 }
          );
          break;
        }

        case "review": {
          toast.info("Gathering changes for review…", { duration: 8000 });
          try {
            const reviewCtx = await vanillaTrpc.workflow.reviewContext.query({});
            const diffBlock = reviewCtx.hasChanges
              ? `Working-tree changes:\n\n${reviewCtx.diffStat}\n\n\`\`\`diff\n${reviewCtx.diff}\n\`\`\`${reviewCtx.truncated ? "\n(diff truncated)" : ""}`
              : "No uncommitted changes detected in the working tree.";
            const planBlock = Object.entries(reviewCtx.planExcerpts)
              .map(([f, t]) => `--- ${f} ---\n${t}`)
              .join("\n\n");
            injectSystem(
              `${SKILL_WORKFLOWS.review.preamble}\n\n[Review context]\n${diffBlock}${planBlock ? `\n\n[Plan]\n${planBlock}` : ""}`
            );
            toast.success(
              reviewCtx.hasChanges
                ? "Review context loaded — ask Valet to run the review."
                : "No changes to review."
            );
          } catch (err) {
            toast.error(`Review failed: ${(err as Error).message}`);
          }
          break;
        }

        case "remember": {
          const mode = (arg || "").trim().toLowerCase();
          if (mode === "restore") {
            try {
              const res = await vanillaTrpc.workflow.rememberRestore.query({
                projectId: activeMap?.id ?? "default",
              });
              if (!res.hasMemory || !res.memory) {
                toast.info("No saved memory found for this project.");
                break;
              }
              injectSystem(
                `${SKILL_WORKFLOWS.remember.preamble}\n\n[Restored memory]\n${res.memory}`
              );
              toast.success("Memory restored — confirm with Valet before continuing.");
            } catch (err) {
              toast.error(`Restore failed: ${(err as Error).message}`);
            }
            break;
          }
          if (mode.startsWith("save")) {
            if (!selectedModel) {
              toast.error("Select a model first to summarize the session.");
              break;
            }
            if (conversation.messages.length === 0) {
              toast.info("Nothing to save yet.");
              break;
            }
            toast.info("Saving session memory…", { duration: 10_000 });
            try {
              const res = await vanillaTrpc.workflow.rememberSave.mutate({
                projectId: activeMap?.id ?? "default",
                providerId: selectedModel.providerId,
                modelId: selectedModel.modelId,
                apiKey: selectedModel.apiKey,
                baseUrl: selectedModel.baseUrl,
                targetNodeId: selectedModel.targetNodeId,
                messages: conversation.messages.map(m => ({
                  role: m.role,
                  content: m.content,
                })),
              });
              injectSystem(`[Memory saved → memory.md]\n\n${res.content}`);
              toast.success("Session memory saved.");
            } catch (err) {
              toast.error(`Save failed: ${(err as Error).message}`);
            }
            break;
          }
          if (mode.startsWith("context ")) {
            const note = mode.substring(8).trim();
            if (!note) {
              toast.error("Usage: /remember context <note>");
              break;
            }
            handleBtw(note);
            toast.success("Pinned note to immediate context");
            break;
          }
          if (mode.startsWith("me ")) {
            const note = mode.substring(3).trim();
            if (!note) {
              toast.error("Usage: /remember me <preference>");
              break;
            }
            setIdentityMap(prev => {
              const updated = [...prev, note];
              localStorage.setItem("omnecor:identity_map", JSON.stringify(updated));
              return updated;
            });
            toast.success("Added to global Omnecor Identity map");
            break;
          }
          if (mode.startsWith("gotcha ")) {
            const note = mode.substring(7).trim();
            if (!note) {
              toast.error("Usage: /remember gotcha <hitch to avoid>");
              break;
            }
            setGotchas(prev => {
              const updated = [...prev, note];
              localStorage.setItem("omnecor:gotchas", JSON.stringify(updated));
              return updated;
            });
            toast.success("Added to project-wide avoidance list (gotchas)");
            break;
          }
          toast.info("Usage: /remember save | restore | context <note> | me <pref> | gotcha <hitch>", {
            duration: 8000,
          });
          break;
        }

        case "imprint": {
          const filePath = (arg || "").trim();
          if (!filePath) {
            toast.info(
              "Usage: /imprint <path to a component file in your project>",
              { duration: 6000 }
            );
            break;
          }
          toast.info("Imprinting UI patterns…", { duration: 8000 });
          try {
            const res = await vanillaTrpc.workflow.imprint.mutate({
              projectId: activeMap?.id ?? "default",
              filePath,
            });
            injectSystem(`[Imprinted → ui-registry.md]\n\n${res.entry}`);
            toast.success("UI patterns captured to ui-registry.md");
          } catch (err) {
            toast.error(`Imprint failed: ${(err as Error).message}`);
          }
          break;
        }

        case "moe-chain": {
          // arg is "l" | "c" | undefined (from /MOE-Chain L/C/bare)
          const chainTypeArg = (arg ?? "").toLowerCase();
          const chainTypes: Array<"local" | "cloud"> =
            chainTypeArg === "c" ? ["cloud"] :
            chainTypeArg === "l" ? ["local"] :
            ["local", "cloud"];

          toast.info("Setting up MoE Chain…", { duration: 5000 });
          try {
            const res = await vanillaTrpc.valet.initMoeChain.mutate({
              chainType: chainTypes.length === 1 ? chainTypes[0]! : "both",
            });

            const localMsg = res.localSteps.length > 0
              ? `Found ${res.localSteps.length} local GGUF model(s).`
              : "No GGUFs found in models directory — add .gguf files to ~/.omnecor/models/.";
            const cloudMsg = chainTypes.includes("cloud")
              ? " Cloud chain template seeded (configure providers in Settings → Valet Router → MoE Chain)."
              : "";

            injectSystem(
              `[MoE Chain initialised]\n\n` +
              `${localMsg}${cloudMsg}\n\n` +
              `Edit your chain in **Settings → Valet Router → MoE Chain**, then send a message — ` +
              `Omnecor will automatically route \`moe_chain\` tasks through your specialist models.`
            );
            toast.success("MoE Chain ready");
          } catch (err) {
            toast.error(`MoE Chain init failed: ${(err as Error).message}`);
          }
          break;
        }

        case "help":
          toast.info(
            "Slash commands: /new · /clear · /compress · /btw <note> · /plan · /skill · /system · /export · /help\nWorkflows: /architect · /remember [save|restore] · /review · /recover · /imprint <file> · /MOE-Chain [L|C]",
            { duration: 10000 }
          );
          break;

        default:
          break;
      }
    },
    [handleClearHistory, handleNewConversation, conversation, setConversation, selectedModel, handleBtw, activeMap?.id]
  );

  // ── Command Palette → workflow bridge ────────────────────────────────────
  // The global Command Palette's Workflows group navigates here and dispatches
  // this event; run the matching slash workflow.
  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent<{ id?: string }>).detail?.id;
      if (id) void handleCommand(id as SlashCommand);
    };
    window.addEventListener("omnecor:run_workflow", handler);
    return () => window.removeEventListener("omnecor:run_workflow", handler);
  }, [handleCommand]);

  // ── Context panel collapse ──────────────────────────────────────────────
  const contextCollapsed = useAppStore((s) => s.chatContextCollapsed);
  const setContextCollapsed = useAppStore((s) => s.setChatContextCollapsed);

  // ── Live Preview Panel ──────────────────────────────────────────────────
  const [previewMode, setPreviewMode] = useState<"3d" | "pcb" | "web" | "none">("none");
  const [previewCode, setPreviewCode] = useState<string>("");
  const [showMemoryArchiver, setShowMemoryArchiver] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);

  // ── Terminal output → chat context bridge ────────────────────────────────
  const terminalOutputBuf = useRef<string[]>([]);
  const terminalFlushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const handler = (e: Event) => {
      const chunk = (e as CustomEvent<string>).detail;
      if (!chunk) return;
      terminalOutputBuf.current.push(chunk);
      if (terminalFlushTimer.current) clearTimeout(terminalFlushTimer.current);
      terminalFlushTimer.current = setTimeout(() => {
        const output = terminalOutputBuf.current.join("").trim();
        terminalOutputBuf.current = [];
        if (!output || output.length < 5) return;
        const injected = `[Terminal output]\n\`\`\`\n${output.slice(0, 3000)}\n\`\`\``;
        setConversation(prev => ({
          ...prev,
          messages: [
            ...prev.messages,
            {
              id: crypto.randomUUID(),
              role: "system" as const,
              content: injected,
              timestamp: new Date(),
              tokens: Math.ceil(injected.length / 4),
            },
          ],
          updatedAt: new Date(),
        }));
      }, 2000);
    };
    window.addEventListener("omnecor:terminal_output", handler);
    return () => {
      window.removeEventListener("omnecor:terminal_output", handler);
      if (terminalFlushTimer.current) clearTimeout(terminalFlushTimer.current);
    };
  }, []);

  // ── Async background-job results → conversation continuation ──────────────
  // When a long agent-launched job (build/download/train) finishes, the server
  // condenses its output and pushes an `asyncJobResult` over the socket. We
  // inject the compact result as a system message and, if Valet is idle, auto
  // re-prompt it to continue based on the result — the token-saving async-job
  // flow, without ever loading the raw multi-thousand-line log.
  //
  // Refs keep the socket handler stable (so the WS doesn't reconnect every
  // render) while still reading the latest conversation / streaming / sender.
  const handleSendMessageRef = useRef(handleSendMessage);
  useEffect(() => {
    handleSendMessageRef.current = handleSendMessage;
  }, [handleSendMessage]);

  // ── Message queue drain ───────────────────────────────────────────────────
  // When the turn ends and the AI is idle, dequeue the oldest type-ahead message
  // and fire it as the next turn (FIFO). The isStreaming guard + React batching
  // (handleSendMessage synchronously flips isStreaming back on) mean exactly one
  // message drains per idle transition. Skipped after an error so a failing
  // provider isn't hit with every queued turn back-to-back.
  useEffect(() => {
    if (isStreaming) return;
    if (streamEndRef.current === "error") return;
    if (messageQueue.length === 0) return;
    const next = dequeueMessage();
    if (next) handleSendMessageRef.current(next.content);
  }, [isStreaming, messageQueue, dequeueMessage]);

  // The queue is bound to the active conversation — switching away must drop any
  // queued type-ahead so it can't fire into the wrong chat. Also cleared on
  // unmount (leaving the page) since the queue is ephemeral by design.
  const prevConvIdRef = useRef(conversation.id);
  useEffect(() => {
    if (prevConvIdRef.current !== conversation.id) {
      prevConvIdRef.current = conversation.id;
      clearMessageQueue();
    }
  }, [conversation.id, clearMessageQueue]);
  useEffect(() => () => clearMessageQueue(), [clearMessageQueue]);

  const handleAsyncJobResult = useCallback((data: Record<string, unknown>) => {
    const formatted = typeof data?.formatted === "string" ? data.formatted : "";
    if (!formatted) return;
    const result = data?.result as { label?: string; status?: string } | undefined;
    const label = result?.label ?? "background job";
    const jobId = typeof data?.jobId === "string" ? data.jobId : "";

    // Drive the live JobBlock (if any) to its terminal state — correlated by
    // jobId, not block id — so the box in the stream turns green/red with the
    // condensed tail, matching the injected system message.
    if (jobId) {
      const jobStatus =
        result?.status === "completed" || result?.status === "failed" || result?.status === "cancelled"
          ? result.status
          : "completed";
      setConversation(prev => ({
        ...prev,
        messages: prev.messages.map(m =>
          m.blocks && m.blocks.some(b => b.type === "job" && b.jobId === jobId)
            ? { ...m, blocks: applyJobCompletion(m.blocks, jobId, jobStatus, formatted) }
            : m
        ),
      }));
    }

    // User-initiated code Runs (autoContinue === false): the job box above already
    // shows the outcome. Don't inject a system message or re-prompt the AI — the
    // run was a test, not a request to regenerate. Just surface a status toast.
    const context = data?.context as { autoContinue?: boolean } | undefined;
    if (context?.autoContinue === false) {
      if (result?.status === "failed") toast.error(`${label} failed — open the box to see the output.`);
      else toast.success(`${label} finished.`);
      return;
    }

    const resultMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "system",
      content: formatted,
      timestamp: new Date(),
      tokens: Math.ceil(formatted.length / 4),
    };
    toast.success(`Background job finished: ${label}`);

    // A stream is in flight — just inject so the result isn't lost; Valet will
    // pick it up on the next turn rather than racing the active stream.
    if (isStreamingRef.current) {
      setConversation(prev => ({
        ...prev,
        messages: [...prev.messages, resultMsg],
        updatedAt: new Date(),
      }));
      return;
    }

    // Idle — inject the result and auto re-prompt Valet to act on it. Passing
    // priorMessages makes handleSendMessage append the result + user nudge and
    // stream with the result in context.
    const priors = [...conversationRef.current.messages, resultMsg];
    handleSendMessageRef.current(
      "A background job just finished — its condensed result is in the system message above. Continue based on it.",
      priors
    );
  }, []);

  // Mesh-Delegation.md — a managed sub-agent chat was created / advanced / ended
  // on the server. Refresh the session list so the new managed chat appears in
  // the sidebar without a manual reload (the "appears automatically" requirement)
  // and toast the lifecycle. The parent chat's `subagent` chip is driven
  // separately by the async-job path (jobId = taskId), so we don't touch blocks
  // here — this is purely list/awareness.
  const handleDelegationEvent = useCallback((data: Record<string, unknown>) => {
    const kind = typeof data?.kind === "string" ? data.kind : "";
    const nodeName = typeof data?.nodeName === "string" ? data.nodeName : "a mesh node";
    const label = typeof data?.label === "string" ? data.label : "task";
    chatUtils.chat.listSessions.invalidate();
    if (kind === "created") toast.success(`Sub-agent started on ${nodeName}: ${label}`);
    else if (kind === "failed") toast.error(`Sub-agent on ${nodeName} failed.`);
    else if (kind === "cancelled") toast.info(`Sub-agent on ${nodeName} cancelled.`);
  }, [chatUtils]);

  const handleSocketEvent = useCallback(
    (type: string, data: Record<string, unknown>) => {
      if (type === "asyncJobResult") handleAsyncJobResult(data);
      else if (type === "delegationEvent") handleDelegationEvent(data);
    },
    [handleAsyncJobResult, handleDelegationEvent]
  );

  const { subscribe: subscribeSocket, unsubscribe: unsubscribeSocket } =
    useOmnecorSocket({ onEvent: handleSocketEvent });

  // Scope the result channel to this user so one user's job results never leak
  // to another in networked/multi-node mode. The server also mirrors to
  // asyncjob:all, but we deliberately do not subscribe to that here.
  useEffect(() => {
    if (me?.id == null) return;
    const channel = `asyncjob:${me.id}`;
    subscribeSocket(channel);
    return () => unsubscribeSocket(channel);
  }, [me?.id, subscribeSocket, unsubscribeSocket]);

  // ── Managed sub-agent chat: live stream subscription (Mesh-Delegation.md) ──
  // When the active conversation is a managed sub-agent chat, subscribe to the
  // peer's relayed `AgentStreamEvent` stream (via the origin's DelegationService)
  // and fold it into a streaming assistant message — the same reducer + block
  // renderers the local agentic chat uses. Finished turns already live in the DB
  // transcript (loaded on select); this only drives the in-progress turn. HITL
  // approve/deny for a delegated tool box goes through the ordinary
  // `resolveToolApproval` mutation (the server forwards it to the peer).
  const isActiveDelegated = delegatedById.has(conversation.id);
  useEffect(() => {
    if (IS_DEMO || !isActiveDelegated) return;
    const convId = conversation.id;
    // Per-turn accumulator: `curId` is the current streaming assistant message
    // id (null between turns). A fresh non-terminal event starts a new turn.
    let curId: string | null = null;
    let blocks: AssistantBlock[] = [];

    const ensureTurn = () => {
      if (curId) return;
      curId = crypto.randomUUID();
      blocks = [];
      setIsStreaming(true);
      setConversation(prev =>
        prev.id !== convId ? prev : {
          ...prev,
          messages: [...prev.messages, { id: curId!, role: "assistant" as const, content: "", blocks: [], timestamp: new Date(), tokens: 0 }],
        }
      );
    };
    const writeBlocks = () => {
      const id = curId;
      setConversation(prev =>
        prev.id !== convId ? prev : { ...prev, messages: prev.messages.map(m => m.id === id ? { ...m, blocks } : m) }
      );
    };

    const sub = vanillaTrpc.delegation.stream.subscribe(
      { conversationId: convId },
      {
        onData(ev) {
          if (ev.type === "done") {
            const id = curId;
            const content = ev.content;
            const finalBlocks = ev.blocks?.length ? ev.blocks : blocks;
            setConversation(prev =>
              prev.id !== convId ? prev : { ...prev, messages: prev.messages.map(m => m.id === id ? { ...m, blocks: finalBlocks, content, tokens: ev.totalTokens || Math.ceil(content.length / 4) } : m) }
            );
            curId = null;
            setIsStreaming(false);
            return;
          }
          if (ev.type === "error") {
            const id = curId;
            setConversation(prev =>
              prev.id !== convId ? prev : { ...prev, messages: prev.messages.map(m => m.id === id ? { ...m, metadata: { ...m.metadata, error: ev.message } } : m) }
            );
            curId = null;
            setIsStreaming(false);
            return;
          }
          ensureTurn();
          blocks = applyAgentEvent(blocks, ev);
          writeBlocks();
        },
        onError(err) {
          toast.error(`Sub-agent stream error: ${err.message}`);
          setIsStreaming(false);
        },
      }
    );
    return () => {
      sub.unsubscribe();
    };
  }, [isActiveDelegated, conversation.id]);

  // Cancel the active managed sub-agent run.
  const handleCancelDelegation = useCallback(() => {
    delegationCancel.mutate(
      { conversationId: conversation.id },
      {
        onSuccess: () => { toast.info("Sub-agent cancelled."); setIsStreaming(false); },
        onError: (e) => toast.error(`Cancel failed: ${e.message}`),
      }
    );
  }, [conversation.id, delegationCancel]);

  const handleOpenPreview = useCallback((mode: "3d" | "pcb" | "web", code: string) => {
    setPreviewMode(mode);
    setPreviewCode(code);
    setContextCollapsed(true); // Auto collapse context to make room
  }, []);

  // ── Code-block Run / Preview (the ▶ Run / ⚡ Preview buttons on code fences) ──
  // Run executes a snippet as a background job (rendered as a JobBlock in the
  // conversation, driven to completion by the async-job → WS path); a GUI app
  // like pygame opens a window on the host display. Preview routes markup to the
  // existing live-preview panel. Both notify via toast, per the workstation flow.
  useEffect(() => {
    const onRun = (e: Event) => {
      const { language, code } = (e as CustomEvent<{ language: string; code: string }>).detail ?? {};
      if (!code?.trim()) return;
      runCodeSnippet.mutate(
        {
          language,
          code,
          mapId: activeMap?.id,
          rootDirectories: activeMap?.rootDirectories,
          conversationId: conversationRef.current.id,
        },
        {
          onSuccess: (res) => {
            toast.success(`Running ${res.label.replace(/^run /, "")} — output streams into the job box (a window opens if it's a GUI app).`);
            const jobMsg: ChatMessage = {
              id: crypto.randomUUID(),
              role: "assistant",
              content: "",
              blocks: [{
                id: crypto.randomUUID(),
                type: "job",
                jobId: res.jobId,
                label: res.label,
                command: res.command,
                status: "running",
                kind: "process",
              }],
              timestamp: new Date(),
              tokens: 0,
            };
            setConversation(prev => addMessageToConversation(prev, jobMsg));
          },
          onError: (err) => toast.error(`Run failed: ${err.message}`),
        },
      );
    };
    const onPreview = (e: Event) => {
      const { code } = (e as CustomEvent<{ language: string; code: string }>).detail ?? {};
      if (!code?.trim()) return;
      handleOpenPreview("web", code);
      toast.success("Opened the live preview panel.");
    };
    window.addEventListener("omnecor:run_code", onRun);
    window.addEventListener("omnecor:preview_code", onPreview);
    return () => {
      window.removeEventListener("omnecor:run_code", onRun);
      window.removeEventListener("omnecor:preview_code", onPreview);
    };
  }, [runCodeSnippet, activeMap?.id, activeMap?.rootDirectories, handleOpenPreview]);

  const transparency = useMemo(() => {
    const systemTokens = estimateTokens(buildFullSystemPrompt(), selectedModel?.modelId);
    const modelMaxTokens = getContextWindow(selectedModel?.providerId, selectedModel?.modelId);
    return calculateContextTransparency(conversation, modelMaxTokens, systemTokens);
  }, [conversation, buildFullSystemPrompt, selectedModel?.providerId, selectedModel?.modelId]);

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <OmnecorDashboardLayout>
      <div className="h-full flex overflow-hidden">
        {/* Conversation history sidebar */}
        <ConversationList
          conversations={conversationIndex}
          activeId={conversation.id}
          onSelect={handleSelectConversation}
          onCreate={handleNewConversation}
          onDelete={handleDeleteConversation}
          onRename={handleRenameConversation}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
          filterScope={filterScope}
          onFilterScopeChange={handleFilterScopeChange}
          scripts={scripts}
          onSelectScript={handleSelectScript}
          onDeleteScript={handleDeleteScript}
          onRenameScript={handleRenameScript}
        />

        {/* Main chat area */}
        <div className="flex-1 flex gap-4 p-4 overflow-hidden min-w-0">
          <div className="flex-1 flex flex-col min-w-0 gap-1.5 overflow-hidden">
            {/* BTW context note chips */}
            {btwNotes.length > 0 && (
              <div className="flex flex-wrap gap-1.5 px-0.5 flex-shrink-0">
                {btwNotes.map((note, i) => (
                  <div
                    key={`btw-${i}`}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/40 border border-border text-xs max-w-xs card-content-safe"
                  >
                    <span className="font-semibold text-accent opacity-70">btw</span>
                    <span className="text-muted-foreground truncate">{note}</span>
                    <button
                      onClick={() => removeBtwNote(i)}
                      className="text-muted-foreground hover:text-destructive transition-colors leading-none ml-0.5"
                      aria-label="Remove note"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Identity map note chips */}
            {identityMap.length > 0 && (
              <div className="flex flex-wrap gap-1.5 px-0.5 flex-shrink-0">
                {identityMap.map((note, i) => (
                  <div
                    key={`id-${i}`}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/20 border border-border text-xs max-w-xs card-content-safe"
                  >
                    <span className="font-semibold text-primary opacity-70">me</span>
                    <span className="text-muted-foreground truncate">{note}</span>
                    <button
                      onClick={() => removeIdentityNote(i)}
                      className="text-muted-foreground hover:text-destructive transition-colors leading-none ml-0.5"
                      aria-label="Remove note"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Gotchas note chips */}
            {gotchas.length > 0 && (
              <div className="flex flex-wrap gap-1.5 px-0.5 flex-shrink-0">
                {gotchas.map((note, i) => (
                  <div
                    key={`gotcha-${i}`}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-destructive/20 border border-border text-xs max-w-xs card-content-safe"
                  >
                    <span className="font-semibold text-destructive opacity-70">gotcha</span>
                    <span className="text-muted-foreground truncate">{note}</span>
                    <button
                      onClick={() => removeGotchaNote(i)}
                      className="text-muted-foreground hover:text-destructive transition-colors leading-none ml-0.5"
                      aria-label="Remove note"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          {/* Managed sub-agent chat banner (Mesh-Delegation.md) */}
          {isActiveDelegated && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-accent-cyan/10 border border-accent-cyan/30 text-xs flex-shrink-0">
              <Network className="w-3.5 h-3.5 text-accent-cyan" />
              <span className="text-foreground/90">
                Sub-agent on <strong>{delegatedById.get(conversation.id)?.nodeName ?? "mesh peer"}</strong> — running here, streamed live.
              </span>
              {isStreaming && (
                <button
                  onClick={handleCancelDelegation}
                  className="ml-auto text-destructive hover:underline"
                >
                  Cancel
                </button>
              )}
            </div>
          )}
          <ChatIntegrationBar
            onInjectContext={(snippet) =>
              handleSendMessage(`[Integration context injected]\n\n${snippet}`)
            }
          />
          <ChatInterface
            className="flex-1 min-w-0"
            layout="stream"
            onApproveTool={handleApproveTool}
            onDenyTool={handleDenyTool}
            onOpenDelegation={handleSelectConversation}
            messages={conversation.messages}
            isLoading={isStreaming}
            conversationTitle={conversation.title}
            selectedModel={selectedModel}
            conversationId={conversation.id}
            contextFiles={conversation.contextFiles}
            systemPrompt={systemPrompt}
            showSystemPrompt={showSystemPrompt}
            onSendMessage={handleSendMessage}
            onClearHistory={handleClearHistory}
            onRetry={handleRetry}
            onDeleteMessage={handleDeleteMessage}
            onEditMessage={handleEditMessage}
            onModelChange={handleModelChange}
            onTitleChange={handleTitleChange}
            onAddFile={handleAddFile}
            onAddImage={handleAddImage}
            onSystemPromptChange={handleSystemPromptChange}
            onToggleSystemPrompt={() => setShowSystemPrompt(v => !v)}
            onExport={() => {
              if (conversation.messages.length === 0) {
                toast.info("Nothing to export yet");
              } else {
                exportConversationMd(conversation);
                toast.success("Exported as Markdown");
              }
            }}
            onStop={handleStop}
            onCommand={handleCommand}
            onBtw={handleBtw}
            tokenCount={transparency.totalTokens}
            maxTokens={transparency.maxTokens}
            excludedMessageIds={excludedMessageIds}
            onToggleExclusion={handleToggleExclusion}
            onOpenPreview={handleOpenPreview}
            valetRoutedModel={valetRoutedModel}
            onToggleMemory={() => setShowMemoryArchiver(v => !v)}
            onToggleTerminal={isFictionMode ? undefined : () => setShowTerminal(v => !v)}
            onToggleCliTerminal={isFictionMode ? undefined : () => setShowCliTerminal(v => !v)}
            isFictionMode={isFictionMode}
            fictionPersonas={fictionPersonas}
            fictionPersonaId={fictionPersonaId}
            onFictionPersonaChange={(id) => {
              setFictionPersonaId(id);
              localStorage.setItem("omnecor:fiction_persona_id", id);
            }}
          />
          </div>

          {/* Memory Archiver Panel */}
          {showMemoryArchiver && conversation.id && (
            <MemoryArchiverPanel 
              sessionId={conversation.id} 
              projectId={activeMap?.id ?? "default"} 
              selectedModel={selectedModel}
            />
          )}

          {/* Live Preview Panel */}
          {previewMode !== "none" && (
            <div className="fixed inset-y-0 right-0 w-[85vw] max-w-sm sm:static sm:w-96 sm:max-w-none lg:w-[400px] xl:w-[500px] flex flex-col gap-2 overflow-hidden flex-shrink-0 border border-border rounded-xl bg-card shadow-xl animate-in slide-in-from-right-4 duration-300 z-30 sm:z-10">
              <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30">
                <div className="flex items-center gap-2">
                  {previewMode === "3d" && <Box className="w-4 h-4 text-primary" />}
                  {previewMode === "pcb" && <Cpu className="w-4 h-4 text-primary" />}
                  {previewMode === "web" && <Globe className="w-4 h-4 text-primary" />}
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Live Preview
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 hover:bg-primary/20 hover:text-primary"
                    title="Edit in Designer (Current Tab)"
                    onClick={() => {
                      localStorage.setItem("omnecor:designer_code", previewCode);
                      localStorage.setItem("omnecor:designer_mode", previewMode);
                      setLocation("/3d-designer");
                    }}
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="w-6 h-6 hover:bg-primary/20 hover:text-primary"
                    title="Pop out to new window"
                    onClick={() => {
                      localStorage.setItem("omnecor:designer_code", previewCode);
                      localStorage.setItem("omnecor:designer_mode", previewMode);
                      window.open("/3d-designer", "_blank");
                    }}
                  >
                    <Maximize2 className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="w-6 h-6 hover:bg-destructive/20 hover:text-destructive"
                    onClick={() => setPreviewMode("none")}
                  >
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden relative bg-background">
                {previewMode === "3d" && <ThreeViewer code={previewCode} />}
                {previewMode === "pcb" && <EnhancedPCBEditor />}
                {previewMode === "web" && <WebPreview code={previewCode} />}
              </div>
            </div>
          )}

          {/* Context panel (Collapsible) */}
          <div className={cn(
            "flex flex-col gap-3 transition-all duration-300 overflow-hidden flex-shrink-0 hidden lg:flex",
            contextCollapsed ? "w-10 items-center" : "w-60 xl:w-72"
          )}>
            <HowToTooltip 
              title={contextCollapsed ? "Expand Context" : "Collapse Context"} 
              description="Toggle the visibility of real-time context transparency and file mapping panels."
              side="left"
            >
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 mb-1"
                onClick={() => setContextCollapsed(!contextCollapsed)}
              >
                {contextCollapsed ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </Button>
            </HowToTooltip>
            
            {!contextCollapsed && (
              <>
                <HowToTooltip title="Context Transparency" description="Monitor exactly how many tokens are being used by the system prompt, chat history, and files." side="left">
                  <div>
                    <ContextTransparencyIndicator
                      transparency={transparency}
                      className="flex-shrink-0"
                    />
                  </div>
                </HowToTooltip>
                <HowToTooltip title="Visual Context Map" description="Manage which local files are currently being 'read' by the AI. Toggle files to keep context lean." side="left">
                  <div>
                    <VisualContextMap
                      files={conversation.contextFiles}
                      onToggleFile={id =>
                        setConversation(prev => toggleFileInContext(prev, id))
                      }
                      onRemoveFile={id =>
                        setConversation(prev => removeFileFromContext(prev, id))
                      }
                      className="flex-1 min-h-0"
                    />
                  </div>
                </HowToTooltip>
              </>
            )}
            {contextCollapsed && (
              <div className="flex flex-col gap-6 pt-4 text-muted-foreground">
                <HowToTooltip title="Tokens Used" description="Current total token usage across all context sources." side="left">
                  <div className="flex flex-col items-center gap-1 cursor-help">
                    <Coins className="w-4 h-4" />
                    <span className="text-[10px] font-mono">
                      {Math.round(transparency.totalTokens / 1000)}k
                    </span>
                  </div>
                </HowToTooltip>
                <HowToTooltip title="Active Files" description="Total number of local files currently injected into the AI's memory." side="left">
                  <div className="flex flex-col items-center gap-1 cursor-help">
                    <FolderOpen className="w-4 h-4" />
                    <span className="text-[10px] font-mono">
                      {conversation.contextFiles.length}
                    </span>
                  </div>
                </HowToTooltip>
              </div>
            )}
          </div>
        </div>
      </div>
      {/* Skill save modal */}
      <Dialog open={showSkillModal} onOpenChange={setShowSkillModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save as Reusable Skill</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">Skill Name</label>
              <Input
                value={skillName}
                onChange={e => setSkillName(e.target.value)}
                placeholder="e.g. auth-flow-research"
                autoFocus
                onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">Description <span className="text-muted-foreground font-normal">(optional)</span></label>
              <Input
                value={skillDesc}
                onChange={e => setSkillDesc(e.target.value)}
                placeholder="What does this skill do?"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSkillModal(false)}>Cancel</Button>
            <Button
              onClick={() => {
                if (!skillName.trim()) { toast.error("Enter a skill name"); return; }
                const skill = {
                  id: crypto.randomUUID(),
                  name: skillName.trim(),
                  description: skillDesc.trim(),
                  messages: conversation.messages,
                  systemPrompt,
                  btwNotes,
                  model: selectedModel,
                  createdAt: new Date().toISOString(),
                };
                let existing: unknown[];
                try { existing = JSON.parse(localStorage.getItem("omnecor:skills") ?? "[]") as unknown[]; } catch { existing = []; }
                existing.push(skill);
                localStorage.setItem("omnecor:skills", JSON.stringify(existing));
                setShowSkillModal(false);
                toast.success(`Skill "${skill.name}" saved — invoke it from the Command Palette`);
              }}
            >
              Save Skill
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    {!isFictionMode && (
      <TerminalPanel
        isOpen={showTerminal}
        onToggle={() => setShowTerminal(v => !v)}
        projectId={activeMap?.id ?? "default"}
      />
    )}
    {!isFictionMode && (
      <EmbeddedTerminal
        isOpen={showCliTerminal}
        onClose={() => setShowCliTerminal(false)}
        onRequestOpen={() => setShowCliTerminal(true)}
        projectId={activeMap?.id ?? "default"}
      />
    )}
    {/* HITL command approval dialog — rendered at root so it floats above everything */}
    <HITLCommandApproval />
    </OmnecorDashboardLayout>

  );
}
