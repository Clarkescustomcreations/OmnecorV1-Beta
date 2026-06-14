import { ScrollView, Text, View, TextInput, Alert } from "react-native";
import { Pressable } from "@/components/pressable";
import { useState } from "react";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { trpcMutate } from "@/lib/_core/trpc-fetch";
import { isServerConfigured } from "@/lib/_core/server-config";
import { askAi } from "@/lib/_core/ai-chat";

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
  const [showVoiceSelector, setShowVoiceSelector] = useState(false);
  const [podcastLength, setPodcastLength] = useState("medium");
  const [isScripting, setIsScripting] = useState(false);

  const voices = ["Default", "Male", "Female", "Narrator", "Casual"];

  const handleGenerate = async () => {
    if (!title.trim() || !script.trim()) {
      Alert.alert("Validation", "Please enter a title and script");
      return;
    }

    if (!isServerConfigured()) {
      Alert.alert("No server configured", "Go to Settings and enter your PC's IP address.");
      return;
    }

    setIsGenerating(true);
    setGenerationProgress(0);
    setAudioPath(null);

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
        duration: number;
        segments: unknown[];
      }>("podcast.generate", { title, turns, useRVC });

      setAudioPath(result.audioPath);
      setGenerationProgress(100);
      setIsGenerating(false);
    } catch (err) {
      setIsGenerating(false);
      Alert.alert("Error", err instanceof Error ? err.message : "Podcast generation failed");
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
    const turnCount = LENGTH_OPTIONS.find((l) => l.value === podcastLength)!.turnCount;
    setIsScripting(true);
    try {
      const text = await askAi({
        prompt: `Generate a ${turnCount}-turn podcast script between two hosts named Host and Guest about: "${title.trim()}".${description.trim() ? " Context: " + description.trim() + "." : ""} Put each turn on its own line, alternating Host: and Guest:, no extra commentary.`,
        systemPrompt: "You are a podcast scriptwriter. Output only the dialogue lines.",
      });
      setScript(text);
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
                      onPress={() => setPodcastLength(opt.value)}
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

          {/* Download Button (shown after generation) */}
          {generationProgress === 100 && !isGenerating && audioPath && (
            <Pressable className="rounded-lg p-4 items-center bg-success active:opacity-80">
              <Text className="text-background font-semibold text-base">
                {`⬇️ Audio ready: ${audioPath}`}
              </Text>
            </Pressable>
          )}
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
