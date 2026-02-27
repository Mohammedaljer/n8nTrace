import type { DataSource } from "./DataSource";
import type {
  Execution,
  ExecutionNode,
  Workflow,
  ExecutionFilters,
  WorkflowSummary,
  DashboardKpis,
  DataLoadResult,
  ExecutionStatus,
  NodeStatus,
} from "@/types/execution";
import {
  filterExecutions,
  computeWorkflowSummaries,
  computeDashboardKpis,
} from "./selectors/executionSelectors";
import { getDataConfig } from "./config";

/** Error thrown when API requests fail */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly endpoint?: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Raw API response types (snake_case from backend) */
interface ApiExecution {
  instance_id: string;
  execution_id: string;
  workflow_id: string;
  status: string | null;
  finished: boolean | null;
  mode: string | null;
  started_at: string | null;
  stopped_at: string | null;
  duration_ms: number | null;
  wait_till: string | null;
  retry_of: string | null;
  retry_success_id: string | null;
  last_node_executed: string | null;
  node_names_executed: string[];
  nodes_count: number | null;
  inserted_at: string | null;
}

interface ApiExecutionNode {
  instance_id: string;
  execution_id: string;
  workflow_id: string;
  node_name: string;
  node_type: string;
  run_index: number;
  runs_count: number;
  is_last_run: boolean;
  execution_status: string;
  execution_time_ms: number;
  start_time_ms: number | null;
  start_time: string | null;
  items_out_count: number;
  items_out_total_all_runs: number;
  inserted_at: string | null;
}

interface ApiWorkflow {
  instance_id: string;
  workflow_id: string;
  name: string;
  active: boolean;
  is_archived: boolean;
  created_at: string | null;
  updated_at: string | null;
  tags: string[];
  nodes_count: number;
  node_types_distinct: string[];
  node_names_distinct: string[];
  inserted_at: string | null;
}

// ===== Transformers =====
function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function parseExecutionStatus(value: string | null): ExecutionStatus | null {
  if (!value) return null;
  const lower = value.toLowerCase();
  if (["success", "error", "running", "waiting", "crashed"].includes(lower)) {
    return lower as ExecutionStatus;
  }
  return "unknown";
}

function parseNodeStatus(value: string | null): NodeStatus {
  if (!value) return "unknown";
  const lower = value.toLowerCase();
  if (["success", "error", "running"].includes(lower)) {
    return lower as NodeStatus;
  }
  return "unknown";
}

function transformExecution(api: ApiExecution): Execution {
  return {
    instanceId: api.instance_id ?? "",
    executionId: api.execution_id,
    workflowId: api.workflow_id,
    status: parseExecutionStatus(api.status),
    finished: api.finished,
    mode: api.mode,
    startedAt: parseDate(api.started_at),
    stoppedAt: parseDate(api.stopped_at),
    durationMs: api.duration_ms == null ? null : Number(api.duration_ms),
    waitTill: parseDate(api.wait_till),
    retryOf: api.retry_of,
    retrySuccessId: api.retry_success_id,
    lastNodeExecuted: api.last_node_executed,
    nodeNamesExecuted: api.node_names_executed ?? [],
    nodesCount: api.nodes_count == null ? null : Number(api.nodes_count),
    insertedAt: parseDate(api.inserted_at),
  };
}

function transformExecutionNode(api: ApiExecutionNode): ExecutionNode {
  return {
    instanceId: api.instance_id ?? "",
    executionId: api.execution_id,
    workflowId: api.workflow_id,
    nodeName: api.node_name,
    nodeType: api.node_type,
    runIndex: Number(api.run_index ?? 0),
    runsCount: Number(api.runs_count ?? 1),
    isLastRun: api.is_last_run ?? true,
    executionStatus: parseNodeStatus(api.execution_status),
    executionTimeMs: Number(api.execution_time_ms ?? 0),
    startTimeMs: api.start_time_ms == null ? null : Number(api.start_time_ms),
    startTime: parseDate(api.start_time),
    itemsOutCount: Number(api.items_out_count ?? 0),
    itemsOutTotalAllRuns: Number(api.items_out_total_all_runs ?? 0),
    insertedAt: parseDate(api.inserted_at),
  };
}

