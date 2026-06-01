// Role hierarchy: owner > admin > user > viewer
export type Role = "viewer" | "user" | "admin" | "owner";

export interface Permission {
  resource: string;
  action: string;
}

// Map each role to its allowed permissions
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  viewer: [
    { resource: "chat", action: "read" },
    { resource: "dashboard", action: "read" },
  ],
  user: [
    { resource: "chat", action: "read" },
    { resource: "chat", action: "write" },
    { resource: "dashboard", action: "read" },
    { resource: "settings", action: "read" },
    { resource: "integrations", action: "manage" },
    { resource: "training", action: "run" },
    { resource: "hardware", action: "manage" },
    { resource: "agents", action: "run" },
  ],
  admin: [
    // inherits user permissions
    { resource: "chat", action: "read" },
    { resource: "chat", action: "write" },
    { resource: "dashboard", action: "read" },
    { resource: "settings", action: "read" },
    { resource: "settings", action: "write" },
    { resource: "integrations", action: "manage" },
    { resource: "training", action: "run" },
    { resource: "hardware", action: "manage" },
    { resource: "agents", action: "run" },
    { resource: "audit_log", action: "read" },
    { resource: "users", action: "read" },
    { resource: "users", action: "manage" },
    { resource: "system", action: "configure" },
  ],
  owner: [
    // inherits all admin permissions + owner-only
    { resource: "chat", action: "read" },
    { resource: "chat", action: "write" },
    { resource: "dashboard", action: "read" },
    { resource: "settings", action: "read" },
    { resource: "settings", action: "write" },
    { resource: "integrations", action: "manage" },
    { resource: "training", action: "run" },
    { resource: "hardware", action: "manage" },
    { resource: "agents", action: "run" },
    { resource: "audit_log", action: "read" },
    { resource: "audit_log", action: "export" },
    { resource: "users", action: "read" },
    { resource: "users", action: "manage" },
    { resource: "users", action: "delete" },
    { resource: "system", action: "configure" },
    { resource: "system", action: "shutdown" },
    { resource: "execution_mode", action: "set_sovereign" },
  ],
};

export function hasPermission(role: Role, resource: string, action: string): boolean {
  return ROLE_PERMISSIONS[role]?.some(p => p.resource === resource && p.action === action) ?? false;
}

export function getPermissionsForRole(role: Role): Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}
