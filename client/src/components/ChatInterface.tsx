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
import ChatInput, { type SlashCommand } from "@/components/chat/ChatInput";
import ModelSelector from "@/components/chat/ModelSelector";
import { saveScript } from "@/lib/scriptStorage";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { HowToTooltip } from "@/components/shell/HowToTooltip";

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
}

function AssistantBubble({
  message,
  onCopy,
  onRetry,
  onDelete,
  copied,
  isLast,
  showTimestamps = true,
  showTokenCounts = true,
  onOpenPreview,
}: AssistantBubbleProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [scriptName, setScriptName] = useState("");
  const [scriptProject, setScriptProject] = useState("");
  const [extractedCode, setExtractedCode] = useState("");

  useCodeBlockCopy(contentRef, message.content);

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
    saveScript({
      name: scriptName.trim(),
      project: scriptProject.trim() || "Default",
      code: extractedCode,
      language: "python",
      description: `Saved from chat: ${message.content.slice(0, 100)}...`,
    });
    setShowSaveDialog(false);
    toast.success(`Script "${scriptName}" saved to ${scriptProject || "Default"}`);
    // Trigger sidebar update
    window.dispatchEvent(new CustomEvent("omnecor:scripts_updated"));
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
      <div className="w-6 h-6 rounded-full bg-accent flex items-center justify-center flex-shrink-0 mt-1 text-[10px] font-bold text-accent-foreground">
        AI
      </div>

      <div className="flex flex-col gap-1 max-w-2xl xl:max-w-3xl min-w-0">
        <div className="rounded-lg px-4 py-3 bg-card border border-border text-card-foreground text-sm shadow-sm">
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
            <Button
              size="sm"
              variant="outline"
              className="h-5 text-[10px] px-1.5 gap-1 border-purple-500/30 text-purple-500 bg-purple-500/5 hover:bg-purple-500/10"
              onClick={handleLivePreviewClick}
            >
              <Eye className="w-2.5 h-2.5" />
              Live Preview
            </Button>
          )}

          {/* Action: Save Script (always visible if python present) */}
          {hasPython && (
            <Button
              size="sm"
              variant="outline"
              className="h-5 text-[10px] px-1.5 gap-1 border-blue-500/30 text-blue-500 bg-blue-500/5 hover:bg-blue-500/10"
              onClick={handleSaveScriptClick}
            >
              <Save className="w-2.5 h-2.5" />
              Save Script
            </Button>
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
              className="h-5 w-5 hover:text-destructive"
              onClick={onDelete}
              title="Delete message"
            >
              <Trash2 className="w-3 h-3" />
            </Button>
          </div>
        </div>
      </div>

      {/* Save Script Dialog */}
      <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Terminal className="w-5 h-5 text-blue-500" />
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
            <Button size="sm" onClick={confirmSave}>Save to Library</Button>
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
}

function UserBubble({
  message,
  onCopy,
  onEdit,
  onDelete,
  copied,
  showTimestamps = true,
  showTokenCounts = true,
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
        <div className="rounded-lg px-4 py-3 bg-accent text-accent-foreground text-sm w-full shadow-sm">
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
  onCommand?: (cmd: SlashCommand) => void | Promise<void>;
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
  className,
}: ChatInterfaceProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(conversationTitle);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Chat-specific display settings
  interface ChatDisplaySettings {
    showTimestamps: boolean;
    showTokenCounts: boolean;
    showModelName: boolean;
    showLatency: boolean;
    autoStoreMemory: boolean;
  }
  const [chatSettings, setChatSettings] = useState<ChatDisplaySettings>(() => {
    try {
      const saved = localStorage.getItem("omnecor:chat_display_settings");
      return saved ? JSON.parse(saved) : {
        showTimestamps: true,
        showTokenCounts: true,
        showModelName: true,
        showLatency: false,
        autoStoreMemory: true,
      };
    } catch {
      return {
        showTimestamps: true,
        showTokenCounts: true,
        showModelName: true,
        showLatency: false,
        autoStoreMemory: true,
      };
    }
  });

  useEffect(() => {
    localStorage.setItem("omnecor:chat_display_settings", JSON.stringify(chatSettings));
  }, [chatSettings]);

  const toggleSetting = (key: keyof typeof chatSettings) => {
    setChatSettings((prev) => ({ ...prev, [key]: !prev[key] }));
  };

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

  const handleCommand = useCallback(
    (cmd: SlashCommand) => {
      if (cmd === "help") {
        toast.info(
          "Commands: /clear · /new · /system · /export · /compress · /btw [note] · /skill · /plan\nShortcuts: Enter → send · Shift+Enter → new line",
          { duration: 6000 }
        );
        return;
      }
      onCommand?.(cmd);
    },
    [onCommand]
  );

  return (
    <Card className={cn(
      "flex flex-col h-full overflow-hidden transition-all duration-300",
      isFictionMode && "border-purple-500/60 shadow-[0_0_18px_-4px_theme(colors.purple.500/0.35)]",
      className
    )}>
      {/* ── Fiction Mode Persistent Banner ─────────────────────────── */}
      {isFictionMode && (
        <div className="flex items-center gap-2 px-4 py-2 bg-purple-950/60 border-b border-purple-500/40 flex-shrink-0 flex-wrap">
          <BookOpenText className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" />
          <span className="text-xs font-semibold text-purple-300 tracking-wide">FICTION MODE</span>
          <span className="text-[10px] text-purple-400/70 hidden sm:inline">Creative writing &amp; roleplay only</span>
          {/* Persona selector */}
          <div className="flex items-center gap-1.5 ml-1">
            <UserCircle2 className="w-3 h-3 text-purple-400/70 flex-shrink-0" />
            <select
              value={fictionPersonaId}
              onChange={e => onFictionPersonaChange?.(e.target.value)}
              className="text-[10px] bg-purple-900/50 border border-purple-500/30 rounded px-1.5 py-0.5 text-purple-300 focus:outline-none focus:ring-1 focus:ring-purple-500/50 max-w-[130px]"
              title="Active fiction persona"
            >
              <option value="">No persona</option>
              {fictionPersonas.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-1 text-[10px] text-purple-400/60">
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
              className="text-sm font-semibold hover:text-accent transition-colors truncate max-w-[200px]"
              onClick={() => setEditingTitle(true)}
              title="Click to rename"
            >
              {conversationTitle}
            </button>
          )}

          {/* Model selector */}
          {chatSettings.showModelName && (
            <ModelSelector
              selectedModel={selectedModel}
              onSelect={model => onModelChange?.(model)}
            />
          )}

          {/* Spacer */}
          <div className="flex-1" />

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
              className="h-7 w-7 text-accent"
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
      <ScrollArea className="flex-1 px-4">
        <div role="log" aria-live="polite" aria-label="Conversation messages" className="space-y-4 py-4">
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
            messages.map((msg, idx) => {
              if (msg.role !== "assistant" && msg.role !== "user") return null;
              const excluded = excludedMessageIds?.has(msg.id) ?? false;
              const lastAssistantIdx = messages.map(m => m.role).lastIndexOf("assistant");
              return (
                <div
                  key={msg.id}
                  className={cn("group relative", excluded && "opacity-40")}
                >
                  {msg.role === "assistant" ? (
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
                    />
                  ) : (
                    <UserBubble
                      message={msg}
                      copied={copiedId === msg.id}
                      onCopy={() => handleCopy(msg.content, msg.id)}
                      onEdit={newContent => onEditMessage?.(msg.id, newContent)}
                      onDelete={() => onDeleteMessage?.(msg.id)}
                      showTimestamps={chatSettings.showTimestamps}
                      showTokenCounts={chatSettings.showTokenCounts}
                    />
                  )}
                  {onToggleExclusion && (
                    <button
                      onClick={() => onToggleExclusion(msg.id)}
                      className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity text-[10px] text-muted-foreground hover:text-foreground bg-background/80 rounded px-1 py-0.5 border border-border/50"
                      title={excluded ? "Include in context" : "Exclude from context"}
                    >
                      {excluded ? "⊕ include" : "⊖ exclude"}
                    </button>
                  )}
                </div>
              );
            })
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
          onBtw={onBtw}
          onToggleCliTerminal={onToggleCliTerminal}
          onToggleSandbox={onToggleTerminal}
          contextFiles={contextFiles}
          isLoading={isLoading}
          tokenCount={tokenCount}
          maxTokens={maxTokens}
          sessionId={conversationId}
          selectedModel={selectedModel}
        />
      </div>
    </Card>
  );
}
