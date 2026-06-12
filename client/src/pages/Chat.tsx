import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import OmnecorDashboardLayout from "@/components/OmnecorDashboardLayout";
import ChatIntegrationBar from "@/components/chat/ChatIntegrationBar";
import ChatInterface from "@/components/ChatInterface";
import ContextTransparencyIndicator from "@/components/ContextTransparencyIndicator";
import VisualContextMap from "@/components/VisualContextMap";
import ConversationList from "@/components/chat/ConversationList";
import MemoryArchiverPanel from "@/components/chat/MemoryArchiverPanel";
import TerminalPanel from "@/components/chat/TerminalPanel";
import CliTerminalWindow from "@/components/chat/CliTerminalWindow";
import EmbeddedTerminal from "@/components/terminal/EmbeddedTerminal";
import HITLCommandApproval from "@/components/terminal/HITLCommandApproval";
import { vanillaTrpc, trpc } from "@/lib/trpc";
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
  getSavedScripts,
  deleteScript,
  updateScript,
  type SavedScript,
} from "@/lib/scriptStorage";
import type { SlashCommand } from "@/components/chat/ChatInput";
import { toast } from "sonner";
import { useAppStore } from "@/lib/store/app.store";
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
import { ChevronLeft, ChevronRight, Coins, FolderOpen, Box, Cpu, Globe, Maximize2, X, UserCircle2 } from "lucide-react";

