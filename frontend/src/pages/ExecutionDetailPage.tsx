import { useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { PageShell } from "@/components/PageShell";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft,
  FileSearch,
  Clock,
  GitBranch,
  Hash,
  Play,
  CheckCircle,
  Copy,
  Check,
  ChevronRight,
  ChevronDown,
  HelpCircle,
  Zap,
  Box,
} from "lucide-react";
import { useData } from "@/data/DataContext";
import { useFilters } from "@/hooks/useFilters";
import { filterExecutions } from "@/data/selectors/executionSelectors";
import { toast } from "@/hooks/use-toast";
import type { Execution, ExecutionNode } from "@/types/execution";

// ========== Utility functions ==========

function formatDate(date: Date | null): string {
  if (!date) return "—";
  return date.toLocaleString();
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

// ========== Copy Button Component ==========

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast({ title: `${label} copied to clipboard` });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Failed to copy", variant: "destructive" });
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={handleCopy}
        >
          {copied ? (
            <Check className="h-3 w-3 text-success" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        Copy {label}
      </TooltipContent>
    </Tooltip>
  );
}

// ========== Info Card Component ==========

function InfoCard({
  icon,
  label,
  value,
  copyValue,
  tooltip,
}: {
  readonly icon: React.ReactNode;
  readonly label: string;
  readonly value: React.ReactNode;
  readonly copyValue?: string;
  readonly tooltip?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="text-muted-foreground">{icon}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1">
            <p className="text-xs text-muted-foreground">{label}</p>
            {tooltip && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <HelpCircle className="h-3 w-3 text-muted-foreground/50 cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs max-w-[180px]">
                  {tooltip}
                </TooltipContent>
              </Tooltip>
            )}
          </div>
          <div className="flex items-center gap-1">
            <div className="font-medium truncate">{value}</div>
            {copyValue && <CopyButton value={copyValue} label={label} />}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ========== Node Group Types ==========

interface NodeGroup {
  nodeName: string;
  nodeType: string;
  runs: ExecutionNode[];
  hasError: boolean;
  totalTime: number;
  totalItemsOut: number;
  maxTime: number;
}

function groupNodesByName(nodes: readonly ExecutionNode[]): NodeGroup[] {
  const groups = new Map<string, ExecutionNode[]>();

  for (const node of nodes) {
    const list = groups.get(node.nodeName) ?? [];
    list.push(node);
    groups.set(node.nodeName, list);
  }

  const result: NodeGroup[] = [];

  for (const [nodeName, runs] of groups) {
    // Sort runs by startTime then runIndex
    const sortedRuns = [...runs].sort((a, b) => {
      const aTime = a.startTime?.getTime() ?? 0;
      const bTime = b.startTime?.getTime() ?? 0;
      if (aTime !== bTime) return aTime - bTime;
      return a.runIndex - b.runIndex;
    });

    const hasError = runs.some((r) => r.executionStatus === "error");
    const totalTime = runs.reduce((sum, r) => sum + r.executionTimeMs, 0);
    const totalItemsOut = runs.reduce((sum, r) => sum + r.itemsOutCount, 0);
    const maxTime = Math.max(...runs.map((r) => r.executionTimeMs));

    result.push({
      nodeName,
      nodeType: runs[0].nodeType,
      runs: sortedRuns,
      hasError,
      totalTime,
      totalItemsOut,
      maxTime,
    });
  }

  // Sort groups by first run start time
  return result.sort((a, b) => {
    const aTime = a.runs[0]?.startTime?.getTime() ?? 0;
    const bTime = b.runs[0]?.startTime?.getTime() ?? 0;
    return aTime - bTime;
  });
}

// ========== Quick Filters ==========

interface NodeQuickFilters {
  errorsOnly: boolean;
  slowOnly: boolean;
  minItemsOut: number | null;
}

function applyNodeFilters(
  groups: NodeGroup[],
  filters: NodeQuickFilters
): NodeGroup[] {
  let result = groups;

  if (filters.errorsOnly) {
    result = result.filter((g) => g.hasError);
  }

  if (filters.slowOnly) {
    // Top 20% slowest nodes
    const sortedByTime = [...result].sort((a, b) => b.maxTime - a.maxTime);
    const threshold = Math.ceil(sortedByTime.length * 0.2);
    const slowNodes = new Set(sortedByTime.slice(0, threshold).map((g) => g.nodeName));
    result = result.filter((g) => slowNodes.has(g.nodeName));
  }

  if (filters.minItemsOut !== null) {
    result = result.filter((g) => g.totalItemsOut >= filters.minItemsOut!);
  }

  return result;
}

// ========== Node Run Row ==========

function NodeRunRow({ run, isLast }: { run: ExecutionNode; isLast: boolean }) {
  return (
    <div
      className={`grid grid-cols-12 gap-2 px-4 py-2 text-sm ${
        !isLast ? "border-b border-dashed" : ""
      }`}
    >
      <div className="col-span-2 text-muted-foreground text-xs font-mono">
        Run {run.runIndex + 1}/{run.runsCount}
      </div>
      <div className="col-span-2">
        <StatusBadge status={run.executionStatus} />
      </div>
      <div className="col-span-2 text-muted-foreground">
        {formatDuration(run.executionTimeMs)}
      </div>
      <div className="col-span-2 text-muted-foreground">
        {run.itemsOutCount} items
      </div>
      <div className="col-span-2 text-muted-foreground text-xs">
        {run.startTime ? formatDate(run.startTime) : "—"}
      </div>
      <div className="col-span-2 text-right">
        {run.isLastRun && (
          <Badge variant="outline" className="text-xs">
            Last run
          </Badge>
        )}
      </div>
    </div>
  );
}

// ========== Node Group Row ==========

function NodeGroupRow({ group }: { group: NodeGroup }) {
  const [isOpen, setIsOpen] = useState(false);
  const hasMultipleRuns = group.runs.length > 1;

  const primaryRun = group.runs[group.runs.length - 1]; // Most recent run

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="border-b">
        <CollapsibleTrigger asChild>
          <div
            className={`grid grid-cols-12 gap-2 px-4 py-3 hover:bg-muted/50 transition-colors ${
              hasMultipleRuns ? "cursor-pointer" : ""
            }`}
          >
            {/* Expand icon + Node name */}
            <div className="col-span-3 flex items-center gap-2">
              {hasMultipleRuns ? (
                isOpen ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )
              ) : (
                <div className="w-4" />
              )}
              <div className="min-w-0">
                <div className="font-medium truncate flex items-center gap-2">
                  {group.nodeName}
                  {group.hasError && (
                    <span className="text-destructive text-xs">●</span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground font-mono truncate">
                  {group.nodeType.replace("n8n-nodes-base.", "")}
                </div>
              </div>
            </div>

            {/* Status */}
            <div className="col-span-2 flex items-center">
              <StatusBadge status={primaryRun.executionStatus} />
            </div>

            {/* Duration */}
            <div className="col-span-2 flex items-center text-muted-foreground">
              {formatDuration(group.totalTime)}
              {hasMultipleRuns && (
                <span className="text-xs ml-1">({group.runs.length} runs)</span>
              )}
            </div>

            {/* Items Out */}
            <div className="col-span-2 flex items-center text-muted-foreground">
              <Box className="h-3 w-3 mr-1" />
              {group.totalItemsOut}
            </div>

            {/* Start Time */}
            <div className="col-span-2 flex items-center text-sm text-muted-foreground">
              {primaryRun.startTime ? formatDate(primaryRun.startTime) : "—"}
            </div>

            {/* Last Run badge */}
            <div className="col-span-1 flex items-center justify-end">
              {primaryRun.isLastRun && (
                <Badge variant="secondary" className="text-xs">
                  Final
                </Badge>
              )}
            </div>
          </div>
        </CollapsibleTrigger>

        {/* Expanded runs */}
        {hasMultipleRuns && (
          <CollapsibleContent>
            <div className="bg-muted/30 border-t">
              <div className="px-4 py-1 text-xs text-muted-foreground font-medium border-b bg-muted/50">
                All runs for this node
              </div>
              {group.runs.map((run, idx) => (
                <NodeRunRow
                  key={`${run.nodeName}-${run.runIndex}`}
                  run={run}
                  isLast={idx === group.runs.length - 1}
                />
              ))}
            </div>
          </CollapsibleContent>
        )}
      </div>
    </Collapsible>
  );
}

// ========== Main Component ==========

export default function ExecutionDetailPage() {
  const { executionId } = useParams<{ executionId: string }>();
  const { loadResult, isLoading } = useData();
  const { filters, hasActiveFilters, temporarilyIgnoreFilters, setTemporarilyIgnoreFilters } =
    useFilters();

  // Quick filters state
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [slowOnly, setSlowOnly] = useState(false);
  const [minItemsOut, setMinItemsOut] = useState("");

  const execution = useMemo<Execution | null>(() => {
    if (!loadResult || !executionId) return null;
    return loadResult.executions.find((e) => e.executionId === executionId) ?? null;
  }, [loadResult, executionId]);

  const nodes = useMemo<readonly ExecutionNode[]>(() => {
    if (!loadResult || !executionId) return [];
    return loadResult.nodeRuns.filter((n) => n.executionId === executionId);
  }, [loadResult, executionId]);

  // Group nodes by name
  const nodeGroups = useMemo(() => groupNodesByName(nodes), [nodes]);

  // Apply quick filters
  const filteredGroups = useMemo(() => {
    return applyNodeFilters(nodeGroups, {
      errorsOnly,
      slowOnly,
      minItemsOut: minItemsOut ? parseInt(minItemsOut, 10) : null,
    });
  }, [nodeGroups, errorsOnly, slowOnly, minItemsOut]);

  // Check if excluded by global filters
  const isExcludedByFilters = useMemo(() => {
    if (!loadResult || !execution || !hasActiveFilters) return false;
    const filtered = filterExecutions(
      loadResult.executions,
      loadResult.workflows,
      loadResult.nodeRuns,
      filters
    );
    return !filtered.some((e) => e.executionId === executionId);
  }, [loadResult, execution, filters, hasActiveFilters, executionId]);

  const workflowName = useMemo(() => {
    if (!loadResult || !execution) return "—";
    return (
      loadResult.workflows.find((w) => w.workflowId === execution.workflowId)?.name ??
      execution.workflowId
    );
  }, [loadResult, execution]);

  // ========== Loading State ==========
  if (isLoading) {
    return (
      <PageShell title="Loading…" description="">
        <div className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </PageShell>
    );
  }

  // ========== Not Found State ==========
  if (!execution) {
    return (
      <PageShell title="Execution Not Found" description="">
        <Link to="/executions">
          <Button variant="ghost" size="sm" className="mb-4">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to executions
          </Button>
        </Link>
        <EmptyState
          icon={<FileSearch className="h-10 w-10" />}
          title="Execution not found"
          description={`The execution "${executionId}" does not exist in the loaded data. It may have been deleted or the ID is incorrect.`}
        />
        <div className="mt-4 flex justify-center">
          <Link to="/executions">
            <Button variant="outline">
              Browse all executions
            </Button>
          </Link>
        </div>
      </PageShell>
    );
  }

  // ========== Main Render ==========
  return (
    <PageShell
      title={
        <div className="flex items-center gap-2">
          <span>Execution</span>
          <span className="font-mono text-base">{execution.executionId}</span>
          <CopyButton value={execution.executionId} label="Execution ID" />
        </div>
      }
      description={workflowName}
    >
      <Link to="/executions">
        <Button variant="ghost" size="sm" className="mb-2">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to executions
        </Button>
      </Link>

      {/* Filter exclusion warnings */}
      {isExcludedByFilters && !temporarilyIgnoreFilters && (
        <Card className="border-warning bg-warning/10 mb-4">
          <CardContent className="flex items-center justify-between py-3">
            <span className="text-sm">
              This execution is excluded by your current filters.
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setTemporarilyIgnoreFilters(true)}
            >
              Ignore filters for this page
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ========== Header Summary ========== */}
      <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="text-muted-foreground">
              <Hash className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Status</p>
              <StatusBadge status={execution.status} size="md" />
            </div>
          </CardContent>
        </Card>

        <InfoCard
          icon={<CheckCircle className="h-5 w-5" />}
          label="Finished"
          value={execution.finished === null ? "—" : execution.finished ? "Yes" : "No"}
          tooltip="Whether the workflow completed or was interrupted"
        />

        <InfoCard
          icon={<Play className="h-5 w-5" />}
          label="Mode"
          value={execution.mode ?? "—"}
          tooltip="How the workflow was triggered (manual, webhook, schedule, etc.)"
        />

        <InfoCard
          icon={<Hash className="h-5 w-5" />}
          label="Nodes Count"
          value={execution.nodesCount?.toString() ?? "—"}
          tooltip="Total number of nodes in this workflow"
        />
      </div>

      <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
        <InfoCard
          icon={<Clock className="h-5 w-5" />}
          label="Started At"
          value={formatDate(execution.startedAt)}
        />

        <InfoCard
          icon={<Clock className="h-5 w-5" />}
          label="Stopped At"
          value={formatDate(execution.stoppedAt)}
        />

        <InfoCard
          icon={<Zap className="h-5 w-5" />}
          label="Duration"
          value={formatDuration(execution.durationMs)}
          tooltip="Total time from start to finish"
        />

        <InfoCard
          icon={<GitBranch className="h-5 w-5" />}
          label="Last Node"
          value={execution.lastNodeExecuted ?? "—"}
          tooltip="The final node that executed before completion or failure"
        />
      </div>

      {/* Workflow ID with copy */}
      <Card>
        <CardContent className="flex items-center gap-3 p-4">
          <GitBranch className="h-5 w-5 text-muted-foreground" />
          <div className="flex-1">
            <p className="text-xs text-muted-foreground">Workflow ID</p>
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm">{execution.workflowId}</span>
              <CopyButton value={execution.workflowId} label="Workflow ID" />
              <Link
                to={`/executions?workflowId=${encodeURIComponent(execution.workflowId)}`}
                className="text-xs text-primary hover:underline"
              >
                View all executions →
              </Link>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ========== Node Runs Section ========== */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-medium">
              Node Runs ({nodes.length})
            </CardTitle>
          </div>
        </CardHeader>

        {/* Quick Filters */}
        <div className="px-6 pb-4 flex flex-wrap items-center gap-6 border-b">
          <div className="flex items-center gap-2">
            <Switch
              id="errors-only"
              checked={errorsOnly}
              onCheckedChange={setErrorsOnly}
            />
            <Label htmlFor="errors-only" className="text-sm cursor-pointer">
              Errors only
            </Label>
          </div>

          <div className="flex items-center gap-2">
            <Switch
              id="slow-only"
              checked={slowOnly}
              onCheckedChange={setSlowOnly}
            />
            <Label htmlFor="slow-only" className="text-sm cursor-pointer">
              Slow nodes
            </Label>
            <Tooltip>
              <TooltipTrigger asChild>
                <HelpCircle className="h-3.5 w-3.5 text-muted-foreground/50 cursor-help" />
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                Show top 20% slowest nodes
              </TooltipContent>
            </Tooltip>
          </div>

          <div className="flex items-center gap-2">
            <Label htmlFor="min-items" className="text-sm whitespace-nowrap">
              Items out ≥
            </Label>
            <Input
              id="min-items"
              type="number"
              placeholder="N"
              className="w-[60px] h-8"
              value={minItemsOut}
              onChange={(e) => setMinItemsOut(e.target.value)}
            />
          </div>

          <div className="ml-auto text-sm text-muted-foreground">
            Showing {filteredGroups.length} of {nodeGroups.length} nodes
          </div>
        </div>

        {/* Table Header */}
        <div className="grid grid-cols-12 gap-2 px-4 py-2 text-xs font-medium text-muted-foreground bg-muted/50 border-b">
          <div className="col-span-3">Node</div>
          <div className="col-span-2">Status</div>
          <div className="col-span-2">Duration</div>
          <div className="col-span-2">Items Out</div>
          <div className="col-span-2">Started</div>
          <div className="col-span-1" />
        </div>

        {/* Node Groups */}
        <CardContent className="p-0">
          {filteredGroups.length === 0 ? (
            <div className="px-6 py-8 text-center text-sm text-muted-foreground">
              {nodes.length === 0
                ? "No node runs recorded for this execution."
                : "No nodes match your filters."}
            </div>
          ) : (
            filteredGroups.map((group) => (
              <NodeGroupRow key={group.nodeName} group={group} />
            ))
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
