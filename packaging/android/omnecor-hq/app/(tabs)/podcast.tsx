import { ScrollView, Text, View, TextInput, Alert } from "react-native";
import { Pressable } from "@/components/pressable";
import { useState, useEffect } from "react";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import * as FileSystem from "expo-file-system/legacy";
import * as DocumentPicker from "expo-document-picker";
import * as WebBrowser from "expo-web-browser";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { trpcMutate } from "@/lib/_core/trpc-fetch";
import { isServerConfigured, getServerBaseUrl } from "@/lib/_core/server-config";
import { askAi, resolveProviderId } from "@/lib/_core/ai-chat";
import { subscribeChannel } from "@/lib/_core/ws-channels";
import AsyncStorage from "@react-native-async-storage/async-storage";

// ── Podcast sources (mirror the desktop SourcesSidebar) ───────────────────────
// Each selected source's content is fed into the AI script generator as context.
type SourceKind = "text" | "file" | "website";
interface PodcastSource {
  id: string;
  kind: SourceKind;
  label: string;
  content: string;
  selected: boolean;
}
const KIND_LABEL: Record<SourceKind, string> = { text: "Text", file: "File", website: "Website" };

const LENGTH_OPTIONS: { value: string; label: string; desc: string; turnCount: number }[] = [
  { value: "short",     label: "Short",     desc: "~5 min · 4–6 turns",   turnCount: 6  },
  { value: "medium",    label: "Medium",    desc: "~15 min · 10–14 turns", turnCount: 12 },
  { value: "long",      label: "Long",      desc: "~30 min · 20–26 turns", turnCount: 24 },
  { value: "deep-dive", label: "Deep Dive", desc: "~60 min · 40+ turns",   turnCount: 40 },
];

