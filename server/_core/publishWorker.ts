/**
 * Publish worker. Periodically publishes scheduled posts whose time has
 * arrived, so "Schedule" in the UI actually sends content to the connected
 * platforms at the chosen time (not just a DB status flip).
 */
import { publishDuePosts } from "../phase2/services/publishExecutor.js";
import { createLogger } from "./logger.js";

const log = createLogger("publishWorker");

const POLL_INTERVAL_MS = 60 * 1000; // check every minute
let timer: NodeJS.Timeout | null = null;
let running = false;

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await publishDuePosts();
  } catch (err) {
    log.warn("Publish worker tick failed", err);
  } finally {
    running = false;
  }
}

/** Start the scheduled-post publisher. Safe to call once at server boot. */
export function startPublishWorker(): void {
  if (timer) return;
  timer = setInterval(() => void tick(), POLL_INTERVAL_MS);
  timer.unref?.();
  log.info("Publish worker started");
}
