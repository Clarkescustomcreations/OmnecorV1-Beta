// shared/types/terminal.types.ts
// Canonical wire contract for the live PTY terminal (EmbeddedTerminal.tsx <-> WebSocketServer.ts).
// Both sides import these instead of declaring their own copies — the two independently
// duplicated shapes drifted apart silently (no compiler error) and broke command execution
// end-to-end until fixed. Importing the same types here makes that class of drift a
// compile-time error instead of a silent runtime bug.

export interface PtySpawnData {
  shell: string;
  cwd?: string;
  cols: number;
  rows: number;
}

export interface PtyInputData {
  input: string;
}

export interface PtyResizeData {
  cols: number;
  rows: number;
}

export interface PtyReadyData {
  sessionId: string;
  shell: string;
  cwd: string;
}

export interface PtyOutputData {
  output: string;
  sessionId: string;
}

export interface PtyExitData {
  exitCode: number;
  signal?: number;
  sessionId: string;
}

export type PtyClientMessage =
  | { type: "pty:spawn"; data: PtySpawnData }
  | { type: "pty:input"; data: PtyInputData }
  | { type: "pty:resize"; data: PtyResizeData }
  | { type: "pty:kill" };

export type PtyServerMessage =
  | { type: "pty:ready"; data: PtyReadyData }
  | { type: "pty:output"; data: PtyOutputData }
  | { type: "pty:exit"; data: PtyExitData };
