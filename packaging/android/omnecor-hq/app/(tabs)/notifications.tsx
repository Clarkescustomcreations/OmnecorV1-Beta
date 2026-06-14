/**
 * Notifications — unified alert feed + Agent Messenger.
 *
 *  • Alerts: live feed of everything the PC surfaces that you'd wait on —
 *    new chat replies, task completion, HITL approvals, agentic-wallet budget
 *    alerts, and Agent Messenger messages (pushed on the "notifications" WS
 *    channel, hydrated from `notifications.list`). Pending HITL approvals are
 *    pinned to the top of this feed with inline Approve/Reject (live on the
 *    "hitl:pending" WS channel) so you can clear them without leaving the tab.
 *  • Messenger: WhatsApp/Discord-style threads with agents/personas, separate
 *    from regular chats. Message always-on agents to plan, assist, start/check
 *    Omnecor tasks, or retrieve neural-map data.
 */
import { Text, View, FlatList, ActivityIndicator, TextInput, KeyboardAvoidingView, Platform } from "react-native";
import { Pressable } from "@/components/pressable";
import { useState } from "react";
import { ScreenContainer } from "@/components/screen-container";
import { isServerConfigured } from "@/lib/_core/server-config";
import { useNotifications, type OmnecorNotification, type NotificationKind } from "@/hooks/use-notifications";
import { useAgentConversations, useAgentThread, type AgentConversation } from "@/hooks/use-agent-messenger";
import { useHitl, type CriticalAction } from "@/hooks/use-hitl";

type NotifTab = "alerts" | "messenger";

const KIND_ICON: Record<NotificationKind, string> = {
  chat: "💬",
  task: "✅",
  hitl: "⚠️",
  wallet: "💳",
  agent: "🤖",
  system: "🔔",
};
const KIND_COLOR: Record<NotificationKind, string> = {
  chat: "text-primary",
  task: "text-success",
  hitl: "text-warning",
  wallet: "text-warning",
  agent: "text-primary",
  system: "text-muted",
};

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// ── HITL approvals (pinned to top of Alerts) ──────────────────────────────────

function summarizeHitlArgs(args: any): string {
  if (args == null) return "";
  if (typeof args === "string") return args;
  if (typeof args.warning === "string") return args.warning;
  if (typeof args.reason === "string") return args.reason;
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}

function hitlRisk(args: any): string | null {
  return args && typeof args.riskLevel === "string" ? args.riskLevel : null;
}

