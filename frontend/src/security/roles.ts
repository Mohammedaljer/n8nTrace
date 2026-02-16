/**
 * SECURITY NOTICE:
 * Role definitions for DEMO-ONLY access control.
 * These are client-side only and provide NO real security.
 */

import type { Role, RoleId } from "./types";

/**
 * Role hierarchy (viewer < analyst < admin)
 */
export const ROLES: Record<RoleId, Role> = {
  viewer: {
    id: "viewer",
    label: "Viewer",
    permissions: [
      "view:dashboard",
      "view:workflows",
      "view:executions",
      "view:executionDetails",
    ],
  },
  analyst: {
    id: "analyst",
    label: "Analyst",
    permissions: [
      "view:dashboard",
      "view:workflows",
      "view:executions",
      "view:executionDetails",
      "export:data",
    ],
  },
  admin: {
    id: "admin",
    label: "Admin",
    permissions: [
      "view:dashboard",
      "view:workflows",
      "view:executions",
      "view:executionDetails",
      "export:data",
      "admin:users",
    ],
  },
};

export function getRoleById(roleId: RoleId): Role {
  return ROLES[roleId];
}
