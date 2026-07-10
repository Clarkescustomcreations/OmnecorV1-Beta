import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { HowToTooltip } from "@/components/shell/HowToTooltip";

export function UpdateBanner() {
  const [dismissed, setDismissed] = useState(() => {
    return sessionStorage.getItem("update-banner-dismissed") === "true";
  });

  const result = trpc.system.checkForUpdates.useQuery(undefined, {
    staleTime: 1000 * 60 * 30,
    retry: false,
  });

  if (dismissed || !result.data?.updateAvailable) return null;

  const { latestVersion, releaseUrl } = result.data;

  return (
    <div className="w-full bg-accent-info/10 border-b border-accent-info/30 px-4 py-2 flex items-center justify-between text-sm text-accent-info">
      <span>
        Update available: v{latestVersion}.{" "}
        {releaseUrl && (
          <a href={releaseUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">
            View release notes
          </a>
        )}
      </span>
      <HowToTooltip title="Dismiss Update" description="Hide this notification until the next session." side="bottom">
        <button
          onClick={() => {
            sessionStorage.setItem("update-banner-dismissed", "true");
            setDismissed(true);
          }}
          className="ml-4 text-accent-info hover:text-foreground"
          aria-label="Dismiss update banner"
        >
          &#x2715;
        </button>
      </HowToTooltip>
    </div>
  );
}
