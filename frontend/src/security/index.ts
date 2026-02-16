/**
 * Security module exports.
 * 
 * SECURITY NOTICE:
 * This module provides DEMO-ONLY access control for the CSV-based dashboard.
 * All checks run in the browser and provide NO real security.
 * See SECURITY.md for details on future backend implementation.
 */

// Types
export type {
  User,
  Group,
  Role,
  RoleId,
  Permission,
  Scope,
  UserAccessContext,
} from "./types";
export { PERMISSIONS, ROLE_IDS } from "./types";

// Roles
export { ROLES, getRoleById } from "./roles";

// Mock data
export {
  MOCK_USERS,
  MOCK_GROUPS,
  getUserById,
  getGroupById,
  getGroupsForUser,
} from "./mockUsers";

// Access control helpers
export {
  getEffectivePermissions,
  getEffectiveScope,
  buildUserAccessContext,
  can,
  canAll,
  canAny,
  isInstanceVisible,
  isWorkflowVisible,
  isExecutionVisibleToUser,
  isNodeRunVisibleToUser,
  filterExecutionsByScope,
  filterNodeRunsByScope,
  filterWorkflowsByScope,
  getAllowedInstanceIds,
} from "./accessControl";

// React context
export {
  UserProvider,
  useUser,
  useAccessContext,
  useCan,
} from "./UserContext";
