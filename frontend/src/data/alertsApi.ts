import { getDataConfig } from "@/data/config";

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

export type AlertSeverity = "info" | "warning" | "critical";
export type IncidentStatus = "open" | "acknowledged" | "resolved" | "suppressed";

export interface AlertIncident {
  id: string;
  rule_id: string;
  rule_name?: string;
  rule_type?: string;
  instance_id: string | null;
  workflow_id: string | null;
  workflow_name?: string | null;
  status: IncidentStatus;
  severity: AlertSeverity;
  title: string;
  summary: string | null;
  started_at: string;
  last_seen_at: string;
  resolved_at: string | null;
  acknowledged_at?: string | null;
}

export interface AlertRule {
  id: string;
  name: string;
  description: string | null;
  rule_type: string;
  severity: AlertSeverity;
  enabled: boolean;
  evaluation_interval_sec: number;
  cooldown_sec: number;
  open_after_n: number;
  resolve_after_n: number;
  apply_default_exclusions: boolean;
  retention_resolved_days?: number | null;
  retention_unresolved_days?: number | null;
  config: Record<string, unknown>;
  destinations_count?: number;
  selectors?: Array<{
    mode: "include" | "exclude";
    kind: "workflow_id" | "tag" | "instance_id" | "name_pattern";
    value: string;
  }>;
  destinations?: Array<{
    destination_id: string;
    notify_on_open: boolean;
    notify_on_resolve: boolean;
    notify_on_ack: boolean;
    min_severity: AlertSeverity;
  }>;
}

export interface AlertDestination {
  id: string;
  name: string;
  type: "webhook";
  enabled: boolean;
  webhookUrl: string;
  headers: Record<string, string>;
  timeoutMs: number;
  retryMaxAttempts: number;
  hasSecret: boolean;
  maskedSecret: string | null;
}

export interface AlertOverviewResponse {
  active: {
    active_count: number;
    info_count: number;
    warning_count: number;
    critical_count: number;
  };
  recentIncidents: AlertIncident[];
  deliveryHealth: {
    sent_count: number;
    pending_count: number;
    dead_count: number;
    retry_count: number;
  };
}

export interface AlertRuleInput {
  name: string;
  description?: string;
  ruleType: "workflow_inactivity" | "stuck_execution" | "metrics_freshness";
  severity: AlertSeverity;
  enabled: boolean;
  evaluationIntervalSec: number;
  cooldownSec: number;
  openAfterN: number;
  resolveAfterN: number;
  applyDefaultExclusions: boolean;
  retentionResolvedDays?: number | null;
  retentionUnresolvedDays?: number | null;
  config: Record<string, unknown>;
  selectors: Array<{ mode: "include" | "exclude"; kind: "workflow_id" | "tag" | "instance_id" | "name_pattern"; value: string }>;
  destinationIds: string[];
  destinationSettings?: Record<string, {
    notifyOnOpen?: boolean;
    notifyOnResolve?: boolean;
    notifyOnAck?: boolean;
    minSeverity?: AlertSeverity;
  }>;
}

export interface AlertDestinationInput {
  name: string;
  enabled: boolean;
  webhookUrl: string;
  secret?: string | null;
  headers?: Record<string, string>;
  timeoutMs?: number;
  retryMaxAttempts?: number;
}

export interface AlertWorkflowOption {
  instance_id: string;
  workflow_id: string;
  name: string;
  tags: string[] | string | null;
}

export interface AlertSelectorOptions {
  instances: string[];
  tags: string[];
  workflows: AlertWorkflowOption[];
}

export interface AlertRetentionSettings {
  resolvedDaysDefault: number;
  unresolvedDaysDefault: number;
  updatedAt?: string | null;
}

export function getAlertsOverview() {
  return fetchJson<AlertOverviewResponse>("/api/alerts/overview");
}

export function getAlertRetentionSettings() {
  return fetchJson<AlertRetentionSettings>("/api/alerts/retention-settings");
}

