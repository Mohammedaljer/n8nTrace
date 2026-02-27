/**
 * Pure, reusable filter helpers.
 * IMPORTANT: "All instances" must be represented as undefined (no filter).
 * All functions include defensive null checks.
 */

export function filterByInstance<T extends { instanceId?: string | null }>(
  items: readonly T[],
  instanceId?: string
): readonly T[] {
  if (!items || !Array.isArray(items)) return [];
  if (!instanceId) return items;
  return items.filter((i) => i?.instanceId === instanceId);
}

/**
 * Check if a filter value is "active" (not undefined/null/empty/"all")
 */
export function isFilterActive(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string" && (value.trim() === "" || value === "all")) return false;
  return true;
}

/**
 * Safely get string property with fallback
 */
export function safeString(value: unknown, fallback: string = ""): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return fallback;
  return String(value);
}
