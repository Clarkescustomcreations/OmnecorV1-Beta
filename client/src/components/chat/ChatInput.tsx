import { useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Send, Paperclip, Image, Square, X, FileText } from "lucide-react";
import { VoiceInputButton } from "@/components/voice/VoiceInputButton";
import { cn } from "@/lib/utils";
import type { ContextFile } from "@/lib/chatContext";

export type SlashCommand = "clear" | "new" | "system" | "export" | "help" | "compress" | "btw" | "skill" | "plan";

interface Attachment {
  name: string;
  kind: "file" | "image";
}

interface ChatInputProps {
  onSend: (content: string) => void;
  onAddFile: (file: File) => void;
  onAddImage: (file: File) => void;
  onStop: () => void;
  onCommand: (cmd: SlashCommand) => void;
  onBtw?: (note: string) => void;
  contextFiles: ContextFile[];
  isLoading: boolean;
  disabled?: boolean;
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
];

export default function ChatInput({
  onSend,
  onAddFile,
  onAddImage,
  onStop,
  onCommand,
  onBtw,
  contextFiles,
  isLoading,
  disabled,
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);

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
    // /btw keeps the input open so the user can type the note inline
    if (cmd === "btw") {
      setValue("/btw ");
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

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed || isLoading || disabled) return;

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

    onSend(trimmed);
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
        setAttachments(prev => [...prev, { name: "pasted-image.png", kind: "image" }]);
      }
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>, kind: "file" | "image") => {
    const handler = kind === "file" ? onAddFile : onAddImage;
    Array.from(e.target.files ?? []).forEach(file => {
      handler(file);
      setAttachments(prev => [...prev, { name: file.name, kind }]);
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
      <div className="flex items-end gap-2 border border-border rounded-xl bg-card px-3 py-2 focus-within:ring-1 focus-within:ring-ring/50 transition-shadow">
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
          style={{ minHeight: "24px", maxHeight: "200px" }}
        />

        {/* Toolbar */}
        <div className="flex items-center gap-0.5 flex-shrink-0 pb-0.5">
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

          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => fileInputRef.current?.click()}
            title="Attach file"
            type="button"
            disabled={isLoading}
          >
            <Paperclip className="w-3.5 h-3.5" />
          </Button>

          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => imageInputRef.current?.click()}
            title="Attach image"
            type="button"
            disabled={isLoading}
          >
            <Image className="w-3.5 h-3.5" />
          </Button>

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
            <Button
              size="icon"
              variant="destructive"
              className="h-7 w-7"
              onClick={onStop}
              title="Stop generation"
              type="button"
            >
              <Square className="w-3 h-3 fill-current" />
            </Button>
          ) : (
            <Button
              size="icon"
              className="h-7 w-7"
              onClick={handleSend}
              disabled={!value.trim() || disabled}
              title="Send (Enter)"
              aria-label="Send message"
              type="button"
            >
              <Send className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Hint line */}
      <p className="text-[10px] text-muted-foreground mt-1 pl-1">
        {isLoading
          ? "Generating response…"
          : "Enter ↵ send · Shift+Enter new line · / commands · @ mention files · paste image"}
      </p>
    </div>
  );
}
