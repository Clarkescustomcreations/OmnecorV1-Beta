/**
 * The agentic assistant render surface for mobile — the native port of
 * `client/src/components/chat/agentic/AssistantStream.tsx`.
 *
 * AI output is written flush-left on a "notepad" (a vertical guide line, no
 * bubble): prose and reasoning are plain text/markdown on the page; only the
 * things that genuinely are objects — command / edit / job / mcp actions — get a
 * boxed chip. Tapping a chip opens a single shared overlay (owned here) with the
 * detail. While the turn is still streaming and no prose has arrived yet, a
 * typed-out LoadingQuote is the waiting indicator (reasoning renders as its own
 * collapsible section independently).
 *
 * Fenced code blocks grow ▶ Run (python/js/ts/sh — runs on the PC) and ⚡ Preview
 * (html) buttons, mirroring the web's code-execution affordance.
 */
import { useMemo, useState } from "react";
import { View, Text, Modal, ScrollView, Image } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Markdown from "react-native-markdown-display";
import { Pressable } from "@/components/pressable";
import { useColors } from "@/hooks/use-colors";
import { getServerBaseUrl } from "@/lib/_core/server-config";
import { LoadingQuote } from "@/components/loading-quote";
import {
  ToolChip,
  ThinkingSection,
  BlockDetail,
  overlayTitle,
  type ToolBlock,
  type ApprovalControls,
} from "./agentic-blocks";
import type { AssistantBlock } from "@/lib/_core/agent-blocks";

// Kept in lockstep with the desktop `resolveInterpreter` (aiProviderRouter) — a
// Run button must never appear for a language the PC can't execute.
const RUN_LANGS = new Set(["python", "py", "javascript", "js", "node", "typescript", "ts", "bash", "sh", "shell"]);
const HTML_LANGS = new Set(["html", "htm", "xml", "markup", "svg"]);

// ── Code fence with Run / Preview affordances ────────────────────────────────

