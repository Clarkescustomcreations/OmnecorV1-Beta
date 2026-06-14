/**
 * App-wide Pressable — drop-in replacement for react-native's Pressable.
 *
 * Why: React Native's own Pressable, once NativeWind's `cssInterop` wraps it
 * (which happens automatically for any core RN component used with a `className`
 * under `jsxImportSource: "nativewind"`), SWALLOWS `onPress` on release / Fabric
 * (new-architecture) builds — the button renders styled but never fires
 * (NativeWind #1583 / RN new-arch Pressable-stuck). Verified on-device.
 *
 * The gesture-handler Pressable keeps a working touch responder under Fabric.
 * We `cssInterop` it so NativeWind `className` styling still applies. Verified
 * on-device: styled AND tappable.
 *
 * Requires a `GestureHandlerRootView` ancestor (present at the app root in
 * app/_layout.tsx). API-compatible with react-native's Pressable (onPress,
 * onLongPress, disabled, style, function children, etc.).
 */
import { Pressable as GHPressable } from "react-native-gesture-handler";
import { cssInterop } from "nativewind";

cssInterop(GHPressable, { className: "style" });

export const Pressable = GHPressable;
export default GHPressable;
