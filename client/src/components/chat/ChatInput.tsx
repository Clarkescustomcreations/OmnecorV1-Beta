import { useRef, useState, useEffect } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Send, Paperclip, Image, Square, X, FileText, Loader2, Terminal } from "lucide-react";
import { VoiceInputButton } from "@/components/voice/VoiceInputButton";
import { HowToTooltip } from "@/components/shell/HowToTooltip";
import { cn } from "@/lib/utils";
import type { ContextFile, SelectedModel } from "@/lib/chatContext";
import { trpc } from "@/lib/trpc";

export type SlashCommand =
  | "clear"
  | "new"
  | "system"
  | "export"
  | "help"
  | "compress"
  | "btw"
  | "skill"
  | "plan"
  | "architect"
  | "remember"
  | "review"
  | "recover"
  | "imprint";

interface Attachment {
  name: string;
  kind: "file" | "image";
  /** The real File object, used for upload at send-time. */
  file: File;
}

/** Convert a File to a base64 data URL using FileReader. */
function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

interface ChatInputProps {
  onSend: (content: string) => void;
  onAddFile: (file: File) => void;
  onAddImage: (file: File) => void;
  onStop: () => void;
  onCommand: (cmd: SlashCommand, arg?: string) => void | Promise<void>;
  onBtw?: (note: string) => void;
  onToggleCliTerminal?: () => void;
  onToggleSandbox?: () => void;
  contextFiles: ContextFile[];
  isLoading: boolean;
  disabled?: boolean;
  tokenCount?: number;
  maxTokens?: number;
  sessionId?: string;
  selectedModel?: SelectedModel;
}

const COMMANDS: { cmd: SlashCommand; label: string; description: string }[] = [
  { cmd: "clear", label: "/clear", description: "Clear conversation history" },
  { cmd: "new", label: "/new", description: "Start a new conversation" },
  { cmd: "system", label: "/system", description: "Toggle system prompt editor" },
  { cmd: "export", label: "/export", description: "Export conversation as Markdown" },
  { cmd: "help", label: "/help", description: "Show keyboard shortcuts" },
  { cmd: "compress", label: "/compress", description: "Compress history to save tokens" },
  { cmd: "btw", label: "/btw", description: "Add a persistent background context note" },
  { cmd: "skill", label: "/skill", description: "Save this workflow as a reusable skill" },
  { cmd: "plan", label: "/plan", description: "Start guided project planning with Valet" },
  { cmd: "architect", label: "/architect", description: "Think through a build like a senior engineer before coding" },
  { cmd: "remember", label: "/remember", description: "Save or restore session memory (save | restore)" },
  { cmd: "review", label: "/review", description: "Three-layer review of the current changes" },
  { cmd: "recover", label: "/recover", description: "Diagnose a failure before deciding how to respond" },
  { cmd: "imprint", label: "/imprint", description: "Capture a component's UI patterns to the registry" },
];

