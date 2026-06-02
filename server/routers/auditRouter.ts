/**
 * @file server/routers/auditRouter.ts
 * @description Omnecor — Immutable Audit Log Router (Phase 20)
 *
 * All procedures are admin-only. The audit log is insert-only by design —
 * no mutation endpoints are exposed here.
 */

import { z } from "zod";
import { router, adminProcedure } from "../_core/trpc.js";
import { getDb } from "../db.factory.js";
import { auditLog } from "../../drizzle/schema.js";
import { desc, eq } from "drizzle-orm";

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
      const query = db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(input.limit).offset(input.offset);
      const entries = await query;
      return { entries };
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
        const s = String(val ?? "").replace(/^[=+\-@\t]/, "'$&");
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
});