export function updateAlertRetentionSettings(input: { resolvedDaysDefault: number; unresolvedDaysDefault: number }) {
  return fetchJson<AlertRetentionSettings>("/api/alerts/retention-settings", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function listAlertWorkflowOptions(limit = 5000) {
  return fetchJson<AlertWorkflowOption[]>(`/api/workflows?limit=${encodeURIComponent(String(limit))}`);
}

export function listAlertSelectorOptions(limit = 5000) {
  return fetchJson<AlertSelectorOptions>(`/api/alerts/selector-options?limit=${encodeURIComponent(String(limit))}`);
}

export function listIncidents(params?: { status?: string; severity?: string; limit?: number }) {
  const query = new URLSearchParams();
  if (params?.status) query.set("status", params.status);
  if (params?.severity) query.set("severity", params.severity);
  if (params?.limit) query.set("limit", String(params.limit));
  return fetchJson<AlertIncident[]>(`/api/alerts/incidents${query.toString() ? `?${query.toString()}` : ""}`);
}

export function getIncidentEvents(incidentId: string) {
  return fetchJson<Array<{
    id: number;
    incident_id: string;
    event_type: string;
    actor_user_id: string | null;
    actor_email: string | null;
    note: string | null;
    event_data: Record<string, unknown>;
    created_at: string;
  }>>(`/api/alerts/incidents/${encodeURIComponent(incidentId)}/events`);
}

export function acknowledgeIncident(incidentId: string, note?: string) {
  return fetchJson<AlertIncident>(`/api/alerts/incidents/${encodeURIComponent(incidentId)}/ack`, {
    method: "POST",
    body: JSON.stringify({ note: note || null }),
  });
}

export function suppressIncident(incidentId: string, minutes: number, note?: string) {
  return fetchJson<AlertIncident>(`/api/alerts/incidents/${encodeURIComponent(incidentId)}/suppress`, {
    method: "POST",
    body: JSON.stringify({ minutes, note: note || null }),
  });
}

export function resolveIncident(incidentId: string, note?: string) {
  return fetchJson<AlertIncident>(`/api/alerts/incidents/${encodeURIComponent(incidentId)}/resolve`, {
    method: "POST",
    body: JSON.stringify({ note: note || null }),
  });
}

export function listRules() {
  return fetchJson<AlertRule[]>("/api/alerts/rules");
}

export function createRule(input: AlertRuleInput) {
  return fetchJson<AlertRule>("/api/alerts/rules", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateRule(ruleId: string, input: AlertRuleInput) {
  return fetchJson<AlertRule>(`/api/alerts/rules/${encodeURIComponent(ruleId)}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function deleteRule(ruleId: string) {
  return fetchJson<{ ok: boolean }>(`/api/alerts/rules/${encodeURIComponent(ruleId)}`, {
    method: "DELETE",
  });
}

export function toggleRule(ruleId: string, enabled: boolean) {
  return fetchJson<AlertRule>(`/api/alerts/rules/${encodeURIComponent(ruleId)}/toggle`, {
    method: "POST",
    body: JSON.stringify({ enabled }),
  });
}

export function previewRuleTargets(ruleId: string) {
  return fetchJson<{ count: number; targets: Array<{ target_fingerprint: string; instance_id: string | null; workflow_id: string | null; label: string }> }>(
    `/api/alerts/rules/${encodeURIComponent(ruleId)}/preview-targets`
  );
}

export function previewRuleTargetsFromInput(input: AlertRuleInput, ruleId?: string) {
  return fetchJson<{ count: number; targets: Array<{ target_fingerprint: string; instance_id: string | null; workflow_id: string | null; label: string }> }>(
    "/api/alerts/rules/preview-targets",
    {
      method: "POST",
      body: JSON.stringify({ ...input, ruleId: ruleId || null }),
    },
  );
}

export function runRuleNow(ruleId: string) {
  return fetchJson<{ ok: boolean; ruleId: string }>(`/api/alerts/rules/${encodeURIComponent(ruleId)}/run-now`, {
    method: "POST",
  });
}

export function listDestinations() {
  return fetchJson<AlertDestination[]>("/api/alerts/destinations");
}

export function createDestination(input: AlertDestinationInput) {
  return fetchJson<AlertDestination>("/api/alerts/destinations", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateDestination(destinationId: string, input: AlertDestinationInput) {
  return fetchJson<AlertDestination>(`/api/alerts/destinations/${encodeURIComponent(destinationId)}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function deleteDestination(destinationId: string) {
  return fetchJson<{ ok: boolean }>(`/api/alerts/destinations/${encodeURIComponent(destinationId)}`, {
    method: "DELETE",
  });
}

export function testDestination(destinationId: string, payload?: Record<string, unknown>) {
  return fetchJson<{
    ok: boolean;
    status: number | null;
    body: string;
    error?: string;
    latencyMs: number;
  }>(`/api/alerts/destinations/${encodeURIComponent(destinationId)}/test`, {
    method: "POST",
    body: JSON.stringify({ payload: payload || null }),
  });
}

export function listDeliveryLog(params?: { status?: string; limit?: number }) {
  const query = new URLSearchParams();
  if (params?.status) query.set("status", params.status);
  if (params?.limit) query.set("limit", String(params.limit));
  return fetchJson<Array<{
    id: string;
    incident_id: string;
    rule_id: string;
    destination_id: string;
    destination_name: string | null;
    event_type: string;
    status: string;
    attempt_count: number;
    max_attempts: number;
    next_attempt_at: string;
    last_error: string | null;
    last_response_status: number | null;
    created_at: string;
    updated_at: string;
    incident_title: string;
    severity: AlertSeverity;
    instance_id: string | null;
    workflow_id: string | null;
  }>>(`/api/alerts/delivery-log${query.toString() ? `?${query.toString()}` : ""}`);
}

export function getDeliveryAttempts(outboxId: string) {
  return fetchJson<Array<{
    id: number;
    outbox_id: string;
    attempt_no: number;
    attempted_at: string;
    success: boolean;
    response_status: number | null;
    error: string | null;
    latency_ms: number | null;
  }>>(`/api/alerts/tools/attempts/${encodeURIComponent(outboxId)}`);
}

export function getAlertsEngineStatus() {
  return fetchJson<{
    enabled: boolean;
    started: boolean;
    workerId: string | null;
    evaluator: { running: boolean; pollMs: number; lastRunAt: string | null; errors: number };
    delivery: { running: boolean; pollMs: number; lastRunAt: string | null; errors: number };
    maintenance: { running: boolean; pollMs: number; lastRunAt: string | null; errors: number };
  }>("/api/alerts/tools/engine-status");
}
