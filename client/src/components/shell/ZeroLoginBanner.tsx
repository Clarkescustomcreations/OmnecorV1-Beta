import { useState } from "react";
import { AlertTriangle } from "lucide-react";

export function ZeroLoginBanner() {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <div className="w-full bg-yellow-500/10 border-b border-yellow-500/30 px-4 py-2 flex items-center justify-between text-xs text-yellow-700 dark:text-yellow-400">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
        <span>
          <strong>Zero-Login Mode</strong> — All requests run as local admin with Sovereign mode enforced. Do not expose this instance to a network.
        </span>
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="ml-4 text-yellow-600 hover:text-yellow-800 dark:text-yellow-500 font-medium flex-shrink-0"
        aria-label="Dismiss zero-login warning"
      >
        Dismiss
      </button>
    </div>
  );
}
