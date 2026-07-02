/**
 * @file server/routers/auditRouter.ts
 * @description Omnecor — Append-Only Audit Log Router (Phase 20)
 *
 * All procedures are admin-only. The audit log is insert-only by design —
 * the only mutation exposed here is the retention-window setting; the actual
 * purge is time-based and handled by AuditLogService.
 */

import { z } from "zod";
import { router, adminProcedure, ownerProcedure } from "../_core/trpc.js";
import { auditList, auditListByActor } from "../db.factory.js";
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
      return auditList(input.limit, input.offset);
    }),

  getAuditLogByActor: adminProcedure
    .input(z.object({ actorId: z.number().int(), limit: z.number().int().min(1).max(200).default(50) }))
    .query(async ({ input }) => {
      const entries = await auditListByActor(input.actorId, input.limit);
      return { entries };
    }),

  exportAuditLog: ownerProcedure
    .input(z.object({ limit: z.number().int().min(1).max(5000).default(1000) }))
    .query(async ({ input }) => {
      const { entries } = await auditList(input.limit, 0);
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
