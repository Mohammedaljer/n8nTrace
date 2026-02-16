import { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { PageShell } from "@/components/PageShell";
import { GlobalFilterBar } from "@/components/GlobalFilterBar";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { List, ChevronLeft, ChevronRight, HelpCircle } from "lucide-react";
import { useData } from "@/data/DataContext";
import { useFilters } from "@/hooks/useFilters";
import { filterExecutions } from "@/data/selectors/executionSelectors";
import type { Execution } from "@/types/execution";

const PAGE_SIZE = 25;

function formatDate(date: Date | null): string {
  if (!date) return "—";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

interface QuickFilters {
  onlyErrors: boolean;
  slowThresholdMs: number | null;
}

function applyQuickFilters(
  executions: readonly Execution[],
  quickFilters: QuickFilters
): readonly Execution[] {
  let result = executions;

  if (quickFilters.onlyErrors) {
    result = result.filter((e) => e.status === "error" || e.status === "crashed");
  }

  if (quickFilters.slowThresholdMs !== null) {
    result = result.filter(
      (e) => e.durationMs !== null && e.durationMs > quickFilters.slowThresholdMs!
    );
  }

  return result;
}

export default function ExecutionsPage() {
  const navigate = useNavigate();
  const { loadResult, isLoading } = useData();
  const { filters } = useFilters();

  // Quick filters state
  const [onlyErrors, setOnlyErrorsState] = useState(false);
  const [slowThreshold, setSlowThresholdState] = useState("");
  const slowThresholdMs = slowThreshold ? parseInt(slowThreshold, 10) * 1000 : null;

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);

  // Wrapped setters that reset pagination synchronously
  const setOnlyErrors = (value: boolean) => {
    setOnlyErrorsState(value);
    setCurrentPage(1);
  };

  const setSlowThreshold = (value: string) => {
    setSlowThresholdState(value);
    setCurrentPage(1);
  };

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

  // Apply quick filters on top of global filtered results
  const executions = useMemo(() => {
    return applyQuickFilters(globalFiltered, {
      onlyErrors,
      slowThresholdMs,
    });
  }, [globalFiltered, onlyErrors, slowThresholdMs]);

  // Reset to page 1 when global filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [filters.instanceId, filters.workflowId, filters.dateFrom, filters.dateTo, filters.status]);

  // Pagination - ensure currentPage is within bounds
  const totalPages = Math.max(1, Math.ceil(executions.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  
  // Auto-correct page if out of bounds (e.g., after filtering reduces results)
  useEffect(() => {
    if (currentPage > totalPages && totalPages > 0) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const paginatedExecutions = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return executions.slice(start, start + PAGE_SIZE);
  }, [executions, safePage]);

  // Workflow name lookup
  const workflowMap = useMemo(
    () => new Map(loadResult?.workflows.map((w) => [w.workflowId, w.name]) ?? []),
    [loadResult?.workflows]
  );

  const handleRowClick = (exec: Execution) => {
    navigate(`/executions/${exec.executionId}`);
  };

  const handlePrevPage = () => setCurrentPage((p) => Math.max(1, p - 1));
  const handleNextPage = () => setCurrentPage((p) => Math.min(totalPages, p + 1));

  return (
    <PageShell title="Executions" description="Browse all workflow executions.">
      <GlobalFilterBar />

      <div className="flex flex-wrap items-center gap-6 rounded-lg border bg-card p-3">
        <div className="flex items-center gap-2">
          <Switch
            id="only-errors"
            checked={onlyErrors}
            onCheckedChange={setOnlyErrors}
          />
          <Label htmlFor="only-errors" className="text-sm cursor-pointer">
            Only errors
          </Label>
          <Tooltip>
            <TooltipTrigger asChild>
              <HelpCircle className="h-3.5 w-3.5 text-muted-foreground/50 cursor-help" />
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              Show only executions that ended with an error or crash
            </TooltipContent>
          </Tooltip>
        </div>

        <div className="flex items-center gap-2">
          <Label htmlFor="slow-threshold" className="text-sm whitespace-nowrap">
            Slow &gt;
          </Label>
          <Input
            id="slow-threshold"
            type="number"
            placeholder="seconds"
            className="w-[80px] h-8"
            value={slowThreshold}
            onChange={(e) => setSlowThreshold(e.target.value)}
          />
          <span className="text-sm text-muted-foreground">sec</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <HelpCircle className="h-3.5 w-3.5 text-muted-foreground/50 cursor-help" />
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              Show only executions that took longer than this threshold
            </TooltipContent>
          </Tooltip>
        </div>

        <div className="ml-auto text-sm text-muted-foreground">
          {executions.length.toLocaleString()} execution{executions.length !== 1 ? "s" : ""}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : executions.length === 0 ? (
        <EmptyState
          icon={<List className="h-10 w-10" />}
          title="No executions found"
          description={
            onlyErrors || slowThresholdMs
              ? "No executions match your quick filters. Try adjusting them."
              : "Adjust your filters or add CSV data to public/data/."
          }
        />
      ) : (
        <>
          <div className="rounded-lg border bg-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[90px]">Status</TableHead>
                  <TableHead className="w-[130px]">Execution ID</TableHead>
                  <TableHead>Workflow</TableHead>
                  <TableHead className="w-[140px]">Started</TableHead>
                  <TableHead className="w-[100px]">Duration</TableHead>
                  <TableHead className="w-[80px] text-center">Nodes</TableHead>
                  <TableHead className="w-[180px]">Last Node</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedExecutions.map((exec) => (
                  <TableRow
                    key={exec.executionId}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => handleRowClick(exec)}
                  >
                    <TableCell>
                      <StatusBadge status={exec.status} />
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {exec.executionId}
                    </TableCell>
                    <TableCell>
                      <div className="max-w-[200px]">
                        <div className="truncate font-medium">
                          {workflowMap.get(exec.workflowId) ?? exec.workflowId}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(exec.startedAt)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDuration(exec.durationMs)}
                    </TableCell>
                    <TableCell className="text-center text-sm text-muted-foreground">
                      {exec.nodesCount ?? "—"}
                    </TableCell>
                    <TableCell className="max-w-[180px] truncate text-sm text-muted-foreground">
                      {exec.lastNodeExecuted ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                Page {safePage} of {totalPages}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handlePrevPage}
                  disabled={safePage === 1}
                >
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleNextPage}
                  disabled={safePage === totalPages}
                >
                  Next
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </PageShell>
  );
}
