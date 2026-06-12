/**
 * Terminal — live remote shell on the PC over WebSocket PTY.
 *
 * Drives a real pseudo-terminal on the Omnecor server (the PC already implements
 * the pty:* protocol). Auto-connects on mount when a server IP is configured in
 * Settings. Output is the raw PTY stream (ANSI-stripped); input runs real
 * commands in a real shell on the PC.
 */
import { ScrollView, Text, View, TextInput, Pressable } from "react-native";
import { useState, useEffect, useRef } from "react";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useTerminal, type TerminalStatus } from "@/hooks/use-terminal";
import { isServerConfigured, getServerIp } from "@/lib/_core/server-config";

const STATUS_COLOR: Record<TerminalStatus, string> = {
  disconnected: "text-muted",
  connecting:   "text-warning",
  ready:        "text-success",
  error:        "text-error",
};

const STATUS_LABEL: Record<TerminalStatus, string> = {
  disconnected: "Disconnected",
  connecting:   "Connecting…",
  ready:        "● Connected",
  error:        "Connection error",
};

export default function TerminalScreen() {
  const colors = useColors();
  const { status, output, connect, disconnect, sendCommand, interrupt, clear } = useTerminal();

  const [commandInput, setCommandInput]     = useState("");
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex]     = useState(-1);
  const scrollRef = useRef<ScrollView>(null);

  // Auto-connect on mount if the PC is configured.
  useEffect(() => {
    if (isServerConfigured()) connect();
    return () => disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the view pinned to the latest output.
  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [output]);

  const handleExecuteCommand = () => {
    if (!commandInput.trim() || status !== "ready") return;
    sendCommand(commandInput);
    setCommandHistory((h) => [...h, commandInput]);
    setHistoryIndex(-1);
    setCommandInput("");
  };

  const handleHistoryUp = () => {
    if (commandHistory.length === 0) return;
    const newIndex = Math.min(historyIndex + 1, commandHistory.length - 1);
    setHistoryIndex(newIndex);
    setCommandInput(commandHistory[commandHistory.length - 1 - newIndex]);
  };

  const handleHistoryDown = () => {
    if (historyIndex <= 0) {
      setHistoryIndex(-1);
      setCommandInput("");
    } else {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      setCommandInput(commandHistory[commandHistory.length - 1 - newIndex]);
    }
  };

  return (
    <ScreenContainer className="flex-1 bg-background">
      {/* ── Status bar ─────────────────────────────────────────────── */}
      <View className="flex-row items-center justify-between px-4 py-2 border-b border-border bg-surface">
        <Text className={`text-xs font-semibold ${STATUS_COLOR[status]}`}>
          {STATUS_LABEL[status]}
          {isServerConfigured() ? `  ·  ${getServerIp()}` : ""}
        </Text>
        {status === "ready" || status === "connecting" ? (
          <Pressable onPress={disconnect} className="px-2 py-1 rounded border border-error active:opacity-70">
            <Text className="text-error text-xs font-semibold">Disconnect</Text>
          </Pressable>
        ) : (
          <Pressable onPress={connect} className="px-2 py-1 rounded bg-primary active:opacity-80">
            <Text className="text-background text-xs font-semibold">Connect</Text>
          </Pressable>
        )}
      </View>

      {/* ── Output stream ──────────────────────────────────────────── */}
      <ScrollView
        ref={scrollRef}
        className="flex-1"
        contentContainerStyle={{ padding: 12, flexGrow: 1 }}
        showsVerticalScrollIndicator
      >
        {output === "" ? (
          <View className="flex-1 items-center justify-center py-8">
            <Text className="text-muted text-xs">
              {status === "ready" ? "Shell ready — type a command below" :
               status === "connecting" ? "Spawning shell on PC…" :
               !isServerConfigured() ? "Set the PC IP in Settings → Omnecor Server" :
               "Tap Connect to open a shell"}
            </Text>
          </View>
        ) : (
          <Text className="font-mono text-xs text-foreground" selectable>
            {output}
          </Text>
        )}
      </ScrollView>

      {/* ── Controls ───────────────────────────────────────────────── */}
      <View className="border-t border-border bg-surface p-4 gap-3">
        <View className="flex-row gap-2 items-center">
          <Text className="text-foreground font-mono">$</Text>
          <TextInput
            value={commandInput}
            onChangeText={setCommandInput}
            onSubmitEditing={handleExecuteCommand}
            editable={status === "ready"}
            placeholder={status === "ready" ? "Enter command…" : "Not connected"}
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-foreground font-mono text-xs"
          />
          <Pressable
            onPress={handleExecuteCommand}
            disabled={status !== "ready"}
            className={`rounded-lg px-3 py-2 ${status === "ready" ? "bg-primary active:opacity-80" : "bg-primary/30"}`}
          >
            <Text className="text-background font-semibold text-xs">Enter</Text>
          </Pressable>
        </View>

        <View className="flex-row gap-2">
          <Pressable onPress={handleHistoryUp}
            className="flex-1 bg-surface border border-border rounded-lg p-2 items-center active:opacity-70">
            <Text className="text-foreground text-xs">↑ History</Text>
          </Pressable>
          <Pressable onPress={handleHistoryDown}
            className="flex-1 bg-surface border border-border rounded-lg p-2 items-center active:opacity-70">
            <Text className="text-foreground text-xs">↓ History</Text>
          </Pressable>
          <Pressable onPress={interrupt} disabled={status !== "ready"}
            className={`flex-1 border rounded-lg p-2 items-center ${status === "ready" ? "bg-warning/20 border-warning active:opacity-70" : "border-muted/30"}`}>
            <Text className={`text-xs font-semibold ${status === "ready" ? "text-warning" : "text-muted"}`}>^C</Text>
          </Pressable>
          <Pressable onPress={clear}
            className="flex-1 bg-error/20 border border-error rounded-lg p-2 items-center active:opacity-70">
            <Text className="text-error text-xs font-semibold">Clear</Text>
          </Pressable>
        </View>

        <View className="bg-background border border-border rounded-lg p-2">
          <Text className="text-xs text-muted">
            💡 Real shell on the PC. ↑↓ recalls history, ^C interrupts. Runs over Tailscale/LAN.
          </Text>
        </View>
      </View>
    </ScreenContainer>
  );
}
