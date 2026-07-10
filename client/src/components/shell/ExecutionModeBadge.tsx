import { useAppStore } from "@/lib/store/app.store";
import { Badge } from "@/components/ui/badge";
import { Lock, Zap, Flame } from "lucide-react";
import { cn } from "@/lib/utils";

const MODE_CONFIG = {
  sovereign: { label: "Sovereign", icon: Lock, className: "bg-accent-danger/15 text-accent-danger border-accent-danger/30" },
  scrapper: { label: "Scrapper", icon: Zap, className: "bg-accent-success/15 text-accent-success border-accent-success/30" },
  big_spender: { label: "Big Spender", icon: Flame, className: "bg-accent-warning/15 text-accent-warning border-accent-warning/30" },
};

interface ExecutionModeBadgeProps {
  collapsed?: boolean;
}

export function ExecutionModeBadge({ collapsed = false }: ExecutionModeBadgeProps) {
  const mode = useAppStore((s) => s.executionMode);
  const config = MODE_CONFIG[mode];
  const Icon = config.icon;

  if (collapsed) {
    const collapsedStyles = {
      sovereign: "bg-accent-danger/15 text-accent-danger border-accent-danger/30",
      scrapper: "bg-accent-success/15 text-accent-success border-accent-success/30",
      big_spender: "bg-accent-warning/15 text-accent-warning border-accent-warning/30",
    };
    return (
      <div 
        className={cn(
          "w-10 h-10 rounded-lg flex items-center justify-center transition-all duration-200 border shadow-md",
          collapsedStyles[mode]
        )}
        title={config.label}
      >
        <Icon className="h-5 w-5" />
      </div>
    );
  }

  return (
    <Badge variant="outline" className={`flex items-center justify-center w-full gap-2 text-[13px] font-semibold px-3 py-1.5 rounded-md ${config.className}`}>
      <Icon className="h-4 w-4" />
      {config.label}
    </Badge>
  );
}
