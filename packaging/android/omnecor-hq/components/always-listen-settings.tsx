/**
 * Always-Listening settings section.
 *
 * Self-contained card block dropped into the Settings screen. Owns the UI for:
 *   - master enable toggle (starts/stops the wake-word service)
 *   - Picovoice access key (KeyStore)
 *   - the persona that answers voice intents
 *   - wake-word sensitivity + "speak replies"
 *   - on-device Whisper STT model download/select
 *   - a manual "Test" turn and the recent-activation audit log
 *
 * State/pipeline live in `lib/_core/always-listen.ts`; this component only
 * configures it and reflects its live state.
 */
import { useCallback, useEffect, useState } from "react";
import { Text, View, TextInput, Switch, Alert, ActivityIndicator, ScrollView } from "react-native";
import { Pressable } from "@/components/pressable";
import { useColors } from "@/hooks/use-colors";
import { trpcQuery } from "@/lib/_core/trpc-fetch";
import { isServerConfigured } from "@/lib/_core/server-config";
import { useAlwaysListen } from "@/hooks/use-always-listen";
import {
  getListenConfig, saveListenConfig,
} from "@/lib/_core/always-listen-config";
import { WHISPER_MODELS } from "@/lib/_core/local-stt";
import {
  isModelDownloaded, downloadModel, deleteModel, cancelDownload,
} from "@/lib/_core/model-download";
import {
  getAuditLog, clearAuditLog, type ActivationRecord, type ListenState,
} from "@/lib/_core/always-listen";
import * as Speech from "expo-speech";

interface Persona { id: string; name: string; type?: string }

const STATE_LABEL: Record<ListenState, string> = {
  off: "Off",
  listening: "Listening for wake word",
  capturing: "Listening…",
  transcribing: "Transcribing",
  thinking: "Thinking",
  speaking: "Speaking",
  error: "Error",
};

