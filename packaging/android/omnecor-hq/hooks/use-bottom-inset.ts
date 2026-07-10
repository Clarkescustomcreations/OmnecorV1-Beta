/**
 * Bottom padding a SCROLLABLE tab screen should add to its scroll content
 * (`contentContainerStyle.paddingBottom`) so its last item (button, text box)
 * isn't pinned against the bottom tab bar.
 *
 * The tab bar RESERVES its own layout space (it is opaque + non-absolute, and it
 * already absorbs the system-nav inset), so the scroll viewport already ends at
 * the tab bar's top edge. All we need is a little breathing room — NOT a full
 * tab-bar height. Padding by the tab-bar height here would leave an ~80px dead
 * background gap below the last item when scrolled. Matches the app's existing
 * flat `paddingBottom` convention (Status used 20).
 *
 * Screens whose last element is a bottom-anchored bar (Chat input, Terminal
 * controls, 3D action bar) do NOT need this — those bars already sit flush above
 * the reserved tab bar.
 */
export function useBottomInset(extra = 24): number {
  return extra;
}
