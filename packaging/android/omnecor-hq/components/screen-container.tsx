import { View, KeyboardAvoidingView, type ViewProps } from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";

import { cn } from "@/lib/utils";
import { ConnectionBanner } from "@/components/connection-banner";

export interface ScreenContainerProps extends ViewProps {
  /**
   * SafeArea edges to apply. Defaults to ["top", "left", "right"].
   * Bottom is typically handled by Tab Bar.
   */
  edges?: Edge[];
  /**
   * Tailwind className for the content area.
   */
  className?: string;
  /**
   * Additional className for the outer container (background layer).
   */
  containerClassName?: string;
  /**
   * Additional className for the SafeAreaView (content layer).
   */
  safeAreaClassName?: string;
  /**
   * Hide the global "No PC connection" banner (e.g. on the setup screen).
   */
  hideConnectionBanner?: boolean;
}

/**
 * A container component that properly handles SafeArea and background colors.
 *
 * The outer View extends to full screen (including status bar area) with the background color,
 * while the inner SafeAreaView ensures content is within safe bounds.
 *
 * Usage:
 * ```tsx
 * <ScreenContainer className="p-4">
 *   <Text className="text-2xl font-bold text-foreground">
 *     Welcome
 *   </Text>
 * </ScreenContainer>
 * ```
 */
export function ScreenContainer({
  children,
  edges = ["top", "left", "right"],
  className,
  containerClassName,
  safeAreaClassName,
  hideConnectionBanner,
  style,
  ...props
}: ScreenContainerProps) {
  // NOTE: we deliberately do NOT add a container-level bottom inset here. The tab
  // bar reserves its own layout space (opaque, non-absolute), so bottom-anchored
  // bars (chat input, terminal controls) already sit flush above it. SCROLLABLE
  // screens instead pad their own scroll content via `useBottomTabBarHeight()` in
  // `contentContainerStyle.paddingBottom` — the React-Navigation-recommended
  // pattern — so their last item clears the bar with no dead black strip.
  return (
    <View
      className={cn(
        "flex-1",
        "bg-background",
        containerClassName
      )}
      {...props}
    >
      <SafeAreaView
        edges={edges}
        className={cn("flex-1", safeAreaClassName)}
        style={style}
      >
        {!hideConnectionBanner && <ConnectionBanner />}
        {/* Lift bottom-anchored inputs above the on-screen keyboard. Under
            Android edge-to-edge the window doesn't auto-resize for the IME, so
            we drive it here (height shrinks the content above the keyboard;
            iOS uses padding). */}
        <KeyboardAvoidingView
          className={cn("flex-1", className)}
          behavior="padding"
        >
          {children}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
