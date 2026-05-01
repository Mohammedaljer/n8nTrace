import { useEffect, useMemo, useState } from "react";
import { PageShell } from "@/components/PageShell";
import { ErrorState } from "@/components/state";
import { EmptyState } from "@/components/EmptyState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { useAuth, hasPerm } from "@/security/AuthContext";
import {
  acknowledgeIncident,
  createDestination,
  createRule,
  deleteDestination,
  deleteRule,
  getAlertRetentionSettings,
  getAlertsEngineStatus,
  getAlertsOverview,
  getDeliveryAttempts,
  getIncidentEvents,
  listDeliveryLog,
  listDestinations,
  listIncidents,
  listAlertSelectorOptions,
  listRules,
  previewRuleTargetsFromInput,
  resolveIncident,
  runRuleNow,
  suppressIncident,
  testDestination,
  toggleRule,
  updateAlertRetentionSettings,
  updateDestination,
  updateRule,
  type AlertDestination,
  type AlertDestinationInput,
  type AlertIncident,
  type AlertOverviewResponse,
  type AlertRetentionSettings,
  type AlertRule,
  type AlertRuleInput,
} from "@/data/alertsApi";
import { toast } from "@/hooks/use-toast";
import { Activity, Bell, BellRing, CircleHelp, History, Link as LinkIcon, RefreshCw, ShieldCheck, Siren, Wrench, X } from "lucide-react";

const RULE_TYPES = [
  { value: "workflow_inactivity", label: "Workflow inactivity" },
  { value: "stuck_execution", label: "Long-running / stuck execution" },
  { value: "metrics_freshness", label: "Metrics freshness" },
] as const;

const SEVERITIES = ["info", "warning", "critical"] as const;
const INCIDENT_STATUSES = ["all", "open", "acknowledged", "suppressed", "resolved"] as const;
const INCIDENT_SEVERITIES = ["all", "info", "warning", "critical"] as const;

const SELECTOR_KINDS = ["workflow_id", "tag", "instance_id", "name_pattern"] as const;

type SelectorMode = AlertRuleInput["selectors"][number]["mode"];
type SelectorKind = AlertRuleInput["selectors"][number]["kind"];

function defaultRuleInput(): AlertRuleInput {
  return {
    name: "",
    description: "",
    ruleType: "workflow_inactivity",
    severity: "warning",
    enabled: true,
    evaluationIntervalSec: 300,
    cooldownSec: 600,
    openAfterN: 1,
    resolveAfterN: 1,
    applyDefaultExclusions: true,
    retentionResolvedDays: null,
    retentionUnresolvedDays: null,
    config: {
      thresholdHours: 24,
      targetMode: "all",
    },
    selectors: [],
    destinationIds: [],
    destinationSettings: {},
  };
}

function defaultDestinationInput(): AlertDestinationInput {
  return {
    name: "",
    enabled: true,
    webhookUrl: "",
    secret: "",
    headers: {},
    timeoutMs: 5000,
    retryMaxAttempts: 6,
  };
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString();
}

function severityBadgeClass(severity: string): string {
  if (severity === "critical") return "bg-red-100 text-red-800 border-red-200";
  if (severity === "warning") return "bg-amber-100 text-amber-800 border-amber-200";
  return "bg-slate-100 text-slate-800 border-slate-200";
}

function HelpTip({ text }: { text: string }) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" className="text-muted-foreground hover:text-foreground" aria-label="Field help">
            <CircleHelp className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs">{text}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

type DeliveryLogRow = Awaited<ReturnType<typeof listDeliveryLog>>[number];
type IncidentEventRow = Awaited<ReturnType<typeof getIncidentEvents>>[number];
type DeliveryAttemptRow = Awaited<ReturnType<typeof getDeliveryAttempts>>[number];
type AlertsEngineStatus = Awaited<ReturnType<typeof getAlertsEngineStatus>>;
type RetentionSettingsForm = AlertRetentionSettings;

