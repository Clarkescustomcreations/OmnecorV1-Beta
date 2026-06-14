// NativeWind v4 + React Native New Architecture: when `Pressable` goes through
// the full `cssInterop` wrapper (which it does by default with
// jsxImportSource:"nativewind", to track `active:`/`hover:` pseudo-state), the
// press responder is swallowed on release/Fabric builds — the button renders
// styled but `onPress` never fires (NativeWind #1583).
//
// Fix: register Pressable for a STATIC className→style remap instead. This keeps
// className styling working while leaving Pressable's native touch responder
// intact (trade-off: no automatic `active:` press-dim, which we don't rely on
// for functionality). Applied globally so every Pressable in the app is tappable.
import { Pressable } from "react-native";
import { remapProps } from "nativewind";

remapProps(Pressable, { className: "style" });
