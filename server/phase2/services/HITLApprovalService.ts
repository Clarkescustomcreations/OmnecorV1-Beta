import { EventEmitter } from "events";
import { v4 as uuidv4 } from "uuid";
import type { CriticalAction } from "../../../shared/hitl.js";

export type { CriticalAction };

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
  async requestApproval(toolName: string, args: any): Promise<boolean> {
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
    }
  }

  getPendingActions(): CriticalAction[] {
    return Array.from(this.pendingActions.values());
  }
}
