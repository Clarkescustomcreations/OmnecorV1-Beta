/**
 * @file client/src/pages/Notifications.tsx
 * @description Unified Notifications page.
 *
 * Two views:
 *   • Alerts — a live feed of everything Omnecor surfaces that the user would
 *     wait on: new chat replies, task completion, HITL approvals, agentic-wallet
 *     budget alerts, and Agent Messenger messages.
 *   • Agent Messenger — WhatsApp/Discord-style threads with agents/personas,
 *     separate from regular project chats. Message always-on agents to plan,
 *     assist, start/check Omnecor tasks, or retrieve neural-map data.
 */

import { useEffect, useRef, useState } from "react";
import { useSearch } from "wouter";
import { OmnecorDashboardLayout } from "@/components/OmnecorDashboardLayout";
import { trpc } from "@/lib/trpc";
import { useNotifications } from "@/hooks/useNotifications";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Bell,
  MessageCircle,
  CheckCircle2,
  ShieldAlert,
  Wallet,
  Bot,
  Send,
  Check,
  Trash2,
  CircleDot,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { NotificationKind } from "@shared/notifications";

const KIND_META: Record<NotificationKind, { icon: LucideIcon; tone: string; label: string }> = {
  chat: { icon: MessageCircle, tone: "text-accent-cyan", label: "Chat" },
  "mobile-chat": { icon: MessageCircle, tone: "text-accent-cyan", label: "Mobile Chat" },
  task: { icon: CheckCircle2, tone: "text-accent-success", label: "Task" },
  hitl: { icon: ShieldAlert, tone: "text-accent-danger", label: "HITL" },
  wallet: { icon: Wallet, tone: "text-accent-purple", label: "Wallet" },
  agent: { icon: Bot, tone: "text-accent-cyan", label: "Agent" },
  system: { icon: Bell, tone: "text-muted-foreground", label: "System" },
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ─── Alerts feed ─────────────────────────────────────────────────────────────

function AlertsFeed() {
  const { notifications, unread, markRead, markAllRead, clear, isLoading } = useNotifications();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {unread > 0 ? `${unread} unread` : "All caught up"}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={markAllRead} disabled={unread === 0}>
            <Check className="w-4 h-4 mr-1" /> Mark all read
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={clear}
            disabled={notifications.length === 0}
            className="text-muted-foreground"
          >
            <Trash2 className="w-4 h-4 mr-1" /> Clear
          </Button>
        </div>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground py-8 text-center">Loading…</p>}

      {!isLoading && notifications.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Bell className="w-10 h-10 text-muted-foreground/40 mb-3" />
          <p className="text-muted-foreground">No notifications yet.</p>
          <p className="text-xs text-muted-foreground/70 mt-1">
            Chat replies, finished tasks, approvals and budget alerts show up here.
          </p>
        </div>
      )}

      <div className="space-y-2">
        {notifications.map(n => {
          const meta = KIND_META[n.kind] ?? KIND_META.system;
          const Icon = meta.icon;
          return (
            <Card
              key={n.id}
              onClick={() => {
                if (!n.read) markRead(n.id);
                if (n.href) window.location.assign(n.href);
              }}
              className={`p-3 flex gap-3 cursor-pointer transition-colors hover:bg-muted/40 ${
                n.read ? "opacity-70" : "border-l-2 border-l-primary"
              }`}
            >
              <div className={`mt-0.5 shrink-0 ${meta.tone}`}>
                <Icon className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm truncate">{n.title}</span>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                    {meta.label}
                  </Badge>
                  {!n.read && <CircleDot className="w-3 h-3 text-primary shrink-0" />}
                </div>
                <p className="text-sm text-muted-foreground line-clamp-2 mt-0.5">{n.body}</p>
                <p className="text-[11px] text-muted-foreground/60 mt-1">{timeAgo(n.createdAt)}</p>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ─── Agent Messenger ─────────────────────────────────────────────────────────

function AgentMessenger({ initialPersona }: { initialPersona?: string }) {
  const utils = trpc.useUtils();
  const convos = trpc.agentMessenger.listConversations.useQuery(undefined, {
    refetchInterval: 15_000,
  });
  const [activeId, setActiveId] = useState<string | undefined>(initialPersona);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Default to the first conversation once loaded.
  useEffect(() => {
    if (!activeId && convos.data?.conversations.length) {
      setActiveId(convos.data.conversations[0].personaId);
    }
  }, [activeId, convos.data]);

  const messages = trpc.agentMessenger.getMessages.useQuery(
    { personaId: activeId ?? "" },
    { enabled: !!activeId, refetchInterval: 10_000 }
  );

  const send = trpc.agentMessenger.send.useMutation({
    onSuccess: () => {
      utils.agentMessenger.getMessages.invalidate({ personaId: activeId });
      utils.agentMessenger.listConversations.invalidate();
    },
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.data, send.isPending]);

  const conversations = convos.data?.conversations ?? [];
  const active = conversations.find(c => c.personaId === activeId);

  const handleSend = () => {
    const text = draft.trim();
    if (!text || !activeId) return;
    setDraft("");
    send.mutate({ personaId: activeId, content: text });
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-4 h-[calc(100vh-220px)] min-h-[420px]">
      {/* Conversation list */}
      <Card className="overflow-hidden flex flex-col">
        <div className="px-3 py-2 border-b text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Agents
        </div>
        <ScrollArea className="flex-1">
          {conversations.length === 0 && (
            <p className="text-xs text-muted-foreground p-4">
              No agents yet. Create a persona in Settings → Personas to start messaging.
            </p>
          )}
          {conversations.map(c => (
            <button
              key={c.personaId}
              onClick={() => setActiveId(c.personaId)}
              className={`w-full text-left px-3 py-2.5 border-b flex items-center gap-2 hover:bg-muted/40 transition-colors ${
                c.personaId === activeId ? "bg-muted/60" : ""
              }`}
            >
              <div className="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
                <Bot className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium truncate">{c.name}</span>
                  {c.alwaysOn && <span className="w-1.5 h-1.5 rounded-full bg-accent-success shrink-0" />}
                </div>
                <p className="text-[11px] text-muted-foreground truncate">
                  {c.lastMessage ?? c.type.replace(/_/g, " ")}
                </p>
              </div>
              {c.unread > 0 && (
                <Badge className="text-[10px] px-1.5 py-0 shrink-0">{c.unread}</Badge>
              )}
            </button>
          ))}
        </ScrollArea>
      </Card>

      {/* Thread */}
      <Card className="flex flex-col overflow-hidden">
        {active ? (
          <>
            <div className="px-4 py-3 border-b flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center">
                <Bot className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-semibold leading-tight">{active.name}</p>
                <p className="text-[11px] text-muted-foreground capitalize">
                  {active.type.replace(/_/g, " ")}
                  {active.alwaysOn ? " · always-on" : ""}
                </p>
              </div>
            </div>

            <div ref={scrollRef} className="flex-1 p-4 overflow-y-auto">
              <div className="space-y-3">
                {(messages.data?.messages ?? []).length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-8">
                    Say hello to {active.name}.
                  </p>
                )}
                {(messages.data?.messages ?? []).map(m => (
                  <div
                    key={m.id}
                    className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[78%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                        m.role === "user"
                          ? "bg-primary text-primary-foreground rounded-br-sm"
                          : "bg-muted rounded-bl-sm"
                      }`}
                    >
                      {m.content}
                    </div>
                  </div>
                ))}
                {send.isPending && (
                  <div className="flex justify-start">
                    <div className="bg-muted rounded-2xl rounded-bl-sm px-3 py-2 text-sm text-muted-foreground">
                      {active.name} is typing…
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="border-t p-3 flex gap-2">
              <Input
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder={`Message ${active.name}…`}
                disabled={send.isPending}
              />
              <Button onClick={handleSend} disabled={send.isPending || !draft.trim()} size="icon">
                <Send className="w-4 h-4" />
              </Button>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-6">
            <Bot className="w-10 h-10 text-muted-foreground/40 mb-3" />
            <p className="text-muted-foreground">Select an agent to start messaging.</p>
          </div>
        )}
      </Card>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export function Notifications() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const personaParam = params.get("persona") ?? undefined;
  const [tab, setTab] = useState(personaParam ? "messenger" : "alerts");

  return (
    <OmnecorDashboardLayout>
      <div className="p-6 max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Bell className="w-6 h-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Notifications</h1>
            <p className="text-sm text-muted-foreground">
              Alerts from every Omnecor process, plus your Agent Messenger.
            </p>
          </div>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="mb-4">
            <TabsTrigger value="alerts">
              <Bell className="w-4 h-4 mr-1.5" /> Alerts
            </TabsTrigger>
            <TabsTrigger value="messenger">
              <Bot className="w-4 h-4 mr-1.5" /> Agent Messenger
            </TabsTrigger>
          </TabsList>

          <TabsContent value="alerts">
            <AlertsFeed />
          </TabsContent>
          <TabsContent value="messenger">
            <AgentMessenger initialPersona={personaParam} />
          </TabsContent>
        </Tabs>
      </div>
    </OmnecorDashboardLayout>
  );
}
