import React, { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { useAppStore } from "@/lib/store/app.store";

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
  "Decoding input semantics..."
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
  "Kick Butt An Chew BubbleGum!.."
];

function getRandomQuote(style: "random" | "funny" | "serious") {
  if (style === "funny") {
    return FUNNY_QUOTES[Math.floor(Math.random() * FUNNY_QUOTES.length)];
  }
  if (style === "serious") {
    return SERIOUS_QUOTES[Math.floor(Math.random() * SERIOUS_QUOTES.length)];
  }
  
  // random mode - 60% chance for a funny quote, 40% for a serious quote
  if (Math.random() < 0.6) {
    return FUNNY_QUOTES[Math.floor(Math.random() * FUNNY_QUOTES.length)];
  }
  return SERIOUS_QUOTES[Math.floor(Math.random() * SERIOUS_QUOTES.length)];
}

export function LoadingQuote({ 
  className,
}: { 
  className?: string;
}) {
  const { chatDisplaySettings } = useAppStore();
  const quoteStyle = chatDisplaySettings.quoteStyle;
  
  const [quote, setQuote] = useState(() => getRandomQuote(quoteStyle));

  useEffect(() => {
    // Update immediately if quoteStyle prop changes
    setQuote(getRandomQuote(quoteStyle));
    
    const interval = setInterval(() => {
      setQuote(prev => {
        let next = getRandomQuote(quoteStyle);
        while (next === prev) {
          next = getRandomQuote(quoteStyle);
        }
        return next;
      });
    }, 3000);

    return () => clearInterval(interval);
  }, [quoteStyle]);

  return (
    <div className={cn("flex items-center gap-3 text-muted-foreground bg-muted/20 rounded-lg max-w-sm px-4 py-3 border border-border/50 min-h-[48px]", className)}>
      <Loader2 className="w-4 h-4 animate-spin text-primary shrink-0" />
      <div className="flex-1 flex items-center">
        <AnimatePresence mode="wait">
          <motion.span
            key={quote}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="text-xs font-medium"
          >
            {quote}
          </motion.span>
        </AnimatePresence>
      </div>
    </div>
  );
}
