export interface CriticalAction {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  status: "pending" | "approved" | "rejected";
  timestamp: string;
}
