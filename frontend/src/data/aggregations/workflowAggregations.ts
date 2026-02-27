import type { Execution } from "@/types/execution";
import { percentile } from "./kpiAggregations";

export interface WorkflowStats {
  readonly workflowId: string;
  readonly workflowName: string;
  readonly runs: number;
  readonly failures: number;
  readonly failureRate: number;
  readonly lastRunAt: Date | null;
  readonly p95DurationMs: number;
  readonly lastStatus: string | null;
}

/**
 * Compute workflow statistics from executions
 */
export function computeWorkflowStats(
  executions: readonly Execution[],
  workflowMap: Map<string, string>
): readonly WorkflowStats[] {
  const byWorkflow = new Map<string, Execution[]>();

  for (const exec of executions) {
    const list = byWorkflow.get(exec.workflowId) ?? [];
    list.push(exec);
    byWorkflow.set(exec.workflowId, list);
  }

  const stats: WorkflowStats[] = [];

  for (const [workflowId, execs] of byWorkflow) {
    const runs = execs.length;
    const failures = execs.filter(
      (e) => e.status === "error" || e.status === "crashed"
    ).length;
    const failureRate = runs > 0 ? Math.round((failures / runs) * 1000) / 10 : 0;

    // Find last run
    const sortedByDate = [...execs]
      .filter((e) => e.startedAt !== null)
      .sort((a, b) => (b.startedAt?.getTime() ?? 0) - (a.startedAt?.getTime() ?? 0));

    const lastRunAt = sortedByDate.length > 0 ? sortedByDate[0].startedAt : null;
    const lastStatus = sortedByDate.length > 0 ? sortedByDate[0].status : null;

    // Calculate p95 duration
    const durations = execs
      .filter((e) => e.durationMs !== null)
      .map((e) => e.durationMs as number)
      .sort((a, b) => a - b);

    const p95DurationMs = Math.round(percentile(durations, 95));

    stats.push({
      workflowId,
      workflowName: workflowMap.get(workflowId) ?? workflowId,
      runs,
      failures,
      failureRate,
      lastRunAt,
      p95DurationMs,
      lastStatus,
    });
  }

  return stats;
}

export type WorkflowStatsSortKey = keyof WorkflowStats;
export type SortDirection = "asc" | "desc";

/**
 * Sort workflow stats by a given key
 */
export function sortWorkflowStats(
  stats: readonly WorkflowStats[],
  sortKey: WorkflowStatsSortKey,
  direction: SortDirection
): readonly WorkflowStats[] {
  const sorted = [...stats].sort((a, b) => {
    const aVal = a[sortKey];
    const bVal = b[sortKey];

    // Handle nulls
    if (aVal === null && bVal === null) return 0;
    if (aVal === null) return 1;
    if (bVal === null) return -1;

    // Handle dates
    if (aVal instanceof Date && bVal instanceof Date) {
      return aVal.getTime() - bVal.getTime();
    }

    // Handle strings
    if (typeof aVal === "string" && typeof bVal === "string") {
      return aVal.localeCompare(bVal);
    }

    // Handle numbers
    if (typeof aVal === "number" && typeof bVal === "number") {
      return aVal - bVal;
    }

    return 0;
  });

  return direction === "desc" ? sorted.reverse() : sorted;
}

/**
 * Filter workflow stats by search query
 */
export function filterWorkflowStats(
  stats: readonly WorkflowStats[],
  search: string
): readonly WorkflowStats[] {
  if (!search.trim()) return stats;

  const searchLower = search.toLowerCase();
  return stats.filter(
    (s) =>
      s.workflowId.toLowerCase().includes(searchLower) ||
      s.workflowName.toLowerCase().includes(searchLower)
  );
}
