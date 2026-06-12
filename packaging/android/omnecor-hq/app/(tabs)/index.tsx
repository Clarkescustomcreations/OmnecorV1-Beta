import { Text, View, TextInput, Pressable, FlatList, ActivityIndicator } from "react-native";
import { useState, useRef, useCallback, useEffect } from "react";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useVoice } from "@/hooks/use-voice";
import { getServerBaseUrl, isServerConfigured } from "@/lib/_core/server-config";
import * as Auth from "@/lib/_core/auth";
import { isModelLoaded, runInference } from "@/lib/_core/local-inference";
import { trpcQuery } from "@/lib/_core/trpc-fetch";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
}

export default function ChatScreen() {
  const colors = useColors();
  const voice  = useVoice();
  const flatListRef = useRef<FlatList>(null);

  const [sessions, setSessions] = useState<ChatSession[]>([
    { id: "1", title: "New Conversation", messages: [
      { id: "1", role: "assistant", content: "Hello! I'm Omnecor HQ. Connect to your PC in Settings, then start chatting.", timestamp: new Date() },
    ]},
  ]);
  const [activeSessionId, setActiveSessionId]               = useState("1");
  const [messageInput, setMessageInput]                     = useState("");
  const [isSending, setIsSending]                           = useState(false);
  const [showSessionSelector, setShowSessionSelector]       = useState(false);
  const [showNeuralMapSelector, setShowNeuralMapSelector]   = useState(false);
  const [showAgentSelector, setShowAgentSelector]           = useState(false);
  const [selectedNeuralMap, setSelectedNeuralMap]           = useState("Default");
  const [selectedAgent, setSelectedAgent]                   = useState("Default Agent");
  const [autoRead, setAutoRead]                             = useState(false);

  const [neuralMapList, setNeuralMapList] = useState<{ id: string; name: string; mode: string }[]>([]);
  const [personaList, setPersonaList]     = useState<{ id: string; name: string }[]>([]);
  const [selectedNeuralMapId, setSelectedNeuralMapId] = useState<string | null>(null);
  const [selectedPersonaId, setSelectedPersonaId]     = useState<string | null>(null);
  const [providers, setProviders] = useState<{ id: string; name: string }[]>([]);

  // Hardcoded fallback arrays (used when server is offline or lists are empty)
  const neuralMaps    = ["Default", "Project A", "Project B"];
  const agents        = ["Default Agent", "Creative", "Technical", "Analyst"];
  const activeSession = sessions.find((s) => s.id === activeSessionId);

  useEffect(() => {
    if (!isServerConfigured()) return;
    (async () => {
      try {
        const [maps, personas, providerList] = await Promise.all([
          trpcQuery<{ id: string; name: string; mode: string }[]>("neuralMaps.list"),
          trpcQuery<{ id: string; name: string }[]>("personas.list"),
          trpcQuery<{ id: string; name: string }[]>("ai.getProviders"),
        ]);
        if (maps?.length)        setNeuralMapList(maps);
        if (personas?.length)    setPersonaList(personas);
        if (providerList?.length) setProviders(providerList);
      } catch {
        // Server offline — silently fail; hardcoded fallbacks remain active
      }
    })();
  }, []);

  const appendMessage = useCallback((sessionId: string, msg: ChatMessage) => {
    setSessions((prev) =>
      prev.map((s) => s.id === sessionId ? { ...s, messages: [...s.messages, msg] } : s)
    );
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
  }, []);

  const handleSend = useCallback(async () => {
    const text = messageInput.trim();
    if (!text || isSending) return;
    setMessageInput("");

    const userMsg: ChatMessage = {
      id: Date.now().toString(), role: "user", content: text, timestamp: new Date(),
    };
    appendMessage(activeSessionId, userMsg);
    setIsSending(true);

    try {
      let reply = "";

      if (isServerConfigured()) {
        // Try PC server (ai.chat tRPC mutation)
        const base     = getServerBaseUrl();
        const token    = await Auth.getSessionToken();
        const provider = providers[0] ?? { id: "ollama", name: "Ollama" };

        const systemParts: string[] = [];
        if (selectedNeuralMap !== "Default") systemParts.push(`Neural Map context: ${selectedNeuralMap}`);
        if (selectedAgent !== "Default Agent") systemParts.push(`Assistant persona: ${selectedAgent}`);
        const systemPrompt = systemParts.length ? systemParts.join(". ") : undefined;

        const resp = await fetch(`${base}/api/trpc/ai.chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ json: {
            providerId: provider.id,
            modelId: "llama3.2:latest",
            messages: [{ role: "user", content: text }],
            ...(systemPrompt ? { systemPrompt } : {}),
          }}),
        });
        if (resp.ok) {
          const data = await resp.json();
          reply = data?.result?.data?.json?.content ?? data?.result?.data?.content ?? "";
        }
      }

      if (!reply && isModelLoaded()) {
        // Fall back to on-device model (Phone AI Node offline mode)
        reply = await runInference(`User: ${text}\nAssistant:`);
      }

      if (!reply) {
        reply = isServerConfigured()
          ? "Could not reach the Omnecor server. Check Settings → Connection."
          : "No server configured. Go to Settings to enter your PC's Tailscale or LAN IP.";
      }

      const assistantMsg: ChatMessage = {
        id: (Date.now() + 1).toString(), role: "assistant", content: reply, timestamp: new Date(),
      };
      appendMessage(activeSessionId, assistantMsg);
      if (autoRead) voice.speak(reply);
    } catch (err) {
      appendMessage(activeSessionId, {
        id: (Date.now() + 1).toString(), role: "assistant",
        content: "⚠ Error: " + String(err), timestamp: new Date(),
      });
    } finally {
      setIsSending(false);
    }
  }, [messageInput, isSending, activeSessionId, appendMessage, autoRead, voice, providers, selectedNeuralMap, selectedAgent]);

  const handleMicPress = useCallback(async () => {
    if (voice.isRecording) {
      const transcript = await voice.stopAndTranscribe();
      if (transcript) setMessageInput(transcript);
    } else {
      await voice.startRecording();
    }
  }, [voice]);

  return (
    <ScreenContainer className="flex-1 bg-background">
      {/* ── Header selectors ── */}
      <View className="bg-surface border-b border-border p-4 gap-3">
        <Pressable onPress={() => setShowSessionSelector(!showSessionSelector)}
          className="bg-background border border-border rounded-lg p-3">
          <Text className="text-sm text-muted">Chat Session</Text>
          <Text className="text-base font-semibold text-foreground">{activeSession?.title ?? "Select a session"}</Text>
        </Pressable>
        {showSessionSelector && (
          <View className="bg-background border border-border rounded-lg overflow-hidden">
            {sessions.map((s) => (
              <Pressable key={s.id} onPress={() => { setActiveSessionId(s.id); setShowSessionSelector(false); }}
                className={`p-3 border-b border-border ${activeSessionId === s.id ? "bg-primary/10" : ""}`}>
                <Text className={`text-sm ${activeSessionId === s.id ? "text-primary font-semibold" : "text-foreground"}`}>{s.title}</Text>
              </Pressable>
            ))}
          </View>
        )}

        <View className="flex-row gap-2">
          <Pressable onPress={() => setShowNeuralMapSelector(!showNeuralMapSelector)}
            className="flex-1 bg-background border border-border rounded-lg p-2">
            <Text className="text-xs text-muted">Neural Map</Text>
            <Text className="text-sm font-semibold text-foreground">{selectedNeuralMap}</Text>
          </Pressable>
          <Pressable onPress={() => setShowAgentSelector(!showAgentSelector)}
            className="flex-1 bg-background border border-border rounded-lg p-2">
            <Text className="text-xs text-muted">Agent</Text>
            <Text className="text-sm font-semibold text-foreground">{selectedAgent}</Text>
          </Pressable>
          {/* TTS auto-read toggle */}
          <Pressable onPress={() => setAutoRead(!autoRead)}
            className={`rounded-lg px-3 py-2 items-center justify-center ${autoRead ? "bg-primary" : "bg-background border border-border"}`}>
            <Text className={`text-lg ${autoRead ? "" : "opacity-50"}`}>🔊</Text>
          </Pressable>
        </View>

        {showNeuralMapSelector && (
          <View className="bg-background border border-border rounded-lg overflow-hidden">
            {(neuralMapList.length > 0
              ? neuralMapList.map((m) => ({
                  key: m.id,
                  label: m.name,
                  onPress: () => { setSelectedNeuralMapId(m.id); setSelectedNeuralMap(m.name); setShowNeuralMapSelector(false); },
                  active: selectedNeuralMap === m.name,
                }))
              : neuralMaps.map((m) => ({
                  key: m,
                  label: m,
                  onPress: () => { setSelectedNeuralMap(m); setShowNeuralMapSelector(false); },
                  active: selectedNeuralMap === m,
                }))
            ).map((item) => (
              <Pressable key={item.key} onPress={item.onPress}
                className={`p-3 border-b border-border ${item.active ? "bg-primary/10" : ""}`}>
                <Text className={`text-sm ${item.active ? "text-primary font-semibold" : "text-foreground"}`}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
        )}
        {showAgentSelector && (
          <View className="bg-background border border-border rounded-lg overflow-hidden">
            {(personaList.length > 0
              ? personaList.map((a) => ({
                  key: a.id,
                  label: a.name,
                  onPress: () => { setSelectedPersonaId(a.id); setSelectedAgent(a.name); setShowAgentSelector(false); },
                  active: selectedAgent === a.name,
                }))
              : agents.map((a) => ({
                  key: a,
                  label: a,
                  onPress: () => { setSelectedAgent(a); setShowAgentSelector(false); },
                  active: selectedAgent === a,
                }))
            ).map((item) => (
              <Pressable key={item.key} onPress={item.onPress}
                className={`p-3 border-b border-border ${item.active ? "bg-primary/10" : ""}`}>
                <Text className={`text-sm ${item.active ? "text-primary font-semibold" : "text-foreground"}`}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>

      {/* ── Messages ── */}
      <FlatList
        ref={flatListRef}
        data={activeSession?.messages ?? []}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View className={`px-4 py-3 ${item.role === "user" ? "items-end" : "items-start"}`}>
            {/* Long-press assistant messages to read aloud */}
            <Pressable onLongPress={() => item.role === "assistant" && voice.speak(item.content)}
              className={`max-w-xs rounded-lg p-3 ${item.role === "user" ? "bg-primary" : "bg-surface border border-border"}`}>
              <Text className={`text-sm ${item.role === "user" ? "text-background" : "text-foreground"}`}>{item.content}</Text>
            </Pressable>
          </View>
        )}
        contentContainerStyle={{ flexGrow: 1 }}
        ListEmptyComponent={<View className="flex-1 items-center justify-center"><Text className="text-muted">No messages yet</Text></View>}
      />

      {/* ── Input area ── */}
      <View className="border-t border-border bg-surface p-4 gap-3">
        {voice.error && (
          <View className="bg-error/10 border border-error rounded-lg p-2">
            <Text className="text-xs text-error">{voice.error}</Text>
          </View>
        )}

        <View className="flex-row gap-2 items-end">
          {/* Mic button */}
          <Pressable onPress={handleMicPress} disabled={voice.isTranscribing}
            className={`rounded-lg px-3 py-2 items-center justify-center ${
              voice.isRecording ? "bg-error" : voice.isTranscribing ? "bg-warning/50" : "bg-surface border border-border"
            }`}>
            {voice.isTranscribing
              ? <ActivityIndicator size="small" color={colors.primary} />
              : <Text className="text-lg">{voice.isRecording ? "⏹" : "🎤"}</Text>
            }
          </Pressable>

          <TextInput value={messageInput} onChangeText={setMessageInput}
            placeholder={voice.isRecording ? "Recording… tap ⏹ to stop" : "Type a message…"}
            placeholderTextColor={colors.muted}
            className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-foreground"
            multiline onSubmitEditing={handleSend} />

          <Pressable onPress={handleSend} disabled={isSending || !messageInput.trim()}
            className={`rounded-lg px-4 py-2 items-center justify-center ${isSending || !messageInput.trim() ? "bg-primary/50" : "bg-primary active:opacity-80"}`}>
            {isSending
              ? <ActivityIndicator size="small" color="white" />
              : <Text className="text-background font-semibold">Send</Text>
            }
          </Pressable>
        </View>

        <View className="flex-row gap-2">
          <Pressable className="flex-1 bg-surface border border-border rounded-lg p-2 items-center active:opacity-70">
            <Text className="text-foreground text-sm">📎 File</Text>
          </Pressable>
          <Pressable className="flex-1 bg-surface border border-border rounded-lg p-2 items-center active:opacity-70">
            <Text className="text-foreground text-sm">📷 Photo</Text>
          </Pressable>
          {voice.isSpeaking && (
            <Pressable onPress={voice.stopSpeaking}
              className="flex-1 bg-error/20 border border-error rounded-lg p-2 items-center active:opacity-70">
              <Text className="text-error text-sm">⏹ Stop TTS</Text>
            </Pressable>
          )}
        </View>

        <View className="bg-background border border-border rounded-lg p-2 flex-row justify-between">
          <Text className="text-xs text-muted">
            {isServerConfigured() ? "🟢 Server connected" : "🔴 No server — open Settings"}
          </Text>
          <Text className="text-xs text-muted">{isModelLoaded() ? "🤖 Phone AI ready" : ""}</Text>
        </View>
      </View>
    </ScreenContainer>
  );
}
