/**
 * The agentic assistant render surface: AI output written flush-left on an open
 * "notepad" (a vertical guide line, no card/bubble), the way modern CLI/agent
 * chat UIs present it. Prose and reasoning are plain text on the page; only the
 * things that genuinely are objects — command / edit / job / mcp actions — get a
 * boxed chip. User messages (bubbles) and these tool boxes are the only enclosed
 * elements; everything the AI "says" or "thinks" is just text.
 *
 * Renders an ordered `AssistantBlock[]` (falling back to a single text block for
 * messages restored from storage that only carry flattened `content`). While the
 * turn is still streaming and no reasoning is showing, a typed-out `LoadingQuote`
 * is the waiting indicator. Per-message actions (copy / retry / delete) sit in a
 * subtle footer under the text.
 */
import { useMemo, useRef } from "react";
import { Copy, Check, RotateCcw, Trash2 } from "lucide-react";
import { Streamdown } from "streamdown";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LoadingQuote } from "@/components/chat/LoadingQuote";
import {
  CommandBox,
  EditBox,
  JobBox,
  McpBox,
  SubAgentBox,
  ThinkingSection,
} from "./AgenticBlocks";
import { useCodeBlockActions } from "./useCodeBlockActions";
import type { ChatMessage } from "@/lib/chatContext";
import type { AssistantBlock, TextBlock } from "@shared/chatBlocks";

/** A prose block that also grows Run/Preview buttons on its code fences. */
function StreamText({ block }: { block: TextBlock }) {
  const ref = useRef<HTMLDivElement>(null);
  useCodeBlockActions(ref, block.text);
  return (
    <div ref={ref} className="prose-sm prose dark:prose-invert max-w-none break-words text-sm leading-relaxed">
      <Streamdown>{block.text}</Streamdown>
    </div>
  );
}

export interface AssistantStreamProps {
  message: ChatMessage;
  /** True while this message is the actively-streaming turn. */
  isStreaming?: boolean;
  isLast?: boolean;
  copied?: boolean;
  showTimestamps?: boolean;
  showTokenCounts?: boolean;
  /** Whether to show the typed-out loading quote while waiting (display setting). */
  showQuotes?: boolean;
  /** Resolve a `pending_approval` tool box. */
  onApprove: (id: string) => void;
  onDeny: (id: string, reason?: string) => void;
  /** Tap-through from a delegated `subagent` chip to its managed chat. */
  onOpenDelegation?: (conversationId: string) => void;
  onCopy?: () => void;
  onRetry?: () => void;
  onDelete?: () => void;
  excluded?: boolean;
  onToggleExclusion?: () => void;
}

export function AssistantStream({
  message,
  isStreaming = false,
  isLast = false,
  copied = false,
  showTimestamps = false,
  showTokenCounts = false,
  showQuotes = true,
  onApprove,
  onDeny,
  onOpenDelegation,
  onCopy,
  onRetry,
  onDelete,
  excluded = false,
  onToggleExclusion,
}: AssistantStreamProps) {
  const approval = { onApprove, onDeny };

  // Prefer structured blocks; fall back to a single text block for messages
  // restored from storage that only carry flattened `content`.
  const blocks: AssistantBlock[] = useMemo(() => {
    if (message.blocks && message.blocks.length > 0) return message.blocks;
    if (message.content) return [{ id: `${message.id}-text`, type: "text", text: message.content }];
    return [];
  }, [message.blocks, message.content, message.id]);

  // Show the typed-out loading quote while streaming until the answer prose
  // actually starts. This keeps it visible through the reasoning phase — the
  // reasoning itself always renders as its own collapsible chevron section
  // (ThinkingSection) so the user can open/close it independently of the quote.
  const hasProse = blocks.some((b) => b.type === "text" && b.text.trim().length > 0);
  const showQuote = isStreaming && !hasProse && showQuotes;

  return (
    <div className="flex gap-3 justify-start group">
      <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5 text-[10px] font-bold text-primary">
        AI
      </div>
      <div className="flex-1 min-w-0 border-l border-border/40 pl-4">
        <div className="space-y-2 py-0.5">
          {blocks.map((block) => {
            switch (block.type) {
              case "text":
                return block.text ? <StreamText key={block.id} block={block} /> : null;
              case "thinking":
                return <ThinkingSection key={block.id} text={block.text} done={block.done} />;
              case "command":
                return <CommandBox key={block.id} block={block} approval={approval} />;
              case "edit":
                return <EditBox key={block.id} block={block} approval={approval} />;
              case "job":
                return <JobBox key={block.id} block={block} approval={approval} />;
              case "mcp":
                return <McpBox key={block.id} block={block} />;
              case "subagent":
                return (
                  <SubAgentBox
                    key={block.id}
                    block={block}
                    approval={approval}
                    onOpen={onOpenDelegation}
                  />
                );
              default:
                return null;
            }
          })}
          {showQuote && <LoadingQuote key="stream-loading-quote" typewriter />}
        </div>

        {message.metadata?.error && (
          <div className="mt-2 p-2 rounded bg-destructive/10 border border-destructive/30">
            <p className="text-xs text-destructive">{message.metadata.error}</p>
          </div>
        )}

        {/* Footer: timestamp + tokens + hover actions */}
        <div className="flex items-center gap-2 mt-1.5 h-5">
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
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            {onCopy && (
              <Button size="icon" variant="ghost" className="h-5 w-5" onClick={onCopy}>
                {copied ? <Check className="w-3 h-3 text-accent-success" /> : <Copy className="w-3 h-3" />}
              </Button>
            )}
            {isLast && onRetry && (
              <Button size="icon" variant="ghost" className="h-5 w-5" onClick={onRetry}>
                <RotateCcw className="w-3 h-3" />
              </Button>
            )}
            {onDelete && (
              <Button size="icon" variant="ghost" className="h-5 w-5 hover:text-destructive" onClick={onDelete}>
                <Trash2 className="w-3 h-3" />
              </Button>
            )}
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
    </div>
  );
}
