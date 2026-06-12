// Fallback for using MaterialIcons on Android and web.
// Icon names mirror the Lucide icons used in OmnecorV1-Beta's OmnecorDashboardLayout.tsx.

import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { SymbolWeight } from "expo-symbols";
import { ComponentProps } from "react";
import { OpaqueColorValue, type StyleProp, type TextStyle } from "react-native";

type MaterialIconName = ComponentProps<typeof MaterialIcons>["name"];
type IconMapping = Record<string, MaterialIconName>;

// Maps SF Symbol names → Material Icons to match the main Omnecor desktop sidebar icons:
//   MessageCircle → chat           (Chat)
//   Brain         → psychology     (Neural Brain Map)
//   Zap           → bolt           (Model Hub)
//   GitBranch     → account-tree   (Pipelines)
//   Box           → view-in-ar     (3D Designer)
//   Share2        → hub            (Agent Networking)
//   Mic2          → mic            (Podcast Studio)
//   Settings      → settings
//   Bell          → notifications-active  (HITL)
//   BarChart2     → bar-chart      (Status)
//   Cpu           → memory         (Phone AI Node)
const MAPPING: IconMapping = {
  // ── Tab nav — matching main Omnecor GUI icons ────────────────
  "message.fill":                              "chat",
  "brain.head.profile":                        "psychology",
  "bolt.fill":                                 "bolt",
  "point.3.connected.trianglepath":            "account-tree",
  "cube.fill":                                 "view-in-ar",
  "network":                                   "hub",
  "mic.fill":                                  "mic",
  "gearshape.fill":                            "settings",
  "bell.badge.fill":                           "notifications-active",
  "bell.fill":                                 "notifications",
  "waveform":                                  "bar-chart",
  "cpu.fill":                                  "memory",
  // ── Original mappings ────────────────────────────────────────
  "house.fill":                                "home",
  "paperplane.fill":                           "send",
  "chevron.left.forwardslash.chevron.right":   "code",
  "chevron.right":                             "chevron-right",
  // ── Misc UI ─────────────────────────────────────────────────
  "xmark":               "close",
  "checkmark":           "check",
  "plus":                "add",
  "trash.fill":          "delete",
  "arrow.clockwise":     "refresh",
  "wifi":                "wifi",
  "wifi.slash":          "wifi-off",
  "lock.fill":           "lock",
  "key.fill":            "vpn-key",
  "doc.fill":            "description",
  "photo.fill":          "photo",
  "speaker.wave.2.fill": "volume-up",
  "speaker.slash.fill":  "volume-off",
  "mic.slash.fill":      "mic-off",
  "link":                "link",
  "person.fill":         "person",
};

export type IconSymbolName = keyof typeof MAPPING;

export function IconSymbol({
  name,
  size = 24,
  color,
  style,
}: {
  name: string;
  size?: number;
  color: string | OpaqueColorValue;
  style?: StyleProp<TextStyle>;
  weight?: SymbolWeight;
}) {
  const resolved: MaterialIconName = (MAPPING as any)[name] ?? "help-outline";
  return <MaterialIcons color={color} size={size} name={resolved} style={style} />;
}
