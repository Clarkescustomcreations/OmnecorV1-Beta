// MUST be first: installs a real crypto.getRandomValues (native CSPRNG) so
// secure nanoid/uuid work in Hermes. Without it, account creation throws
// "property crypto doesn't exist".
import "react-native-get-random-values";
import "@/global.css";
import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import "react-native-reanimated";
import { Alert, Platform } from "react-native";
import { useShareIntent } from "expo-share-intent";
import { importSharedModelFile } from "@/lib/_core/model-download";
import "@/lib/_core/nativewind-pressable";
import { ThemeProvider } from "@/lib/theme-provider";
import {
  SafeAreaFrameContext,
  SafeAreaInsetsContext,
  SafeAreaProvider,
  initialWindowMetrics,
} from "react-native-safe-area-context";
import type { EdgeInsets, Metrics, Rect } from "react-native-safe-area-context";

import { trpc, createTRPCClient } from "@/lib/trpc";
import { initManusRuntime, subscribeSafeAreaInsets } from "@/lib/_core/manus-runtime";
import { loadServerConfig } from "@/lib/_core/server-config";
import { loadListenConfig } from "@/lib/_core/always-listen-config";
import { useAlwaysListenCapture } from "@/hooks/use-always-listen";
import { startConnectionMonitor, subscribeConnection } from "@/lib/_core/connection";
import { loadAccount, isOnboarded, getAccount, syncAccountToPc } from "@/lib/_core/account";
import { syncChatsToPc } from "@/lib/_core/chat-sync";
import { SetupFlow } from "@/components/setup-flow";
import { View } from "react-native";

const DEFAULT_WEB_INSETS: EdgeInsets = { top: 0, right: 0, bottom: 0, left: 0 };
const DEFAULT_WEB_FRAME: Rect = { x: 0, y: 0, width: 0, height: 0 };

export const unstable_settings = {
  anchor: "(tabs)",
};

export default function RootLayout() {
  const initialInsets = initialWindowMetrics?.insets ?? DEFAULT_WEB_INSETS;
  const initialFrame = initialWindowMetrics?.frame ?? DEFAULT_WEB_FRAME;

  const [insets, setInsets] = useState<EdgeInsets>(initialInsets);
  const [frame, setFrame] = useState<Rect>(initialFrame);

  // Initialize Manus runtime for cookie injection from parent container
  useEffect(() => {
    initManusRuntime();
  }, []);

  // Register the app-wide utterance capture provider for Always-Listening, so a
  // wake event works regardless of which screen is mounted.
  useAlwaysListenCapture();

  const handleSafeAreaUpdate = useCallback((metrics: Metrics) => {
    setInsets(metrics.insets);
    setFrame(metrics.frame);
  }, []);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const unsubscribe = subscribeSafeAreaInsets(handleSafeAreaUpdate);
    return () => unsubscribe();
  }, [handleSafeAreaUpdate]);

  // Create clients once and reuse them
  const [queryClient] = useState(
    () =>
      new QueryClient({
        // Global safety net so no mutation can ever fail silently: any
        // mutation without its own onError handler surfaces the failure.
        // Mutations that do define onError keep full control (no double alert).
        mutationCache: new MutationCache({
          onError: (error, _variables, _context, mutation) => {
            console.warn("[API Mutation Error]", error);
            if (!mutation.options.onError) {
              const message = error instanceof Error ? error.message : String(error);
              Alert.alert("Request failed", message.length > 200 ? `${message.slice(0, 200)}…` : message);
            }
          },
        }),
        defaultOptions: {
          queries: {
            // Disable automatic refetching on window focus for mobile
            refetchOnWindowFocus: false,
            // Retry failed requests once
            retry: 1,
          },
        },
      }),
  );
  const [trpcClient] = useState(() => createTRPCClient());

  // ── Startup: load persisted PC config + account, start the connection
  // monitor. NONE of this blocks on the network — the app always loads. ──
  const [ready, setReady] = useState(false);
  const [onboarded, setOnboarded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try { await loadServerConfig(); } catch { /* offline-safe */ }
      try { await loadListenConfig(); } catch { /* offline-safe */ }
      try { await loadAccount(); } catch { /* offline-safe */ }
      if (cancelled) return;
      setOnboarded(isOnboarded());
      startConnectionMonitor();
      setReady(true);
    })();
    return () => { cancelled = true; };
  }, []);

  // Receive models SHARED into the app ("Share → Omnecor HQ" from e.g. Google
  // AI Edge Gallery). Copies any shared .gguf/.task model into the models dir
  // so it can be loaded in Settings — no document-picker / adb step needed.
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent({ resetOnBackground: true });
  useEffect(() => {
    if (!hasShareIntent || !shareIntent.files?.length) return;
    (async () => {
      const imported: string[] = [];
      for (const f of shareIntent.files ?? []) {
        try {
          const m = await importSharedModelFile(f.path, f.fileName);
          if (m) imported.push(m.filename);
        } catch { /* skip non-model / unreadable file */ }
      }
      if (imported.length) {
        Alert.alert("Model imported", `${imported.join(", ")}\n\nOpen Settings → Phone AI Model to load it.`);
      }
      resetShareIntent();
    })();
  }, [hasShareIntent, shareIntent, resetShareIntent]);

  // When the PC becomes reachable, register/adopt the local identity once
  // (no double login). Best-effort; safe to call repeatedly.
  useEffect(() => {
    return subscribeConnection((s) => {
      if (!s.online) return;
      const acc = getAccount();
      if (acc?.method === "local" && !acc.syncedToPc) {
        // Register/adopt identity first, then push any local chats.
        void syncAccountToPc().then(() => syncChatsToPc());
      } else {
        void syncChatsToPc();
      }
    });
  }, []);

  // Ensure minimum 8px padding for top and bottom on mobile
  const providerInitialMetrics = useMemo(() => {
    const metrics = initialWindowMetrics ?? { insets: initialInsets, frame: initialFrame };
    return {
      ...metrics,
      insets: {
        ...metrics.insets,
        top: Math.max(metrics.insets.top, 16),
        bottom: Math.max(metrics.insets.bottom, 12),
      },
    };
  }, [initialInsets, initialFrame]);

  const content = (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <trpc.Provider client={trpcClient} queryClient={queryClient as any}>
        <QueryClientProvider client={queryClient}>
          {/* Splash blank until persisted state is loaded (no network wait). */}
          {!ready ? (
            <View style={{ flex: 1 }} />
          ) : !onboarded ? (
            <SetupFlow onDone={() => setOnboarded(true)} />
          ) : (
            // Default to hiding native headers so raw route segments don't appear.
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="oauth/callback" />
            </Stack>
          )}
          <StatusBar style="auto" />
        </QueryClientProvider>
      </trpc.Provider>
    </GestureHandlerRootView>
  );

  const shouldOverrideSafeArea = Platform.OS === "web";

  if (shouldOverrideSafeArea) {
    return (
      <ThemeProvider>
        <SafeAreaProvider initialMetrics={providerInitialMetrics}>
          <SafeAreaFrameContext.Provider value={frame}>
            <SafeAreaInsetsContext.Provider value={insets}>
              {content}
            </SafeAreaInsetsContext.Provider>
          </SafeAreaFrameContext.Provider>
        </SafeAreaProvider>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <SafeAreaProvider initialMetrics={providerInitialMetrics}>{content}</SafeAreaProvider>
    </ThemeProvider>
  );
}
