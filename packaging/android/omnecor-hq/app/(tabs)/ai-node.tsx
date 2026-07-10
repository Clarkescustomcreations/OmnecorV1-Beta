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
import { Text, View, ScrollView, ActivityIndicator, TextInput } from "react-native";
import { Pressable } from "@/components/pressable";
import { useState, useCallback, useEffect } from "react";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useBottomInset } from "@/hooks/use-bottom-inset";
import { useOmmeshNode } from "@/hooks/use-ommesh-node";
import {
  getPhoneModelStatus, subscribePhoneModel, type PhoneModelStatus,
} from "@/lib/_core/phone-model";
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
  const bottomInset = useBottomInset();
  const { status, nodeId, stats, connect, disconnect } = useOmmeshNode();

  // Resident phone model — the SAME truth the Chat picker and Settings show
  // (either engine), including the backend that actually engaged.
  const [phoneModel, setPhoneModel] = useState<PhoneModelStatus>(getPhoneModelStatus());
  useEffect(() => subscribePhoneModel(setPhoneModel), []);
  const modelLoaded = phoneModel.state === "ready" || phoneModel.state === "running";

  // Test inference input
  const [testPrompt,  setTestPrompt]  = useState("Tell me a one-sentence joke.");
  const [testResult,  setTestResult]  = useState("");
  const [testRunning, setTestRunning] = useState(false);

  const handleTestInference = useCallback(async () => {
    if (!modelLoaded || testRunning) return;
    setTestRunning(true);
    setTestResult("");
    try {
      if (phoneModel.engine === "gguf") {
        const { runInference } = await import("@/lib/_core/local-inference");
        let out = "";
        await runInference(testPrompt, {
          maxTokens: 100,
          onToken: (t) => {
            out += t;
            setTestResult(out);
          },
        });
      } else {
        const { generateTask } = await import("@/lib/_core/mediapipe-inference");
        await generateTask(testPrompt, (partial) => setTestResult(partial));
      }
    } catch (err) {
      setTestResult("Error: " + String(err));
    } finally {
      setTestRunning(false);
    }
  }, [modelLoaded, phoneModel.engine, testPrompt, testRunning]);

  return (
    <ScreenContainer className="flex-1 bg-background">
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingBottom: bottomInset }} className="p-4" showsVerticalScrollIndicator={false}>
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
            <Pressable testID="btn-connect-mesh" onPress={connect}
              disabled={status === "connected" || status === "registered" || status === "connecting" || !isServerConfigured()}
              className={`flex-1 rounded-lg p-3 items-center ${
                status === "registered" || status === "connected" || !isServerConfigured()
                  ? "bg-primary/30" : "bg-primary active:opacity-80"
              }`}>
              <Text className="text-background font-semibold text-sm">
                {status === "connecting" ? "Connecting…" : "Connect to Mesh"}
              </Text>
            </Pressable>
            <Pressable testID="btn-disconnect-mesh" onPress={disconnect}
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
                <View className="flex-row items-center gap-2">
                  <Text className="text-sm font-semibold text-success">✓ Model loaded</Text>
                  {phoneModel.backend && (
                    <View className={`rounded-full px-2 py-0.5 ${phoneModel.backend === "npu" ? "bg-primary/20" : "bg-muted/20"}`}>
                      <Text className={`text-xs font-semibold ${phoneModel.backend === "npu" ? "text-primary" : "text-foreground"}`}>
                        {phoneModel.backend === "npu" ? "⚡ NPU" : phoneModel.backend.toUpperCase()}
                      </Text>
                    </View>
                  )}
                  <Text className="text-xs text-muted">{phoneModel.engine === "gguf" ? "GGUF" : "LiteRT"}</Text>
                </View>
                <Text className="text-xs text-muted mt-1">{phoneModel.filename}</Text>
                {phoneModel.devices.length > 0 && (
                  <Text className="text-xs text-muted mt-1">devices: {phoneModel.devices.join(", ")}</Text>
                )}
                <Text className="text-xs text-muted mt-1">
                  Inference: {phoneModel.state === "running" ? "⚡ Running…" : "✓ Ready"}
                </Text>
              </View>
            ) : phoneModel.state === "loading" ? (
              <View className="bg-primary/10 border border-primary rounded-lg p-3">
                <Text className="text-sm font-semibold text-primary">Loading {phoneModel.filename}…</Text>
              </View>
            ) : (
              <View className="bg-warning/10 border border-warning rounded-lg p-3">
                <Text className="text-sm font-semibold text-warning">⚠ No model loaded</Text>
                <Text className="text-xs text-muted mt-1">
                  Pick a phone model in the Chat model selector to load one (download in Settings → Phone AI Model).
                </Text>
                {phoneModel.state === "error" && phoneModel.error ? (
                  <Text className="text-xs text-error mt-1">{phoneModel.error}</Text>
                ) : null}
              </View>
            )}
          </View>

          {/* ── Phone Capabilities ───────────────────────────────────── */}
          <View>
            <Text className="text-base font-bold text-foreground mb-3">Phone Capabilities</Text>
            <View className="bg-surface border border-border rounded-lg p-4 gap-2">
              {[
                ["Chipset",  "Snapdragon 8 Elite"],
                ["NPU",      "Hexagon HTP (ggml-hexagon via llama.rn)"],
                ["Backend",  phoneModel.backend
                  ? `${phoneModel.backend.toUpperCase()}${phoneModel.devices.length ? ` (${phoneModel.devices.join(", ")})` : ""}`
                  : "— load a model to see the live backend"],
                ["NPU quants", "Q4_0 · IQ4_NL · Q8_0 · MXFP4"],
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
              <TextInput testID="input-test-prompt" value={testPrompt} onChangeText={setTestPrompt} multiline
                placeholder="Enter a test prompt…" placeholderTextColor={colors.muted}
                className="bg-surface border border-border rounded-lg px-3 py-2 text-foreground text-sm mb-3" />
              <Pressable testID="btn-run-test-inference" onPress={handleTestInference} disabled={testRunning}
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
              {"OmnecorV1-Beta/server/core_services/websocket/WebSocketServer.ts"}
            </Text>
          </View>

        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
