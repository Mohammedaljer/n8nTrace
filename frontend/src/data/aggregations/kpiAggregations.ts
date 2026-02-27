import type { Execution, ExecutionNode } from "@/types/execution";

export interface DashboardKpiData {
  readonly totalExecutions: number;
  readonly failures: number;
  readonly failureRate: number;
  readonly medianDurationMs: number;
  readonly p95DurationMs: number;
}

/**
 * Calculate percentile from a sorted array of numbers
 */
export function percentile(sortedValues: readonly number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0];

  const index = (p / 100) * (sortedValues.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;

  if (upper >= sortedValues.length) return sortedValues[sortedValues.length - 1];
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

/**
 * Calculate median (50th percentile)
 */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return percentile(sorted, 50);
}

/**
 * Calculate p95 (95th percentile)
 */
export function p95(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return percentile(sorted, 95);
}

/**
 * Compute dashboard KPIs from filtered executions (with defensive null checks)
 */
export function computeKpis(executions: readonly Execution[]): DashboardKpiData {
  if (!executions || !Array.isArray(executions)) {
    return { totalExecutions: 0, failures: 0, failureRate: 0, medianDurationMs: 0, p95DurationMs: 0 };
  }
  
  const total = executions.length;
  const failures = executions.filter(
    (e) => e?.status === "error" || e?.status === "crashed"
  ).length;

  const failureRate = total > 0 ? Math.round((failures / total) * 1000) / 10 : 0;

  const durations = executions
    .filter((e) => e?.durationMs != null && typeof e.durationMs === "number")
    .map((e) => e.durationMs as number);

  return {
    totalExecutions: total,
    failures,
    failureRate,
    medianDurationMs: Math.round(median(durations)),
    p95DurationMs: Math.round(p95(durations)),
  };
}

export interface NodePerformance {
  readonly nodeName: string;
  readonly nodeType: string;
  readonly executionCount: number;
  readonly medianTimeMs: number;
  readonly p95TimeMs: number;
  readonly avgTimeMs: number;
  /** Unique execution IDs that include this node (for drill-down) */
  readonly executionIds: readonly string[];
}

/**
 * Compute top N slowest nodes by p95 execution time (with defensive null checks)
 */
export function computeSlowNodes(
  nodeRuns: readonly ExecutionNode[],
  topN: number = 10
): readonly NodePerformance[] {
  if (!nodeRuns || !Array.isArray(nodeRuns) || nodeRuns.length === 0) {
    return [];
  }
  
  // Group by nodeName + nodeType for unique identification
  const byNode = new Map<string, ExecutionNode[]>();

  for (const node of nodeRuns) {
    // Defensive: skip null/undefined nodes
    if (!node?.nodeName || !node?.nodeType) continue;
    
    const key = `${node.nodeName}::${node.nodeType}`;
    const list = byNode.get(key) ?? [];
    list.push(node);
    byNode.set(key, list);
  }

  const performances: NodePerformance[] = [];

  for (const [, nodes] of byNode) {
    if (!nodes || nodes.length === 0) continue;
    
    const times = nodes
      .filter((n) => n?.executionTimeMs != null && typeof n.executionTimeMs === "number")
      .map((n) => n.executionTimeMs);
    
    if (times.length === 0) continue;
    
    const sorted = [...times].sort((a, b) => a - b);
    const total = times.reduce((a, b) => a + b, 0);

    // Collect unique execution IDs
    const executionIdSet = new Set<string>();
    for (const node of nodes) {
      if (node?.executionId) executionIdSet.add(node.executionId);
    }

    performances.push({
      nodeName: nodes[0]?.nodeName ?? "Unknown",
      nodeType: nodes[0]?.nodeType ?? "Unknown",
      executionCount: nodes.length,
      medianTimeMs: Math.round(percentile(sorted, 50)),
      p95TimeMs: Math.round(percentile(sorted, 95)),
      avgTimeMs: Math.round(total / times.length),
      executionIds: Array.from(executionIdSet),
    });
  }

  // Sort by p95 descending and take top N
  return performances
    .sort((a, b) => b.p95TimeMs - a.p95TimeMs)
    .slice(0, topN);
}
