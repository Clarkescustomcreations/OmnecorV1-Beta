/**
 * Phone AI Node — OMMESH bidirectional compute screen.
 *
 * Lets the phone act as an AI worker node in the OMMESH network.
 * When connected, the PC can send inference requests here, and the phone's
 * Snapdragon 8 Elite NPU processes them — turning an idle phone into a
 * local AI cloud for an older/weaker PC.
 *
 * Also supports the reverse: phone uses the PC's models when available.
 */
import { Text, View, Pressable, ScrollView, ActivityIndicator, TextInput } from "react-native";
import { useState, useCallback, useEffect } from "react";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useOmmeshNode } from "@/hooks/use-ommesh-node";
import {
  isModelLoaded, getLoadedModelPath, getStatus as getInferenceStatus,
  subscribeStatus, getStats, RECOMMENDED_MODELS,
} from "@/lib/_core/local-inference";
import { isServerConfigured } from "@/lib/_core/server-config";

const STATUS_COLOR: Record<string, string> = {
  disconnected: "text-muted",
  connecting:   "text-warning",
  connected:    "text-primary",
  registered:   "text-success",
  error:        "text-error",
};

const STATUS_BG: Record<string, string> = {
  disconnected: "bg-muted/10 border-muted/30",
  connecting:   "bg-warning/10 border-warning",
  connected:    "bg-primary/10 border-primary",
  registered:   "bg-success/10 border-success",
  error:        "bg-error/10 border-error",
};

const STATUS_LABEL: Record<string, string> = {
  disconnected: "Disconnected",
  connecting:   "Connecting…",
  connected:    "Connected — registering…",
  registered:   "Registered as OMMESH Node",
  error:        "Connection Error",
};

