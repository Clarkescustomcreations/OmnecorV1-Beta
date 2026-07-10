/**
 * Auto-backup scheduler. Makes the Settings → General "Automatic Backups"
 * toggle and "Backup Frequency" selector real: when enabled, the data
 * directory is archived via SecurityService.createBackup at the chosen
 * cadence. Settings are re-read each tick (mtime-cached) so toggling the
 * switch or changing the frequency takes effect without a restart.
 */
import { SecurityService } from "../core_services/services/SecurityService.js";
import { getSetting } from "../core_services/services/SettingsService.js";
import { PATHS } from "./paths.js";
import { createLogger } from "./logger.js";

const log = createLogger("BackupScheduler");

const FREQUENCY_MS: Record<string, number> = {
  hourly: 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

// Poll cadence — the shortest supported frequency. Each tick decides whether a
// backup is actually due based on the configured frequency and the last run.
const POLL_INTERVAL_MS = 60 * 60 * 1000;

let timer: NodeJS.Timeout | null = null;
let lastBackupAt = 0;
let running = false;

async function tick(): Promise<void> {
  if (running) return;
  if (!getSetting<boolean>("autoBackup", false)) return;

  const frequency = getSetting<string>("backupFrequency", "daily");
  const intervalMs = FREQUENCY_MS[frequency] ?? FREQUENCY_MS.daily;
  if (Date.now() - lastBackupAt < intervalMs) return;

  running = true;
  try {
    const result = await SecurityService.getInstance().createBackup("auto", PATHS.data);
    lastBackupAt = Date.now();
    log.info(`Automatic backup created (${frequency})`, { backupId: result.backupId });
  } catch (err) {
    log.warn("Automatic backup failed", err);
  } finally {
    running = false;
  }
}

/** Start the auto-backup poller. Safe to call once at server boot. */
export function startBackupScheduler(): void {
  if (timer) return;
  // Fire an initial check shortly after boot, then on the poll interval.
  setTimeout(() => void tick(), 30_000).unref?.();
  timer = setInterval(() => void tick(), POLL_INTERVAL_MS);
  timer.unref?.();
}
