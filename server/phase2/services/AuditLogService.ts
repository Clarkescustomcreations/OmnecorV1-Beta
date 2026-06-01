/**
 * @file server/phase2/services/AuditLogService.ts
 * @description Omnecor — Immutable Audit Log Service (Phase 20)
 *
 * Insert-only singleton. No update or delete methods are exposed by design.
 * Errors are swallowed so audit logging never crashes the main application flow.
 */

import { v4 as uuidv4 } from "uuid";
import { getDb } from "../../db.js";
import { auditLog, type InsertAuditLog } from "../../../drizzle/schema.js";

type LogInput = Omit<InsertAuditLog, "id" | "createdAt">;

export class AuditLogService {
  private static instance: AuditLogService | null = null;

  private constructor() {}

  public static getInstance(): AuditLogService {
    if (!AuditLogService.instance) {
      AuditLogService.instance = new AuditLogService();
    }
    return AuditLogService.instance;
  }

  async log(input: LogInput): Promise<void> {
    const db = await getDb();
    if (!db) return;
    try {
      await db.insert(auditLog).values({ id: uuidv4(), ...input });
    } catch {
      // Audit log must never crash the main flow
    }
  }
}
