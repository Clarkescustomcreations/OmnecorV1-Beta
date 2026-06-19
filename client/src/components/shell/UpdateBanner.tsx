import { useState } from "react";
import { trpc } from "@/lib/trpc";

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
    <div className="w-full bg-blue-950 border-b border-blue-800 px-4 py-2 flex items-center justify-between text-sm text-blue-200">
      <span>
        Update available: v{latestVersion}.{" "}
        {releaseUrl && (
          <a href={releaseUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-white">
            View release notes
          </a>
        )}
      </span>
      <button
        onClick={() => {
          sessionStorage.setItem("update-banner-dismissed", "true");
          setDismissed(true);
        }}
        className="ml-4 text-blue-400 hover:text-white"
        aria-label="Dismiss update banner"
      >
        &#x2715;
      </button>
    </div>
  );
}
