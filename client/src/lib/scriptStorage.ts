/**
 * Saved Scripts — client types + legacy migration helpers.
 *
 * Scripts are now persisted server-side (see `scripts` tRPC router) so they
 * follow the user across sessions, devices and projects. This module only
 * exposes the shared row type and a one-time migration path for any scripts a
 * user previously saved to localStorage (the old browser-trapped store).
 */
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";

export type SavedScript = inferRouterOutputs<AppRouter>["scripts"]["list"][number];

/** Shape of a script that still needs to be created on the server. */
export interface NewScript {
  name: string;
  description: string;
  code: string;
  language: string;
  project: string;
}

const LEGACY_STORAGE_KEY = "omnecor:saved_scripts";

/**
 * Read any scripts left in the old localStorage store so they can be migrated
 * to the server. Returns an empty array when there is nothing to migrate.
 */
export function getLegacyLocalScripts(): NewScript[] {
  try {
    const data = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!data) return [];
    const parsed = JSON.parse(data);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((s) => s && typeof s.code === "string" && typeof s.name === "string")
      .map((s) => ({
        name: String(s.name),
        description: typeof s.description === "string" ? s.description : "",
        code: String(s.code),
        language: typeof s.language === "string" ? s.language : "python",
        project: typeof s.project === "string" && s.project ? s.project : "Default",
      }));
  } catch (e) {
    console.warn("Failed to read legacy saved scripts", e);
    return [];
  }
}

/** Remove the legacy localStorage store once migration has completed. */
export function clearLegacyLocalScripts(): void {
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch (e) {
    console.warn("Failed to clear legacy saved scripts", e);
  }
}