function transformWorkflow(api: ApiWorkflow): Workflow {
  return {
    instanceId: api.instance_id ?? "",
    workflowId: api.workflow_id,
    name: api.name ?? "Unnamed Workflow",
    active: api.active ?? false,
    isArchived: api.is_archived ?? false,
    createdAt: parseDate(api.created_at),
    updatedAt: parseDate(api.updated_at),
    tags: api.tags ?? [],
    nodesCount: api.nodes_count ?? 0,
    nodeTypesDistinct: api.node_types_distinct ?? [],
    nodeNamesDistinct: api.node_names_distinct ?? [],
    insertedAt: parseDate(api.inserted_at),
  };
}

/**
 * API-based data source for PostgreSQL backend.
 * Implements the same interface as CsvDataSource.
 */
export class ApiDataSource implements DataSource {
  private readonly baseUrl: string;
  private cachedData: DataLoadResult | null = null;
  private loadPromise: Promise<DataLoadResult> | null = null;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl ?? getDataConfig().apiBaseUrl;
  }

  private async fetchJson<T>(endpoint: string): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    
    let response: Response;
    try {
        response = await fetch(url, {
          headers: {
            "Accept": "application/json",
          },
          credentials: "include",
        });

    } catch (err) {
      throw new ApiError(
        `Network error: Unable to connect to API at ${this.baseUrl}. Check if the server is running.`,
        undefined,
        endpoint
      );
    }

    if (!response.ok) {
      throw new ApiError(
        `API request failed: ${response.status} ${response.statusText}`,
        response.status,
        endpoint
      );
    }

    try {
      return await response.json();
    } catch {
      throw new ApiError(
        `Invalid JSON response from ${endpoint}`,
        response.status,
        endpoint
      );
    }
  }

  async loadAll(): Promise<DataLoadResult> {
    if (this.cachedData) return this.cachedData;
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = this.doLoad();
    this.cachedData = await this.loadPromise;
    this.loadPromise = null;
    return this.cachedData;
  }

  private async doLoad(): Promise<DataLoadResult> {
    const warnings: string[] = [];

    // Fetch all data in parallel
    const [rawExecutions, rawNodes, rawWorkflows] = await Promise.all([
      this.fetchJson<ApiExecution[]>("/api/executions").catch((err) => {
        warnings.push(`Failed to load executions: ${err.message}`);
        return [] as ApiExecution[];
      }),
      this.fetchJson<ApiExecutionNode[]>("/api/execution-nodes").catch((err) => {
        warnings.push(`Failed to load execution nodes: ${err.message}`);
        return [] as ApiExecutionNode[];
      }),
      this.fetchJson<ApiWorkflow[]>("/api/workflows").catch((err) => {
        // Workflows are optional
        console.warn("Failed to load workflows:", err);
        return [] as ApiWorkflow[];
      }),
    ]);

    // Transform to domain models
    const executions = rawExecutions.map(transformExecution);
    const nodeRuns = rawNodes.map(transformExecutionNode);
    const workflows = rawWorkflows.map(transformWorkflow);

    console.log(
      `API data loaded: ${executions.length} executions, ${nodeRuns.length} node runs, ${workflows.length} workflows`
    );

    return {
      executions,
      nodeRuns,
      workflows,
      warnings,
      skippedExecutions: 0,
      skippedNodes: 0,
    };
  }

  async getExecutions(filters?: ExecutionFilters): Promise<readonly Execution[]> {
    const data = await this.loadAll();
    return filterExecutions(data.executions, data.workflows, data.nodeRuns, filters);
  }

  async getExecutionById(id: string): Promise<Execution | null> {
    const data = await this.loadAll();
    return data.executions.find((e) => e.executionId === id) ?? null;
  }

  async getExecutionNodes(executionId: string): Promise<readonly ExecutionNode[]> {
    const data = await this.loadAll();
    return data.nodeRuns.filter((n) => n.executionId === executionId);
  }

  async getWorkflows(): Promise<readonly Workflow[]> {
    const data = await this.loadAll();
    return data.workflows;
  }

  async getWorkflowSummaries(): Promise<readonly WorkflowSummary[]> {
    const data = await this.loadAll();
    return computeWorkflowSummaries(data.executions, data.workflows);
  }

  async getDashboardKpis(filters?: ExecutionFilters): Promise<DashboardKpis> {
    const data = await this.loadAll();
    const filtered = filterExecutions(data.executions, data.workflows, data.nodeRuns, filters);
    return computeDashboardKpis(filtered);
  }
}