import ThreeViewer from "@/components/designer/ThreeViewer";
import EnhancedPCBEditor from "@/components/pcb/EnhancedPCBEditor";
import WebPreview from "@/components/designer/WebPreview";

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
export default function Chat() {
  const [, setLocation] = useLocation();
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

  // ── Identity (for Honcho memory sync) ────────────────────────────────────
  const { data: me } = trpc.auth.me.useQuery();
  const openId = me?.openId ?? "local-anonymous";

  // ── Honcho facts — long-term memory injected into system prompt ───────────
  const { data: honchoFacts } = trpc.honcho.getFacts.useQuery(
    { openId, limit: 15 },
    { enabled: !!me && !!openId, staleTime: 60_000 }
  );
  const addHonchoFact = trpc.honcho.addFact.useMutation({
    onError: (err) => console.error("[Honcho] addFact failed:", err.message),
  });
  const addHonchoMessage = trpc.honcho.addMessage.useMutation({
    onError: (err) => console.error("[Honcho] addMessage failed:", err.message),
  });

  // ── BTW notes ────────────────────────────────────────────────────────────
  const [btwNotes, setBtwNotes] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("omnecor:btwNotes") ?? "[]") as string[];
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

  const handleStop = useCallback(() => {
    streamRef.current?.unsubscribe();
    streamRef.current = null;
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

  const sidebarCollapsed = useAppStore((s) => s.chatHistoryCollapsed);
  const setSidebarCollapsed = useAppStore((s) => s.setChatHistoryCollapsed);

  // Debounced auto-save
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (conversation.messages.length === 0) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveConversationToStorage(conversation);
      setConversationIndex(getStoredConversationIndex());
    }, 800);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [conversation]);

  // ── Saved Scripts ───────────────────────────────────────────────────────
  const [scripts, setScripts] = useState<SavedScript[]>(() => getSavedScripts());

  const handleSelectScript = useCallback((script: SavedScript) => {
    // Inject script into chat with a request to reuse it
    const injection = `Reuse my saved script "${script.name}" (from project: ${script.project}):\n\n\`\`\`${script.language}\n${script.code}\n\`\`\``;
    // We'll pass this via a ref or state to ChatInterface to populate the input
    window.dispatchEvent(new CustomEvent("omnecor:inject_chat", { detail: injection }));
    toast.success(`Injected script "${script.name}" into input`);
  }, []);

  const handleDeleteScript = useCallback((id: string) => {
    if (!confirm("Are you sure you want to delete this saved script?")) return;
    deleteScript(id);
    setScripts(getSavedScripts());
    toast.success("Script deleted");
  }, []);

  const handleRenameScript = useCallback((id: string, name: string) => {
    updateScript(id, { name });
    setScripts(getSavedScripts());
  }, []);

  // Listen for "script saved" events from message bubbles
  useEffect(() => {
    const handler = () => setScripts(getSavedScripts());
    window.addEventListener("omnecor:scripts_updated", handler);
    return () => window.removeEventListener("omnecor:scripts_updated", handler);
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

  const handleSelectConversation = useCallback((id: string) => {
    // Save current before switching
    if (conversation.messages.length > 0) {
      saveConversationToStorage(conversation);
    }
    const loaded = loadConversationFromStorage(id);
    if (loaded) setConversation(loaded);
  }, [conversation]);

  const handleDeleteConversation = useCallback(
    (id: string) => {
      deleteConversationFromStorage(id);
      setConversationIndex(getStoredConversationIndex());

      if (conversation.id === id) {
        const remaining = getStoredConversationIndex();
        if (remaining.length > 0) {
          const next = loadConversationFromStorage(remaining[0].id);
          if (next) { setConversation(next); return; }
        }
        setConversation(createConversation("New Conversation", "default"));
      }
    },
    [conversation]
  );

  const handleRenameConversation = useCallback(
    (id: string, title: string) => {
      renameConversationInStorage(id, title);
      setConversationIndex(getStoredConversationIndex());
      if (conversation.id === id) {
        setConversation(prev => ({ ...prev, title }));
      }
    },
    [conversation]
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
        id: `file_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
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
        id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
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

  // ── Streaming core ───────────────────────────────────────────────────────
  const streamResponse = useCallback(
    (userMsg: ChatMessage, priorMessages: ChatMessage[]) => {
      if (!selectedModel) return;

      const assistantId = crypto.randomUUID();
      let assistantContent = "";

      setConversation(prev => ({
        ...prev,
        messages: [...prev.messages, {
          id: assistantId,
          role: "assistant" as const,
          content: "",
          timestamp: new Date(),
          tokens: 0,
        }],
        updatedAt: new Date(),
      }));

      const apiMessages: Array<{ role: "user" | "assistant" | "system"; content: string }> = [];
      const btwContext = btwNotes.map(n => `[Background context: ${n}]`).join("\n");
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
      const fullSystem = [peerCardContext, systemPrompt.trim(), btwContext, honchoContext, neuralContext, personaContext, fictionGuardrail].filter(Boolean).join("\n\n");
      if (fullSystem) {
        apiMessages.push({ role: "system", content: fullSystem });
      }
      priorMessages.forEach(m => {
        if ((m.role === "user" || m.role === "assistant") && !excludedMessageIds.has(m.id)) {
          apiMessages.push({ role: m.role, content: m.content });
        }
      });
      apiMessages.push({ role: "user", content: userMsg.content });

      const sub = vanillaTrpc.aiProvider.chatStream.subscribe(
        {
          providerId: selectedModel.providerId,
          modelId: selectedModel.modelId,
          apiKey: selectedModel.apiKey,
          baseUrl: selectedModel.baseUrl,
          messages: apiMessages,
        },
        {
          onData(chunk) {
            assistantContent += chunk.delta;
            setConversation(prev => ({
              ...prev,
              messages: prev.messages.map(m =>
                m.id === assistantId
                  ? {
                      ...m,
                      content: assistantContent,
                      tokens:
                        chunk.totalTokens ??
                        Math.ceil(assistantContent.length / 4),
                    }
                  : m
              ),
            }));
            if (chunk.done) {
              setIsStreaming(false);
              streamRef.current = null;
              // Sync both sides of the exchange to Honcho (background, non-blocking)
              const sid = conversation.id;
              addHonchoMessage.mutate({ openId, sessionId: sid, role: "user", content: userMsg.content });
              addHonchoMessage.mutate({ openId, sessionId: sid, role: "ai", content: assistantContent });
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
            }
          },
          onError(err) {
            toast.error(`Stream error: ${err.message}`);
            setConversation(prev => ({
              ...prev,
              messages: prev.messages.map(m =>
                m.id === assistantId
                  ? {
                      ...m,
                      content: `Error: ${err.message}`,
                      metadata: { error: err.message },
                    }
                  : m
              ),
            }));
            setIsStreaming(false);
            streamRef.current = null;
          },
        }
      );

      streamRef.current = sub;
    },
    [selectedModel, systemPrompt, btwNotes, honchoFacts, openId, addHonchoMessage, conversation.id, excludedMessageIds, isFictionMode, neuralContextFiles, peerCardContext, fictionPersonaId, fictionPersonas]
  );

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
    [conversation.messages, isStreaming, selectedModel, streamResponse]
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
    async (cmd: SlashCommand) => {
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
          toast.info(
            "Plan mode active — Valet will guide project setup. Start by describing your goal.",
            { duration: 5000 }
          );
          break;

        case "help":
          toast.info(
            "Slash commands: /new · /clear · /compress · /btw <note> · /plan · /skill · /system · /export · /help",
            { duration: 8000 }
          );
          break;

        default:
          break;
      }
    },
    [handleClearHistory, handleNewConversation, conversation, setConversation, selectedModel]
  );

  // ── Context panel collapse ──────────────────────────────────────────────
  const contextCollapsed = useAppStore((s) => s.chatContextCollapsed);
  const setContextCollapsed = useAppStore((s) => s.setChatContextCollapsed);

  // ── Live Preview Panel ──────────────────────────────────────────────────
  const [previewMode, setPreviewMode] = useState<"3d" | "pcb" | "web" | "none">("none");
  const [previewCode, setPreviewCode] = useState<string>("");
  const [showMemoryArchiver, setShowMemoryArchiver] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);
  const [showCliTerminal, setShowCliTerminal] = useState(false);

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
    return () => window.removeEventListener("omnecor:terminal_output", handler);
  }, []);

  const handleOpenPreview = useCallback((mode: "3d" | "pcb" | "web", code: string) => {
    setPreviewMode(mode);
    setPreviewCode(code);
    setContextCollapsed(true); // Auto collapse context to make room
  }, []);

  const transparency = useMemo(
    () => calculateContextTransparency(conversation),
    [conversation]
  );

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
                    key={i}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-accent/40 border border-border text-xs max-w-xs"
                  >
                    <span className="font-semibold text-accent-foreground opacity-70">btw</span>
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
          <ChatIntegrationBar
            onInjectContext={(snippet) =>
              handleSendMessage(`[Integration context injected]\n\n${snippet}`)
            }
          />
          <ChatInterface
            className="flex-1 min-w-0"
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
              projectId="default" 
              selectedModel={selectedModel}
            />
          )}

          {/* Live Preview Panel */}
          {previewMode !== "none" && (
            <div className="fixed inset-y-0 right-0 w-[85vw] max-w-sm sm:static sm:w-96 sm:max-w-none lg:w-[400px] xl:w-[500px] flex flex-col gap-2 overflow-hidden flex-shrink-0 border border-border rounded-xl bg-card shadow-xl animate-in slide-in-from-right-4 duration-300 z-30 sm:z-10">
              <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30">
                <div className="flex items-center gap-2">
                  {previewMode === "3d" && <Box className="w-4 h-4 text-accent" />}
                  {previewMode === "pcb" && <Cpu className="w-4 h-4 text-accent" />}
                  {previewMode === "web" && <Globe className="w-4 h-4 text-accent" />}
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Live Preview
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 hover:bg-accent/20 hover:text-accent"
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
                    className="w-6 h-6 hover:bg-accent/20 hover:text-accent"
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
              <div className="min-h-0 flex-1 overflow-hidden relative bg-slate-950">
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
        projectId={conversation.id}
      />
    )}
    {!isFictionMode && (
      <EmbeddedTerminal
        isOpen={showCliTerminal}
        onClose={() => setShowCliTerminal(false)}
        projectId={conversation.id}
      />
    )}
    {/* HITL command approval dialog — rendered at root so it floats above everything */}
    <HITLCommandApproval />
    </OmnecorDashboardLayout>

  );
}
