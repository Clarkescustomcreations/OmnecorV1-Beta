export interface CriticalAction {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  status: "pending" | "approved" | "rejected";
  timestamp: string;
  /**
   * Optional reason supplied by the reviewer when denying an action. Surfaced
   * back to the agent so it can adjust its approach rather than retrying blind.
   */
  denyReason?: string;
}
