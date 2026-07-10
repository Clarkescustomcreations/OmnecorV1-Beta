/**
 * @file server/core_services/services/AuditLogService.ts
 * @description Omnecor — Append-Only Audit Log Service (Phase 20)
 *
 * Insert-only singleton: application code can never update or rewrite entries.
 * The ONLY deletion path is the time-based retention purge below, which keeps
 * the log from growing without bound. Retention defaults to 14 days and is
 * configurable from Settings → Security (14 days / 28 days / 0 = permanent).
 * Errors are swallowed so audit logging never crashes the main application flow.
 *
 * Persistence and the retention/purge schedule are identical in MySQL and
 * SQLite (Sovereign) mode — both backends implement the audit* functions
 * routed through db.factory.ts.
 */

import { v4 as uuidv4 } from "uuid";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import {
  auditInsert,
  auditPurgeBefore,
  auditStats,
} from "../../db.factory.js";
import { type InsertAuditLog } from "../../../drizzle/schema.js";
import { PATHS } from "../../_core/paths.js";

type LogInput = Omit<InsertAuditLog, "id" | "createdAt">;

/** Allowed retention windows in days. 0 = keep forever (permanent). */
export const AUDIT_RETENTION_OPTIONS = [14, 28, 0] as const;
export type AuditRetentionDays = (typeof AUDIT_RETENTION_OPTIONS)[number];

const DEFAULT_RETENTION_DAYS: AuditRetentionDays = 14;
const SETTINGS_KEY = "auditRetentionDays";
/** Purge sweep interval — every 6 hours keeps the table trimmed without load. */
const PURGE_INTERVAL_MS = 6 * 60 * 60 * 1000;

const SETTINGS_PATH = join(PATHS.base, "settings.json");

export class AuditLogService {
  private static instance: AuditLogService | null = null;
  private purgeTimer: NodeJS.Timeout | null = null;

  private constructor() {}

  public static getInstance(): AuditLogService {
    if (!AuditLogService.instance) {
      AuditLogService.instance = new AuditLogService();
    }
    return AuditLogService.instance;
  }

  async log(input: LogInput): Promise<void> {
    try {
      await auditInsert({ id: uuidv4(), ...input });
    } catch {
      // Audit log must never crash the main flow
    }
  }

  // ── Retention ──────────────────────────────────────────────────────────────

  /** Read the configured retention window (days; 0 = permanent). */
  getRetentionDays(): AuditRetentionDays {
    try {
      if (!existsSync(SETTINGS_PATH)) return DEFAULT_RETENTION_DAYS;
      const settings = JSON.parse(readFileSync(SETTINGS_PATH, "utf-8")) as Record<string, unknown>;
      const value = settings?.[SETTINGS_KEY];
      if (AUDIT_RETENTION_OPTIONS.includes(value as AuditRetentionDays)) {
        return value as AuditRetentionDays;
      }
    } catch {
      /* fall through to default */
    }
    return DEFAULT_RETENTION_DAYS;
  }

  /** Persist a new retention window and immediately apply it. */
  async setRetentionDays(days: AuditRetentionDays): Promise<{ purged: number }> {
    let settings: Record<string, unknown> = {};
    try {
      if (existsSync(SETTINGS_PATH)) {
        settings = JSON.parse(readFileSync(SETTINGS_PATH, "utf-8")) as Record<string, unknown>;
      }
    } catch {
      settings = {};
    }
    settings[SETTINGS_KEY] = days;
    writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), "utf-8");

    // Apply the (possibly shorter) window right away so the user sees the
    // effect without waiting for the next scheduled sweep.
    const purged = await this.purgeExpired();
    return { purged };
  }

  /**
   * Delete entries older than the retention window. No-op when retention is
   * permanent (0). Works identically against MySQL and SQLite.
   * Returns the number of rows removed.
   */
  async purgeExpired(): Promise<number> {
    const days = this.getRetentionDays();
    if (days === 0) return 0;
    try {
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const affected = await auditPurgeBefore(cutoff);
      if (affected > 0) {
        console.log(`[AuditLog] Retention purge removed ${affected} entries older than ${days} days`);
      }
      return affected;
    } catch (err) {
      console.warn("[AuditLog] Retention purge failed:", err);
      return 0;
    }
  }

  /** Entry count + approximate on-disk size, for the Settings storage warning. */
  async getStorageStats(): Promise<{
    dbActive: boolean;
    entries: number;
    oldestEntryAt: string | null;
    approxBytes: number;
  }> {
    try {
      return await auditStats();
    } catch {
      return { dbActive: false, entries: 0, oldestEntryAt: null, approxBytes: 0 };
    }
  }

  /**
   * Start the periodic retention sweep (call once at server startup).
   * Runs an initial purge shortly after boot, then every 6 hours.
   */
  startRetentionScheduler(): void {
    if (this.purgeTimer) return;
    // Small delay so startup isn't slowed by a potentially large first purge.
    const initial = setTimeout(() => {
      void this.purgeExpired();
    }, 30_000);
    initial.unref?.();

    this.purgeTimer = setInterval(() => {
      void this.purgeExpired();
    }, PURGE_INTERVAL_MS);
    this.purgeTimer.unref?.();
  }
}
