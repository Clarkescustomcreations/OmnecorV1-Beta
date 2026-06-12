import {
  ScrollView, Text, View, TextInput, Pressable, Switch, Alert, ActivityIndicator
} from "react-native";
import { useState, useEffect, useCallback } from "react";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useColorScheme } from "@/hooks/use-color-scheme";
import {
  loadServerConfig, saveServerConfig, getServerIp,
  getOmmeshSecret, getNodeName,
} from "@/lib/_core/server-config";
import { trpcQuery, trpcMutate } from "@/lib/_core/trpc-fetch";
import {
  isModelLoaded, getLoadedModelPath, loadModel, releaseModel, RECOMMENDED_MODELS,
} from "@/lib/_core/local-inference";
import * as Auth from "@/lib/_core/auth";
import * as FileSystem from "expo-file-system";

export default function SettingsScreen() {
  const colors      = useColors();
  const colorScheme = useColorScheme();
  const [isDarkMode, setIsDarkMode] = useState(colorScheme === "dark");

  // ── Connection ──────────────────────────────────────────────────────────
  const [serverIp,   setServerIp]   = useState("");
  const [serverPort, setServerPort] = useState("3000");
  const [isTestingConn, setIsTestingConn] = useState(false);
  const [connStatus, setConnStatus] = useState<"unknown" | "ok" | "fail">("unknown");

  // ── OMMESH ──────────────────────────────────────────────────────────────
  const [ommeshEnabled, setOmmeshEnabled] = useState(false);
  const [ommeshSecret,  setOmmeshSecret]  = useState("");
  const [nodeName,      setNodeName]      = useState("My Phone");

  // ── Voice ────────────────────────────────────────────────────────────────
  const [sttEnabled, setSttEnabled] = useState(true);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [ttsRate,    setTtsRate]    = useState("1.0");

  // ── Local AI Model ───────────────────────────────────────────────────────
  const [modelLoaded,      setModelLoaded]      = useState(isModelLoaded());
  const [loadedModelPath,  setLoadedModelPath]  = useState(getLoadedModelPath());
  const [modelLoading,     setModelLoading]     = useState(false);
  const [selectedModelIdx, setSelectedModelIdx] = useState(0);

  // ── User ─────────────────────────────────────────────────────────────────
  const [executionMode, setExecutionMode] = useState<"sovereign" | "scrapper" | "big_spender">("scrapper");

  useEffect(() => {
    loadServerConfig().then(async () => {
      setServerIp(getServerIp());
      setOmmeshSecret(getOmmeshSecret());
      setNodeName(getNodeName());

      // Load execution mode from the PC if a server is configured and user is logged in
      try {
        const me = await trpcQuery<{ executionMode: string }>("auth.me");
        if (me?.executionMode) {
          setExecutionMode(me.executionMode as "sovereign" | "scrapper" | "big_spender");
        }
      } catch {
        // Not logged in or server offline — keep local default
      }
    });
  }, []);

  const handleSaveConnection = useCallback(async () => {
    await saveServerConfig({ ip: serverIp, port: serverPort, secret: ommeshSecret, nodeName });
    Alert.alert("Saved", "Connection settings saved.");
  }, [serverIp, serverPort, ommeshSecret, nodeName]);

  const handleTestConnection = useCallback(async () => {
    if (!serverIp.trim()) { Alert.alert("Error", "Enter a server IP first"); return; }
    setIsTestingConn(true);
    try {
      const url  = `http://${serverIp.trim()}:${serverPort}/health`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
      setConnStatus(resp.ok ? "ok" : "fail");
    } catch {
      setConnStatus("fail");
    } finally {
      setIsTestingConn(false);
    }
  }, [serverIp, serverPort]);

  const handleLoadModel = useCallback(async () => {
    const model    = RECOMMENDED_MODELS[selectedModelIdx];
    const modelDir = `${FileSystem.documentDirectory}models/`;
    const modelPath = `${modelDir}${model.filename}`;
    const info = await FileSystem.getInfoAsync(modelPath);
    if (!info.exists) {
      Alert.alert(
        "Model not found",
        `${model.filename} not found in the app Documents/models/ folder.\n\nDownload from Hugging Face and place it at:\n${modelPath}`,
      );
      return;
    }
    setModelLoading(true);
    try {
      await loadModel(modelPath);
      setModelLoaded(true);
      setLoadedModelPath(modelPath);
      Alert.alert("Model loaded", `${model.name} ready for on-device inference.`);
    } catch (err) {
      Alert.alert("Load failed", String(err));
    } finally {
      setModelLoading(false);
    }
  }, [selectedModelIdx]);

  const handleUnloadModel = useCallback(async () => {
    await releaseModel();
    setModelLoaded(false);
    setLoadedModelPath(null);
  }, []);

  const handleLogout = useCallback(async () => {
    await Auth.removeSessionToken();
    await Auth.clearUserInfo();
    Alert.alert("Logged out", "Session cleared.");
  }, []);

  return (
    <ScreenContainer className="flex-1 bg-background">
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} className="p-4" showsVerticalScrollIndicator={false}>
        <View className="gap-6">

          {/* ── Omnecor Server ──────────────────────────────────────────── */}
          <View>
            <Text className="text-lg font-bold text-foreground mb-1">Omnecor Server</Text>
            <Text className="text-xs text-muted mb-4">
              Enter your PC's Tailscale IP (100.x.x.x) for remote access, or LAN IP (192.168.x.x) for local Wi-Fi.
            </Text>
            <View className="mb-3">
              <Text className="text-sm font-semibold text-foreground mb-2">Server IP / Hostname</Text>
              <TextInput value={serverIp} onChangeText={setServerIp}
                placeholder="100.64.0.1  or  192.168.1.100"
                placeholderTextColor={colors.muted} keyboardType="url"
                autoCapitalize="none" autoCorrect={false}
                className="bg-surface border border-border rounded-lg px-3 py-2 text-foreground" />
            </View>
            <View className="mb-3">
              <Text className="text-sm font-semibold text-foreground mb-2">Port</Text>
              <TextInput value={serverPort} onChangeText={setServerPort}
                placeholder="3000" placeholderTextColor={colors.muted} keyboardType="number-pad"
                className="bg-surface border border-border rounded-lg px-3 py-2 text-foreground" />
            </View>
            {connStatus !== "unknown" && (
              <View className={`rounded-lg p-3 mb-3 ${connStatus === "ok" ? "bg-success/10 border border-success" : "bg-error/10 border border-error"}`}>
                <Text className={`text-sm font-semibold ${connStatus === "ok" ? "text-success" : "text-error"}`}>
                  {connStatus === "ok" ? "✓ Server reachable" : "✕ Cannot reach server"}
                </Text>
              </View>
            )}
            <View className="flex-row gap-2 mb-3">
              <Pressable onPress={handleTestConnection} disabled={isTestingConn}
                className="flex-1 bg-surface border border-border rounded-lg p-3 items-center active:opacity-80">
                {isTestingConn
                  ? <ActivityIndicator size="small" color={colors.primary} />
                  : <Text className="text-foreground font-semibold text-sm">Test</Text>
                }
              </Pressable>
              <Pressable onPress={handleSaveConnection}
                className="flex-1 bg-primary rounded-lg p-3 items-center active:opacity-80">
                <Text className="text-background font-semibold text-sm">Save</Text>
              </Pressable>
            </View>
            <View className="bg-surface border border-border rounded-lg p-3">
              <Text className="text-xs text-muted font-semibold mb-1">Tailscale Quick-Start</Text>
              <Text className="text-xs text-muted leading-5">
                1. PC: curl -fsSL https://tailscale.com/install.sh | sh{"\n"}
                2. Phone: Install Tailscale from Play Store{"\n"}
                3. Join same tailnet → both get 100.x.x.x IPs{"\n"}
                4. PC: tailscale ip  (copy that IP above){"\n"}
                5. Ports to allow: 3000 (server), 8001 (Whisper), 8002 (TTS)
              </Text>
            </View>
          </View>

          {/* ── OMMESH ──────────────────────────────────────────────────── */}
          <View>
            <Text className="text-lg font-bold text-foreground mb-1">OMMESH Network</Text>
            <Text className="text-xs text-muted mb-4">
              Register this phone as an AI compute node. The PC routes inference requests here,
              using your Snapdragon 8 Elite NPU as a local AI cloud — and vice versa.
            </Text>
            <View className="bg-surface border border-border rounded-lg p-4 flex-row justify-between items-center mb-3">
              <View className="flex-1 mr-3">
                <Text className="text-sm font-semibold text-foreground">Register as OMMESH Node</Text>
                <Text className="text-xs text-muted mt-1">Phone becomes a worker node in the mesh</Text>
              </View>
              <Switch value={ommeshEnabled} onValueChange={setOmmeshEnabled}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor={ommeshEnabled ? colors.background : colors.foreground} />
            </View>
            {ommeshEnabled && (
              <>
                <View className="mb-3">
                  <Text className="text-sm font-semibold text-foreground mb-2">Node Name</Text>
                  <TextInput value={nodeName} onChangeText={setNodeName}
                    placeholder="Galaxy S25 Ultra" placeholderTextColor={colors.muted}
                    className="bg-surface border border-border rounded-lg px-3 py-2 text-foreground" />
                </View>
                <View className="mb-3">
                  <Text className="text-sm font-semibold text-foreground mb-2">OMMESH Secret</Text>
                  <Text className="text-xs text-muted mb-2">Must match OMMESH_SECRET in OmnecorV1-Beta/.env</Text>
                  <TextInput value={ommeshSecret} onChangeText={setOmmeshSecret}
                    placeholder="Shared OMMESH secret" placeholderTextColor={colors.muted} secureTextEntry
                    className="bg-surface border border-border rounded-lg px-3 py-2 text-foreground" />
                </View>
                <Pressable onPress={handleSaveConnection}
                  className="bg-primary rounded-lg p-3 items-center active:opacity-80 mb-2">
                  <Text className="text-background font-semibold">Save & Connect</Text>
                </Pressable>
                <Text className="text-xs text-muted text-center">Connection status visible in the AI Node tab</Text>
              </>
            )}
          </View>

          {/* ── Voice ───────────────────────────────────────────────────── */}
          <View>
            <Text className="text-lg font-bold text-foreground mb-1">Voice</Text>
            <Text className="text-xs text-muted mb-4">
              STT sends audio to Whisper on your PC (port 8001). TTS uses your phone's speech engine — zero latency, works offline.
            </Text>
            <View className="bg-surface border border-border rounded-lg p-4 flex-row justify-between items-center mb-3">
              <View>
                <Text className="text-sm font-semibold text-foreground">Speech-to-Text (Whisper)</Text>
                <Text className="text-xs text-muted mt-1">🎤 button → records → PC Whisper → text</Text>
              </View>
              <Switch value={sttEnabled} onValueChange={setSttEnabled}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor={sttEnabled ? colors.background : colors.foreground} />
            </View>
            <View className="bg-surface border border-border rounded-lg p-4 flex-row justify-between items-center mb-3">
              <View>
                <Text className="text-sm font-semibold text-foreground">Text-to-Speech (Device)</Text>
                <Text className="text-xs text-muted mt-1">🔊 auto-reads AI replies · long-press any message</Text>
              </View>
              <Switch value={ttsEnabled} onValueChange={setTtsEnabled}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor={ttsEnabled ? colors.background : colors.foreground} />
            </View>
            {ttsEnabled && (
              <View>
                <Text className="text-sm font-semibold text-foreground mb-2">Reading Speed</Text>
                <View className="flex-row gap-2">
                  {["0.75", "1.0", "1.25", "1.5"].map((r) => (
                    <Pressable key={r} onPress={() => setTtsRate(r)}
                      className={`flex-1 rounded-lg p-2 items-center ${ttsRate === r ? "bg-primary" : "bg-surface border border-border"}`}>
                      <Text className={`text-xs font-semibold ${ttsRate === r ? "text-background" : "text-foreground"}`}>{r}×</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            )}
          </View>

          {/* ── Phone AI Model ───────────────────────────────────────────── */}
          <View>
            <Text className="text-lg font-bold text-foreground mb-1">Phone AI Model</Text>
            <Text className="text-xs text-muted mb-4">
              On-device GGUF inference via llama.rn — uses Snapdragon 8 Elite NPU/GPU.
              Place model files in: Documents/models/
            </Text>
            {RECOMMENDED_MODELS.map((model, idx) => (
              <Pressable key={model.filename} onPress={() => setSelectedModelIdx(idx)}
                className={`mb-2 rounded-lg p-3 border ${selectedModelIdx === idx ? "border-primary bg-primary/10" : "border-border bg-surface"}`}>
                <View className="flex-row justify-between items-start">
                  <View className="flex-1 mr-2">
                    <Text className={`text-sm font-semibold ${selectedModelIdx === idx ? "text-primary" : "text-foreground"}`}>
                      {model.name}{model.recommendedForPhone ? " ⭐" : ""}
                    </Text>
                    <Text className="text-xs text-muted mt-1">{model.description}</Text>
                  </View>
                  <Text className="text-xs text-muted">{model.sizeGb} GB</Text>
                </View>
              </Pressable>
            ))}
            {modelLoaded && loadedModelPath && (
              <View className="bg-success/10 border border-success rounded-lg p-3 mb-3">
                <Text className="text-xs text-success font-semibold">✓ Model loaded</Text>
                <Text className="text-xs text-muted mt-1">{loadedModelPath.split("/").pop()}</Text>
              </View>
            )}
            <View className="flex-row gap-2">
              <Pressable onPress={handleLoadModel} disabled={modelLoading}
                className="flex-1 bg-primary rounded-lg p-3 items-center active:opacity-80">
                {modelLoading
                  ? <ActivityIndicator size="small" color="white" />
                  : <Text className="text-background font-semibold text-sm">Load Selected Model</Text>
                }
              </Pressable>
              {modelLoaded && (
                <Pressable onPress={handleUnloadModel}
                  className="flex-1 bg-error/20 border border-error rounded-lg p-3 items-center active:opacity-80">
                  <Text className="text-error font-semibold text-sm">Unload</Text>
                </Pressable>
              )}
            </View>
          </View>

          {/* ── Execution Mode ───────────────────────────────────────────── */}
          <View>
            <Text className="text-lg font-bold text-foreground mb-3">Execution Mode</Text>
            <View className="flex-row gap-2 mb-2">
              {(["sovereign", "scrapper", "big_spender"] as const).map((mode) => (
                <Pressable key={mode} onPress={() => {
                  setExecutionMode(mode);
                  // Fire-and-forget sync to PC
                  (async () => {
                    try {
                      await trpcMutate("auth.setExecutionMode", { mode });
                    } catch {
                      Alert.alert("Sync failed", "Could not sync mode to server.");
                    }
                  })();
                }}
                  className={`flex-1 rounded-lg p-2 items-center ${executionMode === mode ? "bg-primary" : "bg-surface border border-border"}`}>
                  <Text className={`text-xs font-semibold capitalize ${executionMode === mode ? "text-background" : "text-foreground"}`}>{mode}</Text>
                </Pressable>
              ))}
            </View>
            <Text className="text-xs text-muted">sovereign = no cloud  ·  scrapper = default  ·  big_spender = higher limits</Text>
          </View>

          {/* ── Appearance ───────────────────────────────────────────────── */}
          <View>
            <Text className="text-lg font-bold text-foreground mb-4">Appearance</Text>
            <View className="bg-surface border border-border rounded-lg p-4 flex-row justify-between items-center">
              <Text className="text-sm font-semibold text-foreground">Dark Mode</Text>
              <Switch value={isDarkMode} onValueChange={setIsDarkMode}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor={isDarkMode ? colors.background : colors.foreground} />
            </View>
          </View>

          {/* ── About ────────────────────────────────────────────────────── */}
          <View>
            <Text className="text-lg font-bold text-foreground mb-4">About</Text>
            <View className="bg-surface border border-border rounded-lg p-4 gap-2">
              <Text className="text-xs text-muted">App</Text>
              <Text className="text-sm font-semibold text-foreground">Omnecor HQ v1.0.0</Text>
              <Text className="text-xs text-muted">Package</Text>
              <Text className="text-sm font-semibold text-foreground">com.omnecor.mobilehq</Text>
              <Text className="text-xs text-muted">OMMESH</Text>
              <Text className="text-sm font-semibold text-foreground">Phase 9 · Bidirectional AI routing</Text>
            </View>
          </View>

          <Pressable onPress={handleLogout}
            className="bg-error/20 border border-error rounded-lg p-3 items-center active:opacity-80">
            <Text className="text-error font-semibold">Logout</Text>
          </Pressable>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
