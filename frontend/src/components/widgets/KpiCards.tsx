import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Activity, AlertTriangle, Percent, Clock, Gauge, HelpCircle } from "lucide-react";
import type { DashboardKpiData } from "@/data/aggregations/kpiAggregations";

interface KpiCardProps {
  readonly title: string;
  readonly value: string;
  readonly icon: React.ReactNode;
  readonly tooltip: string;
  readonly loading?: boolean;
  readonly variant?: "default" | "destructive" | "success";
}

function KpiCard({ title, value, icon, tooltip, loading, variant = "default" }: KpiCardProps) {
  const iconColorClass =
    variant === "destructive"
      ? "text-destructive"
      : variant === "success"
      ? "text-success"
      : "text-muted-foreground";

  return (
    <Card className="relative overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {title}
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <HelpCircle className="h-3 w-3 text-muted-foreground/50 cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[200px] text-xs">
                  {tooltip}
                </TooltipContent>
              </Tooltip>
            </div>
            {loading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <p className="text-2xl font-bold tracking-tight">{value}</p>
            )}
          </div>
          <div className={iconColorClass}>{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function formatDuration(ms: number): string {
  if (ms === 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

interface KpiCardsProps {
  readonly data: DashboardKpiData | null;
  readonly loading?: boolean;
}

export function KpiCards({ data, loading }: KpiCardsProps) {
  const kpis = data ?? {
    totalExecutions: 0,
    failures: 0,
    failureRate: 0,
    medianDurationMs: 0,
    p95DurationMs: 0,
  };

  return (
    <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
      <KpiCard
        title="Total Runs"
        value={kpis.totalExecutions.toLocaleString()}
        icon={<Activity className="h-5 w-5" />}
        tooltip="Total number of workflow executions in the selected time range"
        loading={loading}
      />
      <KpiCard
        title="Failures"
        value={kpis.failures.toLocaleString()}
        icon={<AlertTriangle className="h-5 w-5" />}
        tooltip="Number of executions that ended with an error or crash"
        loading={loading}
        variant={kpis.failures > 0 ? "destructive" : "default"}
      />
      <KpiCard
        title="Failure Rate"
        value={`${kpis.failureRate}%`}
        icon={<Percent className="h-5 w-5" />}
        tooltip="Percentage of executions that failed out of total runs"
        loading={loading}
        variant={kpis.failureRate > 10 ? "destructive" : "default"}
      />
      <KpiCard
        title="Median Duration"
        value={formatDuration(kpis.medianDurationMs)}
        icon={<Clock className="h-5 w-5" />}
        tooltip="The middle value of all execution durations — half took less, half took more"
        loading={loading}
      />
      <KpiCard
        title="P95 Duration"
        value={formatDuration(kpis.p95DurationMs)}
        icon={<Gauge className="h-5 w-5" />}
        tooltip="95% of executions completed faster than this. Useful for identifying slow outliers"
        loading={loading}
      />
    </div>
  );
}
