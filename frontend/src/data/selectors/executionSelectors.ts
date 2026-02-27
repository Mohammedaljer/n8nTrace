import type {
  Execution,
  ExecutionFilters,
  ExecutionNode,
  Workflow,
  WorkflowSummary,
  DashboardKpis,
} from "@/types/execution";
import { filterByInstance } from "@/data/selectors/filters";

/**
 * Filter executions by criteria (with optional node-level filters)
 */
export function filterExecutions(
  executions: readonly Execution[],
  workflows: readonly Workflow[],
  nodeRuns: readonly ExecutionNode[] = [],
  filters?: ExecutionFilters
): readonly Execution[] {
  if (!filters) return executions;

  const workflowMap = new Map(workflows.map((w) => [w.workflowId, w]));

  // Apply instance filtering first ("All instances" = undefined = no filter)
  const executionsByInstance = filterByInstance(executions, filters.instanceId);

  // Pre-compute node-level filter matches if needed
  const hasNodeFilters =
    filters.nodeNameContains ||
    filters.nodeTypeContains ||
    filters.itemsOutMin !== undefined ||
    filters.itemsOutMax !== undefined ||
    filters.executionTimeMsMin !== undefined ||
    filters.executionTimeMsMax !== undefined;

  let nodeMatchingExecutions: Set<string> | null = null;

  if (hasNodeFilters && nodeRuns.length > 0) {
    nodeMatchingExecutions = new Set<string>();

    for (const node of nodeRuns) {
      let matches = true;

      if (filters.nodeNameContains) {
        matches =
          matches &&
          node.nodeName
            .toLowerCase()
            .includes(filters.nodeNameContains.toLowerCase());
      }
      if (filters.nodeTypeContains) {
        matches =
          matches &&
          node.nodeType
            .toLowerCase()
            .includes(filters.nodeTypeContains.toLowerCase());
      }
      if (filters.itemsOutMin !== undefined) {
        matches = matches && node.itemsOutCount >= filters.itemsOutMin;
      }
      if (filters.itemsOutMax !== undefined) {
        matches = matches && node.itemsOutCount <= filters.itemsOutMax;
      }
      if (filters.executionTimeMsMin !== undefined) {
        matches = matches && node.executionTimeMs >= filters.executionTimeMsMin;
      }
      if (filters.executionTimeMsMax !== undefined) {
        matches = matches && node.executionTimeMs <= filters.executionTimeMsMax;
      }

      if (matches) {
        nodeMatchingExecutions.add(node.executionId);
      }
    }
  }

  return executionsByInstance.filter((exec) => {
    // Date range filter
    if (filters.dateFrom && exec.startedAt) {
      const from = new Date(filters.dateFrom);
      if (exec.startedAt < from) return false;
    }
    if (filters.dateTo && exec.startedAt) {
      const to = new Date(filters.dateTo);
      // If the dateTo includes time (has 'T'), use it as-is; otherwise end of day
      if (!filters.dateTo.includes("T")) {
        to.setHours(23, 59, 59, 999);
      }
      if (exec.startedAt > to) return false;
    }

    // Status filter
    if (filters.status && exec.status !== filters.status) {
      return false;
    }

    // Workflow filter
    if (filters.workflowId && exec.workflowId !== filters.workflowId) {
      return false;
    }

    // Mode filter
    if (filters.mode && exec.mode !== filters.mode) {
      return false;
    }

    // Finished filter
    if (filters.finished !== undefined && exec.finished !== filters.finished) {
      return false;
    }

    // Duration range filter
    if (
      filters.durationMsMin !== undefined &&
      (exec.durationMs === null || exec.durationMs < filters.durationMsMin)
    ) {
      return false;
    }
    if (
      filters.durationMsMax !== undefined &&
      (exec.durationMs === null || exec.durationMs > filters.durationMsMax)
    ) {
      return false;
    }

    // Node-level filters
    if (nodeMatchingExecutions && !nodeMatchingExecutions.has(exec.executionId)) {
      return false;
    }

    // Search filter (searches workflow name, execution id, lastNodeExecuted, and node names/types)
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      const workflow = workflowMap.get(exec.workflowId);
      const workflowName = workflow?.name ?? "";

      const matchesId = exec.executionId.toLowerCase().includes(searchLower);
      const matchesWorkflowId = exec.workflowId
        .toLowerCase()
        .includes(searchLower);
      const matchesWorkflowName = workflowName
        .toLowerCase()
        .includes(searchLower);
      const matchesNode = exec.lastNodeExecuted?.toLowerCase().includes(searchLower) ?? false;
      const matchesNodeNames = exec.nodeNamesExecuted.some((n) =>
        n.toLowerCase().includes(searchLower)
      );

      // Also search in node runs
      const matchesNodeRuns = nodeRuns.some(
        (n) =>
          n.executionId === exec.executionId &&
          (n.nodeName.toLowerCase().includes(searchLower) ||
            n.nodeType.toLowerCase().includes(searchLower))
      );

      if (
        !matchesId &&
        !matchesWorkflowId &&
        !matchesWorkflowName &&
        !matchesNode &&
        !matchesNodeNames &&
        !matchesNodeRuns
      ) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Group executions by workflow and compute summaries
 */
export function computeWorkflowSummaries(
  executions: readonly Execution[],
  workflows: readonly Workflow[]
): readonly WorkflowSummary[] {
  const workflowMap = new Map(workflows.map((w) => [w.workflowId, w]));
  const grouped = new Map<string, Execution[]>();

  for (const exec of executions) {
    const list = grouped.get(exec.workflowId) ?? [];
    list.push(exec);
    grouped.set(exec.workflowId, list);
  }

  const summaries: WorkflowSummary[] = [];

  for (const [workflowId, execs] of grouped) {
    const workflow = workflowMap.get(workflowId);
    const successCount = execs.filter((e) => e.status === "success").length;
    const errorCount = execs.filter((e) => e.status === "error").length;

    const durations = execs
      .filter((e) => e.durationMs !== null)
      .map((e) => e.durationMs as number);
    const avgDurationMs =
      durations.length > 0
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : 0;

    const dates = execs
      .filter((e) => e.startedAt !== null)
      .map((e) => e.startedAt as Date);
    const lastExecutedAt =
      dates.length > 0 ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null;

    summaries.push({
      workflowId,
      workflowName: workflow?.name ?? workflowId,
      totalExecutions: execs.length,
      successCount,
      errorCount,
      avgDurationMs,
      lastExecutedAt,
    });
  }

  return summaries.sort((a, b) => b.totalExecutions - a.totalExecutions);
}

/**
 * Compute dashboard KPIs from executions
 */
export function computeDashboardKpis(executions: readonly Execution[]): DashboardKpis {
  const total = executions.length;
  const successCount = executions.filter((e) => e.status === "success").length;
  const errorCount = executions.filter((e) => e.status === "error").length;

  const successRate = total > 0 ? Math.round((successCount / total) * 100) : 0;

  const durations = executions
    .filter((e) => e.durationMs !== null)
    .map((e) => e.durationMs as number);
  const avgDurationMs =
    durations.length > 0
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : 0;

  const uniqueWorkflows = new Set(executions.map((e) => e.workflowId));

  return {
    totalExecutions: total,
    successRate,
    errorCount,
    avgDurationMs,
    activeWorkflows: uniqueWorkflows.size,
  };
}

/**
 * Group executions by date for charting
 */
export function groupExecutionsByDate(
  executions: readonly Execution[]
): Map<string, { success: number; error: number; other: number }> {
  const byDate = new Map<string, { success: number; error: number; other: number }>();

  for (const exec of executions) {
    if (!exec.startedAt) continue;
    const dateKey = exec.startedAt.toISOString().split("T")[0];
    const entry = byDate.get(dateKey) ?? { success: 0, error: 0, other: 0 };

    if (exec.status === "success") entry.success++;
    else if (exec.status === "error") entry.error++;
    else entry.other++;

    byDate.set(dateKey, entry);
  }

  return byDate;
}
