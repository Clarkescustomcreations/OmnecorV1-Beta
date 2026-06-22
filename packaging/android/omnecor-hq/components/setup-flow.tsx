/**
 * First-run login / setup for Omnecor HQ.
 *
 * Mirrors the desktop SetupWizard "account" step: Continue with Google /
 * Microsoft (via the PC's OAuth when connected), create a local account by
 * username (works fully offline — no double login, syncs to the PC later), or
 * skip for GUI-only testing. Rendered by the root layout until onboarded.
 */
import { useState } from "react";
import { View, Text, TextInput, ActivityIndicator, ScrollView } from "react-native";
import { Pressable } from "@/components/pressable";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { createLocalAccount, skipOnboarding } from "@/lib/_core/account";
import { isServerConfigured } from "@/lib/_core/server-config";
import { PairFlow } from "@/components/pair-flow";

export function SetupFlow({ onDone }: { onDone: () => void }) {
  const colors = useColors();
  const [view, setView] = useState<"choose" | "local" | "pair">("choose");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const configured = isServerConfigured();

  const handleLocal = async () => {
    if (!username.trim()) { setNote("Enter a username."); return; }
    setBusy(true);
    try {
      await createLocalAccount({ username: username.trim(), password: password || undefined });
      onDone();
    } catch (e) {
      setNote("Could not create account: " + String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleSkip = async () => {
    setBusy(true);
    try { await skipOnboarding(); onDone(); } finally { setBusy(false); }
  };

  return (
    <ScreenContainer className="flex-1 bg-background" hideConnectionBanner>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 24 }}>
        <Text className="text-3xl font-black text-foreground text-center mb-1">Omnecor HQ</Text>
        <Text className="text-sm text-muted text-center mb-8">Remote command center for your Omnecor PC</Text>

        {view === "choose" && (
          <View className="gap-3">
            <Pressable disabled={busy} onPress={() => { setView("pair"); setNote(null); }}
              className="bg-primary rounded-xl p-4 active:opacity-80">
              <Text className="text-background font-semibold text-center">Pair with my PC</Text>
            </Pressable>
            <Text className="text-xs text-muted text-center -mt-1">
              Scan the QR (or type the code) from your PC → Settings → Devices. No login needed.
            </Text>

            <View className="flex-row items-center my-1">
              <View className="flex-1 h-px bg-border" />
              <Text className="text-muted text-xs mx-3">or</Text>
              <View className="flex-1 h-px bg-border" />
            </View>

            <Pressable disabled={busy} onPress={() => setView("local")}
              className="bg-surface border border-border rounded-xl p-4 active:opacity-80">
              <Text className="text-foreground font-semibold text-center">Create a local account</Text>
            </Pressable>
            <Pressable disabled={busy} onPress={handleSkip}
              className="rounded-xl p-3 active:opacity-60">
              <Text className="text-muted text-center text-sm">Skip — explore offline</Text>
            </Pressable>

            <Text className="text-xs text-muted text-center mt-2">
              {configured ? "🟢 PC connected" : "A local account works fully offline and auto-registers on your PC when it connects."}
            </Text>
          </View>
        )}

        {view === "pair" && (
          <PairFlow onDone={onDone} onBack={() => { setView("choose"); setNote(null); }} />
        )}

        {view === "local" && (
          <View className="gap-3">
            <Text className="text-lg font-bold text-foreground">Create local account</Text>
            <Text className="text-xs text-muted">No setup needed. Stored on this device and auto-registered on your PC when it connects — no second login.</Text>
            <TextInput value={username} onChangeText={setUsername} placeholder="Username (e.g. Alex)"
              placeholderTextColor={colors.muted} autoCapitalize="none"
              className="bg-background border border-border rounded-lg px-3 py-3 text-foreground" />
            <TextInput value={password} onChangeText={setPassword} placeholder="Password (optional, min 8)"
              placeholderTextColor={colors.muted} secureTextEntry
              className="bg-background border border-border rounded-lg px-3 py-3 text-foreground" />
            <Pressable disabled={busy} onPress={handleLocal}
              className="bg-primary rounded-xl p-4 active:opacity-80 flex-row justify-center items-center gap-2">
              {busy && <ActivityIndicator size="small" color={colors.background} />}
              <Text className="text-background font-semibold text-center">Create account & continue</Text>
            </Pressable>
            <Pressable disabled={busy} onPress={() => { setView("choose"); setNote(null); }} className="p-2 active:opacity-60">
              <Text className="text-muted text-center text-sm">‹ Back</Text>
            </Pressable>
          </View>
        )}

        {note && <Text className="text-xs text-warning text-center mt-4">{note}</Text>}
      </ScrollView>
    </ScreenContainer>
  );
}
