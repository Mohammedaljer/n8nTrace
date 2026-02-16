/** Strongly typed models matching CSV schema (snake_case columns) */

// ===== Execution =====
export interface Execution {
  readonly instanceId: string;
  readonly executionId: string;
  readonly workflowId: string;
  readonly status: ExecutionStatus | null;
  readonly finished: boolean | null;
  readonly mode: string | null;
  readonly startedAt: Date | null;
  readonly stoppedAt: Date | null;
  readonly durationMs: number | null;
  readonly waitTill: Date | null;
  readonly retryOf: string | null;
  readonly retrySuccessId: string | null;
  readonly lastNodeExecuted: string | null;
  readonly nodeNamesExecuted: string[];
  readonly nodesCount: number | null;
  readonly insertedAt: Date | null;
}

export type ExecutionStatus = "success" | "error" | "running" | "waiting" | "crashed" | "unknown";

// ===== Execution Node =====
export interface ExecutionNode {
  readonly instanceId: string;
  readonly executionId: string;
  readonly workflowId: string;
  readonly nodeName: string;
  readonly nodeType: string;
  readonly runIndex: number;
  readonly runsCount: number;
  readonly isLastRun: boolean;
  readonly executionStatus: NodeStatus;
  readonly executionTimeMs: number;
  readonly startTimeMs: number | null;
  readonly startTime: Date | null;
  readonly itemsOutCount: number;
  readonly itemsOutTotalAllRuns: number;
  readonly insertedAt: Date | null;
}

export type NodeStatus = "success" | "error" | "running" | "unknown";

// ===== Workflow (from workflows_index.csv) =====
export interface Workflow {
  readonly instanceId: string;
  readonly workflowId: string;
  readonly name: string;
  readonly active: boolean;
  readonly isArchived: boolean;
  readonly createdAt: Date | null;
  readonly updatedAt: Date | null;
  readonly tags: string[];
  readonly nodesCount: number;
  readonly nodeTypesDistinct: string[];
  readonly nodeNamesDistinct: string[];
  readonly insertedAt: Date | null;
}

// ===== Filters =====
export interface ExecutionFilters {
  // Primary filters (always visible)
  readonly instanceId?: string; // n8n instance (e.g., "prod", "staging")
  readonly dateFrom?: string; // ISO date or datetime
  readonly dateTo?: string; // ISO date or datetime
  readonly status?: ExecutionStatus;
  readonly workflowId?: string;
  readonly search?: string; // matches executionId, workflowId, lastNodeExecuted, nodeName, nodeType

  // Advanced filters (collapsible)
  readonly mode?: string; // manual/trigger
  readonly finished?: boolean;
  readonly durationMsMin?: number;
  readonly durationMsMax?: number;
  readonly nodeNameContains?: string;
  readonly nodeTypeContains?: string;
  readonly itemsOutMin?: number;
  readonly itemsOutMax?: number;
  readonly executionTimeMsMin?: number;
  readonly executionTimeMsMax?: number;
}

export type FilterKey = keyof ExecutionFilters;

// Date range preset identifiers
export type DatePreset = "today" | "yesterday" | "last7days" | "last30days" | "custom";

// ===== Aggregated types =====
export interface WorkflowSummary {
  readonly workflowId: string;
  readonly workflowName: string;
  readonly totalExecutions: number;
  readonly successCount: number;
  readonly errorCount: number;
  readonly avgDurationMs: number;
  readonly lastExecutedAt: Date | null;
}

export interface DashboardKpis {
  readonly totalExecutions: number;
  readonly successRate: number;
  readonly errorCount: number;
  readonly avgDurationMs: number;
  readonly activeWorkflows: number;
}

// ===== Data load result =====
export interface DataLoadResult {
  readonly executions: readonly Execution[];
  readonly nodeRuns: readonly ExecutionNode[];
  readonly workflows: readonly Workflow[];
  readonly warnings: readonly string[];
  readonly skippedExecutions: number;
  readonly skippedNodes: number;
}
