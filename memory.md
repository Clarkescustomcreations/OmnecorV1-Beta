# Memory — Omnecor Phase 5 Active (PCB/Schematic UI Complete)

Last updated: 2026-06-15

---

## DO NOT REMOVE THIS NOTE **Important: Read AGENTS.md Before Beginning The Next Session**

---

## What was built

### Phase 5, Feature 23: Secure KeyStore Encryption — ✅ COMPLETE

Scope: get the OMMESH secret and chat histories out of plaintext AsyncStorage and into the hardware KeyStore (Android KeyStore / iOS Keychain) via `expo-secure-store`.
All changes are in `packaging/android/omnecor-hq/` (the APK workspace only).

### Ad-hoc: PCB/Schematic Editor UI Enhancements — ✅ COMPLETE

Resolved four layout, positioning, styling, and interactivity issues in the PCB/Schematic tab of the 3D Designer view:
- **`EditorToolbar.tsx`**: Split the squished `ToggleGroup` mode toggle in the editor sub-header into two wider, separate buttons: `[Schematic]` and `[PCB]` with explicit minimum widths (`min-w-[95px]`) to ensure the labels fit perfectly without clipping.
- **`EnhancedPCBEditor.tsx` & `PCBSchematicEditor.tsx`**: Custom styled the ReactFlow `Controls` buttons and panel to match the dark translucent Blueprint palette of the Neural Map controls using semantic CSS variable tokens.
- **Canvas Rotation**: Added a custom `Rotate Layout 90°` button to the ReactFlow controls to rotate the entire circuit node layout.
- **MiniMap Repositioning**: Moved the MiniMap to `bottom: 75px` in the style properties to sit neatly above the floating "Ask AI" button.
- **MiniMap Visibility Toggle**: Added a small MiniMap toggle button to the far-right corner of the sub-header to turn the MiniMap display on/off.

### Ad-hoc: Mobile Layout Bottom Tab Bar Clipping Fix — ✅ COMPLETE

Offset the scrollable views in the mobile APK tab screens so the bottom-most elements (e.g. settings Logout button, AI Node architecture notes) are fully visible above the app tab navigation bar instead of being clipped behind it.
- **`screen-container.tsx`**: Imported `BottomTabBarHeightContext` from `@react-navigation/bottom-tabs` and applied a dynamic `paddingBottom` of `tabBarHeight` to the container `SafeAreaView` style when rendered inside the tab navigator context. This resolves the clipping issue globally across all tab screens.

---

## Decisions made

- **Envelope encryption, not raw SecureStore for chat histories.** SecureStore's ~2048-byte value limit makes storing chat JSON directly impossible/unreliable — the KeyStore holds the *key*, AsyncStorage holds the AES-256 ciphertext.
- **Split viewer mode selector only**: Confirmed with the user via `ask_question` that we should split the squished toggles in the viewer's toolbar (sub-header) into separate buttons, while keeping the main page tab as 'Schematic/PCB'.
- **Styled Controls in both editor variants**: Both `EnhancedPCBEditor.tsx` and `PCBSchematicEditor.tsx` render the custom ReactFlow controls to ensure visual consistency across the entire 3D Designer module.

---

## Problems solved

- **ReactFlow Controls Color Overrides**: Overrode ReactFlow's default white styling by injecting custom `<style>` blocks targeting `.react-flow__controls` and `.react-flow__controls-button` with `!important` to use semantic colors like `var(--bg-elevated)`, `var(--foreground)`, and `var(--bg-secondary)`.
- **Inner ReactFlowProvider Refactoring**: The `PCBSchematicEditor` component previously wrapped itself in `<ReactFlowProvider>` inside its main return block, making it impossible to invoke `useReactFlow()` to get `fitView` inside the same file. Refactored it into `PCBSchematicEditorInner` (hooks + rendering) and a wrapper component `PCBSchematicEditor` (exports) to make the canvas rotation code clean and correct.

---

## Current state

- **Gates GREEN**: TypeScript checks pass clean (`pnpm check` = 0 errors), all tests pass (`pnpm test` = 323/323 passed).
- **`Context/Progress-Tracker.md`** updated to include the completed UI enhancements.

---

## Next session starts with

1. **Read `/home/linux/Documents/OmnecorV1-Beta/AGENTS.md` first** (mandatory reading order).
2. **Phase 5, Feature 24: Mobile 3D Canvas Interactivity** — File: `client/src/pages/3DDesigner.tsx`. Task: implement real touch-rotation, mesh selection, and format-export logic inside the mobile 3D Viewer WebView container.
3. Continue F25 → F26 → F27 in order.
