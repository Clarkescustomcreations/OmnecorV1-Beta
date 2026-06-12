import { ScrollView, Text, View, TextInput, Pressable, Alert } from "react-native";
import { useState } from "react";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { trpcMutate } from "@/lib/_core/trpc-fetch";
import { isServerConfigured } from "@/lib/_core/server-config";

export default function PodcastScreen() {
  const colors = useColors();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [script, setScript] = useState("");
  const [selectedVoice, setSelectedVoice] = useState("Default");
  const [duration, setDuration] = useState("10");
  const [quality, setQuality] = useState("High");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [audioPath, setAudioPath] = useState<string | null>(null);
  const [showVoiceSelector, setShowVoiceSelector] = useState(false);
  const [showQualitySelector, setShowQualitySelector] = useState(false);

  const voices = ["Default", "Male", "Female", "Narrator", "Casual"];
  const qualities = ["Low", "Medium", "High", "Ultra"];

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
    } catch (err: any) {
      setIsGenerating(false);
      Alert.alert("Error", err?.message ?? "Podcast generation failed");
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

          {/* Duration and Quality */}
          <View className="flex-row gap-3">
            <View className="flex-1">
              <Text className="text-sm font-semibold text-foreground mb-2">
                Duration (min)
              </Text>
              <TextInput
                value={duration}
                onChangeText={setDuration}
                placeholder="10"
                placeholderTextColor={colors.muted}
                keyboardType="number-pad"
                className="bg-surface border border-border rounded-lg px-3 py-2 text-foreground"
              />
            </View>

            <View className="flex-1">
              <Text className="text-sm font-semibold text-foreground mb-2">
                Quality
              </Text>
              <Pressable
                onPress={() => setShowQualitySelector(!showQualitySelector)}
                className="bg-surface border border-border rounded-lg p-3"
              >
                <Text className="text-foreground text-center">{quality}</Text>
              </Pressable>

              {showQualitySelector && (
                <View className="bg-background border border-border rounded-lg mt-2 overflow-hidden">
                  {qualities.map((q) => (
                    <Pressable
                      key={q}
                      onPress={() => {
                        setQuality(q);
                        setShowQualitySelector(false);
                      }}
                      className={`p-3 border-b border-border ${
                        quality === q ? "bg-primary/10" : ""
                      }`}
                    >
                      <Text
                        className={`text-sm text-center ${
                          quality === q
                            ? "text-primary font-semibold"
                            : "text-foreground"
                        }`}
                      >
                        {q}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
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
