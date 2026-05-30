import React, { useState, useEffect, useRef } from "react";
import { trpc } from "../../lib/trpc";
import { WebSocketManager } from "../../lib/websocket";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";
import { Card, CardContent } from "../ui/card";
import { Send, StopCircle, User, Bot, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export const ChatPanel: React.FC = () => {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const chatMutation = trpc.ai.chat.useMutation({
    onSuccess: (data) => {
      setMessages(prev => [...prev, { role: "assistant", content: data.content }]);
      setIsStreaming(false);
    },
    onError: (err) => {
      toast.error("Chat error: " + err.message);
      setIsStreaming(false);
    }
  });

  const handleSend = () => {
    if (!input.trim() || isStreaming) return;
    
    const userMsg: Message = { role: "user", content: input };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setIsStreaming(true);

    chatMutation.mutate({
      providerId: "ollama", // TODO: Wire to ModelSelector state
      modelId: "llama3",   // TODO: Wire to ModelSelector state
      messages: [...messages, userMsg].map(m => ({ role: m.role, content: m.content }))
    });
  };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  return (
    <div className="flex flex-col h-full bg-background border-r">
      <div className="p-4 border-b bg-muted/20 flex justify-between items-center">
        <h2 className="font-bold tracking-tight">AI Orchestrator</h2>
      </div>

      <ScrollArea className="flex-1 p-4">
        <div className="space-y-4 max-w-3xl mx-auto">
          {messages.map((m, i) => (
            <div key={i} className={`flex gap-3 ${m.role === 'user' ? 'justify-end' : ''}`}>
              {m.role === 'assistant' && (
                <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white shrink-0 shadow-sm">
                  <Bot className="w-4 h-4" />
                </div>
              )}
              <Card className={`max-w-[80%] border-none shadow-sm ${m.role === 'user' ? 'bg-blue-600 text-white' : 'bg-muted/50'}`}>
                <CardContent className="p-3 text-sm leading-relaxed whitespace-pre-wrap">
                  {m.content}
                </CardContent>
              </Card>
              {m.role === 'user' && (
                <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-white shrink-0 shadow-sm">
                  <User className="w-4 h-4" />
                </div>
              )}
            </div>
          ))}
          {isStreaming && (
             <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white shrink-0 animate-pulse">
                  <Bot className="w-4 h-4" />
                </div>
                <Card className="bg-muted/50 border-none shadow-sm">
                  <CardContent className="p-3 flex items-center gap-2">
                    <Loader2 className="w-3 h-3 animate-spin text-blue-600" />
                    <span className="text-xs text-muted-foreground italic">Thinking...</span>
                  </CardContent>
                </Card>
             </div>
          )}
          <div ref={scrollRef} />
        </div>
      </ScrollArea>

      <div className="p-4 border-t bg-background">
        <div className="max-w-3xl mx-auto relative">
          <Input 
            placeholder="Ask anything..." 
            className="pr-24 h-12 shadow-inner" 
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            disabled={isStreaming}
          />
          <div className="absolute right-1.5 top-1.5 flex gap-1">
             {isStreaming && (
               <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-foreground">
                 <StopCircle className="w-5 h-5" />
               </Button>
             )}
             <Button size="icon" className="h-9 w-9 bg-blue-600 hover:bg-blue-700 shadow-md" onClick={handleSend} disabled={isStreaming}>
               <Send className="w-4 h-4" />
             </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
