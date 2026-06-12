/**
 * HITL — live Human-in-the-Loop approval queue.
 *
 * Shows critical agent actions the PC has paused on, pushed in real time over
 * the "hitl:pending" WebSocket channel. Approve/Reject resolves the suspended
 * call on the PC via the `hitl.resolve` tRPC mutation.
 */
import { Text, View, Pressable, FlatList, ActivityIndicator } from "react-native";
import { useState } from "react";
import { ScreenContainer } from "@/components/screen-container";
import { useHitl, type CriticalAction } from "@/hooks/use-hitl";
import { isServerConfigured } from "@/lib/_core/server-config";

function summarizeArgs(args: any): string {
  if (args == null) return "";
  if (typeof args === "string") return args;
  // Prefer a human-friendly warning/reason if the action provides one.
  if (typeof args.warning === "string") return args.warning;
  if (typeof args.reason === "string") return args.reason;
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}

function riskOf(args: any): string | null {
  return args && typeof args.riskLevel === "string" ? args.riskLevel : null;
}

export default function HITLScreen() {
  const { actions, loading, error, refresh, resolve } = useHitl();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const renderItem = ({ item }: { item: CriticalAction }) => {
    const risk = riskOf(item.args);
    const expanded = expandedId === item.id;
    return (
      <Pressable
        onPress={() => setExpandedId(expanded ? null : item.id)}
        className="border-b border-border p-4 bg-surface"
      >
        <View className="flex-row gap-3 mb-2">
          <View className="w-10 h-10 rounded-full items-center justify-center bg-warning/10">
            <Text className="text-lg text-warning">⚠</Text>
          </View>
          <View className="flex-1">
            <Text className="text-sm font-semibold text-foreground">{item.toolName}</Text>
            <View className="flex-row items-center gap-2 mt-1">
              <Text className="text-xs text-warning">Awaiting approval</Text>
              {risk && (
                <View className={`rounded-full px-2 py-0.5 ${risk === "high" ? "bg-error/15" : "bg-warning/15"}`}>
                  <Text className={`text-[10px] font-semibold ${risk === "high" ? "text-error" : "text-warning"}`}>
                    {risk} risk
                  </Text>
                </View>
              )}
            </View>
          </View>
        </View>

        <Text className="text-xs text-muted ml-13" numberOfLines={expanded ? undefined : 2}>
          {summarizeArgs(item.args)}
        </Text>
        <Text className="text-xs text-muted ml-13 mt-1">
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
  };

  return (
    <ScreenContainer className="flex-1 bg-background">
      {/* Header */}
      <View className="bg-surface border-b border-border p-4">
        <View className="flex-row justify-between items-center">
          <Text className="text-lg font-bold text-foreground">Human-in-the-Loop</Text>
          <View className="flex-row items-center gap-2">
            {actions.length > 0 && (
              <View className="bg-error rounded-full px-3 py-1">
                <Text className="text-background text-xs font-bold">{actions.length} pending</Text>
              </View>
            )}
            <Pressable onPress={refresh} className="px-2 py-1 rounded bg-primary active:opacity-80">
              {loading ? <ActivityIndicator size="small" color="white" /> : <Text className="text-background text-xs font-semibold">↻</Text>}
            </Pressable>
          </View>
        </View>
        {error && (
          <View className="bg-error/10 border border-error rounded-lg p-2 mt-3">
            <Text className="text-xs text-error">{error}</Text>
          </View>
        )}
      </View>

      {/* Queue */}
      <FlatList
        data={actions}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={{ flexGrow: 1 }}
        ListEmptyComponent={
          <View className="flex-1 items-center justify-center py-12 px-6">
            <Text className="text-muted text-center">
              {!isServerConfigured()
                ? "No server configured — set the PC IP in Settings → Omnecor Server."
                : "✓ No actions awaiting approval.\nAgent decisions that need a human will appear here in real time."}
            </Text>
          </View>
        }
      />
    </ScreenContainer>
  );
}
