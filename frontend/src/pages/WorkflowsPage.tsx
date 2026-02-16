import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { PageShell } from "@/components/PageShell";
import { GlobalFilterBar } from "@/components/GlobalFilterBar";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  GitBranch,
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  HelpCircle,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { useData } from "@/data/DataContext";
import { useFilters } from "@/hooks/useFilters";
import { filterExecutions } from "@/data/selectors/executionSelectors";
import {
  computeWorkflowStats,
  sortWorkflowStats,
  filterWorkflowStats,
  type WorkflowStats,
  type WorkflowStatsSortKey,
  type SortDirection,
} from "@/data/aggregations/workflowAggregations";

function formatDate(date: Date | null): string {
  if (!date) return "—";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(ms: number): string {
  if (ms === 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

// Extended stats type that includes active status from workflow metadata
interface ExtendedWorkflowStats extends WorkflowStats {
  readonly active: boolean;
}

interface ColumnDef {
  key: WorkflowStatsSortKey | "active";
  label: string;
  tooltip: string;
  className?: string;
  align?: "left" | "right" | "center";
}

const columns: ColumnDef[] = [
  {
    key: "workflowName",
    label: "Workflow",
    tooltip: "The name of the workflow. Click any row to see all its executions.",
    className: "min-w-[200px]",
  },
  {
    key: "active",
    label: "Active",
    tooltip: "Whether the workflow is currently active/enabled in n8n.",
    align: "center",
    className: "w-[80px]",
  },
  {
    key: "runs",
    label: "Runs",
    tooltip: "Total number of times this workflow has been executed.",
    align: "right",
    className: "w-[80px]",
  },
  {
    key: "failures",
    label: "Failures",
    tooltip: "Number of executions that ended with an error or crash.",
    align: "right",
    className: "w-[80px]",
  },
  {
    key: "failureRate",
    label: "Failure %",
    tooltip: "Percentage of runs that failed. Lower is better.",
    align: "right",
    className: "w-[90px]",
  },
  {
    key: "p95DurationMs",
    label: "P95 Duration",
    tooltip: "95% of runs completed faster than this time. Helps identify slow workflows.",
    align: "right",
    className: "w-[110px]",
  },
  {
    key: "lastRunAt",
    label: "Last Run",
    tooltip: "When this workflow was most recently executed.",
    className: "w-[140px]",
  },
  {
    key: "lastStatus",
    label: "Last Status",
    tooltip: "The result of the most recent execution.",
    className: "w-[100px]",
  },
];

// Active filter options
type ActiveFilter = "all" | "active" | "inactive";

const activeFilterOptions: { value: ActiveFilter; label: string }[] = [
  { value: "all", label: "All workflows" },
  { value: "active", label: "Active only" },
  { value: "inactive", label: "Inactive only" },
];

interface SortableHeaderProps {
  column: ColumnDef;
  sortKey: WorkflowStatsSortKey | "active";
  sortDirection: SortDirection;
  onSort: (key: WorkflowStatsSortKey | "active") => void;
}

function SortableHeader({
  column,
  sortKey,
  sortDirection,
  onSort,
}: SortableHeaderProps) {
  const isActive = sortKey === column.key;

  return (
    <TableHead
      className={`cursor-pointer select-none hover:bg-muted/50 transition-colors ${column.className ?? ""}`}
      onClick={() => onSort(column.key as WorkflowStatsSortKey)}
    >
      <div
        className={`flex items-center gap-1 ${column.align === "right" ? "justify-end" : column.align === "center" ? "justify-center" : ""}`}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex items-center gap-1">
              {column.label}
              <HelpCircle className="h-3 w-3 text-muted-foreground/50" />
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[200px] text-xs">
            {column.tooltip}
          </TooltipContent>
        </Tooltip>

        {isActive ? (
          sortDirection === "asc" ? (
            <ArrowUp className="h-3 w-3" />
          ) : (
            <ArrowDown className="h-3 w-3" />
          )
        ) : (
          <ArrowUpDown className="h-3 w-3 text-muted-foreground/50" />
        )}
      </div>
    </TableHead>
  );
}

export default function WorkflowsPage() {
  const navigate = useNavigate();
  const { loadResult, isLoading } = useData();
  const { filters } = useFilters();

  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("all");
  const [sortKey, setSortKey] = useState<WorkflowStatsSortKey | "active">("runs");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  // Filter executions based on global filters
  const globalFiltered = useMemo(() => {
    if (!loadResult) return [];
    return filterExecutions(
      loadResult.executions,
      loadResult.workflows,
      loadResult.nodeRuns,
      filters
    );
  }, [loadResult, filters]);

  const filteredExecutions = globalFiltered;

  // Create workflow map (id -> workflow object)
  const workflowMap = useMemo(
    () => new Map(loadResult?.workflows.map((w) => [w.workflowId, w]) ?? []),
    [loadResult?.workflows]
  );

  // Create workflow name map for stats computation
  const workflowNameMap = useMemo(
    () => new Map(loadResult?.workflows.map((w) => [w.workflowId, w.name]) ?? []),
    [loadResult?.workflows]
  );

  // Compute workflow stats and extend with active status
  const allStats = useMemo(() => {
    const baseStats = computeWorkflowStats(filteredExecutions, workflowNameMap);
    return baseStats.map((stat): ExtendedWorkflowStats => {
      const workflow = workflowMap.get(stat.workflowId);
      return {
        ...stat,
        active: workflow?.active ?? false,
      };
    });
  }, [filteredExecutions, workflowNameMap, workflowMap]);

  // Apply active filter
  const activeFiltered = useMemo(() => {
    if (activeFilter === "all") return allStats;
    return allStats.filter((s) => 
      activeFilter === "active" ? s.active : !s.active
    );
  }, [allStats, activeFilter]);

  // Apply local search filter
  const filteredStats = useMemo(
    () => filterWorkflowStats(activeFiltered, search),
    [activeFiltered, search]
  );

  // Apply sorting (including active column)
  const sortedStats = useMemo(() => {
    if (sortKey === "active") {
      const sorted = [...filteredStats].sort((a, b) => {
        if (a.active === b.active) return 0;
        return a.active ? -1 : 1;
      });
      return sortDirection === "desc" ? sorted.reverse() : sorted;
    }
    return sortWorkflowStats(filteredStats, sortKey as WorkflowStatsSortKey, sortDirection);
  }, [filteredStats, sortKey, sortDirection]);

  const handleSort = (key: WorkflowStatsSortKey | "active") => {
    if (sortKey === key) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDirection("desc");
    }
  };

  const handleRowClick = (workflow: ExtendedWorkflowStats) => {
    navigate(`/executions?workflowId=${encodeURIComponent(workflow.workflowId)}`);
  };

  return (
    <PageShell title="Workflows" description="Performance analytics per workflow.">
      <GlobalFilterBar />

      {/* Search and Active filter row */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Quick search workflows…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Active filter - NOT in Advanced */}
        <Select
          value={activeFilter}
          onValueChange={(v) => setActiveFilter(v as ActiveFilter)}
        >
          <SelectTrigger className="w-[160px]" aria-label="Filter by active status">
            <SelectValue placeholder="All workflows" />
          </SelectTrigger>
          <SelectContent className="z-50 bg-popover">
            {activeFilterOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : sortedStats.length === 0 ? (
        <EmptyState
          icon={<GitBranch className="h-10 w-10" />}
          title="No workflows found"
          description={
            search || activeFilter !== "all"
              ? "No workflows match your filters. Try adjusting your search or filter criteria."
              : "Workflow analytics will appear here once data is loaded."
          }
        />
      ) : (
        <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                {columns.map((col) => (
                  <SortableHeader
                    key={col.key}
                    column={col}
                    sortKey={sortKey}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                  />
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedStats.map((stat) => (
                <TableRow
                  key={stat.workflowId}
                  className="cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => handleRowClick(stat)}
                >
                  <TableCell>
                    <div>
                      <div className="font-medium truncate max-w-[280px]">
                        {stat.workflowName}
                      </div>
                      <div className="text-xs text-muted-foreground font-mono truncate max-w-[280px]">
                        {stat.workflowId}
                      </div>
                    </div>
                  </TableCell>

                  {/* Active status badge */}
                  <TableCell className="text-center">
                    {stat.active ? (
                      <Badge variant="default" className="bg-success/10 text-success border-success/20 hover:bg-success/20">
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        Active
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="bg-muted text-muted-foreground">
                        <XCircle className="h-3 w-3 mr-1" />
                        Inactive
                      </Badge>
                    )}
                  </TableCell>

                  <TableCell className="text-right font-medium tabular-nums">
                    {stat.runs.toLocaleString()}
                  </TableCell>

                  <TableCell className="text-right tabular-nums">
                    <span className={stat.failures > 0 ? "text-destructive font-medium" : ""}>
                      {stat.failures.toLocaleString()}
                    </span>
                  </TableCell>

                  <TableCell className="text-right tabular-nums">
                    <span
                      className={
                        stat.failureRate > 10
                          ? "text-destructive font-medium"
                          : stat.failureRate > 5
                            ? "text-warning font-medium"
                            : ""
                      }
                    >
                      {stat.failureRate.toFixed(1)}%
                    </span>
                  </TableCell>

                  <TableCell className="text-right text-muted-foreground tabular-nums">
                    {formatDuration(stat.p95DurationMs)}
                  </TableCell>

                  <TableCell className="text-muted-foreground">
                    {formatDate(stat.lastRunAt)}
                  </TableCell>

                  <TableCell>
                    <StatusBadge status={stat.lastStatus as never} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="border-t px-4 py-3 text-center text-sm text-muted-foreground bg-muted/20">
            {sortedStats.length} workflow{sortedStats.length !== 1 ? "s" : ""}
            {activeFilter !== "all" && (
              <span className="ml-1">
                ({activeFilter === "active" ? "active" : "inactive"} only)
              </span>
            )}
          </div>
        </div>
      )}
    </PageShell>
  );
}
