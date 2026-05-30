import React from "react";
import { useAppStore } from "@/lib/store/app.store";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function ConnectionStatusBadge() {
  const wsStatus = useAppStore((state) => state.wsStatus);

  const statusConfig = {
    connecting: {
      label: "Connecting",
      color: "bg-yellow-500",
      pulse: false,
    },
    connected: {
      label: "Connected",
      color: "bg-green-500",
      pulse: false,
    },
    reconnecting: {
      label: "Reconnecting...",
      color: "bg-yellow-500",
      pulse: true,
    },
    offline: {
      label: "Offline",
      color: "bg-red-500",
      pulse: false,
    },
  };

  const config = statusConfig[wsStatus] || statusConfig.offline;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-2 cursor-help">
            <Badge variant="outline" className="flex items-center gap-1.5 px-2 py-0.5">
              <span className={cn(
                "h-2 w-2 rounded-full",
                config.color,
                config.pulse && "animate-pulse"
              )} />
              {config.label}
            </Badge>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p>WebSocket Status: {config.label}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function Header() {
  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 items-center justify-between">
        <div className="flex items-center gap-4">
          <span className="font-bold text-lg hidden sm:inline-block">
            Omnecor HMCI
          </span>
        </div>
        <div className="flex items-center gap-4">
          <ConnectionStatusBadge />
        </div>
      </div>
    </header>
  );
}

export default Header;
