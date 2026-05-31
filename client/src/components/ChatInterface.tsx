import { useState, useRef, useEffect, useCallback } from "react";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Trash2,
  Copy,
  Check,
  RotateCcw,
  Pencil,
  X,
  ThumbsUp,
  ThumbsDown,
  Download,
  Settings2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Streamdown } from "streamdown";
import { toast } from "sonner";
import type { ChatMessage, ContextFile, SelectedModel } from "@/lib/chatContext";
import ChatInput, { type SlashCommand } from "@/components/chat/ChatInput";
import ModelSelector from "@/components/chat/ModelSelector";

// ---------------------------------------------------------------------------
// Code-block copy button injection (runs after Streamdown renders to DOM)
// ---------------------------------------------------------------------------
function useCodeBlockCopy(
  ref: React.RefObject<HTMLDivElement | null>,
  content: string
) {
  useEffect(() => {
    const container = ref.current;
    if (!container) return;

    container
      .querySelectorAll<HTMLElement>("pre:not([data-cb])")
      .forEach(pre => {
        pre.setAttribute("data-cb", "true");
        pre.style.position = "relative";

        const btn = document.createElement("button");
        btn.textContent = "Copy";
        btn.style.cssText = [
          "position:absolute",
          "top:6px",
          "right:6px",
          "padding:2px 8px",
          "font-size:11px",
          "line-height:1.5",
          "background:hsl(var(--muted))",
          "color:hsl(var(--muted-foreground))",
          "border:1px solid hsl(var(--border))",
          "border-radius:4px",
          "cursor:pointer",
          "opacity:0",
          "transition:opacity 0.15s",
          "z-index:10",
        ].join(";");

        pre.addEventListener("mouseenter", () => {
          btn.style.opacity = "1";
        });
        pre.addEventListener("mouseleave", () => {
          btn.style.opacity = "0";
        });
        btn.addEventListener("click", e => {
          e.stopPropagation();
          const code =
            pre.querySelector("code")?.textContent ?? pre.textContent ?? "";
          navigator.clipboard.writeText(code);
          btn.textContent = "Copied!";
          setTimeout(() => {
            btn.textContent = "Copy";
          }, 2000);
        });

        pre.appendChild(btn);
      });
  }, [content, ref]);
}

// ---------------------------------------------------------------------------
// Individual assistant message bubble with code-block enhancement
// ---------------------------------------------------------------------------
interface AssistantBubbleProps {
  message: ChatMessage;
  onCopy: () => void;
  onRetry: () => void;
  onDelete: () => void;
  copied: boolean;
  isLast: boolean;
}