function CodeFence({
  lang,
  code,
  onRun,
  onPreview,
}: {
  lang: string;
  code: string;
  onRun: (language: string, code: string) => void;
  onPreview: (code: string) => void;
}) {
  const runnable = RUN_LANGS.has(lang);
  const previewable = HTML_LANGS.has(lang);
  return (
    <View className="my-1 rounded-md border border-border overflow-hidden">
      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="bg-background">
        <Text className="text-[12px] font-mono text-foreground p-2">{code.replace(/\n$/, "")}</Text>
      </ScrollView>
      {(runnable || previewable) && (
        <View className="flex-row items-center gap-2 px-2 py-1.5 border-t border-border bg-card">
          {lang ? <Text className="text-[10px] text-muted flex-1">{lang}</Text> : <View className="flex-1" />}
          {runnable && (
            <Pressable testID="btn-run-code" onPress={() => onRun(lang, code)}
              className="flex-row items-center gap-1 bg-primary/15 rounded-md px-2.5 py-1 active:opacity-70">
              <Text className="text-[11px] font-semibold text-primary">▶ Run</Text>
            </Pressable>
          )}
          {previewable && (
            <Pressable testID="btn-preview-code" onPress={() => onPreview(code)}
              className="flex-row items-center gap-1 bg-accent/15 rounded-md px-2.5 py-1 active:opacity-70">
              <Text className="text-[11px] font-semibold text-accent">⚡ Preview</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

// ── Markdown config (styles + custom rules) ──────────────────────────────────

function useMarkdown(
  onRun: (language: string, code: string) => void,
  onPreview: (code: string) => void,
) {
  const colors = useColors();
  const styles = useMemo(
    () => ({
      body: { color: colors.foreground, fontSize: 14, lineHeight: 20 },
      strong: { fontWeight: "700" as const },
      em: { fontStyle: "italic" as const },
      code_inline: { backgroundColor: colors.card, borderRadius: 4, paddingHorizontal: 4, fontFamily: "monospace", color: colors.foreground },
      link: { color: colors.primary },
      bullet_list: { marginVertical: 2 },
      ordered_list: { marginVertical: 2 },
      blockquote: { borderLeftWidth: 3, borderLeftColor: colors.muted, paddingLeft: 8, opacity: 0.85 },
    }),
    [colors],
  );

  const rules = useMemo(
    () => ({
      fence: (node: { key?: string; content?: string; sourceInfo?: string }) => {
        const lang = (node.sourceInfo || "").trim().split(/\s+/)[0].toLowerCase();
        return <CodeFence key={node.key} lang={lang} code={node.content ?? ""} onRun={onRun} onPreview={onPreview} />;
      },
      code_block: (node: { key?: string; content?: string; sourceInfo?: string }) => {
        const lang = (node.sourceInfo || "").trim().split(/\s+/)[0].toLowerCase();
        return <CodeFence key={node.key} lang={lang} code={node.content ?? ""} onRun={onRun} onPreview={onPreview} />;
      },
      image: (node: { key?: string; attributes?: { src?: string; alt?: string } }) => {
        const src = node.attributes?.src ?? "";
        const resolvedSrc = src.startsWith("/") ? `${getServerBaseUrl()}${src}` : src;
        return (
          <Image
            key={node.key}
            source={{ uri: resolvedSrc }}
            style={{ width: "100%", height: 200, borderRadius: 8, marginVertical: 4 }}
            resizeMode="contain"
          />
        );
      },
    }),
    [onRun, onPreview],
  );

  return { styles, rules };
}

// ── Assistant stream ─────────────────────────────────────────────────────────

export interface AssistantStreamProps {
  messageId: string;
  blocks?: AssistantBlock[];
  content: string;
  isStreaming: boolean;
  showQuotes: boolean;
  quoteStyle: "random" | "funny" | "serious";
  onApprove: (id: string) => void;
  onDeny: (id: string, reason?: string) => void;
  onRunCode: (language: string, code: string) => void;
  onPreviewCode: (code: string) => void;
}

export function AssistantStream({
  messageId,
  blocks,
  content,
  isStreaming,
  showQuotes,
  quoteStyle,
  onApprove,
  onDeny,
  onRunCode,
  onPreviewCode,
}: AssistantStreamProps) {
  const insets = useSafeAreaInsets();
  const { styles: mdStyles, rules: mdRules } = useMarkdown(onRunCode, onPreviewCode);
  const [overlay, setOverlay] = useState<ToolBlock | null>(null);
  const approval: ApprovalControls = { onApprove, onDeny };

  // Prefer structured blocks; fall back to a single text block for messages
  // restored from storage that only carry flattened `content`.
  const resolved: AssistantBlock[] = useMemo(() => {
    if (blocks && blocks.length > 0) return blocks;
    if (content) return [{ id: `${messageId}-text`, type: "text", text: content }];
    return [];
  }, [blocks, content, messageId]);

  const hasProse = resolved.some((b) => b.type === "text" && b.text.trim().length > 0);
  const showQuote = isStreaming && !hasProse && showQuotes;

  return (
    <View className="flex-row gap-2">
      <View className="w-6 h-6 rounded-full bg-primary/10 items-center justify-center mt-0.5">
        <Text className="text-[10px] font-bold text-primary">AI</Text>
      </View>
      <View className="flex-1 border-l border-border pl-3">
        <View className="gap-2">
          {resolved.map((block) => {
            switch (block.type) {
              case "text":
                return block.text ? (
                  <Markdown key={block.id} style={mdStyles} rules={mdRules}>
                    {block.text}
                  </Markdown>
                ) : null;
              case "thinking":
                return <ThinkingSection key={block.id} text={block.text} done={block.done} />;
              case "command":
              case "edit":
              case "job":
              case "subagent":
                // subagent spawn is HITL-gated like a job launch → needs approval.
                return <ToolChip key={block.id} block={block} onOpen={setOverlay} approval={approval} />;
              case "mcp":
                return <ToolChip key={block.id} block={block} onOpen={setOverlay} />;
              default:
                return null;
            }
          })}
          {showQuote && <LoadingQuote quoteStyle={quoteStyle} typewriter />}
        </View>
      </View>

      {/* Shared detail overlay for a tapped tool box. */}
      <Modal transparent animationType="slide" visible={overlay !== null} onRequestClose={() => setOverlay(null)}>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <View className="flex-1 justify-end">
            <Pressable testID="backdrop-toolbox" className="absolute inset-0 bg-black/50" onPress={() => setOverlay(null)} />
            <View className="bg-surface border-t border-border rounded-t-2xl" style={{ maxHeight: "80%", paddingBottom: insets.bottom + 20 }}>
              <View className="w-10 h-1 bg-border rounded-full self-center mt-3 mb-2" />
              <View className="flex-row items-center justify-between px-5 py-2">
                <Text className="flex-1 text-sm font-mono text-foreground" numberOfLines={1}>
                  {overlay ? overlayTitle(overlay) : ""}
                </Text>
                <Pressable testID="btn-close-toolbox" onPress={() => setOverlay(null)} className="px-2 py-1 active:opacity-60">
                  <Text className="text-base text-muted">✕</Text>
                </Pressable>
              </View>
              <ScrollView className="px-5" contentContainerStyle={{ paddingBottom: 12 }}>
                {overlay && <BlockDetail block={overlay} />}
              </ScrollView>
            </View>
          </View>
        </GestureHandlerRootView>
      </Modal>
    </View>
  );
}
