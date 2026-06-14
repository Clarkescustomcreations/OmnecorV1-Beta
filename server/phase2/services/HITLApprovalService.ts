import { EventEmitter } from "events";
import { v4 as uuidv4 } from "uuid";
import type { CriticalAction } from "../../../shared/hitl.js";
import { AuditLogService } from "./AuditLogService.js";
import { getSetting } from "./SettingsService.js";

export type { CriticalAction };

/**
 * Human-in-the-loop gate categories. Each maps to a toggle in
 * Settings → Security; when its toggle is off the corresponding actions run
 * without requiring manual approval. Gates default to ON (safe) when unset.
 */
export type HitlCategory = "command" | "file" | "internet" | "financial";

const HITL_SETTING_KEY: Record<HitlCategory, string> = {
  command: "hitlCommandExecution",
  file: "hitlFileDeletion",
  internet: "hitlInternetAccess",
  financial: "hitlFinancialTransactions",
};

/** Whether the HITL approval gate is currently enabled for a category. */
export function isHitlGateEnabled(category: HitlCategory): boolean {
  return getSetting<boolean>(HITL_SETTING_KEY[category], true);
}

/**
 * HITLApprovalService
 * Manages the lifecycle of critical agent actions that require manual intervention.
 */
export class HITLApprovalService extends EventEmitter {
  private static instance: HITLApprovalService | null = null;
  private pendingActions: Map<string, CriticalAction> = new Map();
  private approvalResolvers: Map<string, (approved: boolean) => void> =
    new Map();

  private constructor() {
    super();
  }

  public static getInstance(): HITLApprovalService {
    if (!HITLApprovalService.instance) {
      HITLApprovalService.instance = new HITLApprovalService();
    }
    return HITLApprovalService.instance;
  }

  /**
   * Request approval for a critical action.
   * Suspends execution until approval is received.
   */
  async requestApproval(
    toolName: string,
    args: any,
    category?: HitlCategory,
  ): Promise<boolean> {
    // If this action's HITL gate has been disabled in Settings → Security,
    // auto-approve without suspending execution (but still record it).
    if (category && !isHitlGateEnabled(category)) {
      AuditLogService.getInstance().log({
        eventType: "hitl_auto_approved",
        actorId: null,
        actorType: "system",
        procedure: toolName,
        args: args as Record<string, unknown>,
        result: { autoApproved: true, category },
        ipAddress: null,
        sessionId: null,
      }).catch((err) => console.warn("[AuditLog] write failed:", err));
      return true;
    }

    const id = uuidv4();
    const action: CriticalAction = {
      id,
      toolName,
      args,
      status: "pending",
      timestamp: new Date().toISOString(),
    };

    this.pendingActions.set(id, action);
    this.emit("actionPending", action);

    AuditLogService.getInstance().log({
      eventType: "hitl_request",
      actorId: null,
      actorType: "system",
      procedure: toolName,
      args: args as Record<string, unknown>,
      result: null,
      ipAddress: null,
      sessionId: null,
    }).catch((err) => console.warn("[AuditLog] write failed:", err));

    // Wait for manual approval/rejection
    return new Promise(resolve => {
      this.approvalResolvers.set(id, (approved: boolean) => {
        action.status = approved ? "approved" : "rejected";
        this.pendingActions.delete(id);
        this.approvalResolvers.delete(id);
        resolve(approved);
      });
    });
  }

  /**
   * Handle user approval/rejection.
   */
  approveAction(id: string, approved: boolean) {
    const resolver = this.approvalResolvers.get(id);
    if (resolver) {
      resolver(approved);
      AuditLogService.getInstance().log({
        eventType: approved ? "hitl_approved" : "hitl_rejected",
        actorId: null,
        actorType: "system",
        procedure: id,
        args: null,
        result: { approved },
        ipAddress: null,
        sessionId: null,
      }).catch((err) => console.warn("[AuditLog] write failed:", err));
    }
  }

  getPendingActions(): CriticalAction[] {
    return Array.from(this.pendingActions.values());
  }

  /**
   * Request HITL approval for destructive Ollama model operations.
   * Returns true if approved, false if rejected or timed out.
   */
  async requestModelDeletion(modelName: string): Promise<boolean> {
    return this.requestApproval("ollama.deleteModel", {
      modelName,
      warning: "This will permanently delete the model weights from disk. This action cannot be undone.",
      riskLevel: "high",
    });
  }
}
