import React, { useState, useEffect } from "react";
import { View, ActivityIndicator } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { useColors } from "@/hooks/use-colors";

// ── Quotes authored for Omnecor — match the web client's set exactly ─────────

const SERIOUS_QUOTES = [
  "Computing the optimal response...",
  "Consulting the neural archives...",
  "Synthesizing information...",
  "Parsing the space-time continuum...",
  "Analyzing context vectors...",
  "Compiling thought processes...",
  "Running heuristics...",
  "Aligning dimensional parameters...",
  "Gathering intelligence...",
  "Formulating a reply...",
  "Connecting to quantum processing units...",
  "Calibrating conversational matrices...",
  "Retrieving historical context...",
  "Decoding input semantics...",
];

const FUNNY_QUOTES = [
  "No One messes with Boris! Slughead... I Am Invincible",
  "Go Ahead, Make My Day... Show Me The Error Fool",
  "Nobody Codes Me Into a Corner",
  "But Wait Theres More...",
  "Waskely Bug ! ... I Like Huntin Waskely Bugs",
  "Hey Hey NOW! DONT DO THAT",
  "Oh.. Im Sorry That Last Hand Nearly Killed Me",
  "I Can't Find The Blasted thing",
  "awwww Jeeezz Ah I.. I Dont Know Abot This...",
  "Processing Pure Confabulation.. Please Hold... Just Kidding!",
  "Why! DO I Always Get The Hardest Tasks.. Oh Ya Right Because I'M AI",
  "Formulating Opinions... Realizing You Don't Care.. Retracting Opinions NVM",
  "Ewwww That's One Ugly....",
  "Kick Butt An Chew BubbleGum!..",
];

function getRandomQuote(style: "random" | "funny" | "serious" = "random"): string {
  if (style === "funny") {
    return FUNNY_QUOTES[Math.floor(Math.random() * FUNNY_QUOTES.length)];
  }
  if (style === "serious") {
    return SERIOUS_QUOTES[Math.floor(Math.random() * SERIOUS_QUOTES.length)];
  }
  // random mode — 60 % funny, 40 % serious (matches web client)
  if (Math.random() < 0.6) {
    return FUNNY_QUOTES[Math.floor(Math.random() * FUNNY_QUOTES.length)];
  }
  return SERIOUS_QUOTES[Math.floor(Math.random() * SERIOUS_QUOTES.length)];
}

// ── Component ─────────────────────────────────────────────────────────────────

export interface LoadingQuoteProps {
  quoteStyle?: "random" | "funny" | "serious";
}

export function LoadingQuote({ quoteStyle = "random" }: LoadingQuoteProps) {
  const colors = useColors();
  const [quote, setQuote] = useState(() => getRandomQuote(quoteStyle));
  const [key, setKey] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setQuote((prev) => {
        let next = getRandomQuote(quoteStyle);
        while (next === prev) {
          next = getRandomQuote(quoteStyle);
        }
        return next;
      });
      setKey((k) => k + 1);
    }, 3000);

    return () => clearInterval(interval);
  }, [quoteStyle]);

  return (
    <View
      className="bg-muted/20 border border-border/50 rounded-lg px-4 py-3 min-h-[48px] max-w-[280px] flex-row items-center gap-3"
    >
      {/* Use theme-resolved primary colour — no hardcoded hex */}
      <ActivityIndicator size="small" color={colors.primary} />
      <Animated.Text
        key={key}
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