export function ChatInput({
  onSend,
  onAddFile,
  onAddImage,
  onStop,
  onCommand,
  onBtw,
  onToggleCliTerminal,
  onToggleSandbox,
  contextFiles,
  isLoading,
  disabled,
  tokenCount,
  maxTokens,
  sessionId,
  selectedModel,
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  const uploadMutation = trpc.attachments.uploadFile.useMutation();

  // Slash command state
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashFilter, setSlashFilter] = useState("");
  const [slashIdx, setSlashIdx] = useState(0);

  // @ mention state
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionFilter, setMentionFilter] = useState("");
  const [mentionIdx, setMentionIdx] = useState(0);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const filteredCmds = COMMANDS.filter(c =>
    c.cmd.startsWith(slashFilter.toLowerCase())
  );

  const filteredFiles = contextFiles.filter(f =>
    f.name.toLowerCase().includes(mentionFilter.toLowerCase())
  );

  // --- Auto-grow textarea ---
  const resize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  };

  // Listen for injection events (e.g. from saved scripts)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (typeof detail === "string") {
        setValue(detail);
        setTimeout(resize, 0);
        textareaRef.current?.focus();
      }
    };
    window.addEventListener("omnecor:inject_chat", handler);

    // Check for pending AI query from 3D Designer
    const pendingQuery = localStorage.getItem("omnecor:pending_ai_query");
    if (pendingQuery) {
      try {
        const { code, notes, actionType } = JSON.parse(pendingQuery);
        let prompt = "";
        const actionLabel = actionType === "fix" ? "fix" : actionType === "suggest" ? "suggest changes to" : "explain / assist with";
        prompt = `I have highlighted this section of code in the 3D Designer:\n\n\`\`\`\n${code}\n\`\`\`\n\nPlease ${actionLabel} it. ${notes ? `Additional details: ${notes}` : ""}`;
        
        setValue(prompt);
        setTimeout(resize, 50);
        textareaRef.current?.focus();
      } catch (err) {
        console.error("Error parsing pending AI query:", err);
      } finally {
        localStorage.removeItem("omnecor:pending_ai_query");
      }
    }

    return () => {
      window.removeEventListener("omnecor:inject_chat", handler);
    };
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setValue(val);
    resize();

    // Slash command detection — / at start of line
    const slashMatch = /(?:^|\n)\/(\w*)$/.exec(val);
    if (slashMatch) {
      setSlashFilter(slashMatch[1]);
      setSlashIdx(0);
      setSlashOpen(true);
      setMentionOpen(false);
      return;
    }
    setSlashOpen(false);

    // @ mention detection
    const mentionMatch = /@(\w*)$/.exec(val);
    if (mentionMatch) {
      setMentionFilter(mentionMatch[1]);
      setMentionIdx(0);
      setMentionOpen(true);
      return;
    }
    setMentionOpen(false);
  };

  const execCommand = (cmd: SlashCommand) => {
    // These keep the input open so the user can type an inline argument
    // (/btw <note>, /remember save|restore, /imprint <file>).
    const inlineArgPrefix: Partial<Record<SlashCommand, string>> = {
      btw: "/btw ",
      remember: "/remember ",
      imprint: "/imprint ",
    };
    if (inlineArgPrefix[cmd]) {
      setValue(inlineArgPrefix[cmd]!);
      setSlashOpen(false);
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      textareaRef.current?.focus();
      return;
    }
    setValue("");
    setSlashOpen(false);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    onCommand(cmd);
    textareaRef.current?.focus();
  };

  const insertMention = (file: ContextFile) => {
    const newVal = value.replace(/@(\w*)$/, `@${file.name} `);
    setValue(newVal);
    setMentionOpen(false);
    textareaRef.current?.focus();
    setTimeout(resize, 0);
  };

  const handleSend = async () => {
    const trimmed = value.trim();
    if (!trimmed || isLoading || disabled || isUploading) return;

    // Intercept /btw notes — store as session context, don't send as chat
    if (trimmed.startsWith("/btw ")) {
      const note = trimmed.slice(5).trim();
      if (note) {
        onBtw?.(note);
        setValue("");
        setAttachments([]);
        if (textareaRef.current) textareaRef.current.style.height = "auto";
      }
      return;
    }

    // Intercept workflow commands that carry an inline argument so they run the
    // workflow instead of being sent as a chat message.
    const argCmd = /^\/(remember|imprint)\b\s*(.*)$/.exec(trimmed);
    if (argCmd) {
      onCommand(argCmd[1] as SlashCommand, argCmd[2].trim() || undefined);
      setValue("");
      setAttachments([]);
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      return;
    }

    // Pre-upload any pending attachments, then append markdown references
    let finalMessage = trimmed;
    if (attachments.length > 0) {
      setIsUploading(true);
      try {
        const uploadedFiles = await Promise.all(
          attachments.map(async (att) => {
            const dataUrl = await readFileAsDataURL(att.file);
            return uploadMutation.mutateAsync({
              name: att.name,
              mimeType: att.file.type || "application/octet-stream",
              dataUrl,
            });
          })
        );
        const attachmentText = uploadedFiles
          .map((f) => `[Attachment: ${f.filename}](${f.url})`)
          .join("\n");
        finalMessage = `${trimmed}\n\n${attachmentText}`;
      } catch (err) {
        console.error("Attachment upload failed:", err);
        // Still send the message without attachments rather than silently dropping
        finalMessage = trimmed;
      } finally {
        setIsUploading(false);
      }
    }

    onSend(finalMessage);
    setValue("");
    setAttachments([]);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashOpen && filteredCmds.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSlashIdx(i => Math.min(i + 1, filteredCmds.length - 1)); return; }
      if (e.key === "ArrowUp")   { e.preventDefault(); setSlashIdx(i => Math.max(i - 1, 0)); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); execCommand(filteredCmds[slashIdx].cmd); return; }
      if (e.key === "Escape")    { e.preventDefault(); setSlashOpen(false); return; }
    }
    if (mentionOpen && filteredFiles.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setMentionIdx(i => Math.min(i + 1, filteredFiles.length - 1)); return; }
      if (e.key === "ArrowUp")   { e.preventDefault(); setMentionIdx(i => Math.max(i - 1, 0)); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); insertMention(filteredFiles[mentionIdx]); return; }
      if (e.key === "Escape")    { e.preventDefault(); setMentionOpen(false); return; }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const imageItem = Array.from(e.clipboardData.items).find(item =>
      item.type.startsWith("image/")
    );
    if (imageItem) {
      const file = imageItem.getAsFile();
      if (file) {
        onAddImage(file);
        setAttachments(prev => [...prev, { name: "pasted-image.png", kind: "image", file }]);
      }
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>, kind: "file" | "image") => {
    const handler = kind === "file" ? onAddFile : onAddImage;
    Array.from(e.target.files ?? []).forEach(file => {
      handler(file);
      setAttachments(prev => [...prev, { name: file.name, kind, file }]);
    });
    e.target.value = "";
  };

  return (
    <div className="relative">
      {/* Slash command popup */}
      {slashOpen && filteredCmds.length > 0 && (
        <div className="absolute bottom-full mb-1.5 left-0 z-50 w-72 rounded-lg border border-border bg-card shadow-lg overflow-hidden">
          <div className="px-2 py-1 text-[10px] text-muted-foreground border-b border-border font-medium uppercase tracking-wide">
            Commands
          </div>
          {filteredCmds.map((c, i) => (
            <button
              key={c.cmd}
              className={cn(
                "w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-accent/40 transition-colors",
                i === slashIdx && "bg-accent/50"
              )}
              onMouseDown={e => { e.preventDefault(); execCommand(c.cmd); }}
            >
              <span className="font-mono font-semibold text-accent w-20 flex-shrink-0">{c.label}</span>
              <span className="text-muted-foreground">{c.description}</span>
            </button>
          ))}
        </div>
      )}

      {/* @ mention popup */}
      {mentionOpen && filteredFiles.length > 0 && (
        <div className="absolute bottom-full mb-1.5 left-0 z-50 w-80 rounded-lg border border-border bg-card shadow-lg overflow-hidden">
          <div className="px-2 py-1 text-[10px] text-muted-foreground border-b border-border font-medium uppercase tracking-wide">
            Context files
          </div>
          {filteredFiles.slice(0, 8).map((file, i) => (
            <button
              key={file.id}
              className={cn(
                "w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-accent/40 transition-colors",
                i === mentionIdx && "bg-accent/50"
              )}
              onMouseDown={e => { e.preventDefault(); insertMention(file); }}
            >
              <FileText className="w-3 h-3 text-muted-foreground flex-shrink-0" />
              <span className="font-medium">{file.name}</span>
              <span className="text-muted-foreground truncate text-[10px] ml-auto">
                {file.tokens.toLocaleString()} tokens
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Attachment chips */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {attachments.map((att, i) => (
            <div
              key={i}
              className="flex items-center gap-1 px-2 py-0.5 bg-accent/20 rounded-full text-xs border border-border"
            >
              {att.kind === "image" ? (
                <Image className="w-3 h-3 flex-shrink-0" />
              ) : (
                <FileText className="w-3 h-3 flex-shrink-0" />
              )}
              <span className="max-w-[120px] truncate">{att.name}</span>
              <button
                onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))}
                className="hover:text-destructive ml-0.5"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input container */}
      <div className="flex items-end gap-2 border border-border rounded-xl bg-card px-3 py-3 focus-within:ring-1 focus-within:ring-ring/50 transition-shadow">
        <Textarea
          ref={textareaRef}
          placeholder="Message Omnecor… (/ commands · @ files · Shift+Enter new line)"
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          disabled={isLoading || disabled}
          rows={1}
          aria-label="Message input"
          className="flex-1 resize-none border-0 bg-transparent p-0 text-sm focus-visible:ring-0 shadow-none leading-relaxed"
          style={{ minHeight: "36px", maxHeight: "200px" }}
        />
      </div>

      {/* Action Toolbar Row (Terminal + Add/Send) */}
      <div className="flex flex-col sm:flex-row gap-2.5 sm:gap-0 sm:items-center sm:justify-between mt-3.5 px-1">
        {/* Left: Terminal buttons */}
        <div className="flex items-center gap-2 order-2 sm:order-1 justify-start w-full sm:w-auto">
          {onToggleCliTerminal && (
            <Button
              onClick={onToggleCliTerminal}
              variant="default"
              className="font-semibold text-xs h-7 px-2.5 rounded transition-all flex items-center gap-1 shadow-sm cursor-pointer"
              type="button"
            >
              <Terminal className="w-3 h-3" />
              Terminal/CLI
            </Button>
          )}
          {onToggleSandbox && (
            <Button
              onClick={onToggleSandbox}
              variant="default"
              className="font-semibold text-xs h-7 px-2.5 rounded transition-all flex items-center gap-1 shadow-sm cursor-pointer"
              type="button"
            >
              <Terminal className="w-3 h-3" />
              Sandboxed
            </Button>
          )}
        </div>

        {/* Right: Add & Send Toolbar */}
        <div className="flex items-center gap-1 order-1 sm:order-2 justify-end w-full sm:w-auto">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={e => handleFileSelect(e, "file")}
          />
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={e => handleFileSelect(e, "image")}
          />

          <HowToTooltip title="Attach File" description="Upload any file as context for the AI to reference." side="top">
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 cursor-pointer"
              onClick={() => fileInputRef.current?.click()}
              type="button"
              disabled={isLoading}
            >
              <Paperclip className="w-3.5 h-3.5" />
            </Button>
          </HowToTooltip>

          <HowToTooltip title="Attach Image" description="Upload an image for vision-capable models to analyze." side="top">
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 cursor-pointer"
              onClick={() => imageInputRef.current?.click()}
              type="button"
              disabled={isLoading}
            >
              <Image className="w-3.5 h-3.5" />
            </Button>
          </HowToTooltip>

          <VoiceInputButton
            size="sm"
            onTranscription={text =>
              setValue(prev => {
                const next = prev ? `${prev} ${text}` : text;
                setTimeout(resize, 0);
                return next;
              })
            }
          />

          {isLoading ? (
            <HowToTooltip title="Stop Generation" description="Halt the current AI response immediately." side="top">
              <Button
                size="icon"
                variant="destructive"
                className="h-7 w-7 cursor-pointer"
                onClick={onStop}
                type="button"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
              </Button>
            </HowToTooltip>
          ) : (
            <HowToTooltip title="Send Message" description="Send your message to the AI. You can also press Enter to send." side="top">
              <Button
                size="icon"
                className="h-7 w-7 cursor-pointer"
                onClick={handleSend}
                disabled={!value.trim() || disabled || isUploading}
                aria-label={isUploading ? "Uploading attachments" : "Send message"}
                type="button"
              >
                {isUploading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Send className="w-3.5 h-3.5" />
                )}
              </Button>
            </HowToTooltip>
          )}
        </div>
      </div>

      {/* Hint line */}
      <div className="flex items-center justify-between mt-2.5 px-1">
        <p className="text-[10px] text-muted-foreground hidden sm:block">
          {isUploading
            ? "Uploading attachments…"
            : isLoading
            ? "Generating response…"
            : "Enter ↵ send · Shift+Enter new line · /commands/skills · @ mention files · paste image"}
        </p>
        {tokenCount !== undefined && maxTokens !== undefined && (
          <span
            className={cn(
              "text-[10px] tabular-nums sm:ml-2 ml-auto flex-shrink-0",
              tokenCount / maxTokens >= 0.9
                ? "text-destructive"
                : tokenCount / maxTokens >= 0.7
                ? "text-accent-cyan"
                : "text-muted-foreground"
            )}
          >
            {tokenCount.toLocaleString()} / {maxTokens.toLocaleString()} tokens
          </span>
        )}
      </div>
    </div>
  );
}
