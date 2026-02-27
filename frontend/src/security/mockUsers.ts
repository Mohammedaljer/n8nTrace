/**
 * SECURITY NOTICE:
 * Mock users and groups for DEMO-ONLY access control.
 * This is NOT real authentication - it's a UX demonstration of future RBAC.
 * All data is visible in browser dev tools.
 */

import type { User, Group } from "./types";

// ===== Groups =====
export const MOCK_GROUPS: readonly Group[] = [
  {
    id: "global-admins",
    name: "Global Admins",
    description: "Full access to all instances and features",
    roleId: "admin",
    scope: {}, // Empty = all access
  },
  {
    id: "prod-observers",
    name: "Prod Observers",
    description: "View-only access to production instance",
    roleId: "viewer",
    scope: {
      instanceIds: ["prod"],
    },
  },
  {
    id: "dev-analysts",
    name: "Dev Analysts",
    description: "Analyst access to development instances",
    roleId: "analyst",
    scope: {
      instanceIds: ["dev", "dev01", "staging"],
    },
  },
  {
    id: "all-viewers",
    name: "All Viewers",
    description: "View-only access to all instances",
    roleId: "viewer",
    scope: {},
  },
];

// ===== Users =====
export const MOCK_USERS: readonly User[] = [
  {
    id: "user-admin",
    name: "Admin User",
    email: "admin@example.com",
    groupIds: ["global-admins"],
  },
  {
    id: "user-prod-viewer",
    name: "Prod Viewer",
    email: "prod-viewer@example.com",
    groupIds: ["prod-observers"],
  },
  {
    id: "user-dev-analyst",
    name: "Dev Analyst",
    email: "dev-analyst@example.com",
    groupIds: ["dev-analysts"],
  },
  {
    id: "user-viewer",
    name: "Viewer User",
    email: "viewer@example.com",
    groupIds: ["all-viewers"],
  },
];

// ===== Helpers =====
export function getUserById(id: string): User | undefined {
  return MOCK_USERS.find((u) => u.id === id);
}

export function getGroupById(id: string): Group | undefined {
  return MOCK_GROUPS.find((g) => g.id === id);
}

export function getGroupsForUser(user: User): readonly Group[] {
  return user.groupIds
    .map((gid) => getGroupById(gid))
    .filter((g): g is Group => g !== undefined);
}
