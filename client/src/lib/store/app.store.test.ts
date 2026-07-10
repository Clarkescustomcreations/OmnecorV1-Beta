import { describe, it, expect, beforeEach } from "vitest";
import { useAppStore } from "./app.store";

/**
 * Phase 5 — between-turn message queue (type-ahead while the AI streams).
 * These exercise the Zustand actions directly: enqueue / dequeue (FIFO drain)
 * / popLatest (↑ recall) / remove / clear. Client tests are pure-logic by
 * convention (no DOM), so we drive the store via getState().
 */

const q = () => useAppStore.getState();

beforeEach(() => {
  // Reset only the queue slice; leave the rest of the store untouched.
  useAppStore.setState({ messageQueue: [] });
});

describe("messageQueue — enqueue", () => {
  it("appends messages in order and returns a unique id each time", () => {
    const id1 = q().enqueueMessage("first");
    const id2 = q().enqueueMessage("second");

    expect(id1).toBeTypeOf("string");
    expect(id2).toBeTypeOf("string");
    expect(id1).not.toBe(id2);

    expect(q().messageQueue).toEqual([
      { id: id1, content: "first" },
      { id: id2, content: "second" },
    ]);
  });

  it("preserves insertion (FIFO) order for many messages", () => {
    ["a", "b", "c", "d"].forEach((c) => q().enqueueMessage(c));
    expect(q().messageQueue.map((m) => m.content)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("messageQueue — dequeue (FIFO drain)", () => {
  it("removes and returns the oldest message", () => {
    q().enqueueMessage("first");
    q().enqueueMessage("second");

    const drained = q().dequeueMessage();
    expect(drained?.content).toBe("first");
    expect(q().messageQueue.map((m) => m.content)).toEqual(["second"]);
  });

  it("drains the whole queue in the order it was enqueued", () => {
    ["one", "two", "three"].forEach((c) => q().enqueueMessage(c));

    const order: string[] = [];
    let next = q().dequeueMessage();
    while (next) {
      order.push(next.content);
      next = q().dequeueMessage();
    }

    expect(order).toEqual(["one", "two", "three"]);
    expect(q().messageQueue).toEqual([]);
  });

  it("returns undefined when the queue is empty", () => {
    expect(q().dequeueMessage()).toBeUndefined();
    expect(q().messageQueue).toEqual([]);
  });
});

describe("messageQueue — popLatestQueuedMessage (↑ recall)", () => {
  it("removes and returns the newest message (LIFO)", () => {
    q().enqueueMessage("first");
    q().enqueueMessage("second");
    q().enqueueMessage("third");

    const recalled = q().popLatestQueuedMessage();
    expect(recalled?.content).toBe("third");
    expect(q().messageQueue.map((m) => m.content)).toEqual(["first", "second"]);
  });

  it("returns undefined when the queue is empty", () => {
    expect(q().popLatestQueuedMessage()).toBeUndefined();
  });

  it("recall then re-enqueue round-trips the edited content to the back", () => {
    q().enqueueMessage("keep");
    q().enqueueMessage("draft");

    const recalled = q().popLatestQueuedMessage();
    expect(recalled?.content).toBe("draft");
    // Simulate the user editing the recalled text and re-queuing it.
    q().enqueueMessage(`${recalled?.content} (edited)`);

    expect(q().messageQueue.map((m) => m.content)).toEqual(["keep", "draft (edited)"]);
  });
});

describe("messageQueue — remove + clear", () => {
  it("removes a single message by id, leaving the rest", () => {
    const id1 = q().enqueueMessage("a");
    const id2 = q().enqueueMessage("b");
    const id3 = q().enqueueMessage("c");

    q().removeQueuedMessage(id2);
    expect(q().messageQueue).toEqual([
      { id: id1, content: "a" },
      { id: id3, content: "c" },
    ]);
  });

  it("removing an unknown id is a no-op", () => {
    q().enqueueMessage("a");
    q().removeQueuedMessage("does-not-exist");
    expect(q().messageQueue.map((m) => m.content)).toEqual(["a"]);
  });

  it("clearMessageQueue empties the queue", () => {
    ["a", "b", "c"].forEach((c) => q().enqueueMessage(c));
    q().clearMessageQueue();
    expect(q().messageQueue).toEqual([]);
  });
});