export default function PodcastScreen() {
  const colors = useColors();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [script, setScript] = useState("");
  const [selectedVoice, setSelectedVoice] = useState("Default");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [audioPath, setAudioPath] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [showVoiceSelector, setShowVoiceSelector] = useState(false);
  const [podcastLength, setPodcastLength] = useState("medium");
  const [isScripting, setIsScripting] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [podcastDuration, setPodcastDuration] = useState(15);
  const [podcastQuality, setPodcastQuality] = useState<"draft" | "standard" | "high">("standard");

  // ── Sources ──
  const [sources, setSources] = useState<PodcastSource[]>([]);
  const [showAddSource, setShowAddSource] = useState(false);
  const [textDraft, setTextDraft] = useState("");
  const [urlDraft, setUrlDraft] = useState("");

  // Load session from AsyncStorage on mount
  useEffect(() => {
    const loadSession = async () => {
      try {
        const raw = await AsyncStorage.getItem("omnecor:mobile_podcast_session");
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed.title) setTitle(parsed.title);
          if (parsed.description) setDescription(parsed.description);
          if (parsed.script) setScript(parsed.script);
          if (parsed.selectedVoice) setSelectedVoice(parsed.selectedVoice);
          if (parsed.podcastLength) setPodcastLength(parsed.podcastLength);
          if (parsed.podcastDuration) setPodcastDuration(parsed.podcastDuration);
          if (parsed.podcastQuality) setPodcastQuality(parsed.podcastQuality);
          if (parsed.sources) setSources(parsed.sources);
        }
      } catch (err) {
        console.warn("Failed to load podcast session:", err);
      }
    };
    loadSession();
  }, []);

  // Save session to AsyncStorage whenever inputs change
  useEffect(() => {
    const saveSession = async () => {
      try {
        await AsyncStorage.setItem("omnecor:mobile_podcast_session", JSON.stringify({
          title,
          description,
          script,
          selectedVoice,
          podcastLength,
          podcastDuration,
          podcastQuality,
          sources,
        }));
      } catch (err) {
        console.warn("Failed to save podcast session:", err);
      }
    };
    saveSession();
  }, [title, description, script, selectedVoice, podcastLength, podcastDuration, podcastQuality, sources]);

  // ── Audio player (streams the master mix from the PC over HTTP, range-capable) ──
  const player = useAudioPlayer(audioUrl ?? undefined);
  const playerStatus = useAudioPlayerStatus(player);

  const voices = ["Default", "Male", "Female", "Narrator", "Casual"];

  const addSource = (kind: SourceKind, label: string, content: string) => {
    if (!content.trim()) return;
    setSources((prev) => [
      ...prev,
      { id: Math.random().toString(36).slice(2), kind, label: label || KIND_LABEL[kind], content: content.trim(), selected: true },
    ]);
  };
  const toggleSource = (id: string) =>
    setSources((prev) => prev.map((s) => (s.id === id ? { ...s, selected: !s.selected } : s)));
  const removeSource = (id: string) => setSources((prev) => prev.filter((s) => s.id !== id));

  const addTextSource = () => {
    if (!textDraft.trim()) { Alert.alert("Empty", "Type or paste some text first."); return; }
    addSource("text", "Pasted text", textDraft);
    setTextDraft("");
    setShowAddSource(false);
  };

  const addWebsiteSource = async () => {
    const url = urlDraft.trim();
    if (!url) { Alert.alert("Empty", "Enter a website URL first."); return; }
    try {
      const res = await fetch(url);
      const html = await res.text();
      // Strip tags to plain text and cap length so the prompt stays reasonable.
      const text = html.replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 4000);
      if (!text) { Alert.alert("No content", "Could not extract readable text from that page."); return; }
      addSource("website", url.replace(/^https?:\/\//, "").slice(0, 40), text);
      setUrlDraft("");
      setShowAddSource(false);
    } catch (err) {
      Alert.alert("Fetch failed", err instanceof Error ? err.message : String(err));
    }
  };

  const addFileSource = async () => {
    try {
      const picked = await DocumentPicker.getDocumentAsync({ type: ["text/*", "application/json"], copyToCacheDirectory: true });
      if (picked.canceled || !picked.assets?.[0]) return;
      const asset = picked.assets[0];
      const content = await FileSystem.readAsStringAsync(asset.uri);
      addSource("file", asset.name || "File", content.slice(0, 8000));
      setShowAddSource(false);
    } catch (err) {
      Alert.alert("File read failed", err instanceof Error ? err.message : String(err));
    }
  };

  const handleDownload = async () => {
    if (!audioUrl) return;
    setIsDownloading(true);
    try {
      const dest = FileSystem.documentDirectory + `podcast-${Date.now()}.wav`;
      const { uri } = await FileSystem.downloadAsync(audioUrl, dest);
      Alert.alert("Saved", `Episode saved to:\n${uri}`);
    } catch (err) {
      Alert.alert("Download failed", err instanceof Error ? err.message : String(err));
    } finally {
      setIsDownloading(false);
    }
  };

  const handleGenerate = async () => {
    if (!title.trim() || !script.trim()) {
      Alert.alert("Validation", "Please enter a title and script");
      return;
    }

    if (!isServerConfigured()) {
      Alert.alert("No server configured", "Go to Settings and enter your PC's IP address.");
      return;
    }

    const jobId = Math.random().toString(36).substring(7) + "-" + Date.now();
    setIsGenerating(true);
    setGenerationProgress(0);
    setAudioPath(null);
    setAudioUrl(null);

    const unsub = subscribeChannel(`podcast:${jobId}`, (data: any) => {
      if (typeof data?.percent === "number") {
        setGenerationProgress(data.percent);
      }
    });

    // Wait a brief moment to ensure subscription is active on the server before starting the HTTP request
    await new Promise((resolve) => setTimeout(resolve, 300));

    try {
      // Build turns from script: split on double-newlines or --- separators
      const rawParagraphs = script
        .split(/\n\n|---/)
        .map((p) => p.trim())
        .filter((p) => p.length > 0);

      const turns =
        rawParagraphs.length === 0
          ? [{ speakerId: "host", text: script.trim() }]
          : rawParagraphs.map((text, idx) => ({
              speakerId: idx % 2 === 0 ? "host" : "guest",
              text,
            }));

      // Use the description as a real spoken intro turn so the field isn't dead.
      if (description.trim()) {
        turns.unshift({ speakerId: "host", text: description.trim() });
      }

      // Map selectedVoice to useRVC
      const useRVC = selectedVoice === "Female";

      const result = await trpcMutate<{
        jobId: string;
        audioPath: string;
        audioUrl: string;
        duration: number;
        segments: unknown[];
      }>("podcast.generate", {
        jobId,
        title,
        description,
        durationMinutes: podcastDuration,
        quality: podcastQuality,
        turns,
        useRVC,
      });

      setAudioPath(result.audioPath);
      // Full HTTP URL the on-device player streams from (PC base + server route).
      setAudioUrl(result.audioUrl ? getServerBaseUrl() + result.audioUrl : null);
      setGenerationProgress(100);
    } catch (err) {
      Alert.alert("Error", err instanceof Error ? err.message : "Podcast generation failed");
    } finally {
      unsub();
      setIsGenerating(false);
    }
  };

  const handleGenerateScript = async () => {
    if (!title.trim()) {
      Alert.alert("Topic needed", "Enter a podcast title first");
      return;
    }
    if (!isServerConfigured()) {
      Alert.alert("No server configured", "Go to Settings and enter your PC's IP address.");
      return;
    }
    const turnCount = Math.max(2, Math.round(podcastDuration * 0.8));
    setIsScripting(true);
    try {
      const selectedSources = sources.filter((s) => s.selected);
      const providerId = await resolveProviderId();
      const modelId = providerId === "openai" ? "gpt-4o" : "llama3.2:latest";

      const result = await trpcMutate<{ content: string }>("podcast.generateScript", {
        providerId,
        modelId,
        topic: title.trim(),
        description: description.trim() || undefined,
        durationMinutes: podcastDuration,
        quality: podcastQuality,
        turnsCount: turnCount,
        format: "text",
        sources: selectedSources.map(s => ({ label: s.label, content: s.content })),
      });
      setScript(result.content);
    } catch (err) {
      Alert.alert("Script generation failed", String(err));
    } finally {
      setIsScripting(false);
    }
  };

  return (
    <ScreenContainer className="flex-1 bg-background">
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        className="p-4"
        showsVerticalScrollIndicator={false}
      >
        <View className="gap-4">
          {/* Title */}
          <View>
            <Text className="text-sm font-semibold text-foreground mb-2">
              Podcast Title
            </Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="Enter podcast title..."
              placeholderTextColor={colors.muted}
              className="bg-surface border border-border rounded-lg px-3 py-2 text-foreground"
            />
          </View>

          {/* Description */}
          <View>
            <Text className="text-sm font-semibold text-foreground mb-2">
              Description
            </Text>
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="Enter podcast description..."
              placeholderTextColor={colors.muted}
              className="bg-surface border border-border rounded-lg px-3 py-2 text-foreground"
              multiline
            />
          </View>

          {/* Sources */}
          <View>
            <View className="flex-row items-center justify-between mb-2">
              <Text className="text-sm font-semibold text-foreground">
                Sources{sources.length > 0 ? ` (${sources.filter((s) => s.selected).length}/${sources.length})` : ""}
              </Text>
              <Pressable
                onPress={() => setShowAddSource(!showAddSource)}
                className="rounded-lg px-3 py-1.5 bg-surface border border-primary active:opacity-80"
              >
                <Text className="text-xs font-semibold text-primary">{showAddSource ? "Close" : "+ Add Source"}</Text>
              </Pressable>
            </View>
            <Text className="text-xs text-muted mb-2">
              Selected sources are fed to the AI script generator as context.
            </Text>

            {showAddSource && (
              <View className="bg-surface border border-border rounded-lg p-3 gap-3 mb-2">
                {/* Text source */}
                <View className="gap-2">
                  <TextInput
                    value={textDraft}
                    onChangeText={setTextDraft}
                    placeholder="Paste text to use as a source…"
                    placeholderTextColor={colors.muted}
                    className="bg-background border border-border rounded-lg px-3 py-2 text-foreground min-h-16"
                    multiline
                  />
                  <Pressable onPress={addTextSource} className="rounded-lg p-2 items-center bg-background border border-border active:opacity-70">
                    <Text className="text-xs font-semibold text-foreground">+ Add Text</Text>
                  </Pressable>
                </View>
                {/* Website source */}
                <View className="flex-row gap-2">
                  <TextInput
                    value={urlDraft}
                    onChangeText={setUrlDraft}
                    placeholder="https://example.com/article"
                    placeholderTextColor={colors.muted}
                    autoCapitalize="none"
                    keyboardType="url"
                    className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-foreground"
                  />
                  <Pressable onPress={addWebsiteSource} className="rounded-lg px-3 items-center justify-center bg-background border border-border active:opacity-70">
                    <Text className="text-xs font-semibold text-foreground">+ Web</Text>
                  </Pressable>
                </View>
                {/* File source */}
                <Pressable onPress={addFileSource} className="rounded-lg p-2 items-center bg-background border border-border active:opacity-70">
                  <Text className="text-xs font-semibold text-foreground">📄 Add File (text)</Text>
                </Pressable>
                {/* Cloud storage OAuth */}
                {isServerConfigured() && (
                  <View className="gap-2 pt-2 border-t border-border">
                    <Text className="text-xs text-muted">Cloud Storage (OAuth)</Text>
                    {([
                      { label: "Google Drive", icon: "G", provider: "google_drive" },
                      { label: "Dropbox", icon: "⬡", provider: "dropbox" },
                      { label: "OneDrive", icon: "☁", provider: "onedrive" },
                    ] as const).map((p) => (
                      <Pressable
                        key={p.provider}
                        onPress={async () => {
                          try {
                            const result = await trpcMutate<{ authUrl: string; state: string }>(
                              "oauth.getAuthorizationUrl",
                              { platform: p.provider }
                            );
                            if (result?.authUrl) {
                              await WebBrowser.openBrowserAsync(result.authUrl);
                            } else {
                              Alert.alert("Not configured", `Configure ${p.label} in Settings → Integrations first.`);
                            }
                          } catch {
                            Alert.alert("Not configured", `Configure ${p.label} in Settings → Integrations first.`);
                          }
                        }}
                        className="rounded-lg p-2 flex-row items-center gap-2 bg-background border border-border active:opacity-70"
                      >
                        <Text className="font-bold text-base">{p.icon}</Text>
                        <Text className="text-xs font-semibold text-foreground">{p.label}</Text>
                      </Pressable>
                    ))}
                  </View>
                )}
              </View>
            )}

            {sources.length > 0 && (
              <View className="gap-2">
                {sources.map((s) => (
                  <View key={s.id} className="flex-row items-center bg-surface border border-border rounded-lg p-2 gap-2">
                    <Pressable onPress={() => toggleSource(s.id)} className="flex-1 flex-row items-center gap-2">
                      <View className={`w-4 h-4 rounded border ${s.selected ? "bg-primary border-primary" : "border-border"}`} />
                      <View className="flex-1">
                        <Text className="text-xs font-semibold text-foreground" numberOfLines={1}>{KIND_LABEL[s.kind]}: {s.label}</Text>
                        <Text className="text-xs text-muted" numberOfLines={1}>{s.content.slice(0, 60)}</Text>
                      </View>
                    </Pressable>
                    <Pressable onPress={() => removeSource(s.id)} className="px-2 active:opacity-70">
                      <Text className="text-xs text-error">✕</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            )}
          </View>

          {/* Episode Length */}
          <View>
            <Text className="text-sm font-semibold text-foreground mb-2">
              Episode Length
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-row">
              <View className="flex-row gap-2">
                {LENGTH_OPTIONS.map((opt) => {
                  const selected = podcastLength === opt.value;
                  return (
                    <Pressable
                      key={opt.value}
                      onPress={() => {
                        setPodcastLength(opt.value);
                        const mins = opt.value === "short" ? 5 : opt.value === "medium" ? 15 : opt.value === "long" ? 30 : 60;
                        setPodcastDuration(mins);
                      }}
                      className={`rounded-lg px-3 py-2 border ${
                        selected
                          ? "bg-primary border-primary"
                          : "bg-surface border-border"
                      }`}
                    >
                      <Text
                        className={`text-xs font-semibold ${
                          selected ? "text-background" : "text-foreground"
                        }`}
                      >
                        {opt.label}
                      </Text>
                      <Text
                        className={`text-xs mt-0.5 ${
                          selected ? "text-background" : "text-muted"
                        }`}
                      >
                        {opt.desc}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>
          </View>

          {/* Episode Duration */}
          <View>
            <Text className="text-sm font-semibold text-foreground mb-2">
              Duration (Minutes): {podcastDuration} min
            </Text>
            <View className="flex-row items-center gap-3 bg-surface border border-border rounded-lg p-2">
              <Pressable
                onPress={() => setPodcastDuration(prev => Math.max(2, prev - 1))}
                className="w-10 h-10 items-center justify-center bg-background border border-border rounded-lg active:opacity-75"
              >
                <Text className="text-foreground text-lg font-bold">-</Text>
              </Pressable>
              <TextInput
                keyboardType="numeric"
                value={String(podcastDuration)}
                onChangeText={(txt) => {
                  const val = parseInt(txt, 10);
                  if (!isNaN(val)) setPodcastDuration(val);
                }}
                className="flex-1 text-center text-foreground font-semibold text-base py-1"
              />
              <Pressable
                onPress={() => setPodcastDuration(prev => Math.min(120, prev + 1))}
                className="w-10 h-10 items-center justify-center bg-background border border-border rounded-lg active:opacity-75"
              >
                <Text className="text-foreground text-lg font-bold">+</Text>
              </Pressable>
            </View>
          </View>

          {/* Synthesis Quality */}
          <View>
            <Text className="text-sm font-semibold text-foreground mb-2">
              Synthesis Quality
            </Text>
            <View className="flex-row gap-2">
              {(["draft", "standard", "high"] as const).map((q) => {
                const selected = podcastQuality === q;
                return (
                  <Pressable
                    key={q}
                    onPress={() => setPodcastQuality(q)}
                    className={`flex-1 rounded-lg py-2 border items-center ${
                      selected ? "bg-primary border-primary" : "bg-surface border-border"
                    }`}
                  >
                    <Text
                      className={`text-xs font-semibold uppercase ${
                        selected ? "text-background" : "text-foreground"
                      }`}
                    >
                      {q}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Script/Content */}
          <View>
            <Text className="text-sm font-semibold text-foreground mb-2">
              Script / Content
            </Text>
            <TextInput
              value={script}
              onChangeText={setScript}
              placeholder="Enter or paste your script here..."
              placeholderTextColor={colors.muted}
              className="bg-surface border border-border rounded-lg px-3 py-2 text-foreground min-h-32"
              multiline
            />
            {/* AI Script Generator */}
            <Pressable
              onPress={handleGenerateScript}
              disabled={isScripting}
              className={`rounded-lg p-3 items-center mt-2 ${
                isScripting
                  ? "bg-muted opacity-50"
                  : "bg-surface border border-primary active:opacity-80"
              }`}
            >
              <Text
                className={`text-sm font-semibold ${
                  isScripting ? "text-muted" : "text-primary"
                }`}
              >
                {isScripting ? "Generating…" : "✨ Generate Script (AI)"}
              </Text>
            </Pressable>
          </View>

          {/* Voice Selection */}
          <View>
            <Text className="text-sm font-semibold text-foreground mb-2">
              Voice
            </Text>
            <Pressable
              onPress={() => setShowVoiceSelector(!showVoiceSelector)}
              className="bg-surface border border-border rounded-lg p-3"
            >
              <Text className="text-foreground">{selectedVoice}</Text>
            </Pressable>

            {showVoiceSelector && (
              <View className="bg-background border border-border rounded-lg mt-2 overflow-hidden">
                {voices.map((voice) => (
                  <Pressable
                    key={voice}
                    onPress={() => {
                      setSelectedVoice(voice);
                      setShowVoiceSelector(false);
                    }}
                    className={`p-3 border-b border-border ${
                      selectedVoice === voice ? "bg-primary/10" : ""
                    }`}
                  >
                    <Text
                      className={`text-sm ${
                        selectedVoice === voice
                          ? "text-primary font-semibold"
                          : "text-foreground"
                      }`}
                    >
                      {voice}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>

          {/* Generation Status */}
          {isGenerating && (
            <View className="bg-surface border border-border rounded-lg p-4">
              <Text className="text-sm text-foreground mb-2">
                Generating podcast...
              </Text>
              <View className="bg-background rounded-full h-2 overflow-hidden">
                <View
                  className="bg-primary h-full"
                  style={{ width: `${generationProgress}%` }}
                />
              </View>
              <Text className="text-xs text-muted mt-2">
                {generationProgress}% complete
              </Text>
            </View>
          )}

          {/* Generate Button */}
          <Pressable
            onPress={handleGenerate}
            disabled={isGenerating}
            className={`rounded-lg p-4 items-center ${
              isGenerating
                ? "bg-muted opacity-50"
                : "bg-primary active:opacity-80"
            }`}
          >
            <Text className="text-background font-semibold text-base">
              {isGenerating ? "Generating..." : "Generate Podcast"}
            </Text>
          </Pressable>

          {/* Player + Download (shown after generation) */}
          {audioUrl && !isGenerating && (
            <View className="bg-surface border border-border rounded-lg p-4 gap-3">
              <Text className="text-sm font-semibold text-foreground">Master Mix</Text>
              <View className="flex-row items-center gap-3">
                <Pressable
                  onPress={() => (playerStatus.playing ? player.pause() : player.play())}
                  className="rounded-full w-12 h-12 items-center justify-center bg-primary active:opacity-80"
                >
                  <Text className="text-background text-lg">{playerStatus.playing ? "⏸" : "▶"}</Text>
                </Pressable>
                <View className="flex-1">
                  <View className="bg-background rounded-full h-2 overflow-hidden">
                    <View
                      className="bg-primary h-full"
                      style={{ width: `${playerStatus.duration ? Math.min(100, (playerStatus.currentTime / playerStatus.duration) * 100) : 0}%` }}
                    />
                  </View>
                  <Text className="text-xs text-muted mt-1">
                    {Math.floor(playerStatus.currentTime)}s
                    {playerStatus.duration ? ` / ${Math.floor(playerStatus.duration)}s` : ""}
                    {playerStatus.isBuffering ? " · buffering…" : ""}
                  </Text>
                </View>
              </View>
              <Pressable
                onPress={handleDownload}
                disabled={isDownloading}
                className={`rounded-lg p-3 items-center ${isDownloading ? "bg-muted opacity-50" : "bg-background border border-border active:opacity-70"}`}
              >
                <Text className="text-sm font-semibold text-foreground">
                  {isDownloading ? "Downloading…" : "⬇️ Download to device (.wav)"}
                </Text>
              </Pressable>
            </View>
          )}
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
