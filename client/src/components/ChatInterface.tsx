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
  Save,
  Terminal,
  Eye,
  Clock,
  Coins,
  Brain,
  Zap,
  Activity,
  BookOpenText,
  ShieldAlert,
  ShieldCheck,
  UserCircle2,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { Streamdown } from "streamdown";
import { toast } from "sonner";
import type { ChatMessage, ContextFile, SelectedModel } from "@/lib/chatContext";
import { ChatInput, type SlashCommand } from "@/components/chat/ChatInput";
import { AssistantStream } from "@/components/chat/agentic/AssistantStream";
import { useCodeBlockActions } from "@/components/chat/agentic/useCodeBlockActions";
import { ModelSelector } from "@/components/chat/ModelSelector";
import { trpc } from "@/lib/trpc";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { HowToTooltip } from "@/components/shell/HowToTooltip";
import { useNeuralMap } from "@/contexts/NeuralMapContext";
import { LoadingQuote } from "@/components/chat/LoadingQuote";
import { useAppStore } from "@/lib/store/app.store";

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
  showTimestamps?: boolean;
  showTokenCounts?: boolean;
  onOpenPreview?: (mode: "3d" | "pcb" | "web", code: string) => void;
  isTyping?: boolean;
  quoteStyle?: "random" | "funny" | "serious";
  excluded?: boolean;
  onToggleExclusion?: () => void;
}

