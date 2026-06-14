/**
 * Status — system monitor.
 *
 *  • OMMESH Phone Node panel (live, from the OMMESH WebSocket node)
 *  • PC Jobs panel (live, from `jobs.list` + the "training:all" WS channel)
 *
 * Cancel is the only write-action the PC exposes for jobs (no pause/resume).
 */
import { ScrollView, Text, View, ActivityIndicator } from "react-native";
import { Pressable } from "@/components/pressable";
import { useState } from "react";
import { ScreenContainer } from "@/components/screen-container";
import { useOmmeshNode } from "@/hooks/use-ommesh-node";
import { useJobs, jobPercent, type Job, type JobState } from "@/hooks/use-jobs";
import { isModelLoaded, getLoadedModelPath, getStats } from "@/lib/_core/local-inference";
import { isServerConfigured, getServerIp } from "@/lib/_core/server-config";

const MESH_COLOR: Record<string, string> = {
  disconnected: "text-muted",
  connecting:   "text-warning",
  connected:    "text-primary",
  registered:   "text-success",
  error:        "text-error",
};
const MESH_BG: Record<string, string> = {
  disconnected: "bg-muted/10 border-muted/30",
  connecting:   "bg-warning/10 border-warning",
  connected:    "bg-primary/10 border-primary",
  registered:   "bg-success/10 border-success",
  error:        "bg-error/10 border-error",
};

const STATE_COLOR: Record<JobState, string> = {
  queued:    "text-muted",
  running:   "text-primary",
  completed: "text-success",
  failed:    "text-error",
  cancelled: "text-warning",
};
const STATE_BG: Record<JobState, string> = {
  queued:    "bg-muted/10",
  running:   "bg-primary/10",
  completed: "bg-success/10",
  failed:    "bg-error/10",
  cancelled: "bg-warning/10",
};

type Filter = "all" | "running" | "completed" | "failed";

