/**
 * Unit tests for `guardedEmit` — the crash-safe tRPC subscription emit wrapper.
 *
 * Regression guard for the server crash where a late emit (after the client
 * closed the subscription's ReadableStream controller) threw
 * `ERR_INVALID_STATE: Controller is already closed` from a detached async
 * producer, taking down the whole process.
 */
import { describe, it, expect, vi } from "vitest";
import { guardedEmit } from "../_core/streamEmit.js";

function mkEmit() {
  return { next: vi.fn(), error: vi.fn(), complete: vi.fn() };
}

describe("guardedEmit", () => {
  it("forwards next/complete while open, then reports closed", () => {
    const emit = mkEmit();
    const g = guardedEmit(emit);
    expect(g.closed).toBe(false);

    g.next({ delta: "a" });
    g.next({ delta: "b" });
    g.complete();

    expect(emit.next).toHaveBeenCalledTimes(2);
    expect(emit.complete).toHaveBeenCalledTimes(1);
    expect(g.closed).toBe(true);
  });

  it("drops emits issued after complete()", () => {
    const emit = mkEmit();
    const g = guardedEmit(emit);
    g.complete();
    g.next({ delta: "late" });
    g.error(new Error("late"));
    g.complete();
    expect(emit.next).not.toHaveBeenCalled();
    expect(emit.error).not.toHaveBeenCalled();
    expect(emit.complete).toHaveBeenCalledTimes(1); // only the first
  });

  it("drops emits after teardown close()", () => {
    const emit = mkEmit();
    const g = guardedEmit(emit);
    g.close(); // observable teardown (client unsubscribed)
    expect(g.closed).toBe(true);
    g.next({ delta: "x" });
    g.error(new Error("x"));
    expect(emit.next).not.toHaveBeenCalled();
    expect(emit.error).not.toHaveBeenCalled();
  });

  it("swallows a closed-controller throw from emit.error and does not rethrow", () => {
    const emit = mkEmit();
    emit.error.mockImplementation(() => {
      throw new TypeError("Invalid state: Controller is already closed");
    });
    const g = guardedEmit(emit);
    // The core regression: this must NOT throw (previously crashed the process).
    expect(() => g.error(new Error("stream timeout"))).not.toThrow();
    expect(g.closed).toBe(true);
  });

  it("stops forwarding once emit.next throws (controller closed mid-stream)", () => {
    const emit = mkEmit();
    let calls = 0;
    emit.next.mockImplementation(() => {
      if (++calls === 2) throw new TypeError("Controller is already closed");
    });
    const g = guardedEmit(emit);
    expect(() => {
      g.next({ delta: "1" });
      g.next({ delta: "2" }); // throws internally → marks closed
      g.next({ delta: "3" }); // dropped
    }).not.toThrow();
    expect(g.closed).toBe(true);
    expect(emit.next).toHaveBeenCalledTimes(2); // 3rd dropped
  });

  it("only the first terminal signal wins (error after error is dropped)", () => {
    const emit = mkEmit();
    const g = guardedEmit(emit);
    g.error(new Error("first"));
    g.error(new Error("second"));
    g.complete();
    expect(emit.error).toHaveBeenCalledTimes(1);
    expect(emit.complete).not.toHaveBeenCalled();
  });
});