function AssistantBubble({
  message,
  copied,
  isLast,
  onCopy,
  onRetry,
  onDelete,
  showTimestamps = false,
  showTokenCounts = false,
  onOpenPreview,
  isTyping = false,
  excluded = false,
  onToggleExclusion,
}: AssistantBubbleProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [scriptName, setScriptName] = useState("");
  const [scriptProject, setScriptProject] = useState("");
  const [extractedCode, setExtractedCode] = useState("");
  const { activeMap } = useNeuralMap();

  const scriptsUtils = trpc.useUtils();
  const saveScriptMutation = trpc.scripts.create.useMutation({
    onSuccess: (row) => {
      scriptsUtils.scripts.list.invalidate();
      setShowSaveDialog(false);
      toast.success(`Script "${row.name}" saved to ${row.project}`);
    },
    onError: (err) => {
      toast.error(err.message || "Failed to save script");
    },
  });

  useCodeBlockCopy(contentRef, message.content);
  useCodeBlockActions(contentRef, message.content);

  const handleSaveScriptClick = useCallback(() => {
    // Extract first python code block
    const pythonMatch = message.content.match(/```(?:python|py)\n([\s\S]*?)```/);
    if (pythonMatch) {
      setExtractedCode(pythonMatch[1]);
      setScriptName(`script_${Date.now().toString(36)}`);
      setShowSaveDialog(true);
    } else {
      toast.error("No Python code block found in this message");
    }
  }, [message.content]);

  const confirmSave = () => {
    if (!scriptName.trim()) {
      toast.error("Please provide a name for the script");
      return;
    }
    saveScriptMutation.mutate({
      name: scriptName.trim(),
      project: scriptProject.trim() || "Default",
      code: extractedCode,
      language: "python",
      description: `Saved from chat: ${message.content.slice(0, 100)}...`,
      mapId: activeMap?.id,
    });
  };

  const hasPython = message.content.includes("```python") || message.content.includes("```py");
  const hasHtml = message.content.includes("```html");
  const hasReactThree = message.content.includes("```tsx") && message.content.includes("@react-three");
  const hasReactFlow = message.content.includes("```tsx") && message.content.includes("reactflow");
  const hasPreviewable = hasHtml || hasReactThree || hasReactFlow;

  const handleLivePreviewClick = useCallback(() => {
    if (!onOpenPreview) return;
    
    let mode: "3d" | "pcb" | "web" = "web";
    let code = "";
    
    if (hasReactThree) {
      mode = "3d";
      const match = message.content.match(/```(?:tsx|jsx)\n([\s\S]*?)```/);
      if (match) code = match[1];
    } else if (hasReactFlow) {
      mode = "pcb";
      const match = message.content.match(/```(?:tsx|jsx)\n([\s\S]*?)```/);
      if (match) code = match[1];
    } else if (hasHtml) {
      mode = "web";
      const match = message.content.match(/```html\n([\s\S]*?)```/);
      if (match) code = match[1];
    }
    
    onOpenPreview(mode, code);
  }, [hasHtml, hasReactThree, hasReactFlow, message.content, onOpenPreview]);

  return (
    <div className="flex gap-3 justify-start animate-in fade-in slide-in-from-bottom-2 group">
      {/* Avatar */}
      <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-1 text-[10px] font-bold text-primary">
        AI
      </div>

      <div className="flex flex-col gap-1 max-w-2xl xl:max-w-3xl min-w-0">
        <div className="rounded-lg px-4 py-3 bg-card border border-border text-card-foreground text-sm shadow-sm">
          <div ref={contentRef} className="prose-sm prose dark:prose-invert max-w-none break-words">
            <Streamdown>{message.content}</Streamdown>
          </div>
          
          {isTyping && (
            <div className="mt-4">
              <LoadingQuote />
            </div>
          )}

          {message.metadata?.error && (
            <div className="mt-2 p-2 rounded bg-destructive/10 border border-destructive/30">
              <p className="text-xs text-destructive">{message.metadata.error}</p>
            </div>
          )}
        </div>

        {/* Footer: timestamp + tokens + actions */}
        <div className="flex items-center gap-2 px-1">
          {showTimestamps && (
            <span className="text-[10px] text-muted-foreground/60">
              {message.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          {showTokenCounts && message.tokens !== undefined && (
            <span className="text-[10px] text-muted-foreground/60">
              {message.tokens.toLocaleString()} tokens
            </span>
          )}

          {/* Action: Live Preview */}
          {hasPreviewable && (
            <HowToTooltip title="Live Preview" description="Open a live preview of the code snippet in a sandboxed environment." side="top">
              <Button
                size="sm"
                variant="outline"
                className="h-5 text-[10px] px-1.5 gap-1 border-accent-purple/30 text-accent-purple bg-accent-purple/5 hover:bg-accent-purple/10"
                onClick={handleLivePreviewClick}
              >
                <Eye className="w-2.5 h-2.5" />
                Live Preview
              </Button>
            </HowToTooltip>
          )}

          {/* Action: Save Script (always visible if python present) */}
          {hasPython && (
            <HowToTooltip title="Save Script" description="Extract Python code from the message and save it to your library." side="top">
              <Button
                size="sm"
                variant="outline"
                className="h-5 text-[10px] px-1.5 gap-1 border-accent-cyan/30 text-accent-cyan bg-accent-cyan/5 hover:bg-accent-cyan/10"
                onClick={handleSaveScriptClick}
              >
                <Save className="w-2.5 h-2.5" />
                Save Script
              </Button>
            </HowToTooltip>
          )}

          {/* Hover actions */}
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity ml-auto">
            <HowToTooltip title="Copy Message" description="Copy the entire message content to your clipboard." side="top">
              <Button
                size="icon"
                variant="ghost"
                className="h-5 w-5"
                onClick={onCopy}
              >
                {copied ? (
                  <Check className="w-3 h-3 text-accent-success" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
              </Button>
            </HowToTooltip>
            {isLast && (
              <HowToTooltip title="Regenerate" description="Request a new response from the AI." side="top">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-5 w-5"
                  onClick={onRetry}
                >
                  <RotateCcw className="w-3 h-3" />
                </Button>
              </HowToTooltip>
            )}
            <HowToTooltip title="Delete Message" description="Remove this message from the conversation history." side="top">
              <Button
                size="icon"
                variant="ghost"
                className="h-5 w-5 hover:text-destructive"
                onClick={onDelete}
              >
                <Trash2 className="w-3 h-3" />
              </Button>
            </HowToTooltip>
            {onToggleExclusion && (
              <button
                onClick={onToggleExclusion}
                className="text-[10px] text-muted-foreground hover:text-foreground rounded px-1 py-0.5 border border-border/50 ml-1"
                title={excluded ? "Include in context" : "Exclude from context"}
              >
                {excluded ? "⊕ include" : "⊖ exclude"}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Save Script Dialog */}
      <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Terminal className="w-5 h-5 text-accent-cyan" />
              Save Python Script
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Script Name</label>
              <Input
                value={scriptName}
                onChange={e => setScriptName(e.target.value)}
                placeholder="e.g. data-sorter-v1"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Project / Folder</label>
              <Input
                value={scriptProject}
                onChange={e => setScriptProject(e.target.value)}
                placeholder="e.g. Finance App"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowSaveDialog(false)}>Cancel</Button>
            <Button size="sm" onClick={confirmSave} disabled={saveScriptMutation.isPending}>
              {saveScriptMutation.isPending ? "Saving…" : "Save to Library"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
  showTimestamps?: boolean;
  showTokenCounts?: boolean;
  excluded?: boolean;
  onToggleExclusion?: () => void;
}

function UserBubble({
  message,
  onCopy,
  onEdit,
  onDelete,
  copied,
  showTimestamps = true,
  showTokenCounts = true,
  excluded = false,
  onToggleExclusion,
}: UserBubbleProps) {
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
        <div className="rounded-lg px-4 py-3 bg-primary/10 text-foreground text-sm w-full shadow-sm">
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
                className="text-sm resize-none bg-background/40 border-border text-foreground placeholder:text-muted-foreground min-h-[60px]"
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
          {showTimestamps && (
            <span className="text-[10px] text-muted-foreground/60">
              {message.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          {showTokenCounts && message.tokens !== undefined && (
            <span className="text-[10px] text-muted-foreground/60">
              {message.tokens.toLocaleString()} tokens
            </span>
          )}

          {/* Hover actions */}
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity ml-auto">
            <HowToTooltip title="Copy Message" description="Copy your message text to the clipboard." side="top">
              <Button
                size="icon"
                variant="ghost"
                className="h-5 w-5"
                onClick={onCopy}
              >
                {copied ? (
                  <Check className="w-3 h-3 text-accent-success" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
              </Button>
            </HowToTooltip>
            {!editing && (
              <HowToTooltip title="Edit Message" description="Modify your message and re-send it." side="top">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-5 w-5"
                  onClick={() => setEditing(true)}
                >
                  <Pencil className="w-3 h-3" />
                </Button>
              </HowToTooltip>
            )}
            <HowToTooltip title="Delete Message" description="Remove your message from the conversation history." side="top">
              <Button
                size="icon"
                variant="ghost"
                className="h-5 w-5 hover:text-destructive"
                onClick={onDelete}
              >
                <Trash2 className="w-3 h-3" />
              </Button>
            </HowToTooltip>
            {onToggleExclusion && (
              <button
                onClick={onToggleExclusion}
                className="text-[10px] text-muted-foreground hover:text-foreground rounded px-1 py-0.5 border border-border/50 ml-1"
                title={excluded ? "Include in context" : "Exclude from context"}
              >
                {excluded ? "⊕ include" : "⊖ exclude"}
              </button>
            )}
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
  conversationId?: string;
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
  onCommand?: (cmd: SlashCommand, arg?: string) => void | Promise<void>;
  onBtw?: (note: string) => void;
  onToggleMemory?: () => void;
  onToggleTerminal?: () => void;
  onToggleCliTerminal?: () => void;

  isFictionMode?: boolean;
  fictionPersonas?: Array<{ id: string; name: string }>;
  fictionPersonaId?: string;
  onFictionPersonaChange?: (id: string) => void;

  tokenCount?: number;
  maxTokens?: number;

  excludedMessageIds?: Set<string>;
  onToggleExclusion?: (id: string) => void;
  onOpenPreview?: (mode: "3d" | "pcb" | "web", code: string) => void;

  valetRoutedModel?: string | null;

  /**
   * Assistant render mode. `"stream"` (main Omnecor chat) renders the agentic
   * flush-left block stream with tool boxes; `"bubble"` (default, wrapper chats)
   * keeps the classic single-markdown bubble.
   */
  layout?: "stream" | "bubble";
  /** Resolve a `pending_approval` agentic tool box (stream layout only). */
  onApproveTool?: (id: string) => void;
  onDenyTool?: (id: string, reason?: string) => void;
  /** Tap-through from a delegated `subagent` chip to its managed chat
   *  (Mesh-Delegation.md). */
  onOpenDelegation?: (conversationId: string) => void;

  className?: string;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function ChatInterface({
  messages,
  isLoading = false,
  conversationTitle = "Conversation",
  selectedModel,
  conversationId,
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
  onBtw,
  onToggleMemory,
  onToggleTerminal,
  onToggleCliTerminal,
  isFictionMode = false,
  fictionPersonas = [],
  fictionPersonaId = "",
  onFictionPersonaChange,
  tokenCount,
  maxTokens,
  excludedMessageIds,
  onToggleExclusion,
  onOpenPreview,
  valetRoutedModel,
  layout = "bubble",
  onApproveTool,
  onDenyTool,
  onOpenDelegation,
  className,
}: ChatInterfaceProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(conversationTitle);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { chatDisplaySettings: chatSettings, setChatDisplaySettings } = useAppStore();

  const toggleSetting = (key: keyof typeof chatSettings) => {
    setChatDisplaySettings({ [key]: !chatSettings[key] });
  };

  // Sync title draft when prop changes (switching conversations)
  useEffect(() => {
    setTitleDraft(conversationTitle);
  }, [conversationTitle]);

  // Auto-scroll to bottom — but only when the user is already near the bottom,
  // so they can scroll up to read while the AI is still typing without being
  // yanked back down on every streamed update.
  useEffect(() => {
    const sentinel = scrollRef.current;
    if (!sentinel) return;
    const viewport = sentinel.closest("[data-radix-scroll-area-viewport]") as HTMLElement | null;
    if (viewport) {
      const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      if (distanceFromBottom > 120) return; // scrolled up to read — don't follow
    }
    sentinel.scrollIntoView({ behavior: "smooth" });
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

  const handleCommand = useCallback(
    (cmd: SlashCommand, arg?: string) => {
      if (cmd === "help") {
        toast.info(
          "Commands: /clear · /new · /system · /export · /compress · /btw [note] · /skill · /plan\nWorkflows: /architect · /remember [save|restore] · /review · /recover · /imprint [file]\nShortcuts: Enter → send · Shift+Enter → new line",
          { duration: 8000 }
        );
        return;
      }
      onCommand?.(cmd, arg);
    },
    [onCommand]
  );

  return (
    <Card className={cn(
      "flex flex-col h-full overflow-hidden transition-all duration-300",
      isFictionMode && "border-accent-purple/60 shadow-[0_0_18px_-4px_color-mix(in_srgb,var(--color-accent-purple)_35%,transparent)]",
      className
    )}>
      {/* ── Fiction Mode Persistent Banner ─────────────────────────── */}
      {isFictionMode && (
        <div className="flex items-center gap-2 px-4 py-2 bg-accent-purple/5 border-b border-accent-purple/40 flex-shrink-0 flex-wrap">
          <BookOpenText className="w-3.5 h-3.5 text-accent-purple flex-shrink-0" />
          <span className="text-xs font-semibold text-accent-purple tracking-wide">FICTION MODE</span>
          <span className="text-[10px] text-accent-purple/70 hidden sm:inline">Creative writing &amp; roleplay only</span>
          {/* Persona selector */}
          <div className="flex items-center gap-1.5 ml-1">
            <UserCircle2 className="w-3 h-3 text-accent-purple/70 flex-shrink-0" />
            <select
              value={fictionPersonaId}
              onChange={e => onFictionPersonaChange?.(e.target.value)}
              className="text-[10px] bg-accent-purple/10 border border-accent-purple/30 rounded px-1.5 py-0.5 text-accent-purple focus:outline-none focus:ring-1 focus:ring-accent-purple/50 max-w-[130px]"
              title="Active fiction persona"
            >
              <option value="">No persona</option>
              {fictionPersonas.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-1 text-[10px] text-accent-purple/60">
            <ShieldAlert className="w-3 h-3" />
            <span className="hidden md:inline">Terminal · Agent Net · Wallet · Cloud blocked</span>
            <span className="md:hidden">Restricted</span>
          </div>
        </div>
      )}
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
              className="text-sm font-semibold hover:text-primary transition-colors truncate max-w-[200px]"
              onClick={() => setEditingTitle(true)}
              title="Click to rename"
            >
              {conversationTitle}
            </button>
          )}

          {/* Model selector */}
          {chatSettings.showModelName && (
            <div className="flex items-center gap-2">
              <ModelSelector
                selectedModel={selectedModel}
                onSelect={model => onModelChange?.(model)}
              />
              {selectedModel?.modelId === "auto-valet" && valetRoutedModel && (
                <Badge variant="outline" className="h-7 text-[10px] text-accent-purple border-accent-purple/30 bg-accent-purple/5 gap-1 font-mono">
                  <Zap className="w-3 h-3" />
                  {valetRoutedModel}
                </Badge>
              )}
            </div>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Auto-approve tools toggle (agentic stream only) */}
          {layout === "stream" && (
            <HowToTooltip
              title="Auto-approve tools"
              description="When on, the AI runs commands, applies edits, and starts jobs scoped to the active map WITHOUT asking each time. Off = every action needs your approval."
            >
              <Button
                size="sm"
                variant={chatSettings.autoApproveTools ? "default" : "outline"}
                className={cn(
                  "h-7 text-[11px] gap-1 px-2",
                  chatSettings.autoApproveTools
                    ? "bg-accent-warning/90 hover:bg-accent-warning text-black border-transparent"
                    : "text-muted-foreground",
                )}
                onClick={() => {
                  const next = !chatSettings.autoApproveTools;
                  setChatDisplaySettings({ autoApproveTools: next });
                  toast[next ? "warning" : "info"](
                    next
                      ? "Auto-approve ON — tools run without asking (active map only)"
                      : "Auto-approve OFF — every tool action needs approval",
                  );
                }}
              >
                {chatSettings.autoApproveTools ? (
                  <ShieldCheck className="w-3.5 h-3.5" />
                ) : (
                  <ShieldAlert className="w-3.5 h-3.5" />
                )}
                {chatSettings.autoApproveTools ? "Auto" : "Approve"}
              </Button>
            </HowToTooltip>
          )}

          {/* Display Settings Popover */}
          <Popover>
            <HowToTooltip title="Display Settings" description="Adjust chat visuals like timestamps, token counts, and model names. Controls how messages appear.">
              <PopoverTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                >
                  <Eye className="w-3.5 h-3.5" />
                </Button>
              </PopoverTrigger>
            </HowToTooltip>
            <PopoverContent className="w-64 p-4" align="end">
                <div className="space-y-4">
                  <div className="space-y-1">
                    <h4 className="text-sm font-semibold flex items-center gap-2">
                      <Eye className="w-4 h-4" /> Display Options
                    </h4>
                    <p className="text-[11px] text-muted-foreground">Adjust how messages are rendered</p>
                  </div>
                  
                  <div className="space-y-3 pt-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="s-timestamps" className="text-xs cursor-pointer flex items-center gap-2">
                        <Clock className="w-3 h-3" /> Show Timestamps
                      </Label>
                      <Switch 
                        id="s-timestamps" 
                        checked={chatSettings.showTimestamps} 
                        onCheckedChange={() => toggleSetting("showTimestamps")} 
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label htmlFor="s-tokens" className="text-xs cursor-pointer flex items-center gap-2">
                        <Coins className="w-3 h-3" /> Show Token Counts
                      </Label>
                      <Switch 
                        id="s-tokens" 
                        checked={chatSettings.showTokenCounts} 
                        onCheckedChange={() => toggleSetting("showTokenCounts")} 
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label htmlFor="s-modelname" className="text-xs cursor-pointer flex items-center gap-2">
                        <Zap className="w-3 h-3" /> Show Model Selector
                      </Label>
                      <Switch 
                        id="s-modelname" 
                        checked={chatSettings.showModelName} 
                        onCheckedChange={() => toggleSetting("showModelName")} 
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label htmlFor="s-latency" className="text-xs cursor-pointer flex items-center gap-2">
                        <Activity className="w-3 h-3" /> Show Latency/Cost
                      </Label>
                      <Switch 
                        id="s-latency" 
                        checked={chatSettings.showLatency} 
                        onCheckedChange={() => toggleSetting("showLatency")} 
                      />
                    </div>
                  </div>

                  <div className="space-y-1 pt-2 border-t">
                    <h4 className="text-sm font-semibold flex items-center gap-2 pt-2">
                      <Brain className="w-4 h-4" /> Memory System
                    </h4>
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <div className="space-y-0.5">
                      <Label htmlFor="s-memory" className="text-xs cursor-pointer">Auto-Store Memory</Label>
                      <p className="text-[10px] text-muted-foreground">Sync to Honcho</p>
                    </div>
                    <Switch 
                      id="s-memory" 
                      checked={chatSettings.autoStoreMemory} 
                      onCheckedChange={() => toggleSetting("autoStoreMemory")} 
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex flex-col gap-0.5">
                      <Label className="text-xs">Thinking Quotes</Label>
                      <span className="text-[10px] text-muted-foreground">Show quotes while AI is generating</span>
                    </div>
                    <Switch 
                      checked={chatSettings.showThinkingQuotes} 
                      onCheckedChange={() => toggleSetting("showThinkingQuotes")} 
                    />
                  </div>

                  {chatSettings.showThinkingQuotes && (
                    <div className="flex items-center justify-between">
                      <div className="flex flex-col gap-0.5">
                        <Label className="text-xs">Quote Style</Label>
                        <span className="text-[10px] text-muted-foreground">Category of quotes shown</span>
                      </div>
                      <select 
                        className="h-7 text-xs bg-muted/50 rounded border border-border px-2 outline-none focus:ring-1 focus:ring-primary/50"
                        value={chatSettings.quoteStyle}
                        onChange={(e) => setChatDisplaySettings({ quoteStyle: e.target.value as any })}
                      >
                        <option value="random">Random</option>
                        <option value="funny">Funny</option>
                        <option value="serious">Serious</option>
                      </select>
                    </div>
                  )}

                </div>
              </PopoverContent>
          </Popover>

          {/* Message count */}
          <HowToTooltip title="Message History" description="Total number of messages in this session. Helps you track conversation length.">
            <Badge variant="outline" className="text-[10px] hidden sm:flex cursor-help">
              {messages.length} messages
            </Badge>
          </HowToTooltip>

          {/* System prompt toggle */}
          <HowToTooltip title="System Prompt" description="Edit the base instructions for the AI. This defines its 'personality' and core rules for the current chat.">
            <Button
              size="icon"
              variant={showSystemPrompt ? "secondary" : "ghost"}
              className="h-7 w-7"
              onClick={onToggleSystemPrompt}
            >
              <Settings2 className="w-3.5 h-3.5" />
            </Button>
          </HowToTooltip>

          {/* Memory Archiver Toggle */}
          <HowToTooltip title="Memory Archiver" description="Compress chat history into dense insights and save them to long-term episodic memory.">
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-primary"
              onClick={onToggleMemory}
            >
              <Brain className="w-3.5 h-3.5" />
            </Button>
          </HowToTooltip>

          {/* Export */}
          <HowToTooltip title="Export to Markdown" description="Save this entire conversation as a .md file for documentation or reference elsewhere.">
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={onExport}
              disabled={messages.length === 0}
            >
              <Download className="w-3.5 h-3.5" />
            </Button>
          </HowToTooltip>

          {/* Clear */}
          <HowToTooltip title="Clear Chat" description="Wipes all messages and starts a fresh conversation. Careful: this cannot be undone.">
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 hover:text-destructive"
              onClick={onClearHistory}
              disabled={messages.length === 0}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </HowToTooltip>
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
      <ScrollArea className="min-h-0 flex-1 px-4">
        <div role="log" aria-live="polite" aria-label="Conversation messages" className="space-y-4 py-4">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-3 text-center text-muted-foreground">
              <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center text-2xl">
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
            messages.map((msg, idx) => {
              if (msg.role !== "assistant" && msg.role !== "user") return null;
              const excluded = excludedMessageIds?.has(msg.id) ?? false;
              const lastAssistantIdx = messages.map(m => m.role).lastIndexOf("assistant");
              return (
                <div
                  key={msg.id}
                  className={cn(excluded && "opacity-40")}
                >
                  {msg.role === "assistant" ? (
                    layout === "stream" ? (
                      <AssistantStream
                        message={msg}
                        isStreaming={isLoading && idx === lastAssistantIdx}
                        isLast={idx === lastAssistantIdx}
                        copied={copiedId === msg.id}
                        showTimestamps={chatSettings.showTimestamps}
                        showTokenCounts={chatSettings.showTokenCounts}
                        showQuotes={chatSettings.showThinkingQuotes}
                        onApprove={(id) => onApproveTool?.(id)}
                        onDeny={(id, reason) => onDenyTool?.(id, reason)}
                        onOpenDelegation={onOpenDelegation}
                        onCopy={() => handleCopy(msg.content, msg.id)}
                        onRetry={() => onRetry?.()}
                        onDelete={() => onDeleteMessage?.(msg.id)}
                        excluded={excluded}
                        onToggleExclusion={onToggleExclusion ? () => onToggleExclusion(msg.id) : undefined}
                      />
                    ) : (
                      <AssistantBubble
                        message={msg}
                        copied={copiedId === msg.id}
                        isLast={idx === lastAssistantIdx}
                        onCopy={() => handleCopy(msg.content, msg.id)}
                        onRetry={() => onRetry?.()}
                        onDelete={() => onDeleteMessage?.(msg.id)}
                        showTimestamps={chatSettings.showTimestamps}
                        showTokenCounts={chatSettings.showTokenCounts}
                        onOpenPreview={onOpenPreview}
                        isTyping={chatSettings.showThinkingQuotes && isLoading && idx === lastAssistantIdx}
                        excluded={excluded}
                        onToggleExclusion={onToggleExclusion ? () => onToggleExclusion(msg.id) : undefined}
                      />
                    )
                  ) : (
                    <UserBubble
                      message={msg}
                      copied={copiedId === msg.id}
                      onCopy={() => handleCopy(msg.content, msg.id)}
                      onEdit={newContent => onEditMessage?.(msg.id, newContent)}
                      onDelete={() => onDeleteMessage?.(msg.id)}
                      showTimestamps={chatSettings.showTimestamps}
                      showTokenCounts={chatSettings.showTokenCounts}
                      excluded={excluded}
                      onToggleExclusion={onToggleExclusion ? () => onToggleExclusion(msg.id) : undefined}
                    />
                  )}
                  {/* Every message now renders its exclude toggle inside its own
                      footer hover-actions (user, assistant-bubble, and assistant-
                      stream), so it never overlaps the message text or a tool box. */}
                </div>
              );
            })
          )}
          <div ref={scrollRef} />
        </div>
      </ScrollArea>

      {/* ── Input area ──────────────────────────────────────────────── */}
      <div className="border-t border-border px-4 pt-3 pb-1 flex-shrink-0">
        <ChatInput
          onSend={content => onSendMessage?.(content)}
          onAddFile={file => onAddFile?.(file)}
          onAddImage={file => onAddImage?.(file)}
          onStop={() => onStop?.()}
          onCommand={handleCommand}
          onBtw={onBtw}
          onToggleCliTerminal={onToggleCliTerminal}
          onToggleSandbox={onToggleTerminal}
          contextFiles={contextFiles}
          isLoading={isLoading}
          tokenCount={tokenCount}
          maxTokens={maxTokens}
          sessionId={conversationId}
          selectedModel={selectedModel}
          enableQueue={layout === "stream"}
        />
      </div>
    </Card>
  );
}