export default function StatusScreen() {
  const { status: meshStatus, stats: meshStats, nodeId } = useOmmeshNode();
  const { jobs, loading, error, refresh, cancel } = useJobs();
  const [modelLoaded] = useState(isModelLoaded());
  const [modelPath]   = useState(getLoadedModelPath());
  const [filter, setFilter] = useState<Filter>("all");

  const counts = {
    running:   jobs.filter((j) => j.state === "running").length,
    completed: jobs.filter((j) => j.state === "completed").length,
    failed:    jobs.filter((j) => j.state === "failed").length,
  };
  const filtered = jobs.filter((j) => filter === "all" || j.state === filter);

  const renderJob = (item: Job) => {
    const pct = jobPercent(item);
    return (
      <View key={item.jobId} className="border-b border-border p-4">
        <View className="flex-row justify-between items-start mb-2">
          <View className="flex-1 pr-2">
            <Text className="text-sm font-semibold text-foreground" numberOfLines={1}>{item.label}</Text>
            <Text className="text-xs text-muted mt-0.5">{item.type}</Text>
          </View>
          <View className={`rounded-full px-3 py-1 ${STATE_BG[item.state]}`}>
            <Text className={`text-xs font-semibold capitalize ${STATE_COLOR[item.state]}`}>
              {pct != null && item.state === "running" ? `${Math.round(pct)}%` : item.state}
            </Text>
          </View>
        </View>

        {pct != null && (
          <View className="bg-background rounded-full h-2 overflow-hidden mb-2">
            <View className="bg-primary h-full" style={{ width: `${pct}%` }} />
          </View>
        )}

        <View className="flex-row justify-between mb-2">
          <Text className="text-xs text-muted">
            {item.startedAt ? `Started ${new Date(item.startedAt).toLocaleTimeString()}` : "—"}
          </Text>
          <Text className="text-xs text-muted" numberOfLines={1}>{item.jobId.slice(0, 8)}</Text>
        </View>

        {item.state === "running" && (
          <Pressable
            onPress={() => cancel(item.jobId)}
            className="bg-error/20 border border-error rounded-lg p-2 items-center active:opacity-70"
          >
            <Text className="text-error text-xs font-semibold">Cancel</Text>
          </Pressable>
        )}
      </View>
    );
  };

  return (
    <ScreenContainer className="flex-1 bg-background">
      <ScrollView contentContainerStyle={{ paddingBottom: 20 }} showsVerticalScrollIndicator={false}>

        {/* ── OMMESH Node Status ─────────────────────────────────────── */}
        <View className="p-4 border-b border-border">
          <Text className="text-base font-bold text-foreground mb-3">OMMESH Phone Node</Text>
          <View className={`rounded-lg border p-3 mb-3 ${MESH_BG[meshStatus] ?? "bg-muted/10 border-muted/30"}`}>
            <View className="flex-row justify-between items-center">
              <Text className={`text-sm font-semibold capitalize ${MESH_COLOR[meshStatus] ?? "text-muted"}`}>
                {meshStatus === "registered" ? "✓ Registered as worker node" : meshStatus}
              </Text>
              <Text className="text-xs text-muted">{nodeId.slice(0, 8)}</Text>
            </View>
            {isServerConfigured() && (
              <Text className="text-xs text-muted mt-1">PC: {getServerIp()}</Text>
            )}
          </View>

          <View className="flex-row gap-3">
            <View className="flex-1 bg-surface border border-border rounded-lg p-3 items-center">
              <Text className="text-xl font-bold text-primary">{meshStats.totalRequests}</Text>
              <Text className="text-xs text-muted">Requests</Text>
            </View>
            <View className="flex-1 bg-surface border border-border rounded-lg p-3 items-center">
              <Text className="text-xl font-bold text-primary">{meshStats.totalTokens}</Text>
              <Text className="text-xs text-muted">Tokens</Text>
            </View>
            <View className="flex-1 bg-surface border border-border rounded-lg p-3 items-center">
              <Text className="text-xl font-bold text-primary">{meshStats.tokensPerSec}</Text>
              <Text className="text-xs text-muted">tok/s</Text>
            </View>
          </View>

          <View className={`mt-3 rounded-lg border p-2 ${modelLoaded ? "bg-success/10 border-success" : "bg-muted/10 border-muted/30"}`}>
            <Text className={`text-xs font-semibold ${modelLoaded ? "text-success" : "text-muted"}`}>
              {modelLoaded ? `🤖 ${modelPath?.split("/").pop() ?? "Model"} loaded` : "No model loaded — load one in Settings → Phone AI Model"}
            </Text>
          </View>
        </View>

        {/* ── PC Jobs ────────────────────────────────────────────────── */}
        <View className="bg-surface border-b border-border p-4">
          <View className="flex-row justify-between items-center mb-3">
            <Text className="text-base font-bold text-foreground">PC Jobs</Text>
            <Pressable onPress={refresh} className="px-2 py-1 rounded bg-primary active:opacity-80">
              {loading ? <ActivityIndicator size="small" color="white" /> : <Text className="text-background text-xs font-semibold">↻ Refresh</Text>}
            </Pressable>
          </View>

          {error && (
            <View className="bg-error/10 border border-error rounded-lg p-2 mb-3">
              <Text className="text-xs text-error">{error}</Text>
            </View>
          )}

          <View className="flex-row justify-between mb-3">
            <View>
              <Text className="text-xs text-muted">Running</Text>
              <Text className="text-2xl font-bold text-primary">{counts.running}</Text>
            </View>
            <View>
              <Text className="text-xs text-muted">Completed</Text>
              <Text className="text-2xl font-bold text-success">{counts.completed}</Text>
            </View>
            <View>
              <Text className="text-xs text-muted">Failed</Text>
              <Text className="text-2xl font-bold text-error">{counts.failed}</Text>
            </View>
          </View>

          <View className="flex-row gap-2">
            {(["all", "running", "completed", "failed"] as Filter[]).map((s) => (
              <Pressable key={s} onPress={() => setFilter(s)}
                className={`flex-1 rounded-lg p-2 items-center ${filter === s ? "bg-primary" : "bg-background border border-border"}`}>
                <Text className={`text-xs font-semibold capitalize ${filter === s ? "text-background" : "text-foreground"}`}>{s}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* ── Job List ──────────────────────────────────────────────── */}
        {filtered.map(renderJob)}

        {filtered.length === 0 && (
          <View className="items-center justify-center py-10 px-6">
            <Text className="text-muted text-center">
              {!isServerConfigured()
                ? "No server configured — set the PC IP in Settings → Omnecor Server."
                : jobs.length === 0
                  ? "No background jobs running on the PC."
                  : `No ${filter} jobs.`}
            </Text>
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}
