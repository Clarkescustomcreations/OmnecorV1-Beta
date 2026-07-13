import { ComponentType, lazy, LazyExoticComponent } from "react";

/**
 * `React.lazy` caches a *rejected* import promise for the component's lifetime,
 * so once a chunk fetch fails — a transient network blip, or a fresh deploy
 * invalidating the old chunk hashes — an error-boundary reset can never re-fetch
 * it (React re-throws the cached rejection without re-calling the importer).
 *
 * This wrapper retries the dynamic import a few times with exponential backoff
 * *before* the promise settles, so a genuinely transient failure recovers on its
 * own and the user never sees an error. A persistent failure still rejects — the
 * caller pairs this with a Retry that reloads the page for the stale-deploy case
 * (see LazyPreviewPane). Drop-in replacement for `React.lazy`.
 */
export function lazyWithRetry<T extends ComponentType<any>>(
  importer: () => Promise<{ default: T }>,
  retries = 2,
  baseDelayMs = 300,
): LazyExoticComponent<T> {
  return lazy(() => attempt(importer, retries, baseDelayMs));
}

function attempt<R>(importer: () => Promise<R>, retries: number, delayMs: number): Promise<R> {
  return importer().catch((err: unknown) => {
    if (retries <= 0) throw err;
    return new Promise<R>((resolve, reject) => {
      setTimeout(() => attempt(importer, retries - 1, delayMs * 2).then(resolve, reject), delayMs);
    });
  });
}
