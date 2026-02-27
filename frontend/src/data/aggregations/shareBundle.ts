/**
 * Share bundle aggregation for creating self-contained execution exports.
 * Combines execution data with node-level details into a single CSV.
 */

import type { Execution, ExecutionNode } from "@/types/execution";
import { formatDateForCsv } from "@/lib/export/csv";

export interface ExecutionBundleRow {
  // Execution fields
  instanceId: string;
  executionId: string;
  workflowId: string;
  status: string;
  mode: string;
  startedAt: string;
  stoppedAt: string;
  durationMs: number | null;
  nodesCount: number | null;
  lastNodeExecuted: string;
  // Node summary fields (JSON strings)
  nodesList: string;
  nodeTypesList: string;
  nodeTimesMs: string;
  nodeErrorsList: string;
  totalItemsOut: number;
}

/**
 * Group execution nodes by execution ID.
 */
function groupNodesByExecution(
  nodes: readonly ExecutionNode[]
): Map<string, ExecutionNode[]> {
  const map = new Map<string, ExecutionNode[]>();
  for (const node of nodes) {
    const key = `${node.instanceId}::${node.executionId}`;
    const existing = map.get(key) ?? [];
    existing.push(node);
    map.set(key, existing);
  }
  return map;
}

/**
 * Sort nodes by start time, handling nulls.
 */
function sortNodesByStartTime(nodes: ExecutionNode[]): ExecutionNode[] {
  return [...nodes].sort((a, b) => {
    // Nulls go last
    if (a.startTime === null && b.startTime === null) return 0;
    if (a.startTime === null) return 1;
    if (b.startTime === null) return -1;
    return a.startTime.getTime() - b.startTime.getTime();
  });
}

/**
 * Generate node summary for a single execution.
 */
function generateNodeSummary(nodes: ExecutionNode[]): {
  nodesList: string[];
  nodeTypesList: string[];
  nodeTimesMs: string[];
  nodeErrorsList: string[];
  totalItemsOut: number;
} {
  const sorted = sortNodesByStartTime(nodes);

  const nodesList: string[] = [];
  const nodeTypesList: string[] = [];
  const nodeTimesMs: string[] = [];
  const nodeErrorsList: string[] = [];
  let totalItemsOut = 0;

  for (const node of sorted) {
    // Include run index for multi-run nodes
    const nodeLabel =
      node.runsCount > 1
        ? `${node.nodeName}#${node.runIndex}`
        : node.nodeName;

    nodesList.push(nodeLabel);
    nodeTypesList.push(node.nodeType);
    nodeTimesMs.push(String(node.executionTimeMs));
    totalItemsOut += node.itemsOutCount;

    if (node.executionStatus === "error") {
      nodeErrorsList.push(node.nodeName);
    }
  }

  return {
    nodesList,
    nodeTypesList,
    nodeTimesMs,
    nodeErrorsList,
    totalItemsOut,
  };
}

/**
 * Create a bundle row for a single execution.
 */
function createBundleRow(
  execution: Execution,
  nodes: ExecutionNode[]
): ExecutionBundleRow {
  const summary = generateNodeSummary(nodes);

  return {
    instanceId: execution.instanceId,
    executionId: execution.executionId,
    workflowId: execution.workflowId,
    status: execution.status ?? "",
    mode: execution.mode ?? "",
    startedAt: formatDateForCsv(execution.startedAt),
    stoppedAt: formatDateForCsv(execution.stoppedAt),
    durationMs: execution.durationMs,
    nodesCount: execution.nodesCount,
    lastNodeExecuted: execution.lastNodeExecuted ?? "",
    nodesList: JSON.stringify(summary.nodesList),
    nodeTypesList: JSON.stringify(summary.nodeTypesList),
    nodeTimesMs: JSON.stringify(summary.nodeTimesMs),
    nodeErrorsList: JSON.stringify(summary.nodeErrorsList),
    totalItemsOut: summary.totalItemsOut,
  };
}

/**
 * Generate bundle rows for all executions with their associated nodes.
 */
export function generateExecutionBundle(
  executions: readonly Execution[],
  nodes: readonly ExecutionNode[]
): readonly ExecutionBundleRow[] {
  const nodesByExecution = groupNodesByExecution(nodes);
  const rows: ExecutionBundleRow[] = [];

  for (const execution of executions) {
    const key = `${execution.instanceId}::${execution.executionId}`;
    const executionNodes = nodesByExecution.get(key) ?? [];
    rows.push(createBundleRow(execution, executionNodes));
  }

  return rows;
}

/**
 * Get headers for the bundle CSV.
 */
export function getBundleHeaders(): readonly string[] {
  return [
    "instance_id",
    "execution_id",
    "workflow_id",
    "status",
    "mode",
    "started_at",
    "stopped_at",
    "duration_ms",
    "nodes_count",
    "last_node_executed",
    "nodes_list",
    "node_types_list",
    "node_times_ms",
    "node_errors_list",
    "total_items_out",
  ] as const;
}

/**
 * Convert bundle row to array for CSV generation.
 */
export function bundleRowToArray(row: ExecutionBundleRow): readonly unknown[] {
  return [
    row.instanceId,
    row.executionId,
    row.workflowId,
    row.status,
    row.mode,
    row.startedAt,
    row.stoppedAt,
    row.durationMs,
    row.nodesCount,
    row.lastNodeExecuted,
    row.nodesList,
    row.nodeTypesList,
    row.nodeTimesMs,
    row.nodeErrorsList,
    row.totalItemsOut,
  ];
}