export function AlwaysListenSettings() {
  const colors = useColors();
  const { state, error, busy, start, stop, testTurn } = useAlwaysListen();

  const cfg = getListenConfig();
  const [enabled, setEnabled]         = useState(cfg.enabled);
  const [personaId, setPersonaId]     = useState(cfg.personaId);
  const [speakReplies, setSpeakReplies] = useState(cfg.speakReplies);
  const [sensitivity, setSensitivity] = useState(cfg.sensitivity);
  const [sttModel, setSttModel]       = useState(cfg.sttModelFilename);
  const [wakeWord, setWakeWord]       = useState(cfg.wakeWord ?? "omnecor");
  const [ttsVoiceId, setTtsVoiceId]   = useState(cfg.ttsVoiceId);

  const [personas, setPersonas] = useState<Persona[]>([]);
  const [downloaded, setDownloaded] = useState<Record<string, boolean>>({});
  const [progress, setProgress]     = useState<Record<string, number>>({});
  const [downloading, setDownloading] = useState<Record<string, boolean>>({});
  const [audit, setAudit] = useState<ActivationRecord[]>([]);
  // expo-speech device voices (populated once at mount)
  const [deviceVoices, setDeviceVoices] = useState<Speech.Voice[]>([]);
  const [loadingVoices, setLoadingVoices] = useState(false);

  // Load personas, downloaded-model state, and the audit log.
  useEffect(() => {
    if (isServerConfigured()) {
      trpcQuery<Persona[]>("personas.list")
        .then((list) => setPersonas(Array.isArray(list) ? list : []))
        .catch(() => { /* offline — leave empty */ });
    }
  }, []);

  const refreshDownloaded = useCallback(async () => {
    const out: Record<string, boolean> = {};
    await Promise.all(
      WHISPER_MODELS.map(async (m) => { out[m.filename] = await isModelDownloaded(m.filename); }),
    );
    setDownloaded(out);
  }, []);

  const refreshAudit = useCallback(async () => { setAudit(await getAuditLog()); }, []);

  useEffect(() => { refreshDownloaded(); refreshAudit(); }, [refreshDownloaded, refreshAudit]);
  useEffect(() => { if (state === "listening" || state === "off") refreshAudit(); }, [state, refreshAudit]);

  // Load available TTS voices from the device once at mount.
  useEffect(() => {
    setLoadingVoices(true);
    Speech.getAvailableVoicesAsync()
      .then((voices) => {
        // Filter to English voices and sort by name for a manageable list.
        const sorted = [...voices]
          .filter((v) => v.language?.startsWith("en") ?? true)
          .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
        setDeviceVoices(sorted);
      })
      .catch(() => { /* Speech API unavailable on this device/build */ })
      .finally(() => setLoadingVoices(false));
  }, []);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const persist = useCallback(
    async (patch: Parameters<typeof saveListenConfig>[0]) => { await saveListenConfig(patch); },
    [],
  );

  const handleToggle = useCallback(async (next: boolean) => {
    if (next) {
      if (!isServerConfigured()) { Alert.alert("Set server first", "Configure your Omnecor PC connection above."); return; }
      if (!personaId) { Alert.alert("Pick a persona", "Choose which persona answers voice intents."); return; }
      if (!sttModel || !downloaded[sttModel]) { Alert.alert("Download a voice model", "Download an on-device STT model below first."); return; }
    }
    setEnabled(next);
    await persist({ enabled: next });
    try {
      if (next) await start();
      else await stop();
    } catch (e) {
      setEnabled(false);
      await persist({ enabled: false });
      Alert.alert("Could not start", String(e));
    }
  }, [personaId, sttModel, downloaded, persist, start, stop]);

  const handleSaveWakeWord = useCallback(async () => {
    await persist({ wakeWord });
    Alert.alert("Saved", `Wake word set to "${wakeWord}".`);
  }, [wakeWord, persist]);

  const handleDownload = useCallback(async (filename: string) => {
    const model = WHISPER_MODELS.find((m) => m.filename === filename);
    if (!model) return;
    setDownloading((d) => ({ ...d, [filename]: true }));
    setProgress((p) => ({ ...p, [filename]: 0 }));
    try {
      await downloadModel(model, (frac) => setProgress((p) => ({ ...p, [filename]: frac })));
      setDownloaded((d) => ({ ...d, [filename]: true }));
    } catch (e) {
      Alert.alert("Download failed", String(e));
    } finally {
      setDownloading((d) => ({ ...d, [filename]: false }));
    }
  }, []);

  const handlePickModel = useCallback(async (filename: string) => {
    setSttModel(filename);
    await persist({ sttModelFilename: filename });
  }, [persist]);

  const handlePickPersona = useCallback(async (id: string) => {
    setPersonaId(id);
    await persist({ personaId: id });
  }, [persist]);

  const handleSensitivity = useCallback(async (s: number) => {
    setSensitivity(s);
    await persist({ sensitivity: s });
  }, [persist]);

  const handleSpeak = useCallback(async (v: boolean) => {
    setSpeakReplies(v);
    await persist({ speakReplies: v });
  }, [persist]);

  const handlePickVoice = useCallback(async (id: string) => {
    setTtsVoiceId(id);
    await persist({ ttsVoiceId: id });
  }, [persist]);

  const handleClearAudit = useCallback(async () => {
    await clearAuditLog();
    setAudit([]);
  }, []);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <View>
      <Text className="text-lg font-bold text-foreground mb-1">Always Listening</Text>
      <Text className="text-xs text-muted mb-4">
        Say the wake word, speak, and your PC persona answers — transcription runs on-device
        (only text leaves your phone). Keeps the mic on via a foreground service: expect extra
        battery use, and a persistent notification while active.
      </Text>

      {/* Master toggle + live status */}
      <View className="bg-surface border border-border rounded-lg p-4 flex-row justify-between items-center mb-3">
        <View className="flex-1 mr-2">
          <Text className="text-sm font-semibold text-foreground">Enable Always Listening</Text>
          <Text className={`text-xs mt-1 ${state === "error" ? "text-error" : "text-muted"}`}>
            {state === "error" ? (error ?? "Error") : STATE_LABEL[state]}
          </Text>
        </View>
        <Switch value={enabled} onValueChange={handleToggle} disabled={busy}
          trackColor={{ false: colors.border, true: colors.primary }}
          thumbColor={enabled ? colors.background : colors.foreground} />
      </View>

      {/* Wake Word config */}
      <View className="bg-surface border border-border rounded-lg p-4 mb-3">
        <Text className="text-sm font-semibold text-foreground mb-1">
          Wake word
        </Text>
        <Text className="text-xs text-muted mb-2">
          The phrase to trigger voice capture (e.g., "omnecor", "computer").
        </Text>
        <TextInput
          value={wakeWord}
          onChangeText={setWakeWord}
          placeholder="omnecor"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          className="bg-background border border-border rounded-lg px-3 py-2 text-foreground text-sm mb-2"
        />
        <Pressable onPress={handleSaveWakeWord}
          className="bg-primary rounded-lg p-2 items-center active:opacity-80">
          <Text className="text-background font-semibold text-xs">Save wake word</Text>
        </Pressable>
      </View>

      {/* Persona selector */}
      <Text className="text-sm font-semibold text-foreground mb-2">Persona that answers</Text>
      {personas.length === 0 ? (
        <Text className="text-xs text-muted mb-3">No personas found — create one on your PC, or connect the server.</Text>
      ) : (
        <View className="mb-3">
          {personas.map((p) => (
            <Pressable key={p.id} onPress={() => handlePickPersona(p.id)}
              className={`rounded-lg p-3 mb-2 border flex-row justify-between items-center ${personaId === p.id ? "border-primary bg-primary/10" : "border-border bg-surface"}`}>
              <Text className={`text-sm font-semibold ${personaId === p.id ? "text-primary" : "text-foreground"}`}>{p.name}</Text>
              {personaId === p.id && <Text className="text-primary text-xs">Selected</Text>}
            </Pressable>
          ))}
        </View>
      )}

      {/* Speak replies + voice picker */}
      <View className="bg-surface border border-border rounded-lg p-4 flex-row justify-between items-center mb-3">
        <View className="flex-1 mr-2">
          <Text className="text-sm font-semibold text-foreground">Speak replies aloud</Text>
          <Text className="text-xs text-muted mt-1">Read the agent's answer back via the device voice</Text>
        </View>
        <Switch value={speakReplies} onValueChange={handleSpeak}
          trackColor={{ false: colors.border, true: colors.primary }}
          thumbColor={speakReplies ? colors.background : colors.foreground} />
      </View>

      {/* AI Voice selector — shown only when speakReplies is on */}
      {speakReplies && (
        <View className="mb-4">
          <Text className="text-sm font-semibold text-foreground mb-1">AI voice for spoken replies</Text>
          <Text className="text-xs text-muted mb-3">
            Select which installed device voice the AI uses when speaking answers aloud.
            {"\n"}To add more voices, go to Android Settings → Text-to-Speech → Install voice data.
          </Text>

          {/* System default option */}
          <Pressable
            onPress={() => handlePickVoice("")}
            className={`rounded-lg p-3 mb-2 border flex-row justify-between items-center ${
              ttsVoiceId === "" ? "border-primary bg-primary/10" : "border-border bg-surface"
            }`}>
            <View>
              <Text className={`text-sm font-semibold ${
                ttsVoiceId === "" ? "text-primary" : "text-foreground"
              }`}>System default</Text>
              <Text className="text-xs text-muted mt-0.5">Use the device's default TTS voice</Text>
            </View>
            {ttsVoiceId === "" && <Text className="text-primary text-xs font-semibold">Selected ✓</Text>}
          </Pressable>

          {loadingVoices ? (
            <View className="flex-row items-center gap-2 py-2">
              <ActivityIndicator size="small" color={colors.primary} />
              <Text className="text-xs text-muted">Loading device voices…</Text>
            </View>
          ) : deviceVoices.length === 0 ? (
            <Text className="text-xs text-muted">
              No additional voices found. Install voice packs via Android Settings → Accessibility → Text-to-Speech.
            </Text>
          ) : (
            deviceVoices.map((voice) => (
              <Pressable
                key={voice.identifier}
                onPress={() => handlePickVoice(voice.identifier)}
                className={`rounded-lg p-3 mb-2 border flex-row justify-between items-center ${
                  ttsVoiceId === voice.identifier ? "border-primary bg-primary/10" : "border-border bg-surface"
                }`}>
                <View className="flex-1 mr-2">
                  <Text className={`text-sm font-semibold ${
                    ttsVoiceId === voice.identifier ? "text-primary" : "text-foreground"
                  }`} numberOfLines={1}>{voice.name ?? voice.identifier}</Text>
                  <Text className="text-xs text-muted mt-0.5">
                    {voice.language}{voice.quality ? ` · ${voice.quality}` : ""}
                  </Text>
                </View>
                {ttsVoiceId === voice.identifier && (
                  <Text className="text-primary text-xs font-semibold">Selected ✓</Text>
                )}
              </Pressable>
            ))
          )}
        </View>
      )}

      <Text className="text-sm font-semibold text-foreground mb-2">Wake-word sensitivity</Text>
      <View className="flex-row gap-2 mb-4">
        {([["Low", 0.3], ["Medium", 0.5], ["High", 0.7]] as const).map(([label, val]) => (
          <Pressable key={label} onPress={() => handleSensitivity(val)}
            className={`flex-1 rounded-lg p-2 items-center ${Math.abs(sensitivity - val) < 0.01 ? "bg-primary" : "bg-surface border border-border"}`}>
            <Text className={`text-xs font-semibold ${Math.abs(sensitivity - val) < 0.01 ? "text-background" : "text-foreground"}`}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {/* On-device STT model */}
      <Text className="text-sm font-semibold text-foreground mb-2">On-device voice model (Whisper)</Text>
      {WHISPER_MODELS.map((m) => {
        const isDownloaded  = downloaded[m.filename] ?? false;
        const isDownloading = downloading[m.filename] ?? false;
        const dl            = progress[m.filename] ?? 0;
        const isSelected    = sttModel === m.filename;
        return (
          <View key={m.filename}
            className={`mb-3 rounded-lg p-3 border ${isSelected ? "border-primary bg-primary/10" : "border-border bg-surface"}`}>
            <View className="flex-row justify-between items-start mb-2">
              <View className="flex-1 mr-2">
                <Text className={`text-sm font-semibold ${isSelected ? "text-primary" : "text-foreground"}`}>
                  {m.name}{m.recommendedForPhone ? " ★" : ""}
                </Text>
                <Text className="text-xs text-muted mt-0.5">{m.description}</Text>
              </View>
              <Text className="text-xs text-muted">{Math.round(m.sizeGb * 1024)} MB</Text>
            </View>

            {isDownloading ? (
              <View className="flex-row items-center justify-between">
                <Text className="text-xs text-muted">Downloading… {Math.round(dl * 100)}%</Text>
                <Pressable onPress={() => cancelDownload(m.filename)}
                  className="bg-error/20 border border-error rounded px-2 py-0.5 active:opacity-80">
                  <Text className="text-error text-xs font-semibold">Cancel</Text>
                </Pressable>
              </View>
            ) : isDownloaded ? (
              <View className="flex-row gap-2">
                <Pressable onPress={() => handlePickModel(m.filename)}
                  className={`flex-1 rounded-lg p-2 items-center ${isSelected ? "bg-primary" : "bg-surface border border-border"}`}>
                  <Text className={`text-xs font-semibold ${isSelected ? "text-background" : "text-foreground"}`}>
                    {isSelected ? "Selected" : "Use this"}
                  </Text>
                </Pressable>
                <Pressable onPress={async () => { await deleteModel(m.filename); setDownloaded((d) => ({ ...d, [m.filename]: false })); }}
                  className="bg-error/20 border border-error rounded-lg px-3 py-2 items-center active:opacity-80">
                  <Text className="text-error text-xs font-semibold">Delete</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable onPress={() => handleDownload(m.filename)}
                className="bg-primary rounded-lg p-2 items-center active:opacity-80">
                <Text className="text-background font-semibold text-xs">Download</Text>
              </Pressable>
            )}
          </View>
        );
      })}

      {/* Manual test */}
      <Pressable onPress={testTurn} disabled={busy}
        className="bg-surface border border-border rounded-lg p-3 items-center mb-4 active:opacity-80">
        <Text className="text-foreground font-semibold text-sm">
          {busy ? "Working…" : "Test a voice turn (records ~6s)"}
        </Text>
      </Pressable>

      {/* Activation audit */}
      <View className="flex-row justify-between items-center mb-2">
        <Text className="text-sm font-semibold text-foreground">Recent activations</Text>
        {audit.length > 0 && (
          <Pressable onPress={handleClearAudit} className="active:opacity-60">
            <Text className="text-error text-xs font-semibold">Clear</Text>
          </Pressable>
        )}
      </View>
      {audit.length === 0 ? (
        <Text className="text-xs text-muted">No activations yet.</Text>
      ) : (
        audit.slice(0, 10).map((rec, i) => (
          <View key={`${rec.at}-${i}`} className="bg-surface border border-border rounded-lg p-3 mb-2">
            <Text className="text-xs text-muted mb-0.5">
              {new Date(rec.at).toLocaleString()} · {rec.ms} ms · {rec.ok ? "ok" : "failed"}
            </Text>
            <Text className="text-sm text-foreground">{rec.transcript || "(no speech detected)"}</Text>
            {rec.ok && rec.reply ? (
              <Text className="text-xs text-muted mt-1" numberOfLines={2}>↳ {rec.reply}</Text>
            ) : rec.error ? (
              <Text className="text-xs text-error mt-1">{rec.error}</Text>
            ) : null}
          </View>
        ))
      )}
    </View>
  );
}
