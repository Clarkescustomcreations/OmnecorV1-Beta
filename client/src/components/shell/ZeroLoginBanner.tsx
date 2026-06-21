import { useState } from "react";
import { AlertTriangle } from "lucide-react";

export function ZeroLoginBanner() {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <div className="w-full bg-accent-warning/10 border-b border-accent-warning/30 px-4 py-2 flex items-center justify-between text-xs text-accent-warning">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
        <span>
          <strong>Zero-Login Mode</strong> — All requests run as local admin with Sovereign mode enforced. Do not expose this instance to a network.
        </span>
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="ml-4 text-accent-warning hover:text-accent-warning/80 font-medium flex-shrink-0"
        aria-label="Dismiss zero-login warning"
      >
        Dismiss
      </button>
    </div>
  );
}
