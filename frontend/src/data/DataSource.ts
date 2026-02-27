import type {
  Execution,
  ExecutionNode,
  Workflow,
  ExecutionFilters,
  WorkflowSummary,
  DashboardKpis,
  DataLoadResult,
} from "@/types/execution";

export interface DataSource {
  loadAll(): Promise<DataLoadResult>;
  getExecutions(filters?: ExecutionFilters): Promise<readonly Execution[]>;
  getExecutionById(id: string): Promise<Execution | null>;
  getExecutionNodes(executionId: string): Promise<readonly ExecutionNode[]>;
  getWorkflows(): Promise<readonly Workflow[]>;
  getWorkflowSummaries(): Promise<readonly WorkflowSummary[]>;
  getDashboardKpis(filters?: ExecutionFilters): Promise<DashboardKpis>;
}
