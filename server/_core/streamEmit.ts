/**
 * Crash-safe wrapper for tRPC subscription `emit` observers.
 *
 * When a client disconnects mid-stream (browser closed, WS dropped, request
 * aborted on timeout), tRPC closes the subscription's underlying ReadableStream
 * controller. A *late* `emit.next` / `emit.error` / `emit.complete` from the
 * still-running async producer then throws
 *   `ERR_INVALID_STATE: Controller is already closed`
 * which — thrown from a `.catch()` in a detached async IIFE — is an unhandled
 * rejection that **crashes the whole Node process**. This was hit in practice
 * when an Ollama stream timed out after the client had already navigated away.
 *
 * `guardedEmit` drops any emit after teardown and swallows a closed-controller
 * throw, and exposes `.closed` so producers can stop their loop promptly.
 */
export interface EmitLike<T> {
  next: (value: T) => void;
  error: (err: unknown) => void;
  complete: () => void;
}

export interface GuardedEmit<T> extends EmitLike<T> {
  /** True once the stream has completed, errored, or been torn down. */
  readonly closed: boolean;
  /** Mark closed without emitting (call from the observable teardown). */
  close: () => void;
}

export function guardedEmit<T>(emit: EmitLike<T>): GuardedEmit<T> {
  const state = { closed: false };
  return {
    get closed() {
      return state.closed;
    },
    next(value: T) {
      if (state.closed) return;
      try {
        emit.next(value);
      } catch {
        // Controller already closed (client gone) — stop emitting.
        state.closed = true;
      }
    },
    error(err: unknown) {
      if (state.closed) return;
      state.closed = true;
      try {
        emit.error(err);
      } catch {
        /* subscription already torn down */
      }
    },
    complete() {
      if (state.closed) return;
      state.closed = true;
      try {
        emit.complete();
      } catch {
        /* subscription already torn down */
      }
    },
    close() {
      state.closed = true;
    },
  };
}
