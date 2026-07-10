import {
  ScrollView, Text, View, TextInput, Switch, Alert, ActivityIndicator
} from "react-native";
import { Pressable } from "@/components/pressable";
import { useState, useEffect, useCallback } from "react";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useBottomInset } from "@/hooks/use-bottom-inset";
import { useThemeContext } from "@/lib/theme-provider";
import {
  loadServerConfig, saveServerConfig, getServerIp,
  getOmmeshSecret, getNodeName, isServerConfigured,
  isOmmeshEnabled, setOmmeshEnabled as persistOmmeshEnabled,
} from "@/lib/_core/server-config";
import { connect as meshConnect, disconnect as meshDisconnect } from "@/lib/_core/mobile-mesh-node";
import {
  CHAT_SOURCES, listIntegrations, connectIntegration,
  syncIntegration, disconnectIntegration, analyzeSource,
  type IntegrationStatus,
} from "@/lib/_core/integrations";
import { trpcQuery, trpcMutate } from "@/lib/_core/trpc-fetch";
import {
  GGUF_CATALOG, LITERT_CATALOG, pickVariant, variantToModelInfo,
  isNpuCapableFile, type CatalogModel, type ModelVariant,
} from "@/lib/_core/model-catalog";
import {
  modelPath, getModelFileState, type ModelFileState,
  downloadModel, cancelDownload, deleteModel,
  importModelFromDevice, listLocalGguf,
  importTaskModelFromDevice, listLocalTask,
  pickTaskModelFolder, getSavedTaskFolder, clearTaskFolder,
  scanFolderForTaskModels, importTaskModelFromFolder, type FolderTaskModel,
} from "@/lib/_core/model-download";
import { isMediapipeAvailable } from "@/lib/_core/mediapipe-inference";
import { getAccelMode, setAccelMode, type AccelMode } from "@/lib/_core/acceleration";
import {
  getPhoneModelStatus, subscribePhoneModel, unloadPhoneModel,
  type PhoneModelStatus,
} from "@/lib/_core/phone-model";
import * as Auth from "@/lib/_core/auth";
import { AlwaysListenSettings } from "@/components/always-listen-settings";
import { useChatDisplaySettings } from "@/hooks/use-chat-display-settings";
import * as Speech from "expo-speech";
import AsyncStorage from "@react-native-async-storage/async-storage";

const CHAT_TTS_VOICE_KEY = "omnecor_chat_tts_voice_id";

