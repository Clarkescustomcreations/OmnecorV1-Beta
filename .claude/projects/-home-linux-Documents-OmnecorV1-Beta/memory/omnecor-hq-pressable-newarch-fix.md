---
name: omnecor-hq-pressable-newarch-fix
description: Omnecor HQ mobile — why all buttons must import Pressable from @/components/pressable (NativeWind + new-arch onPress fix)
metadata:
  type: project
---

**Hard-won fix (2026-06-13): every tappable in the Omnecor HQ app MUST use `Pressable` from `@/components/pressable`, NOT from `react-native`.** See [[omnecor-hq-standalone-arch]].

**Symptom:** the release/standalone APK launched and rendered perfectly but EVERY button was dead — `onPress` never fired (login screen "locked", no tab content reachable). No crash. Debug builds hid it because they need Metro and fell over first.

**Root cause:** NativeWind v4 (4.2.5, the latest stable) + React Native 0.81 **new architecture (Fabric)**. With `jsxImportSource: "nativewind"`, any RN core `Pressable` used with a `className` gets wrapped by `cssInterop`, and that wrapper SWALLOWS the touch responder under Fabric (NativeWind issue #1583 / RN new-arch "Pressable stuck"). `remapProps(Pressable, {className:"style"})` did NOT fix it.

**Proven on-device (adb screenshots):** a plain RN `Pressable` (no className) works; a `react-native-gesture-handler` `Pressable` works; an RN `Pressable` WITH className is dead. The fix: a `cssInterop`'d gesture-handler Pressable keeps BOTH styling and touch.

**The fix that shipped:**
- `components/pressable.tsx` — `import { Pressable as GHPressable } from "react-native-gesture-handler"; cssInterop(GHPressable, { className: "style" }); export const Pressable = GHPressable;`
- Every screen/component swapped `import { Pressable } from "react-native"` → `import { Pressable } from "@/components/pressable"` (index, status, podcast, ai-node, terminal, viewer, notifications, settings, setup-flow, connection-banner). Tab bar (`HapticTab`) uses react-navigation's `PlatformPressable` and was fine.
- Requires a `GestureHandlerRootView` ancestor (already at the app root in `app/_layout.tsx`).

**Also fixed alongside (same debugging session, all device-validated on a Samsung S25 Ultra / SM8750):**
- Standalone APK must be a **RELEASE** build (`pnpm apk:release` → `app-release.apk`) — the debug APK doesn't bundle JS and needs Metro, which looks like a "dead start". Release build is debug-signed (template default) so it installs with plain `adb install`.
- A duplicate-React crash (NativeWind cssInterop `useContext of null`) fixed by a Metro single-instance resolver in `metro.config.js` that pins `react`/`react-dom` (NOT react-native — pinning react-native there breaks platform `.android` resolution and kills touch too).
- **Model-load crash** (`UnsatisfiedLinkError: libcdsprpc.so not found`): llama.rn 0.9.7 auto-selects its `hexagon_opencl` native variant on Snapdragon SOC_MODELs (SM8750 etc.), which needs the Qualcomm vendor lib `libcdsprpc.so` — not loadable from an app sandbox. Fixed with a **persistent pnpm patch** (`patches/llama.rn.patch`, registered in `pnpm-workspace.yaml` `patchedDependencies`) forcing `hasHexagon = false` in `LlamaContext.java` → loads the CPU `dotprod_i8mm` variant. NOTE: a direct `node_modules` edit gets reverted by `pnpm install` — must be a pnpm patch.
- **Download integrity:** `model-download.ts` now validates the downloaded file size vs `model.sizeGb` and deletes/throws on a truncated download (a partial GGUF loads as "tensor data not within file bounds, model is corrupted").
- **"property crypto doesn't exist"** on local-account register: secure `nanoid()` needs `crypto.getRandomValues`, absent in Hermes. Fixed properly (user wanted secure, no shortcuts) with **`react-native-get-random-values`** imported as the FIRST line of `app/_layout.tsx` (native CSPRNG). Do NOT fall back to `nanoid/non-secure` for anything sensitive.
- **Keyboard hides bottom inputs** (Android edge-to-edge doesn't auto-resize for the IME): `components/screen-container.tsx` wraps content in `KeyboardAvoidingView behavior="padding"` (NOT "height" — "height" didn't lift the input). Device-confirmed it lifts chat + setup inputs above the keyboard.

**Rule for future mobile UI work:** never import `Pressable` from `react-native` in this app; always `@/components/pressable`. Verify any new touch-y third-party component the same way (plain vs gesture-handler) before trusting it under the new arch. Persist native-module source fixes as pnpm patches, never node_modules edits.
