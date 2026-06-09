import React from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAppStore } from "@/lib/store/app.store";

interface HowToTooltipProps {
  children: React.ReactNode;
  title: string;
  description: string;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
}

/**
 * A specialized tooltip for the "How To" beginner-friendly feature.
 * Only renders if global tooltips are enabled in settings.
 */
export function HowToTooltip({
  children,
  title,
  description,
  side = "top",
  align = "center",
}: HowToTooltipProps) {
  const showTooltips = useAppStore((s) => s.showTooltips);

  if (!showTooltips) {
    return <>{children}</>;
  }

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          {children}
        </TooltipTrigger>
        <TooltipContent
          side={side}
          align={align}
          sideOffset={6}
          className="max-w-[240px] p-3 bg-card/95 border-accent/20 shadow-2xl backdrop-blur-md z-[100]"
        >
          <div className="space-y-1.5">
            <h5 className="text-[11px] font-bold uppercase tracking-widest text-accent">
              {title}
            </h5>
            <p className="text-xs leading-relaxed text-foreground/90">
              {description}
            </p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