function AssistantBubble({
  message,
  onCopy,
  onRetry,
  onDelete,
  copied,
  isLast,
}: AssistantBubbleProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  useCodeBlockCopy(contentRef, message.content);

  return (
    <div className="flex gap-3 justify-start animate-in fade-in slide-in-from-bottom-2 group">
      {/* Avatar */}
      <div className="w-6 h-6 rounded-full bg-accent flex items-center justify-center flex-shrink-0 mt-1 text-[10px] font-bold text-accent-foreground">
        AI
      </div>

      <div className="flex flex-col gap-1 max-w-2xl xl:max-w-3xl min-w-0">
        <div className="rounded-lg px-4 py-3 bg-card border border-border text-card-foreground text-sm">
          <div ref={contentRef} className="prose-sm prose dark:prose-invert max-w-none break-words">
            <Streamdown>{message.content}</Streamdown>
          </div>

          {message.metadata?.error && (
            <div className="mt-2 p-2 rounded bg-destructive/10 border border-destructive/30">
              <p className="text-xs text-destructive">{message.metadata.error}</p>
            </div>
          )}
        </div>

        {/* Footer: timestamp + tokens + actions */}
        <div className="flex items-center gap-2 px-1">
          <span className="text-[10px] text-muted-foreground/60">
            {message.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
          {message.tokens !== undefined && (
            <span className="text-[10px] text-muted-foreground/60">
              {message.tokens.toLocaleString()} tokens
            </span>
          )}

          {/* Hover actions */}
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity ml-auto">
            <Button
              size="icon"
              variant="ghost"
              className="h-5 w-5"
              onClick={onCopy}
              title="Copy message"
            >
              {copied ? (
                <Check className="w-3 h-3 text-green-500" />
              ) : (
                <Copy className="w-3 h-3" />
              )}
            </Button>
            {isLast && (
              <Button
                size="icon"
                variant="ghost"
                className="h-5 w-5"
                onClick={onRetry}
                title="Regenerate response"
              >
                <RotateCcw className="w-3 h-3" />
              </Button>
            )}
            <Button
              size="icon"
              variant="ghost"
              className="h-5 w-5 hover:text-green-500"
              title="Good response"
            >
              <ThumbsUp className="w-3 h-3" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-5 w-5 hover:text-destructive"
              title="Bad response"
            >
              <ThumbsDown className="w-3 h-3" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-5 w-5 hover:text-destructive"
              onClick={onDelete}
              title="Delete message"
            >
              <Trash2 className="w-3 h-3" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Individual user message bubble with inline editing
// ---------------------------------------------------------------------------
interface UserBubbleProps {
  message: ChatMessage;
  onCopy: () => void;
  onEdit: (newContent: string) => void;
  onDelete: () => void;
  copied: boolean;
}

function UserBubble({ message, onCopy, onEdit, onDelete, copied }: UserBubbleProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);

  const confirmEdit = () => {
    if (draft.trim() && draft.trim() !== message.content) {
      onEdit(draft.trim());
    }
    setEditing(false);
  };

  const cancelEdit = () => {
    setDraft(message.content);
    setEditing(false);
  };

  return (
    <div className="flex gap-3 justify-end animate-in fade-in slide-in-from-bottom-2 group">
      <div className="flex flex-col gap-1 items-end max-w-xl min-w-0">
        <div className="rounded-lg px-4 py-3 bg-accent text-accent-foreground text-sm w-full">
          {editing ? (
            <div className="flex flex-col gap-2">
              <Textarea
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    confirmEdit();
                  }
                  if (e.key === "Escape") cancelEdit();
                }}
                className="text-sm resize-none bg-accent-foreground/10 border-accent-foreground/20 text-accent-foreground placeholder:text-accent-foreground/50 min-h-[60px]"
                autoFocus
              />
              <div className="flex justify-end gap-1.5">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-xs px-2"
                  onClick={cancelEdit}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="h-6 text-xs px-2"
                  onClick={confirmEdit}
                  disabled={!draft.trim()}
                >
                  <Check className="w-3 h-3 mr-1" />
                  Send edit
                </Button>
              </div>
            </div>
          ) : (
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-1">
          <span className="text-[10px] text-muted-foreground/60">
            {message.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
          {message.tokens !== undefined && (
            <span className="text-[10px] text-muted-foreground/60">
              {message.tokens.toLocaleString()} tokens
            </span>
          )}

          {/* Hover actions */}
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity ml-auto">
            <Button
              size="icon"
              variant="ghost"
              className="h-5 w-5"
              onClick={onCopy}
              title="Copy message"
            >
              {copied ? (
                <Check className="w-3 h-3 text-green-500" />
              ) : (
                <Copy className="w-3 h-3" />
              )}
            </Button>
            {!editing && (
              <Button
                size="icon"
                variant="ghost"
                className="h-5 w-5"
                onClick={() => setEditing(true)}
                title="Edit message"
              >
                <Pencil className="w-3 h-3" />
              </Button>
            )}
            <Button
              size="icon"
              variant="ghost"
              className="h-5 w-5 hover:text-destructive"
              onClick={onDelete}
              title="Delete message"
            >
              <Trash2 className="w-3 h-3" />
            </Button>
          </div>
        </div>
      </div>

      {/* Avatar */}
      <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center flex-shrink-0 mt-1 text-[10px] font-bold text-muted-foreground">
        U
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
export interface ChatInterfaceProps {
  messages: ChatMessage[];
  isLoading?: boolean;
  conversationTitle?: string;
  selectedModel?: SelectedModel;
  contextFiles?: ContextFile[];
  systemPrompt?: string;
  showSystemPrompt?: boolean;

  onSendMessage?: (content: string) => void;
  onClearHistory?: () => void;
  onRetry?: () => void;
  onDeleteMessage?: (id: string) => void;
  onEditMessage?: (id: string, newContent: string) => void;
  onModelChange?: (model: SelectedModel) => void;
  onTitleChange?: (title: string) => void;
  onAddFile?: (file: File) => void;
  onAddImage?: (file: File) => void;
  onSystemPromptChange?: (prompt: string) => void;
  onToggleSystemPrompt?: () => void;
  onExport?: () => void;
  onStop?: () => void;
  onCommand?: (cmd: SlashCommand) => void;

  className?: string;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function ChatInterface({
  messages,
  isLoading = false,
  conversationTitle = "Conversation",
  selectedModel,
  contextFiles = [],
  systemPrompt = "",
  showSystemPrompt = false,
  onSendMessage,
  onClearHistory,
  onRetry,
  onDeleteMessage,
  onEditMessage,
  onModelChange,
  onTitleChange,
  onAddFile,
  onAddImage,
  onSystemPromptChange,
  onToggleSystemPrompt,
  onExport,
  onStop,
  onCommand,
  className,
}: ChatInterfaceProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(conversationTitle);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Sync title draft when prop changes (switching conversations)
  useEffect(() => {
    setTitleDraft(conversationTitle);
  }, [conversationTitle]);

  // Auto-scroll to bottom
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleCopy = useCallback((content: string, id: string) => {
    navigator.clipboard.writeText(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  const confirmTitleEdit = () => {
    if (titleDraft.trim()) onTitleChange?.(titleDraft.trim());
    setEditingTitle(false);
  };

  const totalTokens = messages.reduce((s, m) => s + (m.tokens ?? 0), 0);
  const lastAssistantIdx = messages.map(m => m.role).lastIndexOf("assistant");

  const handleCommand = useCallback(
    (cmd: SlashCommand) => {
      if (cmd === "help") {
        toast.info(
          "Shortcuts: Enter → send · Shift+Enter → new line · /clear → clear · /new → new chat · /system → system prompt · /export → download"
        );
        return;
      }
      onCommand?.(cmd);
    },
    [onCommand]
  );

  return (
    <Card className={cn("flex flex-col h-full overflow-hidden", className)}>
      {/* ── Header ─────────────────────────────────────────────────── */}
      <CardHeader className="border-b border-border px-4 py-2.5 flex-shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Editable title */}
          {editingTitle ? (
            <input
              value={titleDraft}
              onChange={e => setTitleDraft(e.target.value)}
              onBlur={confirmTitleEdit}
              onKeyDown={e => {
                if (e.key === "Enter") confirmTitleEdit();
                if (e.key === "Escape") {
                  setTitleDraft(conversationTitle);
                  setEditingTitle(false);
                }
              }}
              className="text-sm font-semibold bg-transparent border-b border-border outline-none flex-1 min-w-[80px] max-w-[200px]"
              autoFocus
            />
          ) : (
            <button
              className="text-sm font-semibold hover:text-accent transition-colors truncate max-w-[200px]"
              onClick={() => setEditingTitle(true)}
              title="Click to rename"
            >
              {conversationTitle}
            </button>
          )}

          {/* Model selector */}
          <ModelSelector
            selectedModel={selectedModel}
            onSelect={model => onModelChange?.(model)}
          />

          {/* Spacer */}
          <div className="flex-1" />

          {/* Token count */}
          <Badge variant="outline" className="text-[10px] hidden sm:flex">
            {messages.length} msgs · {totalTokens.toLocaleString()} tokens
          </Badge>

          {/* System prompt toggle */}
          <Button
            size="icon"
            variant={showSystemPrompt ? "secondary" : "ghost"}
            className="h-7 w-7"
            onClick={onToggleSystemPrompt}
            title="System prompt"
          >
            <Settings2 className="w-3.5 h-3.5" />
          </Button>

          {/* Export */}
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={onExport}
            title="Export conversation"
            disabled={messages.length === 0}
          >
            <Download className="w-3.5 h-3.5" />
          </Button>

          {/* Clear */}
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 hover:text-destructive"
            onClick={onClearHistory}
            disabled={messages.length === 0}
            title="Clear history"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </CardHeader>

      {/* ── System prompt editor (collapsible) ─────────────────────── */}
      {showSystemPrompt && (
        <div className="border-b border-border bg-muted/30 px-4 py-2.5 flex-shrink-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              System Prompt
            </span>
            <span className="text-[10px] text-muted-foreground/60">
              Sets AI behavior for this conversation
            </span>
            <div className="flex-1" />
            <Button
              size="sm"
              variant="ghost"
              className="h-5 text-xs px-2"
              onClick={() => onSystemPromptChange?.("")}
            >
              Clear
            </Button>
          </div>
          <Textarea
            value={systemPrompt}
            onChange={e => onSystemPromptChange?.(e.target.value)}
            placeholder="You are a helpful assistant specialized in software development..."
            className="text-xs resize-none min-h-[64px] max-h-[160px] bg-background"
            rows={3}
          />
        </div>
      )}

      {/* ── Messages area ────────────────────────────────────────────── */}
      <ScrollArea className="flex-1 px-4">
        <div className="space-y-4 py-4">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-3 text-center text-muted-foreground">
              <div className="w-12 h-12 rounded-full bg-accent/20 flex items-center justify-center text-2xl">
                💬
              </div>
              <div>
                <p className="text-sm font-medium">Start a conversation</p>
                <p className="text-xs mt-0.5">
                  Type a message, use{" "}
                  <code className="bg-muted px-1 rounded">/</code> for commands,{" "}
                  <code className="bg-muted px-1 rounded">@</code> to reference files
                </p>
              </div>
            </div>
          ) : (
            messages.map((msg, idx) =>
              msg.role === "assistant" ? (
                <AssistantBubble
                  key={msg.id}
                  message={msg}
                  copied={copiedId === msg.id}
                  isLast={idx === lastAssistantIdx}
                  onCopy={() => handleCopy(msg.content, msg.id)}
                  onRetry={() => onRetry?.()}
                  onDelete={() => onDeleteMessage?.(msg.id)}
                />
              ) : msg.role === "user" ? (
                <UserBubble
                  key={msg.id}
                  message={msg}
                  copied={copiedId === msg.id}
                  onCopy={() => handleCopy(msg.content, msg.id)}
                  onEdit={newContent => onEditMessage?.(msg.id, newContent)}
                  onDelete={() => onDeleteMessage?.(msg.id)}
                />
              ) : null
            )
          )}
          <div ref={scrollRef} />
        </div>
      </ScrollArea>

      {/* ── Input area ──────────────────────────────────────────────── */}
      <div className="border-t border-border px-4 py-3 flex-shrink-0">
        <ChatInput
          onSend={content => onSendMessage?.(content)}
          onAddFile={file => onAddFile?.(file)}
          onAddImage={file => onAddImage?.(file)}
          onStop={() => onStop?.()}
          onCommand={handleCommand}
          contextFiles={contextFiles}
          isLoading={isLoading}
        />
      </div>
    </Card>
  );
}
