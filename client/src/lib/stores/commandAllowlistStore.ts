/**
 * Command Allowlist Store
 *
 * Tracks which shell commands have been approved (once, per-project, or globally).
 * Persisted to localStorage so approvals survive page reloads.
 *
 * Scope hierarchy:
 *   global  — approved everywhere, any project
 *   project — approved for a specific projectId
 *   once    — approved for the current invocation only (not persisted)
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type AllowScope = "once" | "project" | "global";

export interface AllowedCommand {
  /** Normalised command key (first word/executable) */
  cmd: string;
  scope: AllowScope;
  /** projectId when scope === "project" */
  projectId?: string;
  approvedAt: number; // epoch ms
}

export interface PendingApproval {
  id: string;
  fullCommand: string;
  /** first word — used for key matching */
  cmd: string;
  cwd?: string;
  projectId?: string;
  resolve: (scope: AllowScope | null) => void;
}

interface CommandAllowlistState {
  /** Persisted approvals */
  entries: AllowedCommand[];

  /** In-flight approval request (one at a time) */
  pending: Omit<PendingApproval, "resolve"> | null;

  addEntry: (cmd: string, scope: AllowScope, projectId?: string) => void;
  removeEntry: (cmd: string, scope: AllowScope, projectId?: string) => void;
  clearProjectEntries: (projectId: string) => void;
  clearAllEntries: () => void;

  /** Check if a command is pre-approved (returns scope or null) */
  isAllowed: (cmd: string, projectId?: string) => AllowScope | null;

  /**
   * Request approval for a command.
   * Returns a Promise that resolves when the user picks an action.
   * Resolves to the scope that was chosen, or null if denied.
   */
  requestApproval: (fullCommand: string, cwd?: string, projectId?: string) => Promise<AllowScope | null>;

  /** Called by the approval dialog to resolve the pending approval */
  _resolvePending: (scope: AllowScope | null) => void;
}

let _resolver: ((scope: AllowScope | null) => void) | null = null;

export const useCommandAllowlistStore = create<CommandAllowlistState>()(
  persist(
    (set, get) => ({
      entries: [],
      pending: null,

      addEntry: (cmd, scope, projectId) => {
        const normalised = normaliseCmd(cmd);
        set(s => ({
          entries: [
            // deduplicate: remove existing entry for same cmd+scope+project
            ...s.entries.filter(e =>
              !(e.cmd === normalised && e.scope === scope && e.projectId === projectId)
            ),
            { cmd: normalised, scope, projectId, approvedAt: Date.now() },
          ],
        }));
      },

      removeEntry: (cmd, scope, projectId) => {
        const normalised = normaliseCmd(cmd);
        set(s => ({
          entries: s.entries.filter(e =>
            !(e.cmd === normalised && e.scope === scope && e.projectId === projectId)
          ),
        }));
      },

      clearProjectEntries: (projectId) => {
        set(s => ({ entries: s.entries.filter(e => e.projectId !== projectId) }));
      },

      clearAllEntries: () => set({ entries: [] }),

      isAllowed: (cmd, projectId) => {
        const normalised = normaliseCmd(cmd);
        const entries = get().entries;
        // global first
        if (entries.some(e => e.cmd === normalised && e.scope === "global")) return "global";
        // then project
        if (projectId && entries.some(e => e.cmd === normalised && e.scope === "project" && e.projectId === projectId)) {
          return "project";
        }
        return null;
      },

      requestApproval: (fullCommand, cwd, projectId) => {
        const cmd = normaliseCmd(fullCommand);

        // Fast-path: already allowed
        const existing = get().isAllowed(cmd, projectId);
        if (existing) return Promise.resolve(existing);

        return new Promise<AllowScope | null>(resolve => {
          _resolver = resolve;
          set({
            pending: {
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              fullCommand,
              cmd,
              cwd,
              projectId,
            },
          });
        });
      },

      _resolvePending: (scope) => {
        const pending = get().pending;
        if (!pending || !_resolver) return;

        if (scope && scope !== "once") {
          get().addEntry(pending.cmd, scope, scope === "project" ? pending.projectId : undefined);
        }

        _resolver(scope);
        _resolver = null;
        set({ pending: null });
      },
    }),
    {
      name: "omnecor_cmd_allowlist",
      // Only persist the entries list, not transient pending state
      partialize: (s) => ({ entries: s.entries }),
    }
  )
);

/** Extract the executable name from a command string */
function normaliseCmd(raw: string): string {
  // Strip sudo, env var prefixes, etc.; take first real token
  const stripped = raw.trim().replace(/^(sudo|env\s+\S+=\S+\s+)+/, "");
  return stripped.split(/\s+/)[0] ?? raw.trim();
}
