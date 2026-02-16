/**
 * SECURITY NOTICE:
 * Access control helpers for DEMO-ONLY frontend restrictions.
 * These functions run in the browser and provide NO real security.
 * Any user with dev tools can bypass all checks.
 * 
 * These are designed as pure functions so they can later be
 * moved to a backend as-is for real server-side enforcement.
 */

import type {
  User,
  Group,
  Permission,
  Scope,
  UserAccessContext,
} from "./types";
import type { Execution, ExecutionNode, Workflow } from "@/types/execution";
import { getRoleById } from "./roles";
import { getGroupsForUser } from "./mockUsers";

// ===== Permissions =====

/**
 * Compute effective permissions for a user based on their groups.
 * Merges permissions from all groups (union).
 * Note: user param kept for future extension (direct user permissions).
 */
export function getEffectivePermissions(
  _user: User,
  groups: readonly Group[]
): readonly Permission[] {
  const permissionSet = new Set<Permission>();

  for (const group of groups) {
    const role = getRoleById(group.roleId);
    for (const perm of role.permissions) {
      permissionSet.add(perm);
    }
  }

  return Array.from(permissionSet);
}

/**
 * Check if a user has a specific permission.
 */
export function can(
  context: UserAccessContext,
  permission: Permission
): boolean {
  return context.effectivePermissions.includes(permission);
}

/**
 * Check multiple permissions (all must be present).
 */
export function canAll(
  context: UserAccessContext,
  permissions: readonly Permission[]
): boolean {
  return permissions.every((p) => can(context, p));
}

/**
 * Check if user has any of the given permissions.
 */
export function canAny(
  context: UserAccessContext,
  permissions: readonly Permission[]
): boolean {
  return permissions.some((p) => can(context, p));
}

// ===== Scope =====

/**
 * Merge scopes from all groups (union of all allowed values).
 * Empty/undefined arrays mean "all" in demo mode.
 */
export function getEffectiveScope(groups: readonly Group[]): Scope {
  const instanceIds = new Set<string>();
  const workflowIds = new Set<string>();
  const tags = new Set<string>();

  let hasUnrestrictedInstance = false;
  let hasUnrestrictedWorkflow = false;
  let hasUnrestrictedTags = false;

  for (const group of groups) {
    const scope = group.scope;

    // If any group has no instance restriction, user gets all instances
    if (!scope.instanceIds || scope.instanceIds.length === 0) {
      hasUnrestrictedInstance = true;
    } else {
      for (const id of scope.instanceIds) instanceIds.add(id);
    }

    if (!scope.workflowIds || scope.workflowIds.length === 0) {
      hasUnrestrictedWorkflow = true;
    } else {
      for (const id of scope.workflowIds) workflowIds.add(id);
    }

    if (!scope.tags || scope.tags.length === 0) {
      hasUnrestrictedTags = true;
    } else {
      for (const tag of scope.tags) tags.add(tag);
    }
  }

  return {
    instanceIds: hasUnrestrictedInstance ? undefined : Array.from(instanceIds),
    workflowIds: hasUnrestrictedWorkflow ? undefined : Array.from(workflowIds),
    tags: hasUnrestrictedTags ? undefined : Array.from(tags),
  };
}

/**
 * Build complete user access context.
 * @param user - The user to build context for
 * @param groupsOverride - Optional groups array (for dynamic localStorage-based groups)
 */
export function buildUserAccessContext(
  user: User,
  groupsOverride?: readonly Group[]
): UserAccessContext {
  const groups = groupsOverride
    ? user.groupIds
        .map((gid) => groupsOverride.find((g) => g.id === gid))
        .filter((g): g is Group => g !== undefined)
    : getGroupsForUser(user);
  return {
    user,
    effectivePermissions: getEffectivePermissions(user, groups),
    effectiveScope: getEffectiveScope(groups),
  };
}

// ===== Data visibility checks =====

/**
 * Check if an instance ID is visible to the user.
 * Returns true if scope is unrestricted OR instanceId is in allowed list.
 */
export function isInstanceVisible(
  instanceId: string | undefined | null,
  scope: Scope
): boolean {
  // No restriction = visible
  if (!scope.instanceIds || scope.instanceIds.length === 0) {
    return true;
  }
  // If execution has no instanceId, allow it (defensive)
  if (!instanceId) return true;
  return scope.instanceIds.includes(instanceId);
}

/**
 * Check if a workflow is visible based on workflowId and tags.
 */
export function isWorkflowVisible(
  workflow: Workflow,
  scope: Scope
): boolean {
  // Check instanceId
  if (!isInstanceVisible(workflow.instanceId, scope)) {
    return false;
  }

  // Check workflowId restriction
  if (scope.workflowIds && scope.workflowIds.length > 0) {
    if (!scope.workflowIds.includes(workflow.workflowId)) {
      return false;
    }
  }

  // Check tags restriction
  if (scope.tags && scope.tags.length > 0) {
    const workflowTags = workflow.tags ?? [];
    const hasMatchingTag = scope.tags.some((t) => workflowTags.includes(t));
    if (!hasMatchingTag && workflowTags.length > 0) {
      // Only filter by tags if workflow has tags
      return false;
    }
  }

  return true;
}

/**
 * Check if an execution is visible to the user.
 */
export function isExecutionVisibleToUser(
  execution: Execution,
  context: UserAccessContext
): boolean {
  const scope = context.effectiveScope;

  // Check instance
  if (!isInstanceVisible(execution.instanceId, scope)) {
    return false;
  }

  // Check workflow restriction
  if (scope.workflowIds && scope.workflowIds.length > 0) {
    if (!scope.workflowIds.includes(execution.workflowId)) {
      return false;
    }
  }

  return true;
}

/**
 * Check if a node run is visible to the user.
 */
export function isNodeRunVisibleToUser(
  nodeRun: ExecutionNode,
  context: UserAccessContext
): boolean {
  const scope = context.effectiveScope;

  // Check instance
  if (!isInstanceVisible(nodeRun.instanceId, scope)) {
    return false;
  }

  // Check workflow restriction
  if (scope.workflowIds && scope.workflowIds.length > 0) {
    if (!scope.workflowIds.includes(nodeRun.workflowId)) {
      return false;
    }
  }

  return true;
}

// ===== Filter helpers (pure functions) =====

/**
 * Filter executions by user scope.
 */
export function filterExecutionsByScope(
  executions: readonly Execution[],
  context: UserAccessContext
): readonly Execution[] {
  return executions.filter((e) => isExecutionVisibleToUser(e, context));
}

/**
 * Filter node runs by user scope.
 */
export function filterNodeRunsByScope(
  nodeRuns: readonly ExecutionNode[],
  context: UserAccessContext
): readonly ExecutionNode[] {
  return nodeRuns.filter((n) => isNodeRunVisibleToUser(n, context));
}

/**
 * Filter workflows by user scope.
 */
export function filterWorkflowsByScope(
  workflows: readonly Workflow[],
  context: UserAccessContext
): readonly Workflow[] {
  return workflows.filter((w) => isWorkflowVisible(w, context.effectiveScope));
}

/**
 * Get allowed instance IDs for a user.
 * Returns undefined if user has access to all instances.
 */
export function getAllowedInstanceIds(
  context: UserAccessContext
): readonly string[] | undefined {
  return context.effectiveScope.instanceIds;
}