export default function AiNodeScreen() {
  const colors = useColors();
  const { status, nodeId, stats, isRegistered, connect, disconnect } = useOmmeshNode();

  const [inferenceStatus, setInferenceStatus] = useState(getInferenceStatus());
  const [modelLoaded,     setModelLoaded]     = useState(isModelLoaded());
  const [modelPath,       setModelPath]       = useState(getLoadedModelPath());

  // Test inference input
  const [testPrompt,  setTestPrompt]  = useState("Tell me a one-sentence joke.");
  const [testResult,  setTestResult]  = useState("");
  const [testRunning, setTestRunning] = useState(false);

  useEffect(() => {
    const unsub = subscribeStatus((s) => {
      setInferenceStatus(s);
      setModelLoaded(isModelLoaded());
      setModelPath(getLoadedModelPath());
    });
    return unsub;
  }, []);

  const handleTestInference = useCallback(async () => {
    if (!modelLoaded || testRunning) return;
    setTestRunning(true);
    setTestResult("");
    try {
      const { runInference } = await import("@/lib/_core/local-inference");
      let out = "";
      await runInference(testPrompt, {
        maxTokens: 100,
        onToken: (t) => {
          out += t;
          setTestResult(out);
        },
      });
    } catch (err) {
      setTestResult("Error: " + String(err));
    } finally {
      setTestRunning(false);
    }
  }, [modelLoaded, testPrompt, testRunning]);

  return (
    <ScreenContainer className="flex-1 bg-background">
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} className="p-4" showsVerticalScrollIndicator={false}>
        <View className="gap-5">

          {/* ── Node Status Card ──────────────────────────────────────── */}
          <View className={`rounded-xl border p-4 ${STATUS_BG[status] ?? "bg-muted/10 border-muted/30"}`}>
            <View className="flex-row justify-between items-start">
              <View className="flex-1">
                <Text className={`text-base font-bold ${STATUS_COLOR[status] ?? "text-muted"}`}>
                  {STATUS_LABEL[status] ?? status}
                </Text>
                <Text className="text-xs text-muted mt-1">Node ID: {nodeId}</Text>
              </View>
              {status === "connecting" && <ActivityIndicator size="small" color={colors.primary} />}
            </View>

            {!isServerConfigured() && (
              <View className="mt-3 bg-warning/10 border border-warning rounded-lg p-2">
                <Text className="text-xs text-warning">No server configured. Go to Settings → Omnecor Server.</Text>
              </View>
            )}
          </View>

          {/* ── Connect / Disconnect ─────────────────────────────────── */}
          <View className="flex-row gap-3">
            <Pressable onPress={connect}
              disabled={status === "connected" || status === "registered" || status === "connecting" || !isServerConfigured()}
              className={`flex-1 rounded-lg p-3 items-center ${
                status === "registered" || status === "connected" || !isServerConfigured()
                  ? "bg-primary/30" : "bg-primary active:opacity-80"
              }`}>
              <Text className="text-background font-semibold text-sm">
                {status === "connecting" ? "Connecting…" : "Connect to Mesh"}
              </Text>
            </Pressable>
            <Pressable onPress={disconnect}
              disabled={status === "disconnected"}
              className={`flex-1 rounded-lg p-3 items-center border ${status === "disconnected" ? "border-muted/30 bg-surface" : "border-error bg-error/20 active:opacity-80"}`}>
              <Text className={`font-semibold text-sm ${status === "disconnected" ? "text-muted" : "text-error"}`}>
                Disconnect
              </Text>
            </Pressable>
          </View>

          {/* ── Inference Stats ───────────────────────────────────────── */}
          <View>
            <Text className="text-base font-bold text-foreground mb-3">Inference Stats</Text>
            <View className="flex-row gap-3">
              <View className="flex-1 bg-surface border border-border rounded-lg p-3 items-center">
                <Text className="text-2xl font-bold text-primary">{stats.totalRequests}</Text>
                <Text className="text-xs text-muted mt-1">Requests</Text>
              </View>
              <View className="flex-1 bg-surface border border-border rounded-lg p-3 items-center">
                <Text className="text-2xl font-bold text-primary">{stats.totalTokens}</Text>
                <Text className="text-xs text-muted mt-1">Tokens</Text>
              </View>
              <View className="flex-1 bg-surface border border-border rounded-lg p-3 items-center">
                <Text className="text-2xl font-bold text-primary">{stats.tokensPerSec}</Text>
                <Text className="text-xs text-muted mt-1">tok/s</Text>
              </View>
            </View>
          </View>

          {/* ── Model Status ─────────────────────────────────────────── */}
          <View>
            <Text className="text-base font-bold text-foreground mb-3">On-Device Model</Text>
            {modelLoaded ? (
              <View className="bg-success/10 border border-success rounded-lg p-3">
                <Text className="text-sm font-semibold text-success">✓ Model loaded</Text>
                <Text className="text-xs text-muted mt-1">{modelPath?.split("/").pop()}</Text>
                <Text className="text-xs text-muted mt-1">
                  Inference: {inferenceStatus === "running" ? "⚡ Running…" : inferenceStatus === "ready" ? "✓ Ready" : inferenceStatus}
                </Text>
              </View>
            ) : (
              <View className="bg-warning/10 border border-warning rounded-lg p-3">
                <Text className="text-sm font-semibold text-warning">⚠ No model loaded</Text>
                <Text className="text-xs text-muted mt-1">
                  Load a GGUF model in Settings → Phone AI Model to enable on-device inference.
                </Text>
              </View>
            )}
          </View>

          {/* ── Phone Capabilities ───────────────────────────────────── */}
          <View>
            <Text className="text-base font-bold text-foreground mb-3">Phone Capabilities</Text>
            <View className="bg-surface border border-border rounded-lg p-4 gap-2">
              {[
                ["Chipset",  "Snapdragon 8 Elite"],
                ["NPU",      "Hexagon NPU — 45 TOPS"],
                ["Backend",  "Vulkan / NNAPI (llama.rn)"],
                ["Max Model","~7B Q4 (≈ 5 GB VRAM)"],
                ["Role",     "OMMESH worker node"],
              ].map(([label, value]) => (
                <View key={label} className="flex-row justify-between">
                  <Text className="text-xs text-muted">{label}</Text>
                  <Text className="text-xs text-foreground font-semibold">{value}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* ── Test Inference ───────────────────────────────────────── */}
          {modelLoaded && (
            <View>
              <Text className="text-base font-bold text-foreground mb-3">Test On-Device Inference</Text>
              <TextInput value={testPrompt} onChangeText={setTestPrompt} multiline
                placeholder="Enter a test prompt…" placeholderTextColor={colors.muted}
                className="bg-surface border border-border rounded-lg px-3 py-2 text-foreground text-sm mb-3" />
              <Pressable onPress={handleTestInference} disabled={testRunning}
                className={`rounded-lg p-3 items-center ${testRunning ? "bg-primary/50" : "bg-primary active:opacity-80"}`}>
                {testRunning
                  ? <ActivityIndicator size="small" color="white" />
                  : <Text className="text-background font-semibold">Run Test</Text>
                }
              </Pressable>
              {testResult !== "" && (
                <View className="bg-surface border border-border rounded-lg p-3 mt-3">
                  <Text className="text-xs text-muted mb-1">Model output:</Text>
                  <Text className="text-sm text-foreground">{testResult}</Text>
                </View>
              )}
            </View>
          )}

          {/* ── OMMESH Architecture Note ─────────────────────────────── */}
          <View className="bg-surface border border-border rounded-lg p-4">
            <Text className="text-sm font-semibold text-foreground mb-2">How bidirectional OMMESH works</Text>
            <Text className="text-xs text-muted leading-5">
              {"→ Phone → PC: Tap Connect. Phone registers as a worker node over WebSocket.\n"}
              {"→ PC's RoutingEngine sees the phone as a mesh peer with NPU capabilities.\n"}
              {"→ When the PC needs inference, it routes to the phone (fast NPU) instead of local CPU.\n"}
              {"→ Reverse: when phone needs heavy AI (vision, large context), it routes to PC.\n"}
              {"→ Over Tailscale: works from anywhere, not just same Wi-Fi.\n\n"}
              {"PC-side: add mobile_node_register handler to\n"}
              {"OmnecorV1-Beta/server/phase2/websocket/WebSocketServer.ts"}
            </Text>
          </View>

        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
