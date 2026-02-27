/**
 * SECURITY NOTICE:
 * This module defines types for a DEMO-ONLY access control system.
 * All checks run entirely in the browser and provide NO real security.
 * Any user with browser dev tools can bypass these restrictions.
 * Real security will be implemented later with backend auth + server-side checks.
 */

// ===== Permissions =====
export const PERMISSIONS = [
  "view:dashboard",
  "view:workflows",
  "view:executions",
  "view:executionDetails",
  "export:data",
  "admin:users",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

// ===== Roles =====
export const ROLE_IDS = ["viewer", "analyst", "admin"] as const;
export type RoleId = (typeof ROLE_IDS)[number];

export interface Role {
  readonly id: RoleId;
  readonly label: string;
  readonly permissions: readonly Permission[];
}

// ===== Scope =====
/**
 * Scope defines what data a user/group can access.
 * - undefined/empty arrays mean "all" (no restriction in demo mode)
 * - defined arrays restrict to those values only
 */
export interface Scope {
  readonly instanceIds?: readonly string[];
  readonly workflowIds?: readonly string[];
  readonly tags?: readonly string[];
}

// ===== Groups =====
export interface Group {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly roleId: RoleId;
  readonly scope: Scope;
}

// ===== Users =====
export interface User {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly groupIds: readonly string[];
}

// ===== Derived context =====
/**
 * UserContext combines a user with their effective permissions and scope.
 * Used throughout the app for access control decisions.
 */
export interface UserAccessContext {
  readonly user: User;
  readonly effectivePermissions: readonly Permission[];
  readonly effectiveScope: Scope;
}