export default function AlertsPage() {
  const { state } = useAuth();

  const canRead = hasPerm(state, "alerts.read");
  const canManageRules = hasPerm(state, "alerts.rules.manage");
  const canAcknowledge = hasPerm(state, "alerts.incidents.ack");
  const canManageDestinations = hasPerm(state, "alerts.destinations.manage");
  const canTestDestinations = hasPerm(state, "alerts.destinations.test");
  const canReadHistory = hasPerm(state, "alerts.history.read") || canRead;
  const canManageRetention = hasPerm(state, "admin:users") || hasPerm(state, "admin:roles");

  const [activeTab, setActiveTab] = useState("overview");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [overview, setOverview] = useState<AlertOverviewResponse | null>(null);
  const [incidents, setIncidents] = useState<AlertIncident[]>([]);
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [destinations, setDestinations] = useState<AlertDestination[]>([]);
  const [deliveryLog, setDeliveryLog] = useState<DeliveryLogRow[]>([]);

  const [incidentStatusFilter, setIncidentStatusFilter] = useState<string>("all");
  const [incidentSeverityFilter, setIncidentSeverityFilter] = useState<string>("all");

  const [ruleDialogOpen, setRuleDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<AlertRule | null>(null);
  const [ruleForm, setRuleForm] = useState<AlertRuleInput>(defaultRuleInput());
  const [selectorMode, setSelectorMode] = useState<SelectorMode>("include");
  const [selectorKind, setSelectorKind] = useState<SelectorKind>("workflow_id");
  const [selectorSearch, setSelectorSearch] = useState("");
  const [selectorPickedValues, setSelectorPickedValues] = useState<string[]>([]);
  const [namePatternValue, setNamePatternValue] = useState("");
  const [selectorInstances, setSelectorInstances] = useState<string[]>([]);
  const [selectorTags, setSelectorTags] = useState<string[]>([]);
  const [selectorWorkflows, setSelectorWorkflows] = useState<Array<{ instance_id: string; workflow_id: string; name: string; tags: string[] | string | null }>>([]);
  const [selectorOptionsLoading, setSelectorOptionsLoading] = useState(false);
  const [targetPreview, setTargetPreview] = useState<Array<{ target_fingerprint: string; instance_id: string | null; workflow_id: string | null; label: string }>>([]);

  const [destinationDialogOpen, setDestinationDialogOpen] = useState(false);
  const [editingDestination, setEditingDestination] = useState<AlertDestination | null>(null);
  const [destinationForm, setDestinationForm] = useState<AlertDestinationInput>(defaultDestinationInput());

  const [eventsDialogOpen, setEventsDialogOpen] = useState(false);
  const [eventsRows, setEventsRows] = useState<IncidentEventRow[]>([]);
  const [eventsIncidentId, setEventsIncidentId] = useState<string | null>(null);

  const [attemptsDialogOpen, setAttemptsDialogOpen] = useState(false);
  const [attemptsRows, setAttemptsRows] = useState<DeliveryAttemptRow[]>([]);
  const [attemptsOutboxId, setAttemptsOutboxId] = useState<string | null>(null);

  const [engineStatus, setEngineStatus] = useState<AlertsEngineStatus | null>(null);
  const [retentionSettings, setRetentionSettings] = useState<RetentionSettingsForm>({
    resolvedDaysDefault: 30,
    unresolvedDaysDefault: 180,
    updatedAt: null,
  });
  const [savingRetention, setSavingRetention] = useState(false);

  const selectorWorkflowOptions = useMemo(
    () => selectorWorkflows
      .map((workflow) => ({
        value: workflow.workflow_id,
        label: workflow.name ? `${workflow.name} (${workflow.workflow_id})` : workflow.workflow_id,
      }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    [selectorWorkflows],
  );

  const selectorAvailableValues = useMemo(() => {
    if (selectorKind === "instance_id") {
      return selectorInstances.map((value) => ({ value, label: value }));
    }
    if (selectorKind === "tag") {
      return selectorTags.map((value) => ({ value, label: value }));
    }
    if (selectorKind === "workflow_id") {
      return selectorWorkflowOptions;
    }
    return [];
  }, [selectorInstances, selectorKind, selectorTags, selectorWorkflowOptions]);

  const selectorFilteredValues = useMemo(() => {
    const needle = selectorSearch.trim().toLowerCase();
    if (!needle) return selectorAvailableValues;
    return selectorAvailableValues.filter((item) => item.label.toLowerCase().includes(needle) || item.value.toLowerCase().includes(needle));
  }, [selectorAvailableValues, selectorSearch]);

  const pageActions = (
    <Button variant="outline" size="sm" onClick={() => void refreshActiveTab()}>
      <RefreshCw className="mr-2 h-4 w-4" />
      Refresh
    </Button>
  );

  async function refreshOverview() {
    const data = await getAlertsOverview();
    setOverview(data);
  }

  async function refreshIncidents() {
    const data = await listIncidents({
      status: incidentStatusFilter !== "all" ? incidentStatusFilter : undefined,
      severity: incidentSeverityFilter !== "all" ? incidentSeverityFilter : undefined,
      limit: 200,
    });
    setIncidents(data);
  }

  async function refreshRules() {
    const data = await listRules();
    setRules(data);
  }

  async function refreshDestinations() {
    const data = await listDestinations();
    setDestinations(data);
  }

  async function refreshDeliveryLog() {
    const data = await listDeliveryLog({ limit: 200 });
    setDeliveryLog(data);
  }

  async function refreshTools() {
    const [status, retention] = await Promise.all([
      getAlertsEngineStatus(),
      getAlertRetentionSettings(),
    ]);
    setEngineStatus(status);
    setRetentionSettings(retention);
  }

  async function handleSaveRetentionSettings() {
    if (!canManageRetention) return;
    setSavingRetention(true);
    try {
      const next = await updateAlertRetentionSettings({
        resolvedDaysDefault: Math.max(1, Number(retentionSettings.resolvedDaysDefault || 30)),
        unresolvedDaysDefault: Math.max(1, Number(retentionSettings.unresolvedDaysDefault || 180)),
      });
      setRetentionSettings(next);
      toast({ title: "Retention updated", description: "Alert retention defaults were saved." });
    } catch (err) {
      toast({ title: "Retention save failed", description: err instanceof Error ? err.message : "Unexpected error", variant: "destructive" });
    } finally {
      setSavingRetention(false);
    }
  }

  async function refreshSelectorOptions() {
    setSelectorOptionsLoading(true);
    try {
      const options = await listAlertSelectorOptions(5000);
      setSelectorInstances(options.instances || []);
      setSelectorTags(options.tags || []);
      setSelectorWorkflows(options.workflows || []);
    } catch (err) {
      toast({
        title: "Selector options load failed",
        description: err instanceof Error ? err.message : "Unexpected error",
        variant: "destructive",
      });
    } finally {
      setSelectorOptionsLoading(false);
    }
  }

  function toggleSelectorPickedValue(value: string, checked: boolean) {
    setSelectorPickedValues((prev) => {
      if (checked) {
        if (prev.includes(value)) return prev;
        return [...prev, value];
      }
      return prev.filter((item) => item !== value);
    });
  }

  function addSelectedSelectors() {
    const values = selectorKind === "name_pattern"
      ? (namePatternValue.trim() ? [namePatternValue.trim()] : [])
      : selectorPickedValues;

    if (values.length === 0) {
      toast({ title: "No values selected", description: "Pick one or more values before adding a selector." });
      return;
    }

    setRuleForm((prev) => {
      const existing = new Set(prev.selectors.map((selector) => `${selector.mode}|${selector.kind}|${selector.value}`));
      const additions = values
        .map((value) => ({ mode: selectorMode, kind: selectorKind, value }))
        .filter((selector) => !existing.has(`${selector.mode}|${selector.kind}|${selector.value}`));

      return {
        ...prev,
        selectors: [...prev.selectors, ...additions],
      };
    });

    setSelectorPickedValues([]);
    setNamePatternValue("");
  }

  function removeSelector(index: number) {
    setRuleForm((prev) => ({
      ...prev,
      selectors: prev.selectors.filter((_, selectorIndex) => selectorIndex !== index),
    }));
  }

  async function refreshActiveTab() {
    setLoading(true);
    setError(null);
    try {
      if (activeTab === "overview") await refreshOverview();
      if (activeTab === "incidents") await refreshIncidents();
      if (activeTab === "rules") await refreshRules();
      if (activeTab === "destinations") await refreshDestinations();
      if (activeTab === "delivery") await refreshDeliveryLog();
      if (activeTab === "tools") await refreshTools();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load alerts data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!canRead) return;
    void refreshActiveTab();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, canRead]);

  useEffect(() => {
    if (activeTab === "incidents" && canRead) {
      void refreshIncidents().catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incidentStatusFilter, incidentSeverityFilter]);

  useEffect(() => {
    if (!canRead) return;
    void refreshSelectorOptions();
  }, [canRead]);

  if (!canRead) {
    return (
      <PageShell
        title="Alerts"
        description="Alerting is hidden because your account does not have alerts.read permission."
      >
        <EmptyState
          icon={<ShieldCheck className="h-10 w-10" />}
          title="No alert access"
          description="Ask an administrator to grant alerts.read permission to view the Alerts area and widgets."
        />
      </PageShell>
    );
  }

  async function handleAck(incident: AlertIncident) {
    const note = window.prompt("Optional acknowledge note", "") || undefined;
    try {
      await acknowledgeIncident(incident.id, note);
      toast({ title: "Incident acknowledged", description: incident.title });
      await refreshIncidents();
      await refreshOverview();
    } catch (err) {
      toast({ title: "Acknowledge failed", description: err instanceof Error ? err.message : "Unexpected error", variant: "destructive" });
    }
  }

  async function handleSuppress(incident: AlertIncident) {
    const minutesText = window.prompt("Suppress duration in minutes", "60");
    const minutes = Number(minutesText || "0");
    if (!Number.isFinite(minutes) || minutes <= 0) return;

    const note = window.prompt("Optional suppression note", "") || undefined;
    try {
      await suppressIncident(incident.id, minutes, note);
      toast({ title: "Incident suppressed", description: `${incident.title} for ${minutes}m` });
      await refreshIncidents();
      await refreshOverview();
    } catch (err) {
      toast({ title: "Suppress failed", description: err instanceof Error ? err.message : "Unexpected error", variant: "destructive" });
    }
  }

  async function handleResolve(incident: AlertIncident) {
    const note = window.prompt("Optional resolve note", "") || undefined;
    try {
      await resolveIncident(incident.id, note);
      toast({ title: "Incident resolved", description: incident.title });
      await refreshIncidents();
      await refreshOverview();
    } catch (err) {
      toast({ title: "Resolve failed", description: err instanceof Error ? err.message : "Unexpected error", variant: "destructive" });
    }
  }

  async function handleViewEvents(incidentId: string) {
    try {
      const rows = await getIncidentEvents(incidentId);
      setEventsRows(rows);
      setEventsIncidentId(incidentId);
      setEventsDialogOpen(true);
    } catch (err) {
      toast({ title: "Load events failed", description: err instanceof Error ? err.message : "Unexpected error", variant: "destructive" });
    }
  }

  function openCreateRule() {
    setEditingRule(null);
    setRuleForm(defaultRuleInput());
    setSelectorMode("include");
    setSelectorKind("workflow_id");
    setSelectorSearch("");
    setSelectorPickedValues([]);
    setNamePatternValue("");
    setTargetPreview([]);
    setRuleDialogOpen(true);
  }

  function openEditRule(rule: AlertRule) {
    const destinationIds = (rule.destinations || []).map((destination) => destination.destination_id);
    const destinationSettings = (rule.destinations || []).reduce<NonNullable<AlertRuleInput["destinationSettings"]>>((acc, destination) => {
      acc[destination.destination_id] = {
        notifyOnOpen: destination.notify_on_open,
        notifyOnResolve: destination.notify_on_resolve,
        notifyOnAck: destination.notify_on_ack,
        minSeverity: destination.min_severity,
      };
      return acc;
    }, {});

    setEditingRule(rule);
    const input: AlertRuleInput = {
      name: rule.name,
      description: rule.description || "",
      ruleType: rule.rule_type as AlertRuleInput["ruleType"],
      severity: rule.severity,
      enabled: rule.enabled,
      evaluationIntervalSec: rule.evaluation_interval_sec,
      cooldownSec: rule.cooldown_sec,
      openAfterN: rule.open_after_n,
      resolveAfterN: rule.resolve_after_n,
      applyDefaultExclusions: rule.apply_default_exclusions,
      retentionResolvedDays: rule.retention_resolved_days ?? null,
      retentionUnresolvedDays: rule.retention_unresolved_days ?? null,
      config: rule.config || {},
      selectors: rule.selectors || [],
      destinationIds,
      destinationSettings,
    };
    setRuleForm(input);
    setSelectorMode("include");
    setSelectorKind("workflow_id");
    setSelectorSearch("");
    setSelectorPickedValues([]);
    setNamePatternValue("");
    setTargetPreview([]);
    setRuleDialogOpen(true);
  }

  async function handleSaveRule() {
    const payload: AlertRuleInput = {
      ...ruleForm,
      selectors: ruleForm.selectors,
    };

    try {
      if (editingRule) {
        await updateRule(editingRule.id, payload);
        toast({ title: "Rule updated", description: ruleForm.name });
      } else {
        await createRule(payload);
        toast({ title: "Rule created", description: ruleForm.name });
      }
      setRuleDialogOpen(false);
      await refreshRules();
    } catch (err) {
      toast({ title: "Save rule failed", description: err instanceof Error ? err.message : "Unexpected error", variant: "destructive" });
    }
  }

  async function handlePreviewTargets() {
    try {
      const preview = await previewRuleTargetsFromInput(ruleForm, editingRule?.id);
      setTargetPreview(preview.targets);
    } catch (err) {
      toast({ title: "Preview failed", description: err instanceof Error ? err.message : "Unexpected error", variant: "destructive" });
    }
  }

  async function handleDeleteRule(rule: AlertRule) {
    if (!window.confirm(`Delete rule ${rule.name}?`)) return;
    try {
      await deleteRule(rule.id);
      toast({ title: "Rule deleted", description: rule.name });
      await refreshRules();
      await refreshOverview();
    } catch (err) {
      toast({ title: "Delete failed", description: err instanceof Error ? err.message : "Unexpected error", variant: "destructive" });
    }
  }

  async function handleToggleRule(rule: AlertRule) {
    try {
      await toggleRule(rule.id, !rule.enabled);
      await refreshRules();
    } catch (err) {
      toast({ title: "Toggle failed", description: err instanceof Error ? err.message : "Unexpected error", variant: "destructive" });
    }
  }

  async function handleRunRuleNow(rule: AlertRule) {
    try {
      await runRuleNow(rule.id);
      toast({ title: "Rule run queued", description: `Ran ${rule.name}` });
      await refreshRules();
      await refreshOverview();
    } catch (err) {
      toast({ title: "Run now failed", description: err instanceof Error ? err.message : "Unexpected error", variant: "destructive" });
    }
  }

  function openCreateDestination() {
    setEditingDestination(null);
    setDestinationForm(defaultDestinationInput());
    setDestinationDialogOpen(true);
  }

  function openEditDestination(destination: AlertDestination) {
    setEditingDestination(destination);
    setDestinationForm({
      name: destination.name,
      enabled: destination.enabled,
      webhookUrl: destination.webhookUrl,
      secret: "",
      headers: destination.headers,
      timeoutMs: destination.timeoutMs,
      retryMaxAttempts: destination.retryMaxAttempts,
    });
    setDestinationDialogOpen(true);
  }

  async function handleSaveDestination() {
    try {
      if (editingDestination) {
        await updateDestination(editingDestination.id, destinationForm);
        toast({ title: "Destination updated", description: destinationForm.name });
      } else {
        await createDestination(destinationForm);
        toast({ title: "Destination created", description: destinationForm.name });
      }
      setDestinationDialogOpen(false);
      await refreshDestinations();
    } catch (err) {
      toast({ title: "Save destination failed", description: err instanceof Error ? err.message : "Unexpected error", variant: "destructive" });
    }
  }

  async function handleDeleteDestination(destination: AlertDestination) {
    if (!window.confirm(`Delete destination ${destination.name}?`)) return;
    try {
      await deleteDestination(destination.id);
      toast({ title: "Destination deleted", description: destination.name });
      await refreshDestinations();
    } catch (err) {
      toast({ title: "Delete destination failed", description: err instanceof Error ? err.message : "Unexpected error", variant: "destructive" });
    }
  }

  async function handleTestDestination(destination: AlertDestination) {
    try {
      const result = await testDestination(destination.id);
      if (!result.ok) {
        toast({
          title: "Test failed",
          description: result.error || result.body || `HTTP ${result.status}`,
          variant: "destructive",
        });
      } else {
        toast({ title: "Test succeeded", description: `${destination.name} responded in ${result.latencyMs}ms` });
      }
    } catch (err) {
      toast({ title: "Test request failed", description: err instanceof Error ? err.message : "Unexpected error", variant: "destructive" });
    }
  }

  async function handleOpenAttempts(outboxId: string) {
    try {
      const rows = await getDeliveryAttempts(outboxId);
      setAttemptsRows(rows);
      setAttemptsOutboxId(outboxId);
      setAttemptsDialogOpen(true);
    } catch (err) {
      toast({ title: "Load attempts failed", description: err instanceof Error ? err.message : "Unexpected error", variant: "destructive" });
    }
  }

  return (
    <PageShell
      title="Alerts"
      description="Rules, incidents, destinations, delivery, and alerting tools in one place."
      headerActions={pageActions}
    >
      {error ? <ErrorState message="Failed to load alerts" details={error} onRetry={() => void refreshActiveTab()} /> : null}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-6">
          <TabsTrigger value="overview" className="gap-2"><Bell className="h-4 w-4" />Overview</TabsTrigger>
          <TabsTrigger value="incidents" className="gap-2"><Siren className="h-4 w-4" />Incidents</TabsTrigger>
          <TabsTrigger value="rules" className="gap-2"><BellRing className="h-4 w-4" />Rules</TabsTrigger>
          <TabsTrigger value="destinations" className="gap-2"><LinkIcon className="h-4 w-4" />Destinations</TabsTrigger>
          <TabsTrigger value="delivery" className="gap-2"><History className="h-4 w-4" />Delivery Log</TabsTrigger>
          <TabsTrigger value="tools" className="gap-2"><Wrench className="h-4 w-4" />Tools</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4 mt-4">
          {!overview ? (
            <EmptyState title={loading ? "Loading overview" : "No overview data"} description="Run rules and deliveries to populate overview metrics." />
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-4">
                <Card>
                  <CardHeader><CardTitle className="text-sm">Active Alerts</CardTitle></CardHeader>
                  <CardContent className="text-2xl font-semibold">{overview.active.active_count}</CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle className="text-sm">Critical</CardTitle></CardHeader>
                  <CardContent className="text-2xl font-semibold text-red-600">{overview.active.critical_count}</CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle className="text-sm">Warning</CardTitle></CardHeader>
                  <CardContent className="text-2xl font-semibold text-amber-600">{overview.active.warning_count}</CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle className="text-sm">Info</CardTitle></CardHeader>
                  <CardContent className="text-2xl font-semibold text-slate-600">{overview.active.info_count}</CardContent>
                </Card>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>Recent incidents</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {overview.recentIncidents.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No incidents yet.</p>
                    ) : (
                      <div className="space-y-2">
                        {overview.recentIncidents.slice(0, 8).map((incident) => (
                          <div key={incident.id} className="flex items-center justify-between gap-3 border rounded-md px-3 py-2">
                            <div>
                              <p className="text-sm font-medium">{incident.title}</p>
                              <p className="text-xs text-muted-foreground">
                                {incident.workflow_name || incident.workflow_id || incident.instance_id || "-"}
                              </p>
                              <p className="text-xs text-muted-foreground">{formatDate(incident.last_seen_at)}</p>
                            </div>
                            <Badge variant="outline" className={severityBadgeClass(incident.severity)}>{incident.severity}</Badge>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Delivery health</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div className="flex items-center justify-between"><span>Sent</span><span>{overview.deliveryHealth.sent_count}</span></div>
                    <div className="flex items-center justify-between"><span>Pending</span><span>{overview.deliveryHealth.pending_count}</span></div>
                    <div className="flex items-center justify-between"><span>Retrying</span><span>{overview.deliveryHealth.retry_count}</span></div>
                    <div className="flex items-center justify-between"><span>Dead</span><span className="text-red-600 font-semibold">{overview.deliveryHealth.dead_count}</span></div>
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="incidents" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Filters</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <Label htmlFor="incident-status" className="inline-flex items-center gap-1">Status<HelpTip text="Filter incidents by current lifecycle state." /></Label>
                <Select value={incidentStatusFilter} onValueChange={setIncidentStatusFilter}>
                  <SelectTrigger id="incident-status">
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    {INCIDENT_STATUSES.map((status) => (
                      <SelectItem key={status} value={status}>{status}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="incident-severity" className="inline-flex items-center gap-1">Severity<HelpTip text="Filter incidents by severity level." /></Label>
                <Select value={incidentSeverityFilter} onValueChange={setIncidentSeverityFilter}>
                  <SelectTrigger id="incident-severity">
                    <SelectValue placeholder="Select severity" />
                  </SelectTrigger>
                  <SelectContent>
                    {INCIDENT_SEVERITIES.map((severity) => (
                      <SelectItem key={severity} value={severity}>{severity}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Incidents</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead>Scope</TableHead>
                    <TableHead>Last seen</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {incidents.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No incidents found.</TableCell></TableRow>
                  ) : incidents.map((incident) => (
                    <TableRow key={incident.id}>
                      <TableCell>
                        <p className="font-medium text-sm">{incident.title}</p>
                        <p className="text-xs text-muted-foreground">{incident.summary || "-"}</p>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{incident.status}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={severityBadgeClass(incident.severity)}>{incident.severity}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        <div>{incident.workflow_name || incident.workflow_id || incident.instance_id || "-"}</div>
                        {incident.workflow_name && (incident.workflow_id || incident.instance_id) ? (
                          <div className="text-[11px] text-muted-foreground/80">{incident.workflow_id || incident.instance_id}</div>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-xs">{formatDate(incident.last_seen_at)}</TableCell>
                      <TableCell>
                        <div className="flex gap-2 flex-wrap">
                          {canAcknowledge && (incident.status === "open" || incident.status === "acknowledged") ? (
                            <Button size="sm" variant="outline" onClick={() => void handleAck(incident)}>Acknowledge</Button>
                          ) : null}
                          {canAcknowledge && (incident.status === "open" || incident.status === "acknowledged") ? (
                            <Button size="sm" variant="outline" onClick={() => void handleSuppress(incident)}>Suppress</Button>
                          ) : null}
                          {canAcknowledge && (incident.status === "open" || incident.status === "acknowledged" || incident.status === "suppressed") ? (
                            <Button size="sm" variant="secondary" onClick={() => void handleResolve(incident)}>Resolve</Button>
                          ) : null}
                          {canReadHistory ? (
                            <Button size="sm" variant="ghost" onClick={() => void handleViewEvents(incident.id)}>Timeline</Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rules" className="space-y-4 mt-4">
          <div className="flex justify-end">
            <Button onClick={openCreateRule} disabled={!canManageRules}>Create rule</Button>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Rules</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead>Enabled</TableHead>
                    <TableHead>Interval</TableHead>
                    <TableHead>Destinations</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rules.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No rules configured.</TableCell></TableRow>
                  ) : rules.map((rule) => (
                    <TableRow key={rule.id}>
                      <TableCell>
                        <p className="font-medium">{rule.name}</p>
                        <p className="text-xs text-muted-foreground">{rule.description || "-"}</p>
                      </TableCell>
                      <TableCell className="text-xs">{rule.rule_type}</TableCell>
                      <TableCell><Badge variant="outline" className={severityBadgeClass(rule.severity)}>{rule.severity}</Badge></TableCell>
                      <TableCell>
                        <Switch checked={rule.enabled} onCheckedChange={() => void handleToggleRule(rule)} disabled={!canManageRules} />
                      </TableCell>
                      <TableCell className="text-xs">{rule.evaluation_interval_sec}s</TableCell>
                      <TableCell className="text-xs">{rule.destinations_count || 0}</TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button size="sm" variant="secondary" disabled={!canManageRules || !rule.enabled} onClick={() => void handleRunRuleNow(rule)}>Run now</Button>
                          <Button size="sm" variant="outline" disabled={!canManageRules} onClick={() => openEditRule(rule)}>Edit</Button>
                          <Button size="sm" variant="ghost" disabled={!canManageRules} onClick={() => void handleDeleteRule(rule)}>Delete</Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="destinations" className="space-y-4 mt-4">
          <div className="flex justify-end">
            <Button onClick={openCreateDestination} disabled={!canManageDestinations}>Create destination</Button>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Destinations</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Webhook URL</TableHead>
                    <TableHead>Enabled</TableHead>
                    <TableHead>Secret</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {destinations.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No destinations configured.</TableCell></TableRow>
                  ) : destinations.map((destination) => (
                    <TableRow key={destination.id}>
                      <TableCell className="font-medium">{destination.name}</TableCell>
                      <TableCell>{destination.type}</TableCell>
                      <TableCell className="text-xs">{destination.webhookUrl}</TableCell>
                      <TableCell>
                        <Badge variant={destination.enabled ? "default" : "secondary"}>{destination.enabled ? "Enabled" : "Disabled"}</Badge>
                      </TableCell>
                      <TableCell>{destination.hasSecret ? "Configured" : "None"}</TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" disabled={!canManageDestinations} onClick={() => openEditDestination(destination)}>Edit</Button>
                          <Button size="sm" variant="ghost" disabled={!canManageDestinations} onClick={() => void handleDeleteDestination(destination)}>Delete</Button>
                          <Button size="sm" variant="secondary" disabled={!canTestDestinations} onClick={() => void handleTestDestination(destination)}>Test</Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="delivery" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Delivery log</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Event</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Destination</TableHead>
                    <TableHead>Attempts</TableHead>
                    <TableHead>Next attempt</TableHead>
                    <TableHead>Error</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deliveryLog.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No delivery records.</TableCell></TableRow>
                  ) : deliveryLog.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <p className="font-medium text-sm">{row.event_type}</p>
                        <p className="text-xs text-muted-foreground">{row.incident_title}</p>
                      </TableCell>
                      <TableCell><Badge variant="outline">{row.status}</Badge></TableCell>
                      <TableCell className="text-xs">{row.destination_name || row.destination_id}</TableCell>
                      <TableCell className="text-xs">{row.attempt_count}/{row.max_attempts}</TableCell>
                      <TableCell className="text-xs">{formatDate(row.next_attempt_at)}</TableCell>
                      <TableCell className="text-xs text-red-600 max-w-[280px] truncate">{row.last_error || "-"}</TableCell>
                      <TableCell>
                        <Button size="sm" variant="ghost" onClick={() => void handleOpenAttempts(row.id)}>Attempts</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tools" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Activity className="h-4 w-4" />Engine status</CardTitle>
            </CardHeader>
            <CardContent>
              {!engineStatus ? (
                <p className="text-sm text-muted-foreground">No status loaded.</p>
              ) : (
                <div className="space-y-3 text-sm">
                  <div className="flex items-center justify-between"><span>Alerts enabled</span><Badge variant={engineStatus.enabled ? "default" : "secondary"}>{engineStatus.enabled ? "Yes" : "No"}</Badge></div>
                  <div className="flex items-center justify-between"><span>Workers started</span><Badge variant={engineStatus.started ? "default" : "secondary"}>{engineStatus.started ? "Yes" : "No"}</Badge></div>
                  <Separator />
                  <div className="grid gap-2 sm:grid-cols-3">
                    <Card>
                      <CardHeader><CardTitle className="text-sm">Evaluator</CardTitle></CardHeader>
                      <CardContent className="text-xs space-y-1">
                        <p>Poll: {engineStatus.evaluator?.pollMs} ms</p>
                        <p>Running: {String(engineStatus.evaluator?.running)}</p>
                        <p>Last run: {formatDate(engineStatus.evaluator?.lastRunAt)}</p>
                        <p>Errors: {engineStatus.evaluator?.errors}</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader><CardTitle className="text-sm">Delivery</CardTitle></CardHeader>
                      <CardContent className="text-xs space-y-1">
                        <p>Poll: {engineStatus.delivery?.pollMs} ms</p>
                        <p>Running: {String(engineStatus.delivery?.running)}</p>
                        <p>Last run: {formatDate(engineStatus.delivery?.lastRunAt)}</p>
                        <p>Errors: {engineStatus.delivery?.errors}</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader><CardTitle className="text-sm">Maintenance</CardTitle></CardHeader>
                      <CardContent className="text-xs space-y-1">
                        <p>Poll: {engineStatus.maintenance?.pollMs} ms</p>
                        <p>Running: {String(engineStatus.maintenance?.running)}</p>
                        <p>Last run: {formatDate(engineStatus.maintenance?.lastRunAt)}</p>
                        <p>Errors: {engineStatus.maintenance?.errors}</p>
                      </CardContent>
                    </Card>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Webhook test utility</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!canTestDestinations ? (
                <p className="text-sm text-muted-foreground">You do not have alerts.destinations.test permission.</p>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">Use destination-level Test actions in the Destinations section. Test calls are permission-protected and audited.</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {destinations.map((destination) => (
                      <div key={destination.id} className="flex items-center justify-between border rounded-md px-3 py-2">
                        <div>
                          <p className="text-sm font-medium">{destination.name}</p>
                          <p className="text-xs text-muted-foreground">{destination.webhookUrl}</p>
                        </div>
                        <Button size="sm" variant="outline" onClick={() => void handleTestDestination(destination)}>Send test</Button>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Alert retention policy</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Controls how long incidents are kept before automatic cleanup in maintenance.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label className="inline-flex items-center gap-1">Resolved incidents default (days)<HelpTip text="Global default retention for incidents after they are resolved." /></Label>
                  <Input
                    type="number"
                    min={1}
                    value={retentionSettings.resolvedDaysDefault}
                    onChange={(e) => setRetentionSettings((prev) => ({ ...prev, resolvedDaysDefault: Math.max(1, Number(e.target.value || 30)) }))}
                    disabled={!canManageRetention}
                  />
                </div>
                <div>
                  <Label className="inline-flex items-center gap-1">Unresolved incidents default (days)<HelpTip text="Global default retention for incidents that are still not resolved." /></Label>
                  <Input
                    type="number"
                    min={1}
                    value={retentionSettings.unresolvedDaysDefault}
                    onChange={(e) => setRetentionSettings((prev) => ({ ...prev, unresolvedDaysDefault: Math.max(1, Number(e.target.value || 180)) }))}
                    disabled={!canManageRetention}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Rule-level retention values override these defaults when set.</p>
              {canManageRetention ? (
                <div className="flex justify-end">
                  <Button type="button" onClick={() => void handleSaveRetentionSettings()} disabled={savingRetention}>
                    {savingRetention ? "Saving..." : "Save retention policy"}
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Only admins can change retention policy.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={ruleDialogOpen} onOpenChange={setRuleDialogOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editingRule ? "Edit rule" : "Create rule"}</DialogTitle>
            <DialogDescription>
              Configure rule type, scope selectors, anti-flapping controls, and destination routing.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 max-h-[60vh] overflow-y-auto pr-2">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label className="inline-flex items-center gap-1">Name<HelpTip text="Human-friendly rule name shown in tables and incident context." /></Label>
                <Input value={ruleForm.name} onChange={(e) => setRuleForm((prev) => ({ ...prev, name: e.target.value }))} />
              </div>
              <div>
                <Label className="inline-flex items-center gap-1">Rule type<HelpTip text="Chooses what condition is evaluated: inactivity, stuck execution, or metrics freshness." /></Label>
                <Select
                  value={ruleForm.ruleType}
                  onValueChange={(value) => setRuleForm((prev) => ({ ...prev, ruleType: value as AlertRuleInput["ruleType"] }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select rule type" />
                  </SelectTrigger>
                  <SelectContent>
                    {RULE_TYPES.map((type) => (
                      <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label className="inline-flex items-center gap-1">Description<HelpTip text="Optional notes explaining the intent of this rule for other operators." /></Label>
              <Input value={ruleForm.description || ""} onChange={(e) => setRuleForm((prev) => ({ ...prev, description: e.target.value }))} />
            </div>

            <div className="grid gap-3 sm:grid-cols-4">
              <div>
                <Label className="inline-flex items-center gap-1">Severity<HelpTip text="Priority used for notifications and incident triage." /></Label>
                <Select
                  value={ruleForm.severity}
                  onValueChange={(value) => setRuleForm((prev) => ({ ...prev, severity: value as AlertRuleInput["severity"] }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select severity" />
                  </SelectTrigger>
                  <SelectContent>
                    {SEVERITIES.map((severity) => (
                      <SelectItem key={severity} value={severity}>{severity}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="inline-flex items-center gap-1">Interval (sec)<HelpTip text="How often the rule runs. Lower values detect faster but increase load." /></Label>
                <Input type="number" value={ruleForm.evaluationIntervalSec} onChange={(e) => setRuleForm((prev) => ({ ...prev, evaluationIntervalSec: Number(e.target.value || 300) }))} />
              </div>
              <div>
                <Label className="inline-flex items-center gap-1">Open after N<HelpTip text="Number of consecutive breach evaluations required before opening an incident." /></Label>
                <Input type="number" value={ruleForm.openAfterN} onChange={(e) => setRuleForm((prev) => ({ ...prev, openAfterN: Number(e.target.value || 1) }))} />
              </div>
              <div>
                <Label className="inline-flex items-center gap-1">Resolve after N<HelpTip text="Number of consecutive healthy evaluations required to auto-resolve an active incident." /></Label>
                <Input type="number" value={ruleForm.resolveAfterN} onChange={(e) => setRuleForm((prev) => ({ ...prev, resolveAfterN: Number(e.target.value || 1) }))} />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label className="inline-flex items-center gap-1">Threshold (hours for inactivity, minutes for others)<HelpTip text="The value compared by the rule. Inactivity uses hours; other rule types use minutes." /></Label>
                <Input
                  value={String(ruleForm.config.thresholdHours ?? ruleForm.config.thresholdMinutes ?? "")}
                  onChange={(e) => {
                    const v = Number(e.target.value || "0");
                    setRuleForm((prev) => ({
                      ...prev,
                      config: prev.ruleType === "workflow_inactivity"
                        ? { ...prev.config, thresholdHours: v }
                        : { ...prev.config, thresholdMinutes: v },
                    }));
                  }}
                />
              </div>
              <div className="flex items-end gap-2">
                <Switch checked={ruleForm.applyDefaultExclusions} onCheckedChange={(value) => setRuleForm((prev) => ({ ...prev, applyDefaultExclusions: value }))} />
                <Label className="inline-flex items-center gap-1">
                  Apply template/test default exclusion
                  <HelpTip text="For workflow inactivity rules, skips workflows detected as template/test by name or tags, and workflows marked inactivity exempt." />
                </Label>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label className="inline-flex items-center gap-1">Resolved delete after (days, optional)<HelpTip text="Per-rule override: after this many days in resolved state, incidents are deleted. Empty means use global default." /></Label>
                <Input
                  type="number"
                  value={ruleForm.retentionResolvedDays ?? ""}
                  onChange={(e) => {
                    const raw = e.target.value.trim();
                    setRuleForm((prev) => ({
                      ...prev,
                      retentionResolvedDays: raw ? Math.max(1, Number(raw)) : null,
                    }));
                  }}
                  placeholder={`Use global default (${retentionSettings.resolvedDaysDefault} days)`}
                />
              </div>
              <div>
                <Label className="inline-flex items-center gap-1">Unresolved delete after (days, optional)<HelpTip text="Per-rule override: after this many days in open/acknowledged/suppressed state, incidents are deleted. Empty means use global default." /></Label>
                <Input
                  type="number"
                  value={ruleForm.retentionUnresolvedDays ?? ""}
                  onChange={(e) => {
                    const raw = e.target.value.trim();
                    setRuleForm((prev) => ({
                      ...prev,
                      retentionUnresolvedDays: raw ? Math.max(1, Number(raw)) : null,
                    }));
                  }}
                  placeholder={`Use global default (${retentionSettings.unresolvedDaysDefault} days)`}
                />
              </div>
            </div>

            <div className="space-y-3">
              <Label className="inline-flex items-center gap-1">Selectors<HelpTip text="Selectors define target scope. Includes are AND across kinds and OR within same kind. Excludes remove matches last." /></Label>
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <Label className="text-xs text-muted-foreground inline-flex items-center gap-1">Mode<HelpTip text="Include keeps matching targets; Exclude removes matching targets." /></Label>
                  <Select value={selectorMode} onValueChange={(value) => setSelectorMode(value as SelectorMode)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="include">include</SelectItem>
                      <SelectItem value="exclude">exclude</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground inline-flex items-center gap-1">Kind<HelpTip text="Field used to match targets: workflow id, tag, instance id, or name pattern." /></Label>
                  <Select
                    value={selectorKind}
                    onValueChange={(value) => {
                      setSelectorKind(value as SelectorKind);
                      setSelectorSearch("");
                      setSelectorPickedValues([]);
                      setNamePatternValue("");
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SELECTOR_KINDS.map((kind) => (
                        <SelectItem key={kind} value={kind}>{kind}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end">
                  <Button type="button" variant="outline" className="w-full" onClick={addSelectedSelectors}>Add selector(s)</Button>
                </div>
              </div>

              {selectorKind === "name_pattern" ? (
                <div>
                  <Label className="text-xs text-muted-foreground inline-flex items-center gap-1">Pattern value<HelpTip text="Wildcard pattern for target names, for example *prod*." /></Label>
                  <Input
                    value={namePatternValue}
                    onChange={(e) => setNamePatternValue(e.target.value)}
                    placeholder="Example: *prod*"
                  />
                </div>
              ) : (
                <>
                  <Input
                    value={selectorSearch}
                    onChange={(e) => setSelectorSearch(e.target.value)}
                    placeholder={selectorOptionsLoading ? "Loading options..." : "Search values"}
                    disabled={selectorOptionsLoading}
                  />
                  <div className="max-h-40 overflow-auto rounded-md border p-2 space-y-2">
                    {selectorFilteredValues.length === 0 ? (
                      <p className="text-xs text-muted-foreground px-1 py-1">No values found.</p>
                    ) : selectorFilteredValues.map((option) => {
                      const checked = selectorPickedValues.includes(option.value);
                      return (
                        <label key={`${selectorKind}:${option.value}`} className="flex items-center gap-2 rounded px-1 py-1 hover:bg-muted/50">
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(value) => toggleSelectorPickedValue(option.value, value === true)}
                          />
                          <span className="text-sm">{option.label}</span>
                        </label>
                      );
                    })}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setSelectorPickedValues(selectorFilteredValues.map((option) => option.value))}
                    >
                      Select shown
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setSelectorPickedValues([])}>
                      Clear
                    </Button>
                  </div>
                </>
              )}

              <div className="rounded-md border p-2 min-h-12">
                {ruleForm.selectors.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No selectors added.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {ruleForm.selectors.map((selector, idx) => (
                      <Badge key={`${selector.mode}:${selector.kind}:${selector.value}:${idx}`} variant="outline" className="inline-flex items-center gap-1">
                        {selector.mode}, {selector.kind}, {selector.value}
                        <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => removeSelector(idx)} aria-label="Remove selector">
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Logic: includes are AND across kinds and OR within the same kind. Excludes run last and remove any matches.
              </p>
            </div>

            <div>
              <Label className="inline-flex items-center gap-1">Destinations<HelpTip text="Selected destinations receive notifications for this rule according to route settings." /></Label>
              <div className="grid gap-2 sm:grid-cols-2 mt-2">
                {destinations.length === 0 ? <p className="text-sm text-muted-foreground">No destinations available.</p> : destinations.map((destination) => {
                  const checked = ruleForm.destinationIds.includes(destination.id);
                  return (
                    <label key={destination.id} className="flex items-center gap-2 border rounded-md px-3 py-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          setRuleForm((prev) => ({
                            ...prev,
                            destinationIds: checked
                              ? prev.destinationIds.filter((id) => id !== destination.id)
                              : [...prev.destinationIds, destination.id],
                          }));
                        }}
                      />
                      <span className="text-sm">{destination.name}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            {targetPreview.length > 0 ? (
              <div>
                <Label className="inline-flex items-center gap-1">Matched targets preview<HelpTip text="Shows targets that match current form values, including unsaved selector edits." /></Label>
                <div className="max-h-32 overflow-auto border rounded-md mt-2">
                  {targetPreview.map((target) => (
                    <div key={target.target_fingerprint} className="px-3 py-2 text-xs border-b last:border-b-0">
                      {target.label} ({target.workflow_id || target.instance_id || target.target_fingerprint})
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => void handlePreviewTargets()}>Preview targets</Button>
            <Button type="button" variant="outline" onClick={() => setRuleDialogOpen(false)}>Cancel</Button>
            <Button type="button" onClick={() => void handleSaveRule()}>{editingRule ? "Save" : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={destinationDialogOpen} onOpenChange={setDestinationDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingDestination ? "Edit destination" : "Create destination"}</DialogTitle>
            <DialogDescription>Secure webhook endpoint for alert notifications.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-3">
            <div>
              <Label className="inline-flex items-center gap-1">Name<HelpTip text="Destination name used in selection lists." /></Label>
              <Input value={destinationForm.name} onChange={(e) => setDestinationForm((prev) => ({ ...prev, name: e.target.value }))} />
            </div>
            <div>
              <Label className="inline-flex items-center gap-1">Webhook URL<HelpTip text="HTTPS endpoint that receives alert payloads." /></Label>
              <Input value={destinationForm.webhookUrl} onChange={(e) => setDestinationForm((prev) => ({ ...prev, webhookUrl: e.target.value }))} />
            </div>
            <div>
              <Label className="inline-flex items-center gap-1">Secret (leave empty to keep current value on edit)<HelpTip text="Optional signing secret sent with requests so receivers can verify authenticity." /></Label>
              <Input type="password" value={destinationForm.secret || ""} onChange={(e) => setDestinationForm((prev) => ({ ...prev, secret: e.target.value }))} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label className="inline-flex items-center gap-1">Timeout (ms)<HelpTip text="Maximum wait time for webhook response before marking attempt failed." /></Label>
                <Input type="number" value={destinationForm.timeoutMs || 5000} onChange={(e) => setDestinationForm((prev) => ({ ...prev, timeoutMs: Number(e.target.value || 5000) }))} />
              </div>
              <div>
                <Label className="inline-flex items-center gap-1">Max retries<HelpTip text="How many additional delivery attempts are made after a failure." /></Label>
                <Input type="number" value={destinationForm.retryMaxAttempts || 6} onChange={(e) => setDestinationForm((prev) => ({ ...prev, retryMaxAttempts: Number(e.target.value || 6) }))} />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={destinationForm.enabled} onCheckedChange={(value) => setDestinationForm((prev) => ({ ...prev, enabled: value }))} />
              <Label className="inline-flex items-center gap-1">Enabled<HelpTip text="When disabled, this destination is ignored by routing." /></Label>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDestinationDialogOpen(false)}>Cancel</Button>
            <Button type="button" onClick={() => void handleSaveDestination()}>{editingDestination ? "Save" : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={eventsDialogOpen} onOpenChange={setEventsDialogOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Incident timeline</DialogTitle>
            <DialogDescription>Incident ID: {eventsIncidentId}</DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-auto border rounded-md">
            {eventsRows.length === 0 ? (
              <p className="text-sm text-muted-foreground p-4">No timeline events.</p>
            ) : eventsRows.map((row) => (
              <div key={row.id} className="px-4 py-3 border-b last:border-b-0">
                <div className="flex items-center justify-between gap-3">
                  <Badge variant="outline">{row.event_type}</Badge>
                  <span className="text-xs text-muted-foreground">{formatDate(row.created_at)}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{row.actor_email || row.actor_user_id || "system"}</p>
                {row.note ? <p className="text-sm mt-1">{row.note}</p> : null}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={attemptsDialogOpen} onOpenChange={setAttemptsDialogOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Delivery attempts</DialogTitle>
            <DialogDescription>Outbox ID: {attemptsOutboxId}</DialogDescription>
          </DialogHeader>

          <div className="max-h-[60vh] overflow-auto border rounded-md">
            {attemptsRows.length === 0 ? (
              <p className="text-sm text-muted-foreground p-4">No attempts found.</p>
            ) : attemptsRows.map((row) => (
              <div key={row.id} className="px-4 py-3 border-b last:border-b-0 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <Badge variant={row.success ? "default" : "destructive"}>{row.success ? "Success" : "Failure"}</Badge>
                  <span className="text-xs text-muted-foreground">Attempt {row.attempt_no} • {formatDate(row.attempted_at)}</span>
                </div>
                <p className="text-xs mt-1">HTTP: {row.response_status ?? "-"} • Latency: {row.latency_ms ?? "-"} ms</p>
                {row.error ? <p className="text-xs text-red-600 mt-1">{row.error}</p> : null}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
