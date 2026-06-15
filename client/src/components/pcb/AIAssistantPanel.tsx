/**
 * AIAssistantPanel Component
 * 
 * Slide-in chat panel for AI-powered design assistance:
 * - Design review and feedback
 * - Component suggestions
 * - Netlist analysis
 * - Design recommendations
 * - Context-aware questions
 */

import React, { useState, useRef, useEffect } from 'react';
import { Node, Edge } from 'reactflow';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Send, Loader2 } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';

export interface AIAssistantPanelProps {
  canvasState: {
    nodes: Node[];
    edges: Edge[];
    mode: 'schematic' | 'pcb';
  };
  onClose: () => void;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

/** Max characters of serialized design context to send to the model. */
const CONTEXT_CHAR_CAP = 2000;

/** Best-effort human label for a node (ref designator / component name). */
function nodeLabel(node: Node): string {
  const d = (node.data ?? {}) as Record<string, unknown>;
  const label = d.label ?? d.name ?? d.ref ?? d.reference ?? d.id;
  return String(label ?? node.id);
}

/** Best-effort component type for a node (Resistor, Capacitor, IC, …). */
function nodeType(node: Node): string {
  const d = (node.data ?? {}) as Record<string, unknown>;
  const type = d.componentType ?? d.type ?? node.type;
  return type ? String(type) : 'Component';
}

/**
 * Serialize the canvas into a human-readable netlist so the AI knows the actual
 * component references, types, values, and how they're wired — not just counts.
 */
function buildDesignContext(state: AIAssistantPanelProps['canvasState']): string {
  const { nodes, edges, mode } = state;
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const componentLines = nodes.map((n) => {
    const d = (n.data ?? {}) as Record<string, unknown>;
    const value = d.value != null && d.value !== '' ? ` ${String(d.value)}` : '';
    return `  - ${nodeLabel(n)}: ${nodeType(n)}${value}`;
  });

  const connectionLines = edges.map((e) => {
    const src = byId.get(e.source);
    const tgt = byId.get(e.target);
    const s = src ? nodeLabel(src) : e.source;
    const t = tgt ? nodeLabel(tgt) : e.target;
    const sh = e.sourceHandle ? `.${e.sourceHandle}` : '';
    const th = e.targetHandle ? `.${e.targetHandle}` : '';
    return `  - ${s}${sh} → ${t}${th}`;
  });

  let out =
    `You are a PCB/schematic design assistant. The user's current ${mode} design contains:\n\n` +
    `Components (${nodes.length}):\n${componentLines.join('\n') || '  (none)'}\n\n` +
    `Connections (${edges.length}):\n${connectionLines.join('\n') || '  (none)'}\n\n` +
    `Answer questions about this circuit. If you suggest changes, describe them in terms ` +
    `of the component references shown above.`;

  if (out.length > CONTEXT_CHAR_CAP) {
    out = out.slice(0, CONTEXT_CHAR_CAP) + '\n…(design truncated — too large to fully include)';
  }
  return out;
}

export const AIAssistantPanel: React.FC<AIAssistantPanelProps> = ({
  canvasState,
  onClose,
}) => {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '0',
      role: 'assistant',
      content: `Hello! I'm your PCB/Schematic design assistant. I can help you with:
• Design review and feedback
• Component suggestions
• Netlist analysis
• Design recommendations
• Answering questions about your circuit

What would you like help with?`,
      timestamp: new Date(),
    },
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const chatMutation = trpc.ai.chat.useMutation({
    onSuccess: (data) => {
      setMessages((prev) => [...prev, {
        id: `msg-${Date.now()}-response`,
        role: 'assistant',
        content: data.content,
        timestamp: new Date(),
      }]);
      setIsLoading(false);
    },
    onError: (err) => {
      toast.error("AI error: " + err.message);
      setMessages((prev) => [...prev, {
        id: `msg-${Date.now()}-error`,
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.',
        timestamp: new Date(),
      }]);
      setIsLoading(false);
    },
  });

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Handle send message
  const handleSendMessage = () => {
    if (!inputValue.trim()) return;

    const prompt = inputValue.trim();
    const userMessage: Message = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: prompt,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);

    chatMutation.mutate({
      providerId: "ollama",
      modelId: "llama3.2:latest",
      messages: [
        {
          role: "system",
          content: buildDesignContext(canvasState),
        },
        ...messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
        { role: "user", content: prompt },
      ],
    });
  };

  // Handle keyboard enter
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div className="w-96 border-l border-gray-200 bg-white flex flex-col min-h-0 shadow-sm">
      {/* Header */}
      <div className="p-3 border-b border-gray-200 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">AI Assistant</h2>
          <p className="text-xs text-gray-600 mt-0.5">Context-aware design help</p>
        </div>
        <button
          onClick={onClose}
          className="text-gray-500 hover:text-gray-700 text-lg leading-none"
        >
          ×
        </button>
      </div>

      {/* Design Context Summary */}
      <div className="px-3 py-2 bg-blue-50 border-b border-blue-200 text-xs text-blue-900">
        <p className="font-semibold mb-1">Current Design</p>
        <p>
          {canvasState.nodes.length} components • {canvasState.edges.length} connections •{' '}
          {canvasState.mode} mode
        </p>
      </div>

      {/* Messages */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-3 space-y-3">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`
                  max-w-xs rounded-lg p-3 text-sm
                  ${
                    message.role === 'user'
                      ? 'bg-blue-500 text-white'
                      : 'bg-gray-100 text-gray-900'
                  }
                `}
              >
                <p className="whitespace-pre-wrap break-words">{message.content}</p>
                <p
                  className={`
                    text-xs mt-1
                    ${message.role === 'user' ? 'text-blue-100' : 'text-gray-600'}
                  `}
                >
                  {message.timestamp.toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-gray-100 text-gray-900 rounded-lg p-3 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm">Thinking...</span>
              </div>
            </div>
          )}

          <div ref={scrollRef} />
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="p-3 border-t border-gray-200 bg-gray-50">
        <div className="flex gap-2">
          <Input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your design..."
            className="h-9 text-sm"
            disabled={isLoading}
          />
          <Button
            onClick={handleSendMessage}
            disabled={isLoading || !inputValue.trim()}
            size="sm"
            className="gap-2"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
        <p className="text-xs text-gray-600 mt-2">
          💡 Tip: Ask about components, design review, or netlist analysis
        </p>
      </div>
    </div>
  );
};

export default AIAssistantPanel;
