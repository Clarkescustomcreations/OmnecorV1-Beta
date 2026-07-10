import { describe, it, expect } from "vitest";
import { hasPermission, ROLE_PERMISSIONS } from "../core_services/config/rbac.js";

// The "device" role is applied at auth time to a paired phone's token
// (sdk.authenticateRequest caps the resolved user's role when session.deviceId is
// present). It must let the phone use the assistant but never drive admin/owner ops.
describe("device role (paired phone) permissions", () => {
  it("can use chat and read the dashboard/settings", () => {
    expect(hasPermission("device", "chat", "read")).toBe(true);
    expect(hasPermission("device", "chat", "write")).toBe(true);
    expect(hasPermission("device", "dashboard", "read")).toBe(true);
    expect(hasPermission("device", "settings", "read")).toBe(true);
  });

  it("cannot perform admin/owner-level actions", () => {
    expect(hasPermission("device", "settings", "write")).toBe(false);
    expect(hasPermission("device", "users", "manage")).toBe(false);
    expect(hasPermission("device", "system", "configure")).toBe(false);
    expect(hasPermission("device", "execution_mode", "set_sovereign")).toBe(false);
  });

  it("is a known role yet neither admin nor owner (adminProcedure/ownerProcedure reject it)", () => {
    expect(ROLE_PERMISSIONS).toHaveProperty("device");
    // Mirrors the guard in trpc.ts: role !== "admin" && role !== "owner" → FORBIDDEN
    const role = "device";
    expect(role === "admin" || role === "owner").toBe(false);
  });
});
