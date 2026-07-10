import React, { useState, useEffect, useRef } from "react";
import { View, Text, ActivityIndicator } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { useColors } from "@/hooks/use-colors";
import { pickQuote, type QuoteStyle } from "@/lib/_core/quote-bag";

// ── Component ─────────────────────────────────────────────────────────────────
//
// Mirrors the web `LoadingQuote`: a module-scoped shuffle bag (`pickQuote`)
// guarantees no repeats until the whole pool is exhausted, and the `typewriter`
// variant types the quote out flush-left (used inside the agentic stream) while
// the boxed variant fades between quotes (used under bubbles / while sending).

export interface LoadingQuoteProps {
  quoteStyle?: QuoteStyle;
  /** Stream mode: type the quote out flush-left as plain text (no box). */
  typewriter?: boolean;
}

export function LoadingQuote({ quoteStyle = "random", typewriter = false }: LoadingQuoteProps) {
  const colors = useColors();
  const [quote, setQuote] = useState(() => pickQuote(quoteStyle));

  // Draw a fresh quote from the new pool when the style changes — but not on the
  // initial mount (useState already drew one).
  const firstStyleRun = useRef(true);
  useEffect(() => {
    if (firstStyleRun.current) {
      firstStyleRun.current = false;
      return;
    }
    setQuote(pickQuote(quoteStyle));
  }, [quoteStyle]);

  // Boxed variant — swap the quote every 3s.
  useEffect(() => {
    if (typewriter) return;
    const interval = setInterval(() => setQuote(pickQuote(quoteStyle)), 3000);
    return () => clearInterval(interval);
  }, [quoteStyle, typewriter]);

  // Typewriter variant — type the quote out, hold, then move to the next.
  const [typed, setTyped] = useState("");
  useEffect(() => {
    if (!typewriter) return;
    setTyped("");
    let i = 0;
    let t: ReturnType<typeof setTimeout>;
    const step = () => {
      i++;
      setTyped(quote.slice(0, i));
      if (i < quote.length) {
        t = setTimeout(step, 52); // ~19 chars/sec — a touch faster than human typing
      } else {
        t = setTimeout(() => setQuote(pickQuote(quoteStyle)), 1500);
      }
    };
    t = setTimeout(step, 52);
    return () => clearTimeout(t);
  }, [quote, quoteStyle, typewriter]);

  if (typewriter) {
    return (
      <Text className="text-sm italic text-muted">
        {typed}
        <Text className="not-italic text-primary">▋</Text>
      </Text>
    );
  }

  return (
    <View className="bg-muted/20 border border-border/50 rounded-lg px-4 py-3 min-h-[48px] max-w-[280px] flex-row items-center gap-3">
      <ActivityIndicator size="small" color={colors.primary} />
      <Animated.Text
        key={quote}
        entering={FadeIn.duration(300)}
        exiting={FadeOut.duration(300)}
        className="text-xs font-medium text-muted"
        style={{ flex: 1 }}
      >
        {quote}
      </Animated.Text>
    </View>
  );
}
