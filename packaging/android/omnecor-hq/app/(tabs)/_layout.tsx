/**
 * Tab navigator for Omnecor HQ.
 * Icons mirror the OmnecorV1-Beta desktop sidebar (Lucide → Material Icons mapping
 * lives in components/ui/icon-symbol.tsx).
 */
import { Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Platform } from "react-native";
import { HapticTab } from "@/components/haptic-tab";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";

export default function TabLayout() {
  const colors        = useColors();
  const insets        = useSafeAreaInsets();
  const bottomPadding = Platform.OS === "web" ? 12 : Math.max(insets.bottom, 8);
  const tabBarHeight  = 56 + bottomPadding;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.tint,
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarStyle: {
          paddingTop: 8,
          paddingBottom: bottomPadding,
          height: tabBarHeight,
          backgroundColor: colors.background,
          borderTopColor: colors.border,
          borderTopWidth: 0.5,
        },
        tabBarLabelStyle: { fontSize: 10 },
      }}
    >
      {/* Chat — MessageCircle in main GUI */}
      <Tabs.Screen name="index"
        options={{ title: "Chat",
          tabBarIcon: ({ color }) => <IconSymbol size={24} name="message.fill" color={color} /> }} />

      {/* HITL — Bell (notifications-active) in main GUI */}
      <Tabs.Screen name="hitl"
        options={{ title: "HITL",
          tabBarIcon: ({ color }) => <IconSymbol size={24} name="bell.badge.fill" color={color} /> }} />

      {/* Notifications — unified alert feed + Agent Messenger */}
      <Tabs.Screen name="notifications"
        options={{ title: "Alerts",
          tabBarIcon: ({ color }) => <IconSymbol size={24} name="bell.fill" color={color} /> }} />

      {/* Phone AI Node — cpu/memory */}
      <Tabs.Screen name="ai-node"
        options={{ title: "AI Node",
          tabBarIcon: ({ color }) => <IconSymbol size={24} name="cpu.fill" color={color} /> }} />

      {/* Status — BarChart2 / waveform */}
      <Tabs.Screen name="status"
        options={{ title: "Status",
          tabBarIcon: ({ color }) => <IconSymbol size={24} name="waveform" color={color} /> }} />

      {/* Terminal — code */}
      <Tabs.Screen name="terminal"
        options={{ title: "Terminal",
          tabBarIcon: ({ color }) => <IconSymbol size={24} name="chevron.left.forwardslash.chevron.right" color={color} /> }} />

      {/* Podcast Studio — Mic2 in main GUI */}
      <Tabs.Screen name="podcast"
        options={{ title: "Podcast",
          tabBarIcon: ({ color }) => <IconSymbol size={24} name="mic.fill" color={color} /> }} />

      {/* 3D Viewer — Box / cube */}
      <Tabs.Screen name="viewer"
        options={{ title: "3D View",
          tabBarIcon: ({ color }) => <IconSymbol size={24} name="cube.fill" color={color} /> }} />

      {/* Settings — gearshape */}
      <Tabs.Screen name="settings"
        options={{ title: "Settings",
          tabBarIcon: ({ color }) => <IconSymbol size={24} name="gearshape.fill" color={color} /> }} />
    </Tabs>
  );
}
