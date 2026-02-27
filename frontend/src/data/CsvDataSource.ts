import type { DataSource } from "./DataSource";
import type {
  Execution,
  ExecutionNode,
  Workflow,
  ExecutionFilters,
  WorkflowSummary,
  DashboardKpis,
  DataLoadResult,
} from "@/types/execution";
import {
  fetchAndParseCsv,
  parseExecutionRow,
  parseExecutionNodeRow,
  parseWorkflowRow,
} from "./csvParser";
import {
  filterExecutions,
  computeWorkflowSummaries,
  computeDashboardKpis,
} from "./selectors/executionSelectors";

const EXECUTIONS_PATH = "/data/executions.csv";
const NODES_PATH = "/data/execution_nodes.csv";
const WORKFLOWS_PATH = "/data/workflows_index.csv";

/**
 * Phase 1 data source: reads CSV files from public/data/.
 * Caches data after first load.
 */
export class CsvDataSource implements DataSource {
  private cachedData: DataLoadResult | null = null;
  private loadPromise: Promise<DataLoadResult> | null = null;

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
    let skippedExecutions = 0;
    let skippedNodes = 0;
    let skippedWorkflows = 0;

    // Load executions
    let executions: Execution[] = [];
    try {
      const rawExecutions = await fetchAndParseCsv<Record<string, unknown>>(EXECUTIONS_PATH);
      
      // Validate headers
      if (rawExecutions.length > 0) {
        const firstRow = rawExecutions[0];
        const requiredHeaders = ["execution_id", "workflow_id"];
        const missingHeaders = requiredHeaders.filter((h) => !(h in firstRow));
        if (missingHeaders.length > 0) {
          warnings.push(`executions.csv: missing required headers: ${missingHeaders.join(", ")}`);
        }
      }
      
      for (let i = 0; i < rawExecutions.length; i++) {
        try {
          const { execution, warning } = parseExecutionRow(rawExecutions[i], i);
          if (execution) {
            executions.push(execution);
          } else {
            skippedExecutions++;
            if (warning) {
              console.warn(warning);
              // Only add first 10 warnings to avoid flooding
              if (warnings.length < 20) warnings.push(warning);
            }
          }
        } catch (rowErr) {
          skippedExecutions++;
          console.warn(`Row ${i + 1} parse error:`, rowErr);
        }
      }
    } catch (err) {
      console.warn("Failed to load executions.csv:", err);
      warnings.push(`Failed to load executions.csv: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Load execution nodes
    let nodeRuns: ExecutionNode[] = [];
    try {
      const rawNodes = await fetchAndParseCsv<Record<string, unknown>>(NODES_PATH);
      
      // Validate headers
      if (rawNodes.length > 0) {
        const firstRow = rawNodes[0];
        const requiredHeaders = ["execution_id", "node_name"];
        const missingHeaders = requiredHeaders.filter((h) => !(h in firstRow));
        if (missingHeaders.length > 0) {
          warnings.push(`execution_nodes.csv: missing required headers: ${missingHeaders.join(", ")}`);
        }
      }
      
      for (let i = 0; i < rawNodes.length; i++) {
        try {
          const { node, warning } = parseExecutionNodeRow(rawNodes[i], i);
          if (node) {
            nodeRuns.push(node);
          } else {
            skippedNodes++;
            if (warning) {
              console.warn(warning);
              if (warnings.length < 20) warnings.push(warning);
            }
          }
        } catch (rowErr) {
          skippedNodes++;
          console.warn(`Node row ${i + 1} parse error:`, rowErr);
        }
      }
    } catch (err) {
      console.warn("Failed to load execution_nodes.csv:", err);
      warnings.push(`Failed to load execution_nodes.csv: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Load workflows
    let workflows: Workflow[] = [];
    try {
      const rawWorkflows = await fetchAndParseCsv<Record<string, unknown>>(WORKFLOWS_PATH);
      for (let i = 0; i < rawWorkflows.length; i++) {
        try {
          const { workflow, warning } = parseWorkflowRow(rawWorkflows[i], i);
          if (workflow) {
            workflows.push(workflow);
          } else {
            skippedWorkflows++;
            if (warning) console.warn(warning);
          }
        } catch (rowErr) {
          skippedWorkflows++;
          console.warn(`Workflow row ${i + 1} parse error:`, rowErr);
        }
      }
    } catch (err) {
      console.warn("Failed to load workflows_index.csv:", err);
      // Not critical - workflows are optional
    }

    // Log summary
    const totalSkipped = skippedExecutions + skippedNodes + skippedWorkflows;
    if (totalSkipped > 0) {
      console.warn(
        `CSV parsing: skipped ${skippedExecutions} executions, ${skippedNodes} node runs, ${skippedWorkflows} workflows`
      );
    }
    console.log(
      `Data loaded: ${executions.length} executions, ${nodeRuns.length} node runs, ${workflows.length} workflows`
    );

    return {
      executions,
      nodeRuns,
      workflows,
      warnings,
      skippedExecutions,
      skippedNodes,
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
