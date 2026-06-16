import { describe, it, expect } from "vitest";
import { ProcessManagerService } from "../phase2/services/ProcessManagerService.js";
import {
  AsyncJobService,
  type AsyncJobResultEvent,
} from "../phase2/services/AsyncJobService.js";

/**
 * Integration check for the async-job continuation: a tracked job that fails
 * should produce a condensed `result` event with the exit code, extracted
 * errors, and an agent-facing formatted block.
 */
describe("AsyncJobService continuation", () => {
  it("condenses a tracked job and emits a result on completion", async () => {
    const pm = ProcessManagerService.getInstance();
    const svc = AsyncJobService.getInstance();

    // Attach the listener before spawning so we never miss the result.
    const resultEvent = new Promise<AsyncJobResultEvent>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("timed out waiting for async result")),
        12000
      );
      svc.once("result", (e: AsyncJobResultEvent) => {
        clearTimeout(timer);
        resolve(e);
      });
    });

    const script =
      "console.log('Compiling target'); console.error('ERROR: link failed'); process.exit(2);";
    const jobId = await pm.spawn({
      type: "custom",
      command: process.execPath,
      args: ["-e", script],
      label: "async-job-test",
      captureMode: "raw",
    });
    svc.track(jobId, { userId: 1, conversationId: "c1", label: "async-job-test" });

    const evt = await resultEvent;

    expect(evt.jobId).toBe(jobId);
    expect(evt.result.status).toBe("failed");
    expect(evt.result.exitCode).toBe(2);
    expect(evt.result.errors.some((e) => e.includes("ERROR: link failed"))).toBe(
      true
    );
    expect(evt.formatted).toContain("[Background job failed]");
    expect(evt.context.conversationId).toBe("c1");

    // The job is untracked after delivery (one-shot continuation).
    expect(svc.isTracked(jobId)).toBe(false);
  }, 15000);

  it("ignores lifecycle events for jobs it is not tracking", async () => {
    const pm = ProcessManagerService.getInstance();
    const svc = AsyncJobService.getInstance();

    let fired = false;
    const onResult = () => {
      fired = true;
    };
    svc.on("result", onResult);

    // Spawn WITHOUT tracking — no result should be emitted for it.
    const jobId = await pm.spawn({
      type: "custom",
      command: process.execPath,
      args: ["-e", "console.log('untracked')"],
      label: "untracked-test",
      captureMode: "raw",
    });
    expect(svc.isTracked(jobId)).toBe(false);

    await new Promise((r) => setTimeout(r, 800));
    svc.off("result", onResult);
    expect(fired).toBe(false);
  }, 15000);
});
