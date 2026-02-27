import Papa from "papaparse";
import type {
  Execution,
  ExecutionNode,
  Workflow,
  ExecutionStatus,
  NodeStatus,
} from "@/types/execution";

// CSV row types are no longer needed - we use dynamic Record<string, unknown> parsing

// ===== Parsing helpers =====
function parseDate(value: string | null | undefined): Date | null {
  if (!value || value.trim() === "") return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function parseNumber(value: string | null | undefined): number | null {
  if (!value || value.trim() === "") return null;
  const n = Number(value);
  return isNaN(n) ? null : n;
}

function parseBool(value: string | null | undefined): boolean | null {
  if (!value || value.trim() === "") return null;
  const lower = value.toLowerCase();
  if (lower === "true" || lower === "1") return true;
  if (lower === "false" || lower === "0") return false;
  return null;
}

function parseExecutionStatus(value: string | null | undefined): ExecutionStatus | null {
  if (!value || value.trim() === "") return null;
  const lower = value.toLowerCase();
  if (["success", "error", "running", "waiting", "crashed"].includes(lower)) {
    return lower as ExecutionStatus;
  }
  return "unknown";
}

function parseNodeStatus(value: string | null | undefined): NodeStatus {
  if (!value || value.trim() === "") return "unknown";
  const lower = value.toLowerCase();
  if (["success", "error", "running"].includes(lower)) {
    return lower as NodeStatus;
  }
  return "unknown";
}

function parsePostgresArray(value: string | null | undefined): string[] {
  if (!value || value.trim() === "" || value === "{}") return [];
  // PostgreSQL array format: {item1,item2,"item with spaces"}
  const inner = value.replace(/^\{|\}$/g, "");
  if (!inner) return [];
  
  const items: string[] = [];
  let current = "";
  let inQuotes = false;
  
  for (let i = 0; i < inner.length; i++) {
    const char = inner[i];
    if (char === '"' && (i === 0 || inner[i - 1] !== "\\")) {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      items.push(current.replace(/^"|"$/g, "").trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (current) {
    items.push(current.replace(/^"|"$/g, "").trim());
  }
  return items.filter(Boolean);
}

// ===== Row validation helpers =====
function isEmptyRow(row: Record<string, unknown>): boolean {
  if (!row || typeof row !== "object") return true;
  const values = Object.values(row);
  return values.length === 0 || values.every((v) => v === undefined || v === null || String(v).trim() === "");
}

// ===== Row transformers =====
export function parseExecutionRow(
  row: unknown,
  index: number
): { execution: Execution | null; warning: string | null } {
  // Defensive: handle null/undefined row
  if (!row || typeof row !== "object") {
    return { execution: null, warning: `Row ${index + 1}: invalid or empty row` };
  }
  
  const r = row as Record<string, string | undefined>;
  
  // Skip completely empty rows
  if (isEmptyRow(r)) {
    return { execution: null, warning: `Row ${index + 1}: empty row skipped` };
  }
  
  const executionId = r.execution_id?.trim?.() ?? "";
  const workflowId = r.workflow_id?.trim?.() ?? "";
  
  if (!executionId) {
    return { execution: null, warning: `Row ${index + 1}: missing execution_id` };
  }
  if (!workflowId) {
    return { execution: null, warning: `Row ${index + 1}: missing workflow_id` };
  }
  
  return {
    execution: {
      instanceId: r.instance_id?.trim?.() ?? "",
      executionId,
      workflowId,
      status: parseExecutionStatus(r.status),
      finished: parseBool(r.finished),
      mode: r.mode?.trim?.() || null,
      startedAt: parseDate(r.started_at),
      stoppedAt: parseDate(r.stopped_at),
      durationMs: parseNumber(r.duration_ms),
      waitTill: parseDate(r.wait_till),
      retryOf: r.retry_of?.trim?.() || null,
      retrySuccessId: r.retry_success_id?.trim?.() || null,
      lastNodeExecuted: r.last_node_executed?.trim?.() || null,
      nodeNamesExecuted: parsePostgresArray(r.node_names_executed),
      nodesCount: parseNumber(r.nodes_count),
      insertedAt: parseDate(r.inserted_at),
    },
    warning: null,
  };
}

export function parseExecutionNodeRow(
  row: unknown,
  index: number
): { node: ExecutionNode | null; warning: string | null } {
  // Defensive: handle null/undefined row
  if (!row || typeof row !== "object") {
    return { node: null, warning: `Node row ${index + 1}: invalid or empty row` };
  }
  
  const r = row as Record<string, string | undefined>;
  
  // Skip completely empty rows
  if (isEmptyRow(r)) {
    return { node: null, warning: `Node row ${index + 1}: empty row skipped` };
  }
  
  const executionId = r.execution_id?.trim?.() ?? "";
  const nodeName = r.node_name?.trim?.() ?? "";
  
  if (!executionId) {
    return { node: null, warning: `Node row ${index + 1}: missing execution_id` };
  }
  if (!nodeName) {
    return { node: null, warning: `Node row ${index + 1}: missing node_name` };
  }
  
  return {
    node: {
      instanceId: r.instance_id?.trim?.() ?? "",
      executionId,
      workflowId: r.workflow_id?.trim?.() ?? "",
      nodeName,
      nodeType: r.node_type?.trim?.() ?? "",
      runIndex: parseNumber(r.run_index) ?? 0,
      runsCount: parseNumber(r.runs_count) ?? 1,
      isLastRun: parseBool(r.is_last_run) ?? true,
      executionStatus: parseNodeStatus(r.execution_status),
      executionTimeMs: parseNumber(r.execution_time_ms) ?? 0,
      startTimeMs: parseNumber(r.start_time_ms),
      startTime: parseDate(r.start_time),
      itemsOutCount: parseNumber(r.items_out_count) ?? 0,
      itemsOutTotalAllRuns: parseNumber(r.items_out_total_all_runs) ?? 0,
      insertedAt: parseDate(r.inserted_at),
    },
    warning: null,
  };
}

export function parseWorkflowRow(
  row: unknown,
  index: number
): { workflow: Workflow | null; warning: string | null } {
  // Defensive: handle null/undefined row
  if (!row || typeof row !== "object") {
    return { workflow: null, warning: `Workflow row ${index + 1}: invalid or empty row` };
  }
  
  const r = row as Record<string, string | undefined>;
  
  // Skip completely empty rows
  if (isEmptyRow(r)) {
    return { workflow: null, warning: `Workflow row ${index + 1}: empty row skipped` };
  }
  
  const workflowId = r.workflow_id?.trim?.() ?? "";
  
  if (!workflowId) {
    return { workflow: null, warning: `Workflow row ${index + 1}: missing workflow_id` };
  }
  
  return {
    workflow: {
      instanceId: r.instance_id?.trim?.() ?? "",
      workflowId,
      name: r.name?.trim?.() ?? "Unnamed Workflow",
      active: parseBool(r.active) ?? false,
      isArchived: parseBool(r.is_archived) ?? false,
      createdAt: parseDate(r.created_at),
      updatedAt: parseDate(r.updated_at),
      tags: parsePostgresArray(r.tags),
      nodesCount: parseNumber(r.nodes_count) ?? 0,
      nodeTypesDistinct: parsePostgresArray(r.node_types_distinct),
      nodeNamesDistinct: parsePostgresArray(r.node_names_distinct),
      insertedAt: parseDate(r.inserted_at),
    },
    warning: null,
  };
}

// ===== CSV fetcher =====
export async function fetchAndParseCsv<T>(path: string): Promise<T[]> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${path}: ${response.status}`);
  }
  const text = await response.text();
  
  return new Promise((resolve, reject) => {
    Papa.parse<T>(text, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => resolve(results.data),
      error: (error: Error) => reject(error),
    });
  });
}
