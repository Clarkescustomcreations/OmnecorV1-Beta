/**
 * Agentic chat block contract — re-exported for the Omnecor HQ mobile app.
 *
 * The desktop web UI, the server tool loop (`ChatAgentRunner`), and this app all
 * render an assistant turn from the SAME source of truth: the ordered
 * `AssistantBlock[]` union in `shared/chatBlocks.ts` and the wire event stream in
 * `shared/chatAgentEvents.ts`. Those two files are pure TypeScript — they import
 * only each other, with no Node / DOM / server dependencies — so the mobile
 * workspace can consume them directly.
 *
 * The mobile tsconfig has no `@shared` path alias (that's a web/vite-only alias),
 * so we reach the workspace-root `shared/` folder by relative path once, here,
 * and every mobile module imports the contract from `@/lib/_core/agent-blocks`.
 * Metro already watches the workspace root, so the runtime helpers
 * (`flattenBlocksToText`, `blockDotIntent`, `isToolBlock`) bundle cleanly.
 */
export type {
  AssistantBlock,
  AssistantBlockType,
  TextBlock,
  ThinkingBlock,
  CommandBlock,
  EditBlock,
  JobBlock,
  McpBlock,
  SubAgentBlock,
  ToolBlockStatus,
  JobBlockStatus,
  BlockDotIntent,
  FileDiff,
} from "../../../../../shared/chatBlocks";
export {
  isToolBlock,
  blockDotIntent,
  flattenBlocksToText,
  TOOL_FAILURE_STATUSES,
} from "../../../../../shared/chatBlocks";

export type {
  AgentStreamEvent,
  ToolApprovalDecision,
  ApprovableBlockType,
} from "../../../../../shared/chatAgentEvents";
