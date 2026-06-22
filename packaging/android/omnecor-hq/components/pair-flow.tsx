/**
 * Pair-with-PC flow — the phone's primary way to connect to its Omnecor PC.
 *
 * Scan the QR shown on the desktop (Settings → Devices), which carries the PC
 * address + a one-time secret and pairs in a single step; or switch to manual
 * entry and type the PC's IP + the 6-digit code. No OAuth, no account.
 */
import { useState, useRef, useCallback } from "react";
import { View, Text, TextInput, ActivityIndicator } from "react-native";
import { Pressable } from "@/components/pressable";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useColors } from "@/hooks/use-colors";
import { getNodeName, getServerIp } from "@/lib/_core/server-config";
import { parsePairingPayload, pairFromQr, pairWithCodeAt } from "@/lib/_core/pairing";

export function PairFlow({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const colors = useColors();
  const [permission, requestPermission] = useCameraPermissions();
  const [mode, setMode] = useState<"scan" | "manual">("scan");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [ip, setIp] = useState(getServerIp());
  const [port, setPort] = useState("3000");
  const [code, setCode] = useState("");
  const scannedRef = useRef(false);

  const deviceName = getNodeName() || "Phone";

  const onScanned = useCallback(
    async ({ data }: { data: string }) => {
      if (scannedRef.current || busy) return;
      const target = parsePairingPayload(data);
      if (!target) return; // ignore QR codes that aren't ours
      scannedRef.current = true;
      setBusy(true);
      setNote(null);
      try {
        await pairFromQr(target, deviceName);
        onDone();
      } catch (e) {
        scannedRef.current = false;
        setNote(e instanceof Error ? e.message : "Pairing failed.");
      } finally {
        setBusy(false);
      }
    },
    [busy, deviceName, onDone],
  );

  const handleManual = useCallback(async () => {
    if (!ip.trim()) { setNote("Enter your PC's IP address."); return; }
    if (!/^\d{6}$/.test(code.trim())) { setNote("Enter the 6-digit code shown on your PC."); return; }
    setBusy(true);
    setNote(null);
    try {
      await pairWithCodeAt(ip, port, code, deviceName);
      onDone();
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Pairing failed.");
    } finally {
      setBusy(false);
    }
  }, [ip, port, code, deviceName, onDone]);

  return (
    <View className="gap-3">
      <Text className="text-lg font-bold text-foreground">Pair with your PC</Text>
      <Text className="text-xs text-muted">
        On your PC open Omnecor → Settings → Devices → “Pair a device”. Scan the QR, or switch to manual entry.
      </Text>

      <View className="flex-row gap-2 mt-1">
        <Pressable onPress={() => setMode("scan")}
          className={`flex-1 rounded-lg p-2 items-center ${mode === "scan" ? "bg-primary" : "bg-background border border-border"}`}>
          <Text className={`text-sm font-semibold ${mode === "scan" ? "text-background" : "text-foreground"}`}>Scan QR</Text>
        </Pressable>
        <Pressable onPress={() => setMode("manual")}
          className={`flex-1 rounded-lg p-2 items-center ${mode === "manual" ? "bg-primary" : "bg-background border border-border"}`}>
          <Text className={`text-sm font-semibold ${mode === "manual" ? "text-background" : "text-foreground"}`}>Enter code</Text>
        </Pressable>
      </View>

      {mode === "scan" && (
        <View className="rounded-xl overflow-hidden border border-border" style={{ height: 280 }}>
          {!permission ? (
            <View className="flex-1 items-center justify-center"><ActivityIndicator color={colors.primary} /></View>
          ) : !permission.granted ? (
            <View className="flex-1 items-center justify-center p-4 gap-3">
              <Text className="text-sm text-muted text-center">Camera access is needed to scan the pairing QR.</Text>
              <Pressable onPress={requestPermission} className="bg-primary rounded-xl px-4 py-2 active:opacity-80">
                <Text className="text-background font-semibold">Allow camera</Text>
              </Pressable>
            </View>
          ) : (
            <CameraView
              style={{ flex: 1 }}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              onBarcodeScanned={busy ? undefined : onScanned}
            />
          )}
        </View>
      )}

      {mode === "manual" && (
        <View className="gap-2">
          <TextInput value={ip} onChangeText={setIp} placeholder="PC IP (Tailscale 100.x or LAN 192.168.x)"
            placeholderTextColor={colors.muted} autoCapitalize="none" keyboardType="numbers-and-punctuation"
            className="bg-background border border-border rounded-lg px-3 py-3 text-foreground" />
          <TextInput value={port} onChangeText={setPort} placeholder="Port (3000)"
            placeholderTextColor={colors.muted} keyboardType="number-pad"
            className="bg-background border border-border rounded-lg px-3 py-3 text-foreground" />
          <TextInput value={code} onChangeText={setCode} placeholder="6-digit code" maxLength={6}
            placeholderTextColor={colors.muted} keyboardType="number-pad"
            className="bg-background border border-border rounded-lg px-3 py-3 text-foreground text-lg tracking-widest" />
          <Pressable disabled={busy} onPress={handleManual}
            className="bg-primary rounded-xl p-4 active:opacity-80 flex-row justify-center items-center gap-2">
            {busy && <ActivityIndicator size="small" color={colors.background} />}
            <Text className="text-background font-semibold text-center">Pair</Text>
          </Pressable>
        </View>
      )}

      {note && <Text className="text-xs text-warning text-center">{note}</Text>}

      <Pressable disabled={busy} onPress={onBack} className="p-2 active:opacity-60">
        <Text className="text-muted text-center text-sm">‹ Back</Text>
      </Pressable>
    </View>
  );
}
