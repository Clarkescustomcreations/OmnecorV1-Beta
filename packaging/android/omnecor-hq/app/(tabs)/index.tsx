import { Text, View, TextInput, FlatList, ActivityIndicator, Image, Share, Modal } from "react-native";
import { Pressable } from "@/components/pressable";
import { useState, useRef, useCallback, useEffect } from "react";
import Markdown from "react-native-markdown-display";
import * as Clipboard from "expo-clipboard";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useVoice } from "@/hooks/use-voice";
import { getServerBaseUrl, isServerConfigured } from "@/lib/_core/server-config";
import * as Auth from "@/lib/_core/auth";
import { isModelLoaded, runInference } from "@/lib/_core/local-inference";
import { trpcQuery, trpcMutate } from "@/lib/_core/trpc-fetch";
import { listModelsForProvider, resolveDefaultModel, type ChatModel } from "@/lib/_core/ai-models";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { loadChats, saveChats, type StoredChatSession } from "@/lib/_core/chat-store";

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

  const [hydrated, setHydrated] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>([
    { id: "1", title: "New Conversation", messages: [
      { id: "1", role: "assistant", content: "Hello! I'm Omnecor HQ. Connect to your PC in Settings, then start chatting.", timestamp: new Date() },
    ]},
  ]);
  const [activeSessionId, setActiveSessionId]               = useState("1");
  const [messageInput, setMessageInput]                     = useState("");
  const [isSending, setIsSending]                           = useState(false);
  const [isUploading, setIsUploading]                       = useState(false);
  const [showSessionSelector, setShowSessionSelector]       = useState(false);
  const [showNeuralMapSelector, setShowNeuralMapSelector]   = useState(false);
  const [showAgentSelector, setShowAgentSelector]           = useState(false);
  const [selectedNeuralMap, setSelectedNeuralMap]           = useState("Default");
  const [selectedAgent, setSelectedAgent]                   = useState("Default Agent");
  const [autoRead, setAutoRead]                             = useState(false);
  const [actionSheetTarget, setActionSheetTarget]           = useState<ChatMessage | null>(null);

  const [neuralMapList, setNeuralMapList] = useState<{ id: string; name: string; mode: string }[]>([]);
  const [personaList, setPersonaList]     = useState<{ id: string; name: string }[]>([]);
  const [selectedNeuralMapId, setSelectedNeuralMapId] = useState<string | null>(null);
  const [selectedPersonaId, setSelectedPersonaId]     = useState<string | null>(null);
  const [providers, setProviders] = useState<{ id: string; name: string }[]>([]);

  // ── Model selection (real: PC-installed Ollama models / cloud catalog) ──
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [models, setModels]                         = useState<ChatModel[]>([]);
  const [selectedModelId, setSelectedModelId]       = useState<string | null>(null);
  const [showModelSelector, setShowModelSelector]   = useState(false);

  const activeSession = sessions.find((s) => s.id === activeSessionId);

  // ── Load persisted chats on mount ──
  useEffect(() => {
    loadChats()
      .then((snapshot) => {
        if (snapshot && snapshot.sessions.length > 0) {
          const revived = snapshot.sessions.map((s: StoredChatSession) => ({
            ...s,
            messages: s.messages.map((m) => ({
              ...m,
              timestamp: new Date(m.timestamp),
            })),
          }));
          setSessions(revived);
          const activeExists = revived.some((s) => s.id === snapshot.activeSessionId);
          setActiveSessionId(activeExists ? snapshot.activeSessionId : revived[0].id);
        }
      })
      .finally(() => setHydrated(true));
  }, []);

  // ── Persist chats whenever sessions or activeSessionId change ──
  useEffect(() => {
    if (!hydrated) return;
    const serialized: StoredChatSession[] = sessions.map((s) => {
      const ext = s as unknown as { neuralMapId?: string | null; personaId?: string | null };
      return {
        id: s.id,
        title: s.title,
        neuralMapId: ext.neuralMapId,
        personaId: ext.personaId,
        messages: s.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          timestamp: new Date(m.timestamp).toISOString(),
        })),
      };
    });
    saveChats({ sessions: serialized, activeSessionId });
  }, [sessions, activeSessionId, hydrated]);

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
        if (providerList?.length) {
          setProviders(providerList);
          // Default to a real provider (prefer a non-mesh one for direct chat).
          const pick = providerList.find((p) => p.id !== "ommesh") ?? providerList[0];
          if (pick) setSelectedProviderId((cur) => cur ?? pick.id);
        }
      } catch {
        // Server offline — leave lists empty; the UI shows truthful empty states.
      }
    })();
  }, []);

  // Load the selected provider's real models (PC-installed Ollama models or the
  // cloud catalog) and default the model to the first available one.
  useEffect(() => {
    if (!selectedProviderId || !isServerConfigured()) return;
    let cancelled = false;
    (async () => {
      const list = await listModelsForProvider(selectedProviderId);
      if (cancelled) return;
      setModels(list);
      setSelectedModelId((cur) => (cur && list.some((m) => m.id === cur) ? cur : list[0]?.id ?? null));
    })();
    return () => { cancelled = true; };
  }, [selectedProviderId]);

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
      let noModel = false;

      if (isServerConfigured()) {
        // Try PC server (ai.chat tRPC mutation) with the real selected model.
        const base       = getServerBaseUrl();
        const token      = await Auth.getSessionToken();
        const providerId = selectedProviderId ?? providers[0]?.id ?? "ollama";
        const modelId    = selectedModelId ?? (await resolveDefaultModel(providerId));

        if (!modelId) {
          // No installed/cataloged model — don't guess a tag the PC may not have.
          noModel = true;
        } else {
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
              providerId,
              modelId,
              messages: [{ role: "user", content: text }],
              ...(systemPrompt ? { systemPrompt } : {}),
            }}),
          });
          if (resp.ok) {
            const data = await resp.json();
            reply = data?.result?.data?.json?.content ?? data?.result?.data?.content ?? "";
          }
        }
      }

      if (!reply && isModelLoaded()) {
        // Fall back to on-device model (Phone AI Node offline mode)
        reply = await runInference(`User: ${text}\nAssistant:`);
      }

      if (!reply) {
        reply = !isServerConfigured()
          ? "No server configured. Go to Settings to enter your PC's Tailscale or LAN IP."
          : noModel
            ? "Connected, but no model is available. Install an Ollama model on the PC, or pick a provider/model above."
            : "Could not reach the Omnecor server. Check Settings → Connection.";
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
  }, [messageInput, isSending, activeSessionId, appendMessage, autoRead, voice, providers, selectedProviderId, selectedModelId, selectedNeuralMap, selectedAgent]);

  const handleMicPress = useCallback(async () => {
    if (voice.isRecording) {
      const transcript = await voice.stopAndTranscribe();
      if (transcript) setMessageInput(transcript);
    } else {
      await voice.startRecording();
    }
  }, [voice]);

  const handleAttachPhoto = useCallback(async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return;

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: "images",
        base64: true,
        quality: 0.7,
      });

      if (result.canceled) return;
      const asset = result.assets[0];

      if (!isServerConfigured()) {
        appendMessage(activeSessionId, {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: "⚠ Server not configured. Go to Settings to connect to your Omnecor PC.",
          timestamp: new Date(),
        });
        return;
      }

      const name = asset.fileName ?? "photo.jpg";
      const mimeType = asset.mimeType ?? "image/jpeg";
      const dataUrl = asset.base64;

      setIsUploading(true);
      const res = await trpcMutate<{ filename: string; url: string }>("attachments.uploadFile", {
        name,
        mimeType,
        dataUrl,
      });

      setMessageInput((prev) =>
        `${prev} ![${res.filename}](${getServerBaseUrl()}${res.url})`.trim()
      );
    } catch (err) {
      appendMessage(activeSessionId, {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: "⚠ Error uploading photo: " + String(err),
        timestamp: new Date(),
      });
    } finally {
      setIsUploading(false);
    }
  }, [activeSessionId, appendMessage]);

  const handleAttachFile = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        type: "*/*",
      });

      if (result.canceled) return;
      const asset = result.assets[0];

      if (!isServerConfigured()) {
        appendMessage(activeSessionId, {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: "⚠ Server not configured. Go to Settings to connect to your Omnecor PC.",
          timestamp: new Date(),
        });
        return;
      }

      const base64 = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      const name = asset.name;
      const mimeType = asset.mimeType ?? "application/octet-stream";

      setIsUploading(true);
      const res = await trpcMutate<{ filename: string; url: string }>("attachments.uploadFile", {
        name,
        mimeType,
        dataUrl: base64,
      });

      setMessageInput((prev) => `${prev} [${res.filename}](${getServerBaseUrl()}${res.url})`.trim());
    } catch (err) {
      appendMessage(activeSessionId, {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: "⚠ Error uploading file: " + String(err),
        timestamp: new Date(),
      });
    } finally {
      setIsUploading(false);
    }
  }, [activeSessionId, appendMessage]);

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

        {/* Model — real PC-installed Ollama models / cloud catalog */}
        <Pressable onPress={() => setShowModelSelector(!showModelSelector)}
          className="bg-background border border-border rounded-lg p-3">
          <Text className="text-sm text-muted">Model</Text>
          <Text className="text-base font-semibold text-foreground" numberOfLines={1}>
            {selectedModelId
              ? `${models.find((m) => m.id === selectedModelId)?.name ?? selectedModelId}`
                + `${selectedProviderId ? `  ·  ${providers.find((p) => p.id === selectedProviderId)?.name ?? selectedProviderId}` : ""}`
              : isServerConfigured() ? "No models found — install one on the PC" : "Connect to your PC first"}
          </Text>
        </Pressable>
        {showModelSelector && (
          <View className="bg-background border border-border rounded-lg overflow-hidden">
            {providers.length > 1 && (
              <View className="flex-row flex-wrap gap-2 p-2 border-b border-border">
                {providers.map((p) => (
                  <Pressable key={p.id} onPress={() => setSelectedProviderId(p.id)}
                    className={`rounded-lg px-3 py-1 ${selectedProviderId === p.id ? "bg-primary" : "bg-surface border border-border"}`}>
                    <Text className={`text-xs font-semibold ${selectedProviderId === p.id ? "text-background" : "text-foreground"}`}>{p.name}</Text>
                  </Pressable>
                ))}
              </View>
            )}
            {models.length > 0 ? (
              models.map((m) => (
                <Pressable key={m.id} onPress={() => { setSelectedModelId(m.id); setShowModelSelector(false); }}
                  className={`p-3 border-b border-border ${selectedModelId === m.id ? "bg-primary/10" : ""}`}>
                  <Text className={`text-sm ${selectedModelId === m.id ? "text-primary font-semibold" : "text-foreground"}`}>{m.name}</Text>
                </Pressable>
              ))
            ) : (
              <View className="p-3">
                <Text className="text-sm text-muted">
                  {isServerConfigured()
                    ? "No models available for this provider. Install an Ollama model on the PC, or add an API key for the provider in Settings."
                    : "Connect to your PC in Settings to load available models."}
                </Text>
              </View>
            )}
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
            {[
              { key: "__default", label: "Default", onPress: () => { setSelectedNeuralMapId(null); setSelectedNeuralMap("Default"); setShowNeuralMapSelector(false); }, active: selectedNeuralMap === "Default" },
              ...neuralMapList.map((m) => ({
                key: m.id,
                label: m.name,
                onPress: () => { setSelectedNeuralMapId(m.id); setSelectedNeuralMap(m.name); setShowNeuralMapSelector(false); },
                active: selectedNeuralMap === m.name,
              })),
            ].map((item) => (
              <Pressable key={item.key} onPress={item.onPress}
                className={`p-3 border-b border-border ${item.active ? "bg-primary/10" : ""}`}>
                <Text className={`text-sm ${item.active ? "text-primary font-semibold" : "text-foreground"}`}>{item.label}</Text>
              </Pressable>
            ))}
            {neuralMapList.length === 0 && isServerConfigured() && (
              <View className="p-3 border-t border-border">
                <Text className="text-xs text-muted">No neural maps on the PC yet — create one in the desktop app.</Text>
              </View>
            )}
          </View>
        )}
        {showAgentSelector && (
          <View className="bg-background border border-border rounded-lg overflow-hidden">
            {[
              { key: "__default", label: "Default Agent", onPress: () => { setSelectedPersonaId(null); setSelectedAgent("Default Agent"); setShowAgentSelector(false); }, active: selectedAgent === "Default Agent" },
              ...personaList.map((a) => ({
                key: a.id,
                label: a.name,
                onPress: () => { setSelectedPersonaId(a.id); setSelectedAgent(a.name); setShowAgentSelector(false); },
                active: selectedAgent === a.name,
              })),
            ].map((item) => (
              <Pressable key={item.key} onPress={item.onPress}
                className={`p-3 border-b border-border ${item.active ? "bg-primary/10" : ""}`}>
                <Text className={`text-sm ${item.active ? "text-primary font-semibold" : "text-foreground"}`}>{item.label}</Text>
              </Pressable>
            ))}
            {personaList.length === 0 && isServerConfigured() && (
              <View className="p-3 border-t border-border">
                <Text className="text-xs text-muted">No personas on the PC yet — create one in the desktop app.</Text>
              </View>
            )}
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
            <Pressable
              onLongPress={() => setActionSheetTarget(item)}
              className={`max-w-xs rounded-lg p-3 ${item.role === "user" ? "bg-primary" : "bg-surface border border-border"}`}
            >
              {item.role === "user" ? (
                <Text className="text-sm text-background">{item.content}</Text>
              ) : (
                <Markdown
                  rules={{
                    image: (node: { key?: string; attributes?: { src?: string; alt?: string } }) => {
                      const src = node.attributes?.src ?? "";
                      const resolvedSrc = src.startsWith("/") ? `${getServerBaseUrl()}${src}` : src;
                      return (
                        <Image
                          key={node.key}
                          source={{ uri: resolvedSrc }}
                          style={{ width: "100%", height: 200, borderRadius: 8, marginVertical: 4 }}
                          resizeMode="contain"
                        />
                      );
                    },
                  }}
                  style={{
                    body: { color: colors.foreground, fontSize: 14, lineHeight: 20 },
                    strong: { fontWeight: "700" },
                    em: { fontStyle: "italic" },
                    code_inline: { backgroundColor: colors.card, borderRadius: 4, paddingHorizontal: 4, fontFamily: "monospace" },
                    fence: { backgroundColor: colors.card, borderRadius: 8, padding: 8, marginVertical: 4 },
                    blockquote: { borderLeftWidth: 3, borderLeftColor: colors.muted, paddingLeft: 8, opacity: 0.8 },
                  }}
                >
                  {item.content}
                </Markdown>
              )}
            </Pressable>
          </View>
        )}
        contentContainerStyle={{ flexGrow: 1 }}
        ListEmptyComponent={<View className="flex-1 items-center justify-center"><Text className="text-muted">No messages yet</Text></View>}
      />

      {/* ── Long-press Action Sheet ── */}
      <Modal transparent animationType="slide" visible={!!actionSheetTarget} onRequestClose={() => setActionSheetTarget(null)}>
        <Pressable className="flex-1 bg-black/40" onPress={() => setActionSheetTarget(null)}>
          <View className="flex-1" />
          <Pressable onPress={() => {/* stop propagation */}}>
            <View className="bg-surface border-t border-border rounded-t-2xl pb-8">
              <View className="w-10 h-1 bg-border rounded-full self-center mt-3 mb-4" />
              {[
                {
                  label: "Copy",
                  onPress: async () => {
                    if (actionSheetTarget) await Clipboard.setStringAsync(actionSheetTarget.content);
                    setActionSheetTarget(null);
                  },
                },
                {
                  label: "Read Aloud",
                  onPress: () => {
                    if (actionSheetTarget) voice.speak(actionSheetTarget.content);
                    setActionSheetTarget(null);
                  },
                },
                ...(actionSheetTarget?.role === "user" ? [{
                  label: "Delete",
                  onPress: () => {
                    if (!actionSheetTarget) return;
                    setSessions(prev => prev.map(s =>
                      s.id === activeSessionId
                        ? { ...s, messages: s.messages.filter(m => m.id !== actionSheetTarget.id) }
                        : s
                    ));
                    setActionSheetTarget(null);
                  },
                }] : []),
                {
                  label: "Share",
                  onPress: async () => {
                    if (actionSheetTarget) await Share.share({ message: actionSheetTarget.content });
                    setActionSheetTarget(null);
                  },
                },
              ].map((action) => (
                <Pressable
                  key={action.label}
                  onPress={action.onPress}
                  className="px-6 py-4 border-b border-border/50 active:bg-muted/20"
                >
                  <Text className="text-base text-foreground">{action.label}</Text>
                </Pressable>
              ))}
              <Pressable onPress={() => setActionSheetTarget(null)} className="px-6 py-4 active:bg-muted/20">
                <Text className="text-base text-primary font-semibold text-center">Cancel</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

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
          <Pressable onPress={handleAttachFile} disabled={isUploading}
            className={`flex-1 bg-surface border border-border rounded-lg p-2 items-center ${isUploading ? "opacity-50" : "active:opacity-70"}`}>
            <Text className="text-foreground text-sm">{isUploading ? "Uploading…" : "📎 File"}</Text>
          </Pressable>
          <Pressable onPress={handleAttachPhoto} disabled={isUploading}
            className={`flex-1 bg-surface border border-border rounded-lg p-2 items-center ${isUploading ? "opacity-50" : "active:opacity-70"}`}>
            <Text className="text-foreground text-sm">{isUploading ? "Uploading…" : "📷 Photo"}</Text>
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
