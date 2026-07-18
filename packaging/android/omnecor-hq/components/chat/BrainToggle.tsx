/**
 * BrainToggle (mobile) — per-chat Brain Pack selector (Brains-Upgrade Phase 8).
 *
 * Native port of `client/src/components/chat/BrainToggle.tsx`. A section for the
 * chat Options sheet listing the user's Brain Packs; toggling one adds it to the
 * chat's active set (persisted via brain-store, threaded to `agentChatStream` as
 * `brainIds`). Incompatible brains (not ready / embedder mismatch) are shown but
 * disabled — their corpus isn't indexed so per-chat retrieval can't use them.
 *
 * Data comes through the untyped `trpcQuery` helper (the app has no generated
 * `brains.*` client), refetched on mount and whenever `refreshKey` changes (e.g.
 * after the Manager imports/deletes a pack).
 */
import { View, Text, ActivityIndicator } from "react-native";
import { Pressable } from "@/components/pressable";
import { useEffect, useState } from "react";
import { trpcQuery } from "@/lib/_core/trpc-fetch";
import { isServerConfigured } from "@/lib/_core/server-config";

/** Serialized brain shape returned by `brains.list` (mirrors the web BrainRow). */
export interface BrainRow {
  id: string;
  name: string;
  domain: string;
  version: string;
  status: "ready" | "incompatible" | "error";
  embedderMatch: boolean;
  chunkCount: number;
}

export function BrainToggle({
  activeBrainIds,
  onToggle,
  onOpenManager,
  refreshKey = 0,
}: {
  activeBrainIds: string[];
  onToggle: (id: string) => void;
  onOpenManager: () => void;
  refreshKey?: number;
}) {
  const [brains, setBrains] = useState<BrainRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isServerConfigured()) return;
    let cancelled = false;
    setLoading(true);
    trpcQuery<(BrainRow | null)[]>("brains.list")
      .then((rows) => {
        if (cancelled) return;
        setBrains((rows ?? []).filter((b): b is BrainRow => b !== null));
      })
      .catch(() => { if (!cancelled) setBrains([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refreshKey]);

  const activeCount = brains.filter((b) => activeBrainIds.includes(b.id)).length;

  return (
    <View>
      <View className="flex-row items-center justify-between mb-1 px-1">
        <Text className="text-xs text-muted">
          Brains{activeCount > 0 ? ` · ${activeCount} attached` : ""}
        </Text>
        <Pressable testID="btn-open-brains-manager" onPress={onOpenManager} className="active:opacity-60">
          <Text className="text-xs font-semibold text-primary">Manage →</Text>
        </Pressable>
      </View>
      <View className="bg-background border border-border rounded-lg overflow-hidden">
        {loading ? (
          <View className="p-3 flex-row items-center gap-2">
            <ActivityIndicator size="small" />
            <Text className="text-xs text-muted">Loading brains…</Text>
          </View>
        ) : brains.length === 0 ? (
          <Pressable testID="btn-brains-empty-manage" onPress={onOpenManager} className="p-3 active:opacity-60">
            <Text className="text-sm text-foreground">No brains yet</Text>
            <Text className="text-xs text-muted mt-0.5">
              Import the built-in expert brains or a .obp pack to give a local model curated domain expertise.
            </Text>
          </Pressable>
        ) : (
          brains.map((brain, i) => {
            const usable = brain.status === "ready" && brain.embedderMatch;
            const checked = activeBrainIds.includes(brain.id);
            return (
              <Pressable
                key={brain.id}
                testID={`toggle-chat-brain-${brain.id}`}
                disabled={!usable}
                onPress={() => onToggle(brain.id)}
                className={`flex-row items-center justify-between p-3 ${i < brains.length - 1 ? "border-b border-border" : ""} ${usable ? "active:opacity-60" : "opacity-50"}`}
              >
                <View className="flex-1 min-w-0 pr-2">
                  <Text className="text-sm text-foreground" numberOfLines={1}>
                    {brain.name}{!usable ? "  ⚠️" : ""}
                  </Text>
                  <Text className="text-xs text-muted" numberOfLines={1}>
                    {brain.domain} · v{brain.version} · {brain.chunkCount} chunks
                    {!usable ? " · embedder mismatch" : ""}
                  </Text>
                </View>
                <Text className="text-base">{checked ? "✅" : "⬜"}</Text>
              </Pressable>
            );
          })
        )}
      </View>
    </View>
  );
}
