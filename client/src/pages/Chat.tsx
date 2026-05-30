import OmnecorDashboardLayout from "@/components/OmnecorDashboardLayout";
import ChatInterface from "@/components/ChatInterface";
import ContextTransparencyIndicator from "@/components/ContextTransparencyIndicator";
import VisualContextMap from "@/components/VisualContextMap";
import { MessageCircle } from "lucide-react";
import { useState, useCallback, useMemo } from "react";
import { vanillaTrpc } from "@/lib/trpc";
import {
  ChatMessage,
  ContextTransparency,
  calculateContextTransparency,
  createConversation,
  addMessageToConversation,
} from "@/lib/chatContext";

interface SelectedModel {
  providerId: "ollama" | "anthropic" | "openai" | "gemini" | "grok";
  modelId: string;
  apiKey?: string;
  baseUrl?: string;
}

export default function Chat() {
  const [conversation, setConversation] = useState(() =>
    createConversation("New Conversation", "default")
  );
  const [isStreaming, setIsStreaming] = useState(false);

  const [selectedModel] = useState<SelectedModel | undefined>(() => {
    try {
      const s = localStorage.getItem("omnecor:selectedModel");
      return s ? JSON.parse(s) : undefined;
    } catch {
      return undefined;
    }
  });

  const transparency = useMemo(
    () => calculateContextTransparency(conversation),
    [conversation]
  );

  const handleSendMessage = useCallback(
    async (content: string) => {
      if (!content.trim() || isStreaming) return;

      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content,
        timestamp: new Date(),
        tokens: Math.ceil(content.length / 4),
      };

      setConversation(prev => addMessageToConversation(prev, userMsg));

      // Demo mode fallback (no model configured)
      if (!selectedModel) {
        setIsStreaming(true);
        setTimeout(() => {
          const assistantMsg: ChatMessage = {
            id: crypto.randomUUID(),
            role: "assistant",
            content:
              "Demo mode — select a model in Model Hub to enable real responses.",
            timestamp: new Date(),
            tokens: 18,
          };
          setConversation(prev => addMessageToConversation(prev, assistantMsg));
          setIsStreaming(false);
        }, 600);
        return;
      }

      setIsStreaming(true);
      const assistantId = crypto.randomUUID();
      let assistantContent = "";

      const initialAssistantMsg: ChatMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
        timestamp: new Date(),
        tokens: 0,
      };
      setConversation(prev =>
        addMessageToConversation(prev, initialAssistantMsg)
      );

      const sub = vanillaTrpc.aiProvider.chatStream.subscribe(
        {
          providerId: selectedModel.providerId,
          modelId: selectedModel.modelId,
          apiKey: selectedModel.apiKey,
          baseUrl: selectedModel.baseUrl,
          messages: conversation.messages
            .concat(userMsg)
            .map(m => ({ role: m.role as any, content: m.content })),
        },
        {
          onData(chunk: any) {
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
            }
          },
          onError(err: any) {
            console.error("[chat stream error]", err);
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
          },
        }
      );
    },
    [conversation, isStreaming, selectedModel]
  );

  const handleClearHistory = useCallback(() => {
    if (confirm("Are you sure you want to clear the conversation history?")) {
      setConversation(createConversation("New Conversation", "default"));
    }
  }, []);

  return (
    <OmnecorDashboardLayout>
      <div className="h-full flex flex-col bg-background">
        {/* Header */}
        <div className="border-b border-border bg-card px-6 py-4">
          <div className="flex items-center gap-3">
            <MessageCircle className="w-6 h-6 text-accent" />
            <div>
              <h1 className="text-xl font-bold">Chat</h1>
              <p className="text-sm text-muted-foreground">
                Conversational AI with context transparency and file management
              </p>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex gap-6 p-6 overflow-hidden">
          {/* Chat Area */}
          <div className="flex-1 flex flex-col min-w-0">
            <ChatInterface
              messages={conversation.messages}
              isLoading={isStreaming}
              onSendMessage={handleSendMessage}
              onClearHistory={handleClearHistory}
              className="flex-1"
            />
          </div>

          {/* Context Panel */}
          <div className="w-80 flex flex-col gap-4 overflow-hidden">
            <ContextTransparencyIndicator
              transparency={transparency}
              className="flex-shrink-0"
            />

            <VisualContextMap
              files={conversation.contextFiles}
              onToggleFile={() => {}}
              onRemoveFile={() => {}}
              className="flex-1 min-h-0"
            />
          </div>
        </div>
      </div>
    </OmnecorDashboardLayout>
  );
}
