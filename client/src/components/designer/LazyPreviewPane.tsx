/**
 * LazyPreviewPane
 *
 * Wraps a conditionally-rendered preview panel (the PCB editor, 3D viewer, or
 * web preview) so that:
 *   1. when the panel is code-split (via lazyWithRetry), its heavy module graph
 *      is kept out of the host page's bundle, and
 *   2. a failure during that module's evaluation/render — or a slow chunk load —
 *      is contained to this pane instead of taking down the whole route.
 *
 * Previously these panels were statically imported at a page's top level, so a
 * throw during their module evaluation failed the *page's own* module and
 * dropped the entire route to its RouteBoundary. This pane isolates the failure
 * and gives the user a Retry that actually recovers.
 *
 * Also used to wrap an *eager* (non-lazy) preview purely for crash isolation —
 * the Suspense boundary simply never triggers for a non-suspending child.
 */
import { ReactNode, Suspense } from "react";
import { AlertTriangle, RotateCcw, Loader2 } from "lucide-react";
import { ErrorBoundary } from "@/components/ErrorBoundary";

/**
 * A failed lazy chunk fetch can't be recovered by an in-place boundary reset —
 * React.lazy caches the rejected import, so re-rendering the same component just
 * re-throws. Only a reload re-fetches the chunk (which also fixes the common
 * stale-deploy case). Detect those errors so Retry does the right thing; any
 * other (render-time) error is recoverable by a plain reset.
 */
function isChunkLoadError(error: Error | null): boolean {
  if (!error) return false;
  const s = `${error.name}: ${error.message}`;
  return /ChunkLoadError|dynamically imported module|module script failed|Failed to fetch|error loading dynamically/i.test(s);
}

export function LazyPreviewPane({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary
      fallback={(reset, error) => (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center">
          <AlertTriangle className="h-6 w-6 text-destructive" />
          <p className="text-sm text-muted-foreground">This preview failed to load.</p>
          <button
            onClick={() => (isChunkLoadError(error) ? window.location.reload() : reset())}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs hover:bg-muted"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Retry
          </button>
        </div>
      )}
    >
      <Suspense
        fallback={
          <div className="flex h-full w-full items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        }
      >
        {children}
      </Suspense>
    </ErrorBoundary>
  );
}
