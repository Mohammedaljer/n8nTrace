import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/StatusBadge";
import { HelpCircle, ExternalLink, ChevronLeft, ChevronRight } from "lucide-react";
import type { Execution, Workflow } from "@/types/execution";

interface FailedExecutionsTableProps {
  readonly executions: readonly Execution[] | null;
  readonly workflows: readonly Workflow[];
  readonly loading?: boolean;
  readonly pageSize?: number;
}

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

export function FailedExecutionsTable({
  executions,
  workflows,
  loading,
  pageSize = 20,
}: FailedExecutionsTableProps) {
  const workflowMap = new Map(workflows.map((w) => [w.workflowId, w.name]));
  const [currentPage, setCurrentPage] = useState(1);

  const isEmpty = !loading && (!executions || executions.length === 0);
  const totalItems = executions?.length ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  
  // Ensure current page is within bounds
  const safePage = Math.min(currentPage, totalPages);
  
  // Paginated data
  const paginatedExecutions = useMemo(() => {
    if (!executions) return [];
    const start = (safePage - 1) * pageSize;
    return executions.slice(start, start + pageSize);
  }, [executions, safePage, pageSize]);

  const handlePrevPage = () => setCurrentPage((p) => Math.max(1, p - 1));
  const handleNextPage = () => setCurrentPage((p) => Math.min(totalPages, p + 1));

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <CardTitle className="text-base font-medium">Recent Failures</CardTitle>
          <Tooltip>
            <TooltipTrigger asChild>
              <HelpCircle className="h-4 w-4 text-muted-foreground/50 cursor-help" />
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[220px] text-xs">
              Most recent workflow executions that ended with an error. Click a row to see detailed node-level information.
            </TooltipContent>
          </Tooltip>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : isEmpty ? (
          <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
            No failures in this time range 🎉
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Workflow</TableHead>
                  <TableHead className="w-[100px]">Status</TableHead>
                  <TableHead className="w-[130px]">When</TableHead>
                  <TableHead className="w-[90px]">Duration</TableHead>
                  <TableHead className="w-[140px]">Last Node</TableHead>
                  <TableHead className="w-[40px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedExecutions.map((exec) => (
                  <TableRow
                    key={exec.executionId}
                    className="cursor-pointer hover:bg-muted/50"
                  >
                    <TableCell className="max-w-[160px] truncate font-medium">
                      {workflowMap.get(exec.workflowId) ?? exec.workflowId}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={exec.status} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(exec.startedAt)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDuration(exec.durationMs)}
                    </TableCell>
                    <TableCell className="max-w-[140px] truncate text-sm text-muted-foreground">
                      {exec.lastNodeExecuted ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Link
                        to={`/executions/${exec.executionId}`}
                        className="text-primary hover:text-primary/80"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ExternalLink className="h-4 w-4" />
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            
            {/* Pagination controls */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t">
                <div className="text-xs text-muted-foreground">
                  {((safePage - 1) * pageSize) + 1}–{Math.min(safePage * pageSize, totalItems)} of {totalItems}
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handlePrevPage}
                    disabled={safePage === 1}
                    className="h-7 px-2"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-xs text-muted-foreground px-2">
                    {safePage} / {totalPages}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleNextPage}
                    disabled={safePage === totalPages}
                    className="h-7 px-2"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
