/**
 * Batch C — Item 1: HashTrackerService (server-side)
 *
 * Covers:
 *   generateActionHash: deterministic, distinct, key-order normalised, hex format
 *   HashTrackerService.checkAndRecord: loop detection at threshold=3, broken
 *     sequences, cross-session isolation, loopDetected event emission
 *   resetSession, removeSession, getSessionSnapshot
 */
import { describe, it, expect, vi } from "vitest";
import {
  generateActionHash,
  HashTrackerService,
} from "../phase2/services/HashTrackerService.js";

// ---------------------------------------------------------------------------
// generateActionHash — pure utility
// ---------------------------------------------------------------------------

describe("generateActionHash", () => {
  it("is deterministic for the same inputs", () => {
    const h1 = generateActionHash("writeFile", { path: "/tmp/x" }, { step: 3 });
    const h2 = generateActionHash("writeFile", { path: "/tmp/x" }, { step: 3 });
    expect(h1).toBe(h2);
  });

  it("is distinct for different toolNames", () => {
    const h1 = generateActionHash("readFile", { path: "/tmp/x" }, {});
    const h2 = generateActionHash("writeFile", { path: "/tmp/x" }, {});
    expect(h1).not.toBe(h2);
  });

  it("is distinct for different args", () => {
    const h1 = generateActionHash("writeFile", { path: "/tmp/a" }, {});
    const h2 = generateActionHash("writeFile", { path: "/tmp/b" }, {});
    expect(h1).not.toBe(h2);
  });

  it("is distinct for different state", () => {
    const h1 = generateActionHash("writeFile", {}, { step: 1 });
    const h2 = generateActionHash("writeFile", {}, { step: 2 });
    expect(h1).not.toBe(h2);
  });

  it("normalises object key order — same hash regardless of insertion order", () => {
    const h1 = generateActionHash("tool", { a: 1, b: 2 }, { x: 9, y: 8 });
    const h2 = generateActionHash("tool", { b: 2, a: 1 }, { y: 8, x: 9 });
    expect(h1).toBe(h2);
  });

  it("returns a 64-character lowercase hex string (SHA-256)", () => {
    const h = generateActionHash("tool", {}, {});
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// HashTrackerService — loop detection
// ---------------------------------------------------------------------------

describe("HashTrackerService — loop detection", () => {
  // Default LOOP_DETECTOR_CONFIG.loopThreshold = 3
  const tracker = HashTrackerService.getInstance();

  it("no loop when identical count is below threshold (2 identical for threshold=3)", () => {
    const sid = `test-below-${crypto.randomUUID()}`;
    const hash = generateActionHash("tool", { x: 1 }, {});
    const r1 = tracker.checkAndRecord(sid, hash);
    const r2 = tracker.checkAndRecord(sid, hash);
    expect(r1.isLoop).toBe(false);
    expect(r2.isLoop).toBe(false);
  });

  it("loop detected at threshold — 3 consecutive identical hashes", () => {
    const sid = `test-loop-${crypto.randomUUID()}`;
    const hash = generateActionHash("tool", { stuck: true }, {});
    tracker.checkAndRecord(sid, hash);
    tracker.checkAndRecord(sid, hash);
    const r3 = tracker.checkAndRecord(sid, hash);
    expect(r3.isLoop).toBe(true);
    expect(r3.sessionId).toBe(sid);
    expect(r3.hash).toBe(hash);
  });

  it("no loop when sequence is broken by a different hash", () => {
    const sid = `test-broken-${crypto.randomUUID()}`;
    const hashA = generateActionHash("tool", { v: "a" }, {});
    const hashB = generateActionHash("tool", { v: "b" }, {});
    tracker.checkAndRecord(sid, hashA);
    tracker.checkAndRecord(sid, hashA);
    tracker.checkAndRecord(sid, hashB); // breaks the run
    const r4 = tracker.checkAndRecord(sid, hashA);
    expect(r4.isLoop).toBe(false);
  });

  it("emits loopDetected event with correct payload when loop is detected", () => {
    const sid = `test-event-${crypto.randomUUID()}`;
    const hash = generateActionHash("emit-test", { q: 1 }, {});
    const handler = vi.fn();
    tracker.on("loopDetected", handler);
    tracker.checkAndRecord(sid, hash);
    tracker.checkAndRecord(sid, hash);
    tracker.checkAndRecord(sid, hash); // triggers loop
    tracker.removeListener("loopDetected", handler);
    expect(handler).toHaveBeenCalledOnce();
    const evt = handler.mock.calls[0]![0];
    expect(evt.sessionId).toBe(sid);
    expect(evt.hash).toBe(hash);
    expect(evt.consecutiveCount).toBe(3);
    expect(typeof evt.timestamp).toBe("string");
  });

  it("sessions are isolated — loop in one session does not affect another", () => {
    const sidA = `test-iso-a-${crypto.randomUUID()}`;
    const sidB = `test-iso-b-${crypto.randomUUID()}`;
    const hash = generateActionHash("isolated", { k: 1 }, {});
    tracker.checkAndRecord(sidA, hash);
    tracker.checkAndRecord(sidA, hash);
    tracker.checkAndRecord(sidA, hash); // loop in A
    // B starts fresh — first two entries should not trigger
    const rB1 = tracker.checkAndRecord(sidB, hash);
    expect(rB1.isLoop).toBe(false);
    expect(rB1.historySize).toBe(1);
  });

  it("resetSession clears history so subsequent hashes don't carry over", () => {
    const sid = `test-reset-${crypto.randomUUID()}`;
    const hash = generateActionHash("reset-me", { n: 1 }, {});
    tracker.checkAndRecord(sid, hash);
    tracker.checkAndRecord(sid, hash);
    tracker.resetSession(sid);
    // After reset: 2 identical hashes should NOT trigger loop (need 3 consecutive)
    const r1 = tracker.checkAndRecord(sid, hash);
    const r2 = tracker.checkAndRecord(sid, hash);
    expect(r1.isLoop).toBe(false);
    expect(r2.isLoop).toBe(false);
  });

  it("removeSession removes detector from getActiveSessions", () => {
    const sid = `test-remove-${crypto.randomUUID()}`;
    const hash = generateActionHash("removeme", {}, {});
    tracker.checkAndRecord(sid, hash);
    expect(tracker.getActiveSessions()).toContain(sid);
    tracker.removeSession(sid);
    expect(tracker.getActiveSessions()).not.toContain(sid);
  });

  it("getSessionSnapshot returns null for an unknown session", () => {
    expect(tracker.getSessionSnapshot(`ghost-${crypto.randomUUID()}`)).toBeNull();
  });

  it("getSessionSnapshot returns a snapshot with history entries and thresholds", () => {
    const sid = `test-snap-${crypto.randomUUID()}`;
    const hash = generateActionHash("snap", { i: 1 }, {});
    tracker.checkAndRecord(sid, hash);
    const snap = tracker.getSessionSnapshot(sid);
    expect(snap).not.toBeNull();
    expect(snap!.history).toHaveLength(1);
    expect(snap!.history[0]!.hash).toBe(hash);
    expect(typeof snap!.history[0]!.recordedAt).toBe("string");
    expect(snap!.loopThreshold).toBe(3); // default from LOOP_DETECTOR_CONFIG
    expect(snap!.maxHistorySize).toBeGreaterThan(0);
  });
});
