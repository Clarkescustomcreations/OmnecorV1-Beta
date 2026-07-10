import { describe, it, expect } from "vitest";
import { ProcessManagerService } from "../core_services/services/ProcessManagerService.js";
import type { ProcessLifecycleEvent } from "../core_services/services/ProcessManagerService.js";

/**
 * Verifies the opt-in raw ring-buffer capture added for the async-job condenser.
 * Spawns a short-lived Node process that prints a JSON progress line plus plain
 * stdout lines, then asserts both the JSON progress parse and the raw tail.
 */
describe("ProcessManagerService raw capture", () => {
  const pm = ProcessManagerService.getInstance();

  /** Spawn a job and resolve with its terminal lifecycle event. */
  function runToCompletion(jobId: Promise<string>): Promise<ProcessLifecycleEvent> {
    return new Promise(async (resolve) => {
      const id = await jobId;
      const onLifecycle = (e: ProcessLifecycleEvent) => {
        if (e.jobId !== id) return;
        if (e.state === "completed" || e.state === "failed" || e.state === "cancelled") {
          pm.off("lifecycle", onLifecycle);
          resolve(e);
        }
      };
      pm.on("lifecycle", onLifecycle);
    });
  }

  it("retains the stdout tail and parses JSON progress when captureMode is raw", async () => {
    const script =
      "console.log(JSON.stringify({ step: 1 }));" +
      "console.log('Building target foo');" +
      "console.log('Done.');";

    const evt = await runToCompletion(
      pm.spawn({
        type: "custom",
        command: process.execPath,
        args: ["-e", script],
        label: "raw-capture-test",
        captureMode: "raw",
      })
    );

    expect(evt.state).toBe("completed");

    const captured = pm.getCapturedOutput(evt.jobId);
    expect(captured).not.toBeNull();
    // Raw tail keeps every non-empty stdout line, including the JSON line.
    expect(captured!.stdoutTail).toContain("Building target foo");
    expect(captured!.stdoutTail).toContain("Done.");

    // JSON progress parsing still works alongside raw capture.
    const status = pm.getJobStatus(evt.jobId);
    expect(status?.lastProgress).toEqual({ step: 1 });
  }, 15000);

  it("does not retain a stdout tail in the default (json) capture mode", async () => {
    const evt = await runToCompletion(
      pm.spawn({
        type: "custom",
        command: process.execPath,
        args: ["-e", "console.log('plain output line')"],
        label: "default-capture-test",
      })
    );

    expect(evt.state).toBe("completed");
    const captured = pm.getCapturedOutput(evt.jobId);
    expect(captured!.stdoutTail).toHaveLength(0);
  }, 15000);

  it("caps the ring buffer at maxCaptureLines", async () => {
    const script = "for (let i = 0; i < 50; i++) console.log('line-' + i);";

    const evt = await runToCompletion(
      pm.spawn({
        type: "custom",
        command: process.execPath,
        args: ["-e", script],
        label: "ringbuffer-cap-test",
        captureMode: "raw",
        maxCaptureLines: 10,
      })
    );

    expect(evt.state).toBe("completed");
    const captured = pm.getCapturedOutput(evt.jobId);
    expect(captured!.stdoutTail).toHaveLength(10);
    // Oldest lines evicted; newest retained.
    expect(captured!.stdoutTail).toContain("line-49");
    expect(captured!.stdoutTail).not.toContain("line-0");
  }, 15000);
});
