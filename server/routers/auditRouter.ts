/**
 * @file server/routers/auditRouter.ts
 * @description Omnecor — Append-Only Audit Log Router (Phase 20)
 *
 * All procedures are admin-only. The audit log is insert-only by design —
 * the only mutation exposed here is the retention-window setting; the actual
 * purge is time-based and handled by AuditLogService.
 */

import { z } from "zod";
import { router, adminProcedure } from "../_core/trpc.js";
import { getDb } from "../db.factory.js";
import { auditLog } from "../../drizzle/schema.js";
import { desc, eq, sql } from "drizzle-orm";
import {
  AuditLogService,
  type AuditRetentionDays,
} from "../phase2/services/AuditLogService.js";

export const auditRouter = router({
  getAuditLog: adminProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(500).default(100),
      offset: z.number().int().min(0).default(0),
      actorId: z.number().int().optional(),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { entries: [], total: 0 };
      const [entries, countResult] = await Promise.all([
        db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(input.limit).offset(input.offset),
        db.select({ count: sql<number>`count(*)` }).from(auditLog),
      ]);
      const total = Number(countResult[0]?.count ?? 0);
      return { entries, total };
    }),

  getAuditLogByActor: adminProcedure
    .input(z.object({ actorId: z.number().int(), limit: z.number().int().min(1).max(200).default(50) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { entries: [] };
      const entries = await db.select().from(auditLog)
        .where(eq(auditLog.actorId, input.actorId))
        .orderBy(desc(auditLog.createdAt))
        .limit(input.limit);
      return { entries };
    }),

  exportAuditLog: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(5000).default(1000) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { csv: "" };
      const entries = await db.select().from(auditLog)
        .orderBy(desc(auditLog.createdAt))
        .limit(input.limit);
      // Escape CSV fields: wrap in quotes and double any internal quotes.
      // Also strip leading =,+,-,@ to prevent formula injection in Excel/Sheets.
      const csvEscape = (val: unknown): string => {
        const s = String(val ?? "")
          .replace(/[\r\n]+/g, " ")
          .replace(/^[=+\-@\t]/, "'$&");
        return `"${s.replace(/"/g, '""')}"`;
      };
      const header = "id,eventType,actorId,actorType,procedure,ipAddress,createdAt\n";
      const rows = entries.map(e =>
        [e.id, e.eventType, e.actorId ?? "", e.actorType, e.procedure ?? "", e.ipAddress ?? "", e.createdAt.toISOString()]
          .map(csvEscape)
          .join(",")
      ).join("\n");
      return { csv: header + rows };
    }),

  /** Current retention window + storage stats for the Settings → Security panel. */
  getRetention: adminProcedure.query(async () => {
    const service = AuditLogService.getInstance();
    const stats = await service.getStorageStats();
    return { retentionDays: service.getRetentionDays(), ...stats };
  }),

  /**
   * Change the retention window (14 days default / 28 days / 0 = permanent).
   * Applies immediately: shrinking the window purges out-of-window entries.
   * The change itself is recorded in the audit log.
   */
  setRetention: adminProcedure
    .input(z.object({ retentionDays: z.union([z.literal(14), z.literal(28), z.literal(0)]) }))
    .mutation(async ({ ctx, input }) => {
      const service = AuditLogService.getInstance();
      const previous = service.getRetentionDays();
      const { purged } = await service.setRetentionDays(input.retentionDays as AuditRetentionDays);
      await service.log({
        eventType: "audit_retention_changed",
        actorId: ctx.user?.id ?? null,
        actorType: "user",
        procedure: "audit.setRetention",
        args: { previousDays: previous, retentionDays: input.retentionDays, purged },
        result: null,
        ipAddress: ctx.req.ip ?? null,
        sessionId: null,
      });
      return { success: true, retentionDays: input.retentionDays, purged };
    }),
});
