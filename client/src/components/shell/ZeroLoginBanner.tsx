import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { trpc } from "@/lib/trpc";

export function ZeroLoginBanner() {
  const [dismissed, setDismissed] = useState(false);
  // Read executionMode from the server-authoritative auth.me query rather than
  // the Zustand store, which defaults to "scrapper" from localStorage and would
  // show the wrong security posture during the initial render before hydration.
  const { data: me, isLoading } = trpc.auth.me.useQuery();
  const executionMode = me?.executionMode;

  if (dismissed) return null;

  const isSovereign = executionMode === "sovereign";
  const modeLabel = isLoading || !executionMode
    ? "Checking execution mode…"
    : isSovereign
      ? "Sovereign mode enforced — cloud inference is blocked (air-gapped)."
      : `${executionMode === "big_spender" ? "Big Spender" : "Scrapper"} mode — cloud inference is ALLOWED and spend-tracked (testing mode, NOT air-gapped).`;

  return (
    <div className="w-full bg-accent-warning/10 border-b border-accent-warning/30 px-4 py-2 flex items-center justify-between text-xs text-accent-warning">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
        <span>
          <strong>Zero-Login Mode</strong> — All requests run as local admin. {modeLabel} Do not expose this instance to a network.
        </span>
      </div>
      <button
        onClick={() => setDismissed(true)}
        disabled={isLoading}
        className="ml-4 text-accent-warning hover:text-accent-warning/80 font-medium flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
        aria-label="Dismiss zero-login warning"
      >
        Dismiss
      </button>
    </div>
  );
}
