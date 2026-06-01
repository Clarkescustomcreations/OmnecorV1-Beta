import { useAppStore } from "@/lib/store/app.store";
import { Badge } from "@/components/ui/badge";
import { Lock, Zap, Flame } from "lucide-react";

const MODE_CONFIG = {
  sovereign: { label: "Sovereign", icon: Lock, className: "bg-red-500/15 text-red-600 border-red-500/30" },
  scrapper: { label: "Scrapper", icon: Zap, className: "bg-green-500/15 text-green-600 border-green-500/30" },
  big_spender: { label: "Big Spender", icon: Flame, className: "bg-amber-500/15 text-amber-600 border-amber-500/30" },
};

export default function ExecutionModeBadge() {
  const mode = useAppStore((s) => s.executionMode);
  const config = MODE_CONFIG[mode];
  const Icon = config.icon;
  return (
    <Badge variant="outline" className={`flex items-center gap-1 text-xs px-2 py-0.5 ${config.className}`}>
      <Icon className="h-3 w-3" />
      {config.label}
    </Badge>
  );
}
