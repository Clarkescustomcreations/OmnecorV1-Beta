import { useState, useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { useAppStore } from "@/lib/store/app.store";
import { pickQuote } from "./quoteBag";

export function LoadingQuote({
  className,
  typewriter = false,
}: {
  className?: string;
  /** Notepad mode: type the quote out flush-left as plain text (no box/bubble). */
  typewriter?: boolean;
}) {
  const { chatDisplaySettings } = useAppStore();
  const quoteStyle = chatDisplaySettings.quoteStyle;

  const [quote, setQuote] = useState(() => pickQuote(quoteStyle));

  // Draw a fresh quote from the new pool when the style changes — but not on the
  // initial mount (useState already drew one), so we don't waste a draw.
  const firstStyleRun = useRef(true);
  useEffect(() => {
    if (firstStyleRun.current) {
      firstStyleRun.current = false;
      return;
    }
    setQuote(pickQuote(quoteStyle));
  }, [quoteStyle]);

  // --- Boxed variant (bubble layouts, personas panel) — fade between quotes ---
  useEffect(() => {
    if (typewriter) return;
    const interval = setInterval(() => setQuote(pickQuote(quoteStyle)), 3000);
    return () => clearInterval(interval);
  }, [quoteStyle, typewriter]);

  // --- Typewriter variant — type the quote out, hold, then move to the next ---
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
      <p className={cn("text-sm text-muted-foreground/70 italic", className)}>
        {typed}
        <span className="not-italic text-primary animate-pulse">▋</span>
      </p>
    );
  }

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
