/**
 * Metrics API client for n8n instance health monitoring
 */
import { getDataConfig } from "./config";

const baseUrl = getDataConfig().apiBaseUrl;

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
      credentials: "include",
    });
  } catch {
    throw new Error("Unable to reach the server. Please try again.");
  }

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    if (txt.includes("<html") || txt.includes("<!DOCTYPE")) {
      throw new Error("Server is starting up. Please wait a moment and try again.");
    }
    try {
      const parsed = JSON.parse(txt);
      throw new Error(parsed.error || `${res.status} ${res.statusText}`);
    } catch (e) {
      if (e instanceof Error && e.message !== txt) throw e;
      throw new Error(txt || `${res.status} ${res.statusText}`);
    }
  }
  return res.json();
}

// Types
export interface MetricsConfig {
  enabled: boolean;
  hasVersionPermission: boolean;
  hasFullPermission: boolean;
  hasManagePermission: boolean;
  /** 
   * canCustomizeDashboard: granted to ALL authenticated users.
   * Allows personal UI customization (widget toggles) without granting admin-level permissions.
   * This is separate from hasManagePermission which is for global/admin configuration.
   */
  canCustomizeDashboard: boolean;
  maxTimeRangeDays: number;
  maxDatapoints: number;
}

export interface MetricsSnapshot {
  id: number;
  ts: string;
  instance_id: string;
  n8n_version: string | null;
  node_version: string | null;
  process_start_time_seconds?: number | null;
  is_leader?: boolean | null;
  active_workflows?: number | null;
  cpu_total_seconds?: number | null;
  memory_rss_bytes?: number | null;
  heap_used_bytes?: number | null;
  external_memory_bytes?: number | null;
  eventloop_lag_p99_s?: number | null;
  open_fds?: number | null;
}

export interface MetricsLatestResponse {
  enabled: boolean;
  data: MetricsSnapshot | null;
  permissionLevel?: "full" | "version";
}

export interface MetricsTimeseriesDatapoint {
  ts: string;
  cpuRate: number | null;
  memoryRssBytes: number | null;
  heapUsedBytes: number | null;
  externalMemoryBytes: number | null;
  eventloopLagP99S: number | null;
  openFds: number | null;
  activeWorkflows: number | null;
}

export interface MetricsTimeseriesResponse {
  enabled: boolean;
  instanceId?: string;
  from?: string;
  to?: string;
  datapoints?: number;
  data?: MetricsTimeseriesDatapoint[];
}

export interface MetricsInstancesResponse {
  enabled: boolean;
  instances: string[];
}

export interface WorkflowStatus {
  workflowId: string;
  name: string;
  active: boolean;
}

export interface WorkflowsStatusResponse {
  instanceId: string;
  total: number;
  active: number;
  inactive: number;
  workflows: WorkflowStatus[];
}

// API Functions

export function getMetricsConfig(): Promise<MetricsConfig> {
  return fetchJson<MetricsConfig>("/api/metrics/config");
}

export function getMetricsInstances(): Promise<MetricsInstancesResponse> {
  return fetchJson<MetricsInstancesResponse>("/api/metrics/instances");
}

export function getMetricsLatest(instanceId: string): Promise<MetricsLatestResponse> {
  return fetchJson<MetricsLatestResponse>(`/api/metrics/latest?instance_id=${encodeURIComponent(instanceId)}`);
}

export function getMetricsTimeseries(
  instanceId: string,
  from?: string,
  to?: string
): Promise<MetricsTimeseriesResponse> {
  const params = new URLSearchParams({ instance_id: instanceId });
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  return fetchJson<MetricsTimeseriesResponse>(`/api/metrics/timeseries?${params.toString()}`);
}

export function getWorkflowsStatus(instanceId: string): Promise<WorkflowsStatusResponse> {
  return fetchJson<WorkflowsStatusResponse>(`/api/workflows/status?instance_id=${encodeURIComponent(instanceId)}`);
}
