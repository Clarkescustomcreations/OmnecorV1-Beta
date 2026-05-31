import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import OmnecorDashboardLayout from "@/components/OmnecorDashboardLayout";
import ChatInterface from "@/components/ChatInterface";
import ContextTransparencyIndicator from "@/components/ContextTransparencyIndicator";
import VisualContextMap from "@/components/VisualContextMap";
import ConversationList from "@/components/chat/ConversationList";
import { vanillaTrpc } from "@/lib/trpc";
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
import type { SlashCommand } from "@/components/chat/ChatInput";
import { toast } from "sonner";

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

  // ── System prompt ────────────────────────────────────────────────────────
  const [systemPrompt, setSystemPrompt] = useState(
    () => localStorage.getItem("omnecor:systemPrompt") ?? ""
  );
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);

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

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

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
      if (systemPrompt.trim()) {
        apiMessages.push({ role: "system", content: systemPrompt });
      }
      priorMessages.forEach(m => {
        if (m.role === "user" || m.role === "assistant") {
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
    [selectedModel, systemPrompt]
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
    (cmd: SlashCommand) => {
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
        default:
          break;
      }
    },
    [handleClearHistory, handleNewConversation, conversation]
  );

  // ── Context panel ────────────────────────────────────────────────────────
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
          onToggleCollapse={() => setSidebarCollapsed(v => !v)}
        />

        {/* Main chat area */}
        <div className="flex-1 flex gap-4 p-4 overflow-hidden min-w-0">
          <ChatInterface
            className="flex-1 min-w-0"
            messages={conversation.messages}
            isLoading={isStreaming}
            conversationTitle={conversation.title}
            selectedModel={selectedModel}
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
          />

          {/* Context panel */}
          <div className="w-72 flex flex-col gap-3 overflow-hidden flex-shrink-0 hidden xl:flex">
            <ContextTransparencyIndicator
              transparency={transparency}
              className="flex-shrink-0"
            />
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
        </div>
      </div>
    </OmnecorDashboardLayout>
  );
}
