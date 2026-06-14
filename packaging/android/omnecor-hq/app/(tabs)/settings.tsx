import {
  ScrollView, Text, View, TextInput, Switch, Alert, ActivityIndicator
} from "react-native";
import { Pressable } from "@/components/pressable";
import { useState, useEffect, useCallback } from "react";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useColorScheme } from "@/hooks/use-color-scheme";
import {
  loadServerConfig, saveServerConfig, getServerIp,
  getOmmeshSecret, getNodeName, isServerConfigured,
} from "@/lib/_core/server-config";
import {
  CHAT_SOURCES, listIntegrations, connectIntegration,
  syncIntegration, disconnectIntegration, analyzeSource,
  type IntegrationStatus,
} from "@/lib/_core/integrations";
import { trpcQuery, trpcMutate } from "@/lib/_core/trpc-fetch";
import {
  isModelLoaded, getLoadedModelPath, loadModel, releaseModel, RECOMMENDED_MODELS,
} from "@/lib/_core/local-inference";
import {
  modelPath, isModelDownloaded, downloadModel, cancelDownload, deleteModel,
  importModelFromDevice, listLocalGguf,
  importTaskModelFromDevice, listLocalTask,
} from "@/lib/_core/model-download";
import {
  loadTaskModel, isMediapipeAvailable, getLoadedTaskPath,
} from "@/lib/_core/mediapipe-inference";
import * as Auth from "@/lib/_core/auth";

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

  // Per-model download state (keyed by filename)
  const [downloaded,   setDownloaded]   = useState<Record<string, boolean>>({});
  const [progress,     setProgress]     = useState<Record<string, number>>({});
  const [downloading,  setDownloading]  = useState<Record<string, boolean>>({});

  // Local GGUF models (imported from device)
  const [localGguf, setLocalGguf] = useState<{filename:string;path:string;sizeBytes:number}[]>([]);
  const [importing, setImporting] = useState(false);

  // LiteRT / MediaPipe .task models
  const [localTask, setLocalTask] = useState<{filename:string;path:string;sizeBytes:number}[]>([]);
  const [importingTask, setImportingTask] = useState(false);
  const [loadedTaskPath, setLoadedTaskPath] = useState<string | null>(getLoadedTaskPath());

  // ── User ─────────────────────────────────────────────────────────────────
  const [executionMode, setExecutionMode] = useState<"sovereign" | "scrapper" | "big_spender">("scrapper");

  // ── Connected Sources ────────────────────────────────────────────────────
  const [sources,      setSources]      = useState<IntegrationStatus[]>([]);
  const [tokenInputs,  setTokenInputs]  = useState<Record<string, string>>({});
  const [busySource,   setBusySource]   = useState<string | null>(null);
  const [analysis,     setAnalysis]     = useState<string | null>(null);

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

  const refreshSources = useCallback(async () => {
    try { setSources(await listIntegrations()); } catch {}
  }, []);

  useEffect(() => {
    if (isServerConfigured()) { refreshSources(); }
  }, [refreshSources]);

  const refreshDownloaded = useCallback(async () => {
    const results: Record<string, boolean> = {};
    await Promise.all(
      RECOMMENDED_MODELS.map(async (m) => {
        results[m.filename] = await isModelDownloaded(m.filename);
      })
    );
    setDownloaded(results);
  }, []);

  const refreshLocalGguf = useCallback(async () => {
    setLocalGguf(await listLocalGguf());
  }, []);

  const refreshLocalTask = useCallback(async () => {
    setLocalTask(await listLocalTask());
  }, []);

  useEffect(() => {
    refreshDownloaded();
    refreshLocalGguf();
    refreshLocalTask();
  }, [refreshDownloaded, refreshLocalGguf, refreshLocalTask]);

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

  const handleUnloadModel = useCallback(async () => {
    await releaseModel();
    setModelLoaded(false);
    setLoadedModelPath(null);
  }, []);

  const handleDownload = useCallback(async (model: typeof RECOMMENDED_MODELS[number]) => {
    setDownloading(d => ({ ...d, [model.filename]: true }));
    setProgress(p => ({ ...p, [model.filename]: 0 }));
    try {
      await downloadModel(model, (frac) => {
        setProgress(p => ({ ...p, [model.filename]: frac }));
      });
      setDownloaded(d => ({ ...d, [model.filename]: true }));
    } catch (e) {
      Alert.alert("Download failed", String(e));
    } finally {
      setDownloading(d => ({ ...d, [model.filename]: false }));
    }
  }, []);

  const handleDelete = useCallback(async (filename: string) => {
    try {
      await deleteModel(filename);
      setDownloaded(d => ({ ...d, [filename]: false }));
      setProgress(p => ({ ...p, [filename]: 0 }));
    } catch (e) {
      Alert.alert("Delete failed", String(e));
    }
  }, []);

  const handleLoadDownloaded = useCallback(async (filename: string, modelName: string) => {
    setModelLoading(true);
    try {
      const path = modelPath(filename);
      await loadModel(path);
      setModelLoaded(true);
      setLoadedModelPath(path);
      Alert.alert("Model loaded", `${modelName} ready for on-device inference.`);
    } catch (err) {
      Alert.alert("Load failed", String(err));
    } finally {
      setModelLoading(false);
    }
  }, []);

  const handleImport = useCallback(async () => {
    setImporting(true);
    try {
      const m = await importModelFromDevice();
      if (m) {
        await refreshLocalGguf();
      }
    } catch (err) {
      Alert.alert("Import failed", String(err));
    } finally {
      setImporting(false);
    }
  }, [refreshLocalGguf]);

  const handleImportTask = useCallback(async () => {
    setImportingTask(true);
    try {
      const m = await importTaskModelFromDevice();
      if (m) await refreshLocalTask();
    } catch (err) {
      Alert.alert("Import failed", String(err));
    } finally {
      setImportingTask(false);
    }
  }, [refreshLocalTask]);

  const handleLoadTask = useCallback(async (path: string) => {
    try {
      await loadTaskModel(path);
      setLoadedTaskPath(path);
      Alert.alert("Loaded", "MediaPipe model ready");
    } catch (err) {
      Alert.alert("Load failed", String(err));
    }
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
              Download a model directly to the phone or place files in: Documents/models/
            </Text>

            {modelLoaded && loadedModelPath && (
              <View className="bg-surface border border-border rounded-lg p-3 mb-3 flex-row justify-between items-center">
                <View className="flex-1 mr-2">
                  <Text className="text-xs text-success font-semibold">Model active</Text>
                  <Text className="text-xs text-muted mt-0.5">{loadedModelPath.split("/").pop()}</Text>
                </View>
                <Pressable onPress={handleUnloadModel}
                  className="bg-error/20 border border-error rounded-lg px-3 py-1.5 active:opacity-80">
                  <Text className="text-error font-semibold text-xs">Unload</Text>
                </Pressable>
              </View>
            )}

            {RECOMMENDED_MODELS.map((model, idx) => {
              const isDownloaded   = downloaded[model.filename] ?? false;
              const isDownloading  = downloading[model.filename] ?? false;
              const dlProgress     = progress[model.filename] ?? 0;
              const isSelected     = selectedModelIdx === idx;
              const isLoaded       = modelLoaded && loadedModelPath === modelPath(model.filename);

              return (
                <Pressable key={model.filename} onPress={() => setSelectedModelIdx(idx)}
                  className={`mb-3 rounded-lg p-3 border ${isSelected ? "border-primary bg-primary/10" : "border-border bg-surface"}`}>
                  {/* Header row */}
                  <View className="flex-row justify-between items-start mb-2">
                    <View className="flex-1 mr-2">
                      <Text className={`text-sm font-semibold ${isSelected ? "text-primary" : "text-foreground"}`}>
                        {model.name}{model.recommendedForPhone ? " ★" : ""}
                      </Text>
                      <Text className="text-xs text-muted mt-0.5">{model.description}</Text>
                    </View>
                    <Text className="text-xs text-muted">{model.sizeGb} GB</Text>
                  </View>

                  {/* State-driven action row */}
                  {isDownloading ? (
                    /* Downloading — show progress + cancel */
                    <View>
                      <View className="flex-row items-center justify-between mb-1.5">
                        <Text className="text-xs text-muted">
                          Downloading… {Math.round(dlProgress * 100)}%
                        </Text>
                        <Pressable
                          onPress={() => cancelDownload(model.filename)}
                          className="bg-error/20 border border-error rounded px-2 py-0.5 active:opacity-80">
                          <Text className="text-error text-xs font-semibold">Cancel</Text>
                        </Pressable>
                      </View>
                      {/* Progress bar */}
                      <View className="h-1.5 bg-border rounded-full overflow-hidden">
                        <View
                          className="h-full bg-primary rounded-full"
                          style={{ width: `${Math.round(dlProgress * 100)}%` }}
                        />
                      </View>
                    </View>
                  ) : isDownloaded ? (
                    /* Downloaded — show Load + Delete */
                    <View className="flex-row gap-2 mt-1">
                      <View className="flex-row items-center flex-1">
                        <Text className="text-xs text-success font-semibold">✓ Downloaded</Text>
                        {isLoaded && (
                          <Text className="text-xs text-primary font-semibold ml-2">· Loaded</Text>
                        )}
                      </View>
                      <Pressable
                        onPress={() => handleLoadDownloaded(model.filename, model.name)}
                        disabled={modelLoading && isSelected}
                        className="bg-primary rounded-lg px-3 py-1.5 items-center active:opacity-80">
                        {modelLoading && isSelected
                          ? <ActivityIndicator size="small" color="white" />
                          : <Text className="text-background font-semibold text-xs">Load</Text>
                        }
                      </Pressable>
                      <Pressable
                        onPress={() => handleDelete(model.filename)}
                        className="bg-error/20 border border-error rounded-lg px-3 py-1.5 items-center active:opacity-80">
                        <Text className="text-error font-semibold text-xs">Delete</Text>
                      </Pressable>
                    </View>
                  ) : (
                    /* Not downloaded — show Download button */
                    <Pressable
                      onPress={() => handleDownload(model)}
                      className="bg-surface border border-border rounded-lg p-2 items-center active:opacity-80 mt-1">
                      <Text className="text-foreground font-semibold text-xs">
                        Download ({model.sizeGb} GB)
                      </Text>
                    </Pressable>
                  )}
                </Pressable>
              );
            })}

            {/* Import from device button */}
            <Pressable
              onPress={handleImport}
              disabled={importing}
              className="bg-surface border border-border rounded-lg p-3 items-center active:opacity-80 mb-4">
              {importing
                ? <ActivityIndicator size="small" color={colors.primary} />
                : <Text className="text-foreground font-semibold text-sm">📂 Import a .gguf from this device</Text>
              }
            </Pressable>

            {/* Helper text */}
            <Text className="text-xs text-muted mb-4">
              Use a GGUF model already on your phone. (Google AI Edge Gallery .task/.litertlm models use a different engine and aren't loadable here.)
            </Text>

            {/* Detected local models */}
            {localGguf.length > 0 && (
              <>
                <Text className="text-sm font-semibold text-foreground mb-3">Detected on device</Text>
                {localGguf.map((item) => (
                  <View
                    key={item.path}
                    className="bg-surface border border-border rounded-lg p-3 mb-3 flex-row justify-between items-center">
                    <View className="flex-1 mr-2">
                      <Text className="text-xs font-semibold text-foreground">{item.filename}</Text>
                      <Text className="text-xs text-muted mt-0.5">{(item.sizeBytes / 1e9).toFixed(2)} GB</Text>
                    </View>
                    <Pressable
                      onPress={async () => {
                        setModelLoading(true);
                        try {
                          await loadModel(item.path);
                          setModelLoaded(true);
                          setLoadedModelPath(item.path);
                          Alert.alert("Model loaded", `${item.filename} ready for on-device inference.`);
                        } catch (err) {
                          Alert.alert("Load failed", String(err));
                        } finally {
                          setModelLoading(false);
                        }
                      }}
                      disabled={modelLoading}
                      className="bg-primary rounded-lg px-3 py-1.5 items-center active:opacity-80">
                      {modelLoading
                        ? <ActivityIndicator size="small" color="white" />
                        : <Text className="text-background font-semibold text-xs">Load</Text>
                      }
                    </Pressable>
                  </View>
                ))}
              </>
            )}

            {/* ── LiteRT models (.task) — Edge Gallery ─────────────────── */}
            <Text className="text-sm font-semibold text-foreground mt-2 mb-2">
              LiteRT models (.task) — Edge Gallery
            </Text>
            <Text className="text-xs text-muted mb-3">
              Import a .task model exported or shared from Google AI Edge Gallery. Runs on the on-device MediaPipe engine.
            </Text>

            {!isMediapipeAvailable() && (
              <View className="bg-surface border border-border rounded-lg p-3 mb-3">
                <Text className="text-xs text-warning">
                  MediaPipe engine not present in this build yet.
                </Text>
              </View>
            )}

            <Pressable
              onPress={handleImportTask}
              disabled={importingTask}
              className="bg-surface border border-border rounded-lg p-3 items-center active:opacity-80 mb-3">
              {importingTask
                ? <ActivityIndicator size="small" color={colors.primary} />
                : <Text className="text-foreground font-semibold text-sm">📂 Import a .task model</Text>
              }
            </Pressable>

            {localTask.map((item) => (
              <View
                key={item.path}
                className="bg-surface border border-border rounded-lg p-3 mb-3 flex-row justify-between items-center">
                <View className="flex-1 mr-2">
                  <Text className="text-xs font-semibold text-foreground">{item.filename}</Text>
                  <View className="flex-row items-center mt-0.5 gap-2">
                    <Text className="text-xs text-muted">{(item.sizeBytes / 1e9).toFixed(2)} GB</Text>
                    {loadedTaskPath === item.path && (
                      <Text className="text-xs text-primary font-semibold">✓ Loaded</Text>
                    )}
                  </View>
                </View>
                <Pressable
                  onPress={() => handleLoadTask(item.path)}
                  disabled={!isMediapipeAvailable()}
                  className="bg-primary rounded-lg px-3 py-1.5 items-center active:opacity-80"
                  style={!isMediapipeAvailable() ? { opacity: 0.4 } : undefined}>
                  <Text className="text-background font-semibold text-xs">Load</Text>
                </Pressable>
              </View>
            ))}
          </View>

          {/* ── Connected Sources ───────────────────────────────────────── */}
          <View>
            <Text className="text-lg font-bold text-foreground mb-1">Connected Sources</Text>
            <Text className="text-xs text-muted mb-4">
              Connect Gmail, Outlook, or GitHub so the assistant can analyze your mail and repos.
              Requires a PC connection.
            </Text>
            {!isServerConfigured() ? (
              <Text className="text-xs text-muted">
                Connect to your PC first (above) to manage sources.
              </Text>
            ) : (
              <>
                {CHAT_SOURCES.map((entry) => {
                  const status     = sources.find((s) => s.type === entry.type);
                  const connected  = status?.isConnected ?? false;
                  const username   = status?.metadata?.username as string | undefined;
                  const isBusy     = busySource === entry.type;
                  return (
                    <View key={entry.type} className="bg-surface border border-border rounded-lg p-4 mb-3">
                      {/* Header row: label + badge */}
                      <View className="flex-row justify-between items-center mb-2">
                        <Text className="text-sm font-semibold text-foreground">{entry.label}</Text>
                        <View className={`rounded-full px-2 py-0.5 ${connected ? "bg-success/20" : "bg-error/10"}`}>
                          <Text className={`text-xs font-semibold ${connected ? "text-success" : "text-error"}`}>
                            {connected ? "Connected" : "Disconnected"}
                          </Text>
                        </View>
                      </View>
                      {connected && username ? (
                        <Text className="text-xs text-muted mb-2">{username}</Text>
                      ) : null}

                      {!connected ? (
                        /* ── Connect flow ── */
                        <>
                          <TextInput
                            value={tokenInputs[entry.type] ?? ""}
                            onChangeText={(v) =>
                              setTokenInputs((prev) => ({ ...prev, [entry.type]: v }))
                            }
                            placeholder={entry.hint}
                            placeholderTextColor={colors.muted}
                            secureTextEntry
                            className="bg-background border border-border rounded-lg px-3 py-2 text-foreground mb-2"
                          />
                          <Pressable
                            disabled={isBusy}
                            onPress={async () => {
                              setBusySource(entry.type);
                              try {
                                await connectIntegration(entry.type, tokenInputs[entry.type] ?? "");
                                await refreshSources();
                              } catch (err) {
                                setAnalysis("⚠ " + String(err));
                              } finally {
                                setBusySource(null);
                              }
                            }}
                            className="bg-primary rounded-lg p-2 items-center active:opacity-80">
                            {isBusy
                              ? <ActivityIndicator size="small" color={colors.background} />
                              : <Text className="text-background font-semibold text-sm">Connect</Text>
                            }
                          </Pressable>
                        </>
                      ) : (
                        /* ── Connected actions ── */
                        <View className="flex-row gap-2">
                          <Pressable
                            disabled={isBusy}
                            onPress={async () => {
                              setBusySource(entry.type);
                              try {
                                await syncIntegration(entry.type);
                                await refreshSources();
                              } catch (err) {
                                setAnalysis("⚠ " + String(err));
                              } finally {
                                setBusySource(null);
                              }
                            }}
                            className="flex-1 bg-surface border border-border rounded-lg p-2 items-center active:opacity-80">
                            {isBusy
                              ? <ActivityIndicator size="small" color={colors.primary} />
                              : <Text className="text-foreground text-xs font-semibold">Sync</Text>
                            }
                          </Pressable>
                          <Pressable
                            disabled={isBusy}
                            onPress={async () => {
                              setBusySource(entry.type);
                              try {
                                const result = await analyzeSource(entry.type);
                                setAnalysis(result);
                              } catch (err) {
                                setAnalysis("⚠ " + String(err));
                              } finally {
                                setBusySource(null);
                              }
                            }}
                            className="flex-1 bg-primary rounded-lg p-2 items-center active:opacity-80">
                            {isBusy
                              ? <ActivityIndicator size="small" color={colors.background} />
                              : <Text className="text-background text-xs font-semibold">Analyze</Text>
                            }
                          </Pressable>
                          <Pressable
                            disabled={isBusy}
                            onPress={async () => {
                              setBusySource(entry.type);
                              try {
                                await disconnectIntegration(entry.type);
                                await refreshSources();
                              } catch (err) {
                                setAnalysis("⚠ " + String(err));
                              } finally {
                                setBusySource(null);
                              }
                            }}
                            className="flex-1 bg-error/20 border border-error rounded-lg p-2 items-center active:opacity-80">
                            {isBusy
                              ? <ActivityIndicator size="small" color={colors.error} />
                              : <Text className="text-error text-xs font-semibold">Disconnect</Text>
                            }
                          </Pressable>
                        </View>
                      )}
                    </View>
                  );
                })}

                {/* Analysis result card */}
                {analysis !== null && (
                  <View className="bg-surface border border-border rounded-lg p-4 mb-2">
                    <View className="flex-row justify-between items-center mb-2">
                      <Text className="text-xs font-semibold text-muted">Analysis</Text>
                      <Pressable onPress={() => setAnalysis(null)} className="p-1 active:opacity-60">
                        <Text className="text-xs text-muted">✕</Text>
                      </Pressable>
                    </View>
                    <Text className="text-sm text-foreground leading-5">{analysis}</Text>
                  </View>
                )}

                {/* Global busy spinner while an async action runs */}
                {busySource !== null && (
                  <ActivityIndicator size="small" color={colors.primary} className="mt-1 mb-2" />
                )}
              </>
            )}
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