export default function SettingsScreen() {
  const colors      = useColors();
  const bottomInset = useBottomInset();
  const { colorScheme, setColorScheme } = useThemeContext();
  const isDarkMode = colorScheme === "dark";
  const { settings: chatDisplaySettings, updateSettings: updateChatDisplaySettings } = useChatDisplaySettings();

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
  // Device TTS voice for chat replies (persisted; separate from always-listen voice)
  const [chatTtsVoiceId,  setChatTtsVoiceId]  = useState("");
  const [deviceVoices,    setDeviceVoices]    = useState<Speech.Voice[]>([]);
  const [loadingVoices,   setLoadingVoices]   = useState(false);

  // ── Local AI Model ───────────────────────────────────────────────────────
  // The resident phone model — single subscribable truth (either engine).
  const [phoneStatus, setPhoneStatus] = useState<PhoneModelStatus>(getPhoneModelStatus());
  // App-wide acceleration mode (Auto default; NPU/GPU/CPU manual overrides).
  const [accelMode, setAccelModeState] = useState<AccelMode>("auto");

  // Per-file download state (keyed by filename — covers every variant)
  const [downloaded,   setDownloaded]   = useState<Record<string, ModelFileState>>({});
  const [progress,     setProgress]     = useState<Record<string, number>>({});
  const [downloading,  setDownloading]  = useState<Record<string, boolean>>({});

  // Local GGUF models (imported from device)
  const [localGguf, setLocalGguf] = useState<{filename:string;path:string;sizeBytes:number}[]>([]);
  const [importing, setImporting] = useState(false);

  // LiteRT-LM (.litertlm) models
  const [localTask, setLocalTask] = useState<{filename:string;path:string;sizeBytes:number}[]>([]);
  const [importingTask, setImportingTask] = useState(false);
  // Device folder (SAF) discovery
  const [taskFolder, setTaskFolder] = useState<string | null>(null);
  const [folderTaskModels, setFolderTaskModels] = useState<FolderTaskModel[]>([]);
  const [scanningFolder, setScanningFolder] = useState(false);
  const [busyTaskFile, setBusyTaskFile] = useState<string | null>(null);

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
      setOmmeshEnabled(isOmmeshEnabled());

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

  // File state for EVERY catalog variant (both engines) — variants share the
  // filename keyspace so one map serves the whole section.
  const refreshDownloaded = useCallback(async () => {
    const results: Record<string, ModelFileState> = {};
    const variants: { model: CatalogModel; variant: ModelVariant }[] = [];
    for (const m of [...GGUF_CATALOG, ...LITERT_CATALOG]) {
      for (const v of m.variants) variants.push({ model: m, variant: v });
    }
    await Promise.all(
      variants.map(async ({ model, variant }) => {
        results[variant.filename] = await getModelFileState(variantToModelInfo(model, variant));
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

  /** Load the remembered device folder (if any) and list its LiteRT-LM models. */
  const refreshTaskFolder = useCallback(async () => {
    const dir = await getSavedTaskFolder();
    setTaskFolder(dir);
    if (!dir) { setFolderTaskModels([]); return; }
    setScanningFolder(true);
    try {
      setFolderTaskModels(await scanFolderForTaskModels(dir));
    } catch {
      // Permission revoked or folder gone — forget it so the UI re-prompts.
      await clearTaskFolder();
      setTaskFolder(null);
      setFolderTaskModels([]);
    } finally {
      setScanningFolder(false);
    }
  }, []);

  useEffect(() => {
    refreshDownloaded();
    refreshLocalGguf();
    refreshLocalTask();
    refreshTaskFolder();
    getAccelMode().then(setAccelModeState);
    // Live resident-model status (loads happen in the Chat model picker).
    const unsub = subscribePhoneModel(setPhoneStatus);
    // Load persisted chat TTS voice preference.
    AsyncStorage.getItem(CHAT_TTS_VOICE_KEY).then((v) => {
      if (v) setChatTtsVoiceId(v);
    }).catch(() => {});
    // Load available device TTS voices.
    setLoadingVoices(true);
    Speech.getAvailableVoicesAsync()
      .then((voices) => {
        const sorted = [...voices]
          .filter((v) => v.language?.startsWith("en") ?? true)
          .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
        setDeviceVoices(sorted);
      })
      .catch(() => {})
      .finally(() => setLoadingVoices(false));
    return unsub;
  }, [refreshDownloaded, refreshLocalGguf, refreshLocalTask, refreshTaskFolder]);

  const handleSaveConnection = useCallback(async () => {
    await saveServerConfig({ ip: serverIp, port: serverPort, secret: ommeshSecret, nodeName });
    // "Save & Connect" must actually (re)connect: drop any socket bound to the
    // old host/secret, then register against the freshly saved config.
    if (ommeshEnabled && isServerConfigured()) {
      meshDisconnect();
      meshConnect();
      Alert.alert("Saved", "Connection settings saved — joining the mesh. Status is in the AI Node tab.");
    } else {
      Alert.alert("Saved", "Connection settings saved.");
    }
  }, [serverIp, serverPort, ommeshSecret, nodeName, ommeshEnabled]);

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
    await unloadPhoneModel();
  }, []);

  const handleChangeAccel = useCallback(async (mode: AccelMode) => {
    setAccelModeState(mode);
    await setAccelMode(mode);
  }, []);

  // Download one catalog variant (GGUF or .litertlm — same flow).
  const handleDownloadVariant = useCallback(async (model: CatalogModel, variant: ModelVariant) => {
    const spec = variantToModelInfo(model, variant);
    setDownloading(d => ({ ...d, [variant.filename]: true }));
    setProgress(p => ({ ...p, [variant.filename]: 0 }));
    try {
      // Clear any leftover partial from an earlier interrupted attempt so we
      // start clean (a resumed/appended file can corrupt the model file).
      await deleteModel(variant.filename).catch(() => { /* nothing to clear */ });
      await downloadModel(spec, (frac) => {
        setProgress(p => ({ ...p, [variant.filename]: frac }));
      });
      setDownloaded(d => ({ ...d, [variant.filename]: "complete" }));
      if (model.engine === "litert") await refreshLocalTask();
      else await refreshLocalGguf();
    } catch (e) {
      // A failed/cancelled download may leave a partial — reflect real state.
      const state = await getModelFileState(spec);
      setDownloaded(d => ({ ...d, [variant.filename]: state }));
      Alert.alert("Download failed", String(e));
    } finally {
      setDownloading(d => ({ ...d, [variant.filename]: false }));
    }
  }, [refreshLocalGguf, refreshLocalTask]);

  const handleDelete = useCallback(async (filename: string) => {
    try {
      // Deleting the resident model's file would leave a loaded context over a
      // gone file — unload first so status stays truthful.
      if (phoneStatus.path === modelPath(filename)) await unloadPhoneModel();
      await deleteModel(filename);
      setDownloaded(d => ({ ...d, [filename]: "missing" }));
      setProgress(p => ({ ...p, [filename]: 0 }));
      await refreshLocalGguf();
      await refreshLocalTask();
    } catch (e) {
      Alert.alert("Delete failed", String(e));
    }
  }, [phoneStatus.path, refreshLocalGguf, refreshLocalTask]);

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

  // Grant / change the device folder that holds the user's LiteRT-LM models.
  const handlePickTaskFolder = useCallback(async () => {
    try {
      const dir = await pickTaskModelFolder();
      if (!dir) return;
      setTaskFolder(dir);
      setScanningFolder(true);
      setFolderTaskModels(await scanFolderForTaskModels(dir));
    } catch (err) {
      Alert.alert("Folder scan failed", String(err));
    } finally {
      setScanningFolder(false);
    }
  }, []);

  // Copy a folder-discovered model into the app so it appears in the Chat
  // model picker (loading happens there — selection is the lifecycle verb).
  const handleImportFromFolder = useCallback(async (m: FolderTaskModel) => {
    setBusyTaskFile(m.filename);
    try {
      await importTaskModelFromFolder(m);
      await refreshLocalTask();
      Alert.alert("Imported", `${m.filename} is now available in the Chat model picker.`);
    } catch (err) {
      Alert.alert("Import failed", String(err));
    } finally {
      setBusyTaskFile(null);
    }
  }, [refreshLocalTask]);

  const handleLogout = useCallback(async () => {
    await Auth.removeSessionToken();
    await Auth.clearUserInfo();
    Alert.alert("Logged out", "Session cleared.");
  }, []);

  const handleChangeChatTtsVoice = useCallback(async (id: string) => {
    setChatTtsVoiceId(id);
    await AsyncStorage.setItem(CHAT_TTS_VOICE_KEY, id);
  }, []);

  return (
    <ScreenContainer className="flex-1 bg-background">
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingBottom: bottomInset }} className="p-4" showsVerticalScrollIndicator={false}>
        <View className="gap-6">

          {/* ── Omnecor Server ──────────────────────────────────────────── */}
          <View>
            <Text className="text-lg font-bold text-foreground mb-1">Omnecor Server</Text>
            <Text className="text-xs text-muted mb-4">
              Enter your PC&apos;s Tailscale IP (100.x.x.x) for remote access, or LAN IP (192.168.x.x) for local Wi-Fi.
            </Text>
            <View className="mb-3">
              <Text className="text-sm font-semibold text-foreground mb-2">Server IP / Hostname</Text>
              <TextInput testID="input-server-ip" value={serverIp} onChangeText={setServerIp}
                placeholder="100.64.0.1  or  192.168.1.100"
                placeholderTextColor={colors.muted} keyboardType="url"
                autoCapitalize="none" autoCorrect={false}
                className="bg-surface border border-border rounded-lg px-3 py-2 text-foreground" />
            </View>
            <View className="mb-3">
              <Text className="text-sm font-semibold text-foreground mb-2">Port</Text>
              <TextInput testID="input-server-port" value={serverPort} onChangeText={setServerPort}
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
              <Pressable testID="btn-test-connection" onPress={handleTestConnection} disabled={isTestingConn}
                className="flex-1 bg-surface border border-border rounded-lg p-3 items-center active:opacity-80">
                {isTestingConn
                  ? <ActivityIndicator size="small" color={colors.primary} />
                  : <Text className="text-foreground font-semibold text-sm">Test</Text>
                }
              </Pressable>
              <Pressable testID="btn-save-connection" onPress={handleSaveConnection}
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
              <Switch testID="toggle-register-ommesh-node" value={ommeshEnabled} onValueChange={(v) => {
                  setOmmeshEnabled(v);
                  void persistOmmeshEnabled(v);
                  if (!v) meshDisconnect();
                  else if (isServerConfigured() && getOmmeshSecret()) meshConnect();
                }}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor={ommeshEnabled ? colors.background : colors.foreground} />
            </View>
            {ommeshEnabled && (
              <>
                <View className="mb-3">
                  <Text className="text-sm font-semibold text-foreground mb-2">Node Name</Text>
                  <TextInput testID="input-ommesh-node-name" value={nodeName} onChangeText={setNodeName}
                    placeholder="Galaxy S25 Ultra" placeholderTextColor={colors.muted}
                    className="bg-surface border border-border rounded-lg px-3 py-2 text-foreground" />
                </View>
                <View className="mb-3">
                  <Text className="text-sm font-semibold text-foreground mb-2">OMMESH Secret</Text>
                  <Text className="text-xs text-muted mb-2">Must match OMMESH_SECRET in OmnecorV1-Beta/.env</Text>
                  <TextInput testID="input-ommesh-secret" value={ommeshSecret} onChangeText={setOmmeshSecret}
                    placeholder="Shared OMMESH secret" placeholderTextColor={colors.muted} secureTextEntry
                    className="bg-surface border border-border rounded-lg px-3 py-2 text-foreground" />
                </View>
                <Pressable testID="btn-ommesh-save-connect" onPress={handleSaveConnection}
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
              STT sends audio to Whisper on your PC (port 8001). TTS uses your phone&apos;s speech engine — zero latency, works offline.
            </Text>
            <View className="bg-surface border border-border rounded-lg p-4 flex-row justify-between items-center mb-3">
              <View>
                <Text className="text-sm font-semibold text-foreground">Speech-to-Text (Whisper)</Text>
                <Text className="text-xs text-muted mt-1">🎤 button → records → PC Whisper → text</Text>
              </View>
              <Switch testID="toggle-stt-enabled" value={sttEnabled} onValueChange={setSttEnabled}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor={sttEnabled ? colors.background : colors.foreground} />
            </View>
            <View className="bg-surface border border-border rounded-lg p-4 flex-row justify-between items-center mb-3">
              <View>
                <Text className="text-sm font-semibold text-foreground">Text-to-Speech (Device)</Text>
                <Text className="text-xs text-muted mt-1">🔊 auto-reads AI replies · long-press any message</Text>
              </View>
              <Switch testID="toggle-tts-enabled" value={ttsEnabled} onValueChange={setTtsEnabled}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor={ttsEnabled ? colors.background : colors.foreground} />
            </View>
            {ttsEnabled && (
              <View>
                {/* Reading speed */}
                <Text className="text-sm font-semibold text-foreground mb-2">Reading Speed</Text>
                <View className="flex-row gap-2 mb-4">
                  {["0.75", "1.0", "1.25", "1.5"].map((r) => (
                    <Pressable key={r} testID={`btn-tts-rate-${r}`} onPress={() => setTtsRate(r)}
                      className={`flex-1 rounded-lg p-2 items-center ${ttsRate === r ? "bg-primary" : "bg-surface border border-border"}`}>
                      <Text className={`text-xs font-semibold ${ttsRate === r ? "text-background" : "text-foreground"}`}>{r}×</Text>
                    </Pressable>
                  ))}
                </View>

                {/* AI Voice selector */}
                <Text className="text-sm font-semibold text-foreground mb-1">AI voice for chat replies</Text>
                <Text className="text-xs text-muted mb-3">
                  Pick which installed device voice reads AI messages aloud.{"\n"}
                  To get more voices: Android Settings → Accessibility → Text-to-Speech → Preferred engine → Install voice data.
                </Text>

                {/* System default option */}
                <Pressable
                  testID="btn-tts-voice-system-default"
                  onPress={() => handleChangeChatTtsVoice("")}
                  className={`rounded-lg p-3 mb-2 border flex-row justify-between items-center ${
                    chatTtsVoiceId === "" ? "border-primary bg-primary/10" : "border-border bg-surface"
                  }`}>
                  <View>
                    <Text className={`text-sm font-semibold ${
                      chatTtsVoiceId === "" ? "text-primary" : "text-foreground"
                    }`}>System default</Text>
                    <Text className="text-xs text-muted mt-0.5">Use the device's default TTS voice</Text>
                  </View>
                  {chatTtsVoiceId === "" && (
                    <Text className="text-primary text-xs font-semibold">Selected ✓</Text>
                  )}
                </Pressable>

                {loadingVoices ? (
                  <View className="flex-row items-center gap-2 py-2">
                    <ActivityIndicator size="small" color={colors.primary} />
                    <Text className="text-xs text-muted">Loading installed voices…</Text>
                  </View>
                ) : deviceVoices.length === 0 ? (
                  <Text className="text-xs text-muted mb-3">
                    No extra voices detected. Install voice packs via Android Settings → Accessibility → Text-to-Speech.
                  </Text>
                ) : (
                  deviceVoices.map((voice) => (
                    <Pressable
                      key={voice.identifier}
                      testID={`btn-tts-voice-${voice.identifier}`}
                      onPress={() => handleChangeChatTtsVoice(voice.identifier)}
                      className={`rounded-lg p-3 mb-2 border flex-row justify-between items-center ${
                        chatTtsVoiceId === voice.identifier ? "border-primary bg-primary/10" : "border-border bg-surface"
                      }`}>
                      <View className="flex-1 mr-2">
                        <Text className={`text-sm font-semibold ${
                          chatTtsVoiceId === voice.identifier ? "text-primary" : "text-foreground"
                        }`} numberOfLines={1}>{voice.name ?? voice.identifier}</Text>
                        <Text className="text-xs text-muted mt-0.5">
                          {voice.language}{voice.quality ? ` · ${voice.quality}` : ""}
                        </Text>
                      </View>
                      {chatTtsVoiceId === voice.identifier && (
                        <Text className="text-primary text-xs font-semibold">Selected ✓</Text>
                      )}
                    </Pressable>
                  ))
                )}
              </View>
            )}
          </View>

          {/* ── Always Listening ────────────────────────────────────────── */}
          <AlwaysListenSettings />

          {/* ── Phone AI Model ───────────────────────────────────────────── */}
          <View>
            <Text className="text-lg font-bold text-foreground mb-1">Phone AI Model</Text>
            <Text className="text-xs text-muted mb-3">
              On-device inference: GGUF via llama.rn (Hexagon NPU / Adreno GPU / CPU) and
              .litertlm via LiteRT-LM. Download and manage files here — models load from the
              Chat model picker: selecting a phone model loads it, selecting another swaps it.
            </Text>

            {/* Resident model — the ONE model loaded on the phone (either engine) */}
            {phoneStatus.engine && phoneStatus.path ? (
              <View className="bg-surface border border-border rounded-lg p-3 mb-3 flex-row justify-between items-center">
                <View className="flex-1 mr-2">
                  <View className="flex-row items-center gap-2">
                    <Text className={`text-xs font-semibold ${phoneStatus.state === "error" ? "text-error" : "text-success"}`}>
                      {phoneStatus.state === "loading" ? "Loading…"
                        : phoneStatus.state === "running" ? "⚡ Generating…"
                        : phoneStatus.state === "error" ? "Error"
                        : "Model active"}
                    </Text>
                    {phoneStatus.backend && (
                      <View className={`rounded-full px-2 py-0.5 ${phoneStatus.backend === "npu" ? "bg-primary/20" : "bg-muted/20"}`}>
                        <Text className={`text-xs font-semibold ${phoneStatus.backend === "npu" ? "text-primary" : "text-foreground"}`}>
                          {phoneStatus.backend === "npu" ? "⚡ NPU" : phoneStatus.backend.toUpperCase()}
                        </Text>
                      </View>
                    )}
                    <Text className="text-xs text-muted">{phoneStatus.engine === "gguf" ? "GGUF" : "LiteRT"}</Text>
                  </View>
                  <Text className="text-xs text-muted mt-0.5" numberOfLines={1}>{phoneStatus.filename}</Text>
                  {phoneStatus.devices.length > 0 && (
                    <Text className="text-xs text-muted mt-0.5">devices: {phoneStatus.devices.join(", ")}</Text>
                  )}
                </View>
                <Pressable testID="btn-model-unload" onPress={handleUnloadModel}
                  className="bg-error/20 border border-error rounded-lg px-3 py-1.5 active:opacity-80">
                  <Text className="text-error font-semibold text-xs">Unload</Text>
                </Pressable>
              </View>
            ) : (
              <View className="bg-surface border border-border rounded-lg p-3 mb-3">
                <Text className="text-xs text-muted">
                  No model loaded — pick a phone model in the Chat model selector to load one.
                </Text>
                {phoneStatus.state === "error" && phoneStatus.error ? (
                  <Text className="text-xs text-error mt-1">{phoneStatus.error}</Text>
                ) : null}
              </View>
            )}

            {/* Acceleration — one app-wide setting, both engines obey it */}
            <Text className="text-xs font-semibold text-foreground mb-1">Acceleration</Text>
            <View className="flex-row gap-2 mb-1">
              {(["auto", "npu", "gpu", "cpu"] as AccelMode[]).map((m) => (
                <Pressable
                  key={m}
                  testID={`btn-accel-${m}`}
                  onPress={() => handleChangeAccel(m)}
                  className={`flex-1 rounded-lg px-3 py-2 items-center border ${accelMode === m ? "bg-primary border-primary" : "bg-surface border-border"}`}>
                  <Text className={`text-xs font-semibold ${accelMode === m ? "text-background" : "text-foreground"}`}>
                    {m === "auto" ? "AUTO" : m.toUpperCase()}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text className="text-xs text-muted mb-3">
              Auto runs on the NPU when the model file supports it (Q4_0 / IQ4_NL / Q8_0 / MXFP4 GGUF),
              else the GPU, with CPU fallback. Manual NPU/GPU are strict — the load fails with a clear
              error instead of silently running elsewhere. The badge above always shows the backend that
              actually engaged. Applies on the next load. (LiteRT NPU is experimental — it needs
              NPU-built .litertlm files.)
            </Text>

            {/* GGUF catalog — variant-aware (quality vs ⚡NPU-ready files) */}
            <Text className="text-xs font-semibold text-foreground mb-2">Download a GGUF model (llama.rn)</Text>
            {GGUF_CATALOG.map((model) => {
              const chosen = pickVariant(model, accelMode);
              return (
                <View key={model.name} testID={`card-model-${model.name}`}
                  className="bg-surface border border-border rounded-lg p-3 mb-3">
                  <View className="flex-row justify-between items-start mb-1">
                    <Text className="text-sm font-semibold text-foreground flex-1 mr-2">
                      {model.name}{model.recommendedForPhone ? " ★" : ""}
                    </Text>
                  </View>
                  <Text className="text-xs text-muted mb-2">{model.description}</Text>
                  {model.variants.map((variant) => {
                    const fileState     = downloaded[variant.filename] ?? "missing";
                    const isDownloading = downloading[variant.filename] ?? false;
                    const dlProgress    = progress[variant.filename] ?? 0;
                    const isLoaded      = phoneStatus.path === modelPath(variant.filename);
                    const isChosen      = chosen.filename === variant.filename;
                    return (
                      <View key={variant.filename}
                        className={`rounded-lg border p-2 mb-2 ${isChosen ? "border-primary/60 bg-primary/5" : "border-border bg-background"}`}>
                        <View className="flex-row items-center gap-2 mb-1">
                          <Text className="text-xs font-semibold text-foreground">{variant.quant.toUpperCase()}</Text>
                          {variant.npuCapable && (
                            <View className="rounded-full px-2 py-0.5 bg-primary/20">
                              <Text className="text-xs font-semibold text-primary">⚡ NPU-ready</Text>
                            </View>
                          )}
                          {isChosen && (
                            <Text className="text-xs text-primary">· matches your setting</Text>
                          )}
                          {isLoaded && (
                            <Text className="text-xs text-success font-semibold">· Loaded ✓</Text>
                          )}
                          <View className="flex-1" />
                          <Text className="text-xs text-muted">{variant.sizeGb} GB</Text>
                        </View>
                        {isDownloading ? (
                          <View>
                            <View className="flex-row items-center justify-between mb-1.5">
                              <Text className="text-xs text-muted">Downloading… {Math.round(dlProgress * 100)}%</Text>
                              <Pressable
                                testID={`btn-model-cancel-${variant.filename}`}
                                onPress={() => cancelDownload(variant.filename)}
                                className="bg-error/20 border border-error rounded px-2 py-0.5 active:opacity-80">
                                <Text className="text-error text-xs font-semibold">Cancel</Text>
                              </Pressable>
                            </View>
                            <View className="h-1.5 bg-border rounded-full overflow-hidden">
                              <View className="h-full bg-primary rounded-full"
                                style={{ width: `${Math.round(dlProgress * 100)}%` }} />
                            </View>
                          </View>
                        ) : fileState === "complete" ? (
                          <View className="flex-row items-center gap-2">
                            <Text className="text-xs text-success font-semibold flex-1">✓ Downloaded — load it from the Chat model picker</Text>
                            <Pressable
                              testID={`btn-model-delete-${variant.filename}`}
                              onPress={() => handleDelete(variant.filename)}
                              className="bg-error/20 border border-error rounded-lg px-3 py-1.5 items-center active:opacity-80">
                              <Text className="text-error font-semibold text-xs">Delete</Text>
                            </Pressable>
                          </View>
                        ) : fileState === "partial" ? (
                          <View>
                            <Text className="text-xs text-warning font-semibold mb-1.5">⚠ Incomplete download — file is truncated</Text>
                            <View className="flex-row gap-2">
                              <Pressable
                                testID={`btn-model-redownload-${variant.filename}`}
                                onPress={() => handleDownloadVariant(model, variant)}
                                className="bg-primary rounded-lg px-3 py-1.5 items-center active:opacity-80 flex-1">
                                <Text className="text-background font-semibold text-xs">Re-download</Text>
                              </Pressable>
                              <Pressable
                                testID={`btn-model-delete-${variant.filename}`}
                                onPress={() => handleDelete(variant.filename)}
                                className="bg-error/20 border border-error rounded-lg px-3 py-1.5 items-center active:opacity-80">
                                <Text className="text-error font-semibold text-xs">Delete</Text>
                              </Pressable>
                            </View>
                          </View>
                        ) : (
                          <Pressable
                            testID={`btn-model-download-${variant.filename}`}
                            onPress={() => handleDownloadVariant(model, variant)}
                            className="bg-surface border border-border rounded-lg p-2 items-center active:opacity-80">
                            <Text className="text-foreground font-semibold text-xs">Download ({variant.sizeGb} GB)</Text>
                          </Pressable>
                        )}
                      </View>
                    );
                  })}
                </View>
              );
            })}

            {/* Import from device button */}
            <Pressable
              testID="btn-import-gguf"
              onPress={handleImport}
              disabled={importing}
              className="bg-surface border border-border rounded-lg p-3 items-center active:opacity-80 mb-4">
              {importing
                ? <ActivityIndicator size="small" color={colors.primary} />
                : <Text className="text-foreground font-semibold text-sm">📂 Import a .gguf from this device</Text>
              }
            </Pressable>

            {/* Detected local models — status only; loading lives in the Chat picker */}
            {localGguf.length > 0 && (
              <>
                <Text className="text-sm font-semibold text-foreground mb-3">GGUF files in this app</Text>
                {localGguf.map((item) => (
                  <View
                    key={item.path}
                    className="bg-surface border border-border rounded-lg p-3 mb-3 flex-row justify-between items-center">
                    <View className="flex-1 mr-2">
                      <Text className="text-xs font-semibold text-foreground" numberOfLines={1}>{item.filename}</Text>
                      <View className="flex-row items-center mt-0.5 gap-2">
                        <Text className="text-xs text-muted">{(item.sizeBytes / 1e9).toFixed(2)} GB</Text>
                        {isNpuCapableFile(item.filename) && (
                          <Text className="text-xs text-primary font-semibold">⚡ NPU-ready</Text>
                        )}
                        {phoneStatus.path === item.path && (
                          <Text className="text-xs text-success font-semibold">
                            ✓ Loaded{phoneStatus.backend ? ` (${phoneStatus.backend.toUpperCase()})` : ""}
                          </Text>
                        )}
                      </View>
                    </View>
                  </View>
                ))}
              </>
            )}

            {/* ── LiteRT-LM models (.litertlm) — Google AI Edge ──────────── */}
            <Text className="text-sm font-semibold text-foreground mt-2 mb-1">
              LiteRT-LM models (.litertlm)
            </Text>
            <Text className="text-xs text-muted mb-3">
              Google AI Edge on-device models. Download one below, or point Omnecor at the
              folder where your existing models (e.g. from the AI Edge Gallery app) live.
            </Text>

            {!isMediapipeAvailable() && (
              <View className="bg-surface border border-border rounded-lg p-3 mb-3">
                <Text className="text-xs text-warning">
                  LiteRT-LM engine not present in this build yet.
                </Text>
              </View>
            )}

            {/* (1) Downloadable catalog — ungated litert-community models */}
            <Text className="text-xs font-semibold text-foreground mb-2">Download a model</Text>
            {LITERT_CATALOG.map((model) => {
              const variant       = model.variants[0];
              const fileState     = downloaded[variant.filename] ?? "missing";
              const isBusy        = downloading[variant.filename];
              const frac          = progress[variant.filename] ?? 0;
              const localPath     = modelPath(variant.filename);
              const isLoaded      = phoneStatus.path === localPath;
              return (
                <View key={variant.filename} className="bg-surface border border-border rounded-lg p-3 mb-3">
                  <View className="flex-row justify-between items-center mb-1">
                    <Text className="text-xs font-semibold text-foreground flex-1 mr-2">{model.name}</Text>
                    {model.recommendedForPhone && (
                      <Text className="text-xs text-primary font-semibold">★ phone</Text>
                    )}
                    {isLoaded && (
                      <Text className="text-xs text-success font-semibold ml-2">
                        ✓ Loaded{phoneStatus.backend ? ` (${phoneStatus.backend.toUpperCase()})` : ""}
                      </Text>
                    )}
                  </View>
                  <Text className="text-xs text-muted mb-2">{model.description}</Text>
                  {isBusy ? (
                    <View>
                      <View className="flex-row items-center justify-between mb-1.5">
                        <Text className="text-xs text-muted">
                          Downloading… {Math.round(frac * 100)}%
                        </Text>
                        <Pressable
                          testID={`btn-litert-cancel-${variant.filename}`}
                          onPress={() => cancelDownload(variant.filename)}
                          className="bg-error/20 border border-error rounded px-2 py-0.5 active:opacity-80">
                          <Text className="text-error text-xs font-semibold">Cancel</Text>
                        </Pressable>
                      </View>
                      <View className="h-1.5 bg-border rounded-full overflow-hidden">
                        <View
                          className="h-full bg-primary rounded-full"
                          style={{ width: `${Math.round(frac * 100)}%` }}
                        />
                      </View>
                    </View>
                  ) : fileState === "complete" ? (
                    <View className="flex-row items-center gap-2">
                      <Text className="text-xs text-success font-semibold flex-1">✓ Downloaded — load it from the Chat model picker</Text>
                      <Pressable
                        testID={`btn-litert-delete-${variant.filename}`}
                        onPress={() => handleDelete(variant.filename)}
                        className="bg-error/20 border border-error rounded-lg px-3 py-1.5 items-center active:opacity-80">
                        <Text className="text-error font-semibold text-xs">Delete</Text>
                      </Pressable>
                    </View>
                  ) : (
                    <Pressable
                      testID={`btn-litert-download-${variant.filename}`}
                      onPress={() => handleDownloadVariant(model, variant)}
                      className="bg-surface border border-border rounded-lg p-2 items-center active:opacity-80">
                      <Text className="text-foreground font-semibold text-xs">Download ({variant.sizeGb} GB)</Text>
                    </Pressable>
                  )}
                </View>
              );
            })}

            {/* (2) Device folder (SAF) — surface models already on the phone */}
            <Text className="text-xs font-semibold text-foreground mt-2 mb-2">Import from a folder on this device</Text>
            <Text className="text-xs text-muted mb-2">
              Grant Omnecor a folder your .litertlm / .task models live in and every model in it
              can be imported here. Use a sub-folder you make (e.g. Download/OmnecorModels) —
              Android blocks granting Downloads or the storage root directly.
            </Text>

            {/* How to bring in Google AI Edge Gallery models (Android blocks direct access). */}
            <View className="bg-surface border border-border rounded-lg p-3 mb-3">
              <Text className="text-xs font-semibold text-foreground mb-1">Using Google AI Edge Gallery models</Text>
              <Text className="text-xs text-muted">
                Android won&apos;t let any app read Gallery&apos;s private folder
                (Android/data/…) — not even with permissions. To use those models here:{"\n"}
                1. Open Samsung <Text className="text-foreground">My Files</Text> →
                Android/data/com.google.ai.edge.gallery/files{"\n"}
                2. Make a folder like <Text className="text-foreground">Download/OmnecorModels</Text>
                {" "}and copy the <Text className="text-foreground">.litertlm</Text> file into it
                (a sub-folder — Android won&apos;t grant Downloads or the root itself){"\n"}
                3. Tap <Text className="text-foreground">Choose model folder</Text> below → pick that
                folder → Import copies it into the app; it then appears in the Chat model picker.
              </Text>
            </View>
            <Pressable
              testID="btn-litert-pick-folder"
              onPress={handlePickTaskFolder}
              disabled={scanningFolder}
              className="bg-surface border border-border rounded-lg p-3 items-center active:opacity-80 mb-2">
              {scanningFolder
                ? <ActivityIndicator size="small" color={colors.primary} />
                : <Text className="text-foreground font-semibold text-sm">
                    {taskFolder ? "📁 Change model folder" : "📁 Choose model folder"}
                  </Text>}
            </Pressable>

            {taskFolder && folderTaskModels.length === 0 && !scanningFolder && (
              <Text className="text-xs text-muted mb-3">
                No .litertlm / .task models found in that folder. If your models were downloaded
                inside the Google AI Edge Gallery app, Android hides that folder from other apps —
                open Gallery and use Share → Omnecor HQ, or download one from the list above.
              </Text>
            )}

            {/* Hide folder models already copied into the app — they show under "In this app". */}
            {folderTaskModels
              .filter((item) => !localTask.some((t) => t.filename === item.filename))
              .map((item) => (
              <View
                key={item.uri}
                className="bg-surface border border-border rounded-lg p-3 mb-3 flex-row justify-between items-center">
                <View className="flex-1 mr-2">
                  <Text className="text-xs font-semibold text-foreground" numberOfLines={1}>{item.filename}</Text>
                  {item.sizeBytes > 0 && (
                    <Text className="text-xs text-muted mt-0.5">{(item.sizeBytes / 1e9).toFixed(2)} GB</Text>
                  )}
                </View>
                <Pressable
                  testID={`btn-litert-folder-import-${item.filename}`}
                  onPress={() => handleImportFromFolder(item)}
                  disabled={busyTaskFile === item.filename}
                  className="bg-primary rounded-lg px-3 py-1.5 items-center active:opacity-80">
                  {busyTaskFile === item.filename
                    ? <ActivityIndicator size="small" color="white" />
                    : <Text className="text-background font-semibold text-xs">Import</Text>}
                </Pressable>
              </View>
            ))}

            {/* (3) Single-file import fallback */}
            <Pressable
              testID="btn-import-litertlm"
              onPress={handleImportTask}
              disabled={importingTask}
              className="bg-surface border border-border rounded-lg p-3 items-center active:opacity-80 mt-1 mb-3">
              {importingTask
                ? <ActivityIndicator size="small" color={colors.primary} />
                : <Text className="text-foreground font-semibold text-sm">📂 Import a single .litertlm file</Text>
              }
            </Pressable>

            {/* (4) Models already copied into the app — status only */}
            {localTask.length > 0 && (
              <Text className="text-xs font-semibold text-foreground mb-2">In this app</Text>
            )}
            {localTask.map((item) => (
              <View
                key={item.path}
                className="bg-surface border border-border rounded-lg p-3 mb-3 flex-row justify-between items-center">
                <View className="flex-1 mr-2">
                  <Text className="text-xs font-semibold text-foreground" numberOfLines={1}>{item.filename}</Text>
                  <View className="flex-row items-center mt-0.5 gap-2">
                    <Text className="text-xs text-muted">{(item.sizeBytes / 1e9).toFixed(2)} GB</Text>
                    {phoneStatus.path === item.path && (
                      <Text className="text-xs text-success font-semibold">
                        ✓ Loaded{phoneStatus.backend ? ` (${phoneStatus.backend.toUpperCase()})` : ""}
                      </Text>
                    )}
                  </View>
                </View>
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
                            testID={`input-source-token-${entry.type}`}
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
                            testID={`btn-source-connect-${entry.type}`}
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
                            testID={`btn-source-sync-${entry.type}`}
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
                            testID={`btn-source-analyze-${entry.type}`}
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
                            testID={`btn-source-disconnect-${entry.type}`}
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
                      <Pressable testID="btn-analysis-dismiss" onPress={() => setAnalysis(null)} className="p-1 active:opacity-60">
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
                <Pressable key={mode} testID={`btn-execution-mode-${mode}`} onPress={() => {
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
            <View className="bg-surface border border-border rounded-lg overflow-hidden gap-0">
              {/* Dark Mode */}
              <View className="p-4 flex-row justify-between items-center border-b border-border">
                <Text className="text-sm font-semibold text-foreground">Dark Mode</Text>
                <Switch testID="toggle-dark-mode" value={isDarkMode} onValueChange={(v) => setColorScheme(v ? "dark" : "light")}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor={isDarkMode ? colors.background : colors.foreground} />
              </View>
              {/* AI Response Quotes */}
              <View className="p-4 flex-row justify-between items-center">
                <View className="flex-1 mr-3">
                  <Text className="text-sm font-semibold text-foreground">AI Response Quotes</Text>
                  <Text className="text-xs text-muted mt-0.5">Show a quote while the AI is thinking</Text>
                </View>
                <Switch
                  testID="toggle-thinking-quotes"
                  value={chatDisplaySettings.showThinkingQuotes}
                  onValueChange={(v) => updateChatDisplaySettings({ showThinkingQuotes: v })}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor={chatDisplaySettings.showThinkingQuotes ? colors.background : colors.foreground}
                />
              </View>
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

          <Pressable testID="btn-logout" onPress={handleLogout}
            className="bg-error/20 border border-error rounded-lg p-3 items-center active:opacity-80">
            <Text className="text-error font-semibold">Logout</Text>
          </Pressable>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