function HitlQueue() {
  const { actions, resolve } = useHitl();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (actions.length === 0) return null;

  return (
    <View className="border-b-4 border-warning/40">
      <View className="flex-row items-center gap-2 px-4 pt-3 pb-2 bg-warning/10">
        <Text className="text-base">⚠️</Text>
        <Text className="text-sm font-bold text-warning flex-1">Awaiting your approval</Text>
        <View className="bg-warning rounded-full px-2 py-0.5">
          <Text className="text-background text-xs font-bold">{actions.length}</Text>
        </View>
      </View>

      {actions.map((item: CriticalAction) => {
        const risk = hitlRisk(item.args);
        const expanded = expandedId === item.id;
        return (
          <Pressable
            key={item.id}
            onPress={() => setExpandedId(expanded ? null : item.id)}
            className="border-b border-border p-4 bg-warning/5"
          >
            <View className="flex-row items-center gap-2">
              <Text className="text-sm font-semibold text-foreground flex-1" numberOfLines={1}>
                {item.toolName}
              </Text>
              {risk && (
                <View className={`rounded-full px-2 py-0.5 ${risk === "high" ? "bg-error/15" : "bg-warning/15"}`}>
                  <Text className={`text-[10px] font-semibold ${risk === "high" ? "text-error" : "text-warning"}`}>
                    {risk} risk
                  </Text>
                </View>
              )}
            </View>

            <Text className="text-xs text-muted mt-1" numberOfLines={expanded ? undefined : 2}>
              {summarizeHitlArgs(item.args)}
            </Text>
            <Text className="text-[10px] text-muted mt-1">
              {new Date(item.timestamp).toLocaleString()}
            </Text>

            {expanded && (
              <View className="mt-4 pt-4 border-t border-border flex-row gap-2">
                <Pressable
                  onPress={() => resolve(item.id, true)}
                  className="flex-1 bg-success rounded-lg p-3 items-center active:opacity-80"
                >
                  <Text className="text-background font-semibold text-sm">✓ Approve</Text>
                </Pressable>
                <Pressable
                  onPress={() => resolve(item.id, false)}
                  className="flex-1 bg-error rounded-lg p-3 items-center active:opacity-80"
                >
                  <Text className="text-background font-semibold text-sm">✕ Reject</Text>
                </Pressable>
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

// ── Alerts ───────────────────────────────────────────────────────────────────

function AlertsView() {
  const { notifications, unread, loading, error, refresh, markRead, markAllRead, clear } = useNotifications();

  const renderItem = ({ item }: { item: OmnecorNotification }) => (
    <Pressable
      onPress={() => !item.read && markRead(item.id)}
      className={`border-b border-border p-4 ${item.read ? "bg-background" : "bg-surface"}`}
    >
      <View className="flex-row gap-3">
        <Text className="text-lg">{KIND_ICON[item.kind] ?? "🔔"}</Text>
        <View className="flex-1">
          <View className="flex-row items-center gap-2">
            <Text className={`text-sm font-semibold flex-1 ${KIND_COLOR[item.kind] ?? "text-foreground"}`} numberOfLines={1}>
              {item.title}
            </Text>
            {!item.read && <View className="w-2 h-2 rounded-full bg-primary" />}
          </View>
          <Text className="text-xs text-muted mt-0.5" numberOfLines={3}>{item.body}</Text>
          <Text className="text-[10px] text-muted mt-1">{timeAgo(item.createdAt)}</Text>
        </View>
      </View>
    </Pressable>
  );

  return (
    <View className="flex-1">
      <View className="flex-row justify-between items-center p-3 border-b border-border bg-surface">
        <Text className="text-xs text-muted">{unread > 0 ? `${unread} unread` : "All caught up"}</Text>
        <View className="flex-row gap-2">
          <Pressable onPress={markAllRead} disabled={unread === 0}
            className={`px-2 py-1 rounded ${unread === 0 ? "bg-muted/10" : "bg-primary"}`}>
            <Text className={`text-xs font-semibold ${unread === 0 ? "text-muted" : "text-background"}`}>Mark all</Text>
          </Pressable>
          <Pressable onPress={clear} className="px-2 py-1 rounded bg-error/20 border border-error">
            <Text className="text-xs font-semibold text-error">Clear</Text>
          </Pressable>
          <Pressable onPress={refresh} className="px-2 py-1 rounded bg-background border border-border">
            {loading ? <ActivityIndicator size="small" /> : <Text className="text-xs text-foreground">↻</Text>}
          </Pressable>
        </View>
      </View>

      {error && (
        <View className="bg-error/10 border border-error rounded-lg p-2 m-3">
          <Text className="text-xs text-error">{error}</Text>
        </View>
      )}

      <FlatList
        data={notifications}
        keyExtractor={(i) => i.id}
        renderItem={renderItem}
        contentContainerStyle={{ flexGrow: 1 }}
        ListHeaderComponent={<HitlQueue />}
        ListEmptyComponent={
          <View className="flex-1 items-center justify-center py-16 px-6">
            <Text className="text-muted text-center">
              {!isServerConfigured()
                ? "No server configured — set the PC IP in Settings → Omnecor Server."
                : "🔔 No notifications yet.\nChat replies, finished tasks, approvals and budget alerts appear here."}
            </Text>
          </View>
        }
      />
    </View>
  );
}

// ── Messenger ────────────────────────────────────────────────────────────────

function MessengerView() {
  const { conversations, loading, error, refresh } = useAgentConversations();
  const [active, setActive] = useState<AgentConversation | null>(null);
  const thread = useAgentThread(active?.personaId ?? null);
  const [draft, setDraft] = useState("");

  if (active) {
    return (
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {/* Thread header */}
        <View className="flex-row items-center gap-2 p-3 border-b border-border bg-surface">
          <Pressable onPress={() => setActive(null)} className="px-2 py-1">
            <Text className="text-primary text-lg">‹</Text>
          </Pressable>
          <View className="w-8 h-8 rounded-full bg-primary/15 items-center justify-center">
            <Text>🤖</Text>
          </View>
          <View className="flex-1">
            <Text className="text-sm font-semibold text-foreground">{active.name}</Text>
            <Text className="text-[10px] text-muted capitalize">
              {active.type.replace(/_/g, " ")}{active.alwaysOn ? " · always-on" : ""}
            </Text>
          </View>
        </View>

        <FlatList
          data={thread.messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: 12, flexGrow: 1 }}
          renderItem={({ item }) => (
            <View className={`my-1 flex-row ${item.role === "user" ? "justify-end" : "justify-start"}`}>
              <View className={`max-w-[80%] rounded-2xl px-3 py-2 ${item.role === "user" ? "bg-primary" : "bg-surface border border-border"}`}>
                <Text className={`text-sm ${item.role === "user" ? "text-background" : "text-foreground"}`}>{item.content}</Text>
              </View>
            </View>
          )}
          ListEmptyComponent={
            <View className="flex-1 items-center justify-center py-12">
              <Text className="text-muted">Say hello to {active.name}.</Text>
            </View>
          }
        />

        {thread.sending && (
          <Text className="text-xs text-muted px-4 pb-1">{active.name} is typing…</Text>
        )}

        <View className="flex-row gap-2 p-3 border-t border-border bg-surface">
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={`Message ${active.name}…`}
            placeholderTextColor="#888"
            className="flex-1 bg-background border border-border rounded-full px-4 py-2 text-foreground"
            editable={!thread.sending}
          />
          <Pressable
            onPress={() => { const t = draft.trim(); if (t) { setDraft(""); thread.send(t); } }}
            disabled={thread.sending || !draft.trim()}
            className={`px-4 rounded-full items-center justify-center ${thread.sending || !draft.trim() ? "bg-muted/20" : "bg-primary"}`}
          >
            <Text className={`font-semibold ${thread.sending || !draft.trim() ? "text-muted" : "text-background"}`}>Send</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    );
  }

  return (
    <View className="flex-1">
      <View className="flex-row justify-between items-center p-3 border-b border-border bg-surface">
        <Text className="text-sm font-bold text-foreground">Agent Messenger</Text>
        <Pressable onPress={refresh} className="px-2 py-1 rounded bg-background border border-border">
          {loading ? <ActivityIndicator size="small" /> : <Text className="text-xs text-foreground">↻</Text>}
        </Pressable>
      </View>

      {error && (
        <View className="bg-error/10 border border-error rounded-lg p-2 m-3">
          <Text className="text-xs text-error">{error}</Text>
        </View>
      )}

      <FlatList
        data={conversations}
        keyExtractor={(c) => c.personaId}
        contentContainerStyle={{ flexGrow: 1 }}
        renderItem={({ item }) => (
          <Pressable onPress={() => setActive(item)} className="flex-row items-center gap-3 p-4 border-b border-border">
            <View className="w-10 h-10 rounded-full bg-primary/15 items-center justify-center">
              <Text className="text-lg">🤖</Text>
            </View>
            <View className="flex-1">
              <View className="flex-row items-center gap-2">
                <Text className="text-sm font-semibold text-foreground">{item.name}</Text>
                {item.alwaysOn && <View className="w-1.5 h-1.5 rounded-full bg-success" />}
              </View>
              <Text className="text-xs text-muted" numberOfLines={1}>
                {item.lastMessage ?? item.type.replace(/_/g, " ")}
              </Text>
            </View>
            {item.unread > 0 && (
              <View className="bg-error rounded-full min-w-5 h-5 px-1.5 items-center justify-center">
                <Text className="text-background text-xs font-bold">{item.unread}</Text>
              </View>
            )}
          </Pressable>
        )}
        ListEmptyComponent={
          <View className="flex-1 items-center justify-center py-16 px-6">
            <Text className="text-muted text-center">
              {!isServerConfigured()
                ? "No server configured — set the PC IP in Settings → Omnecor Server."
                : "No agents yet.\nCreate a persona on the PC (Settings → Personas) to start messaging."}
            </Text>
          </View>
        }
      />
    </View>
  );
}

// ── Screen ───────────────────────────────────────────────────────────────────

export default function NotificationsScreen() {
  const [view, setView] = useState<NotifTab>("alerts");
  const { unread } = useNotifications();

  return (
    <ScreenContainer className="flex-1 bg-background">
      {/* Segmented toggle */}
      <View className="flex-row gap-2 p-3 border-b border-border">
        {(["alerts", "messenger"] as NotifTab[]).map((v) => (
          <Pressable key={v} onPress={() => setView(v)}
            className={`flex-1 rounded-lg p-2 items-center flex-row justify-center gap-1.5 ${view === v ? "bg-primary" : "bg-surface border border-border"}`}>
            <Text className={`text-xs font-semibold capitalize ${view === v ? "text-background" : "text-foreground"}`}>
              {v === "alerts" ? "Alerts" : "Messenger"}
            </Text>
            {v === "alerts" && unread > 0 && (
              <View className={`rounded-full min-w-4 h-4 px-1 items-center justify-center ${view === v ? "bg-background" : "bg-error"}`}>
                <Text className={`text-[9px] font-bold ${view === v ? "text-primary" : "text-background"}`}>{unread > 99 ? "99+" : unread}</Text>
              </View>
            )}
          </Pressable>
        ))}
      </View>

      {view === "alerts" ? <AlertsView /> : <MessengerView />}
    </ScreenContainer>
  );
}
