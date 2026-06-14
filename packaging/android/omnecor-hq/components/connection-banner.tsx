/**
 * Thin global indicator of desktop connectivity, rendered at the top of every
 * screen via ScreenContainer. Shows nothing when the PC is reachable; a subtle
 * bar otherwise so the app is clearly usable offline (independent GUI testing).
 */
import { View, Text } from "react-native";
import { Pressable } from "@/components/pressable";
import { useConnection } from "@/hooks/use-connection";

export function ConnectionBanner() {
  const { configured, online, checking, refresh } = useConnection();

  if (online) return null;

  const label = !configured
    ? "No PC connection — add your Omnecor PC in Settings"
    : checking
    ? "Connecting to PC…"
    : "No PC connection — tap to retry";

  return (
    <Pressable onPress={refresh} className="bg-warning/15 border-b border-warning/40 px-3 py-1.5 active:opacity-70">
      <Text className="text-[11px] text-warning text-center" numberOfLines={1}>
        {`⚠ ${label}`}
      </Text>
    </Pressable>
  );
}
