/**
 * Metrics KPI Cards - Display key instance health metrics
 */
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Server,
  Cpu,
  MemoryStick,
  Timer,
  FileStack,
  Activity,
  HelpCircle,
  Lock,
} from "lucide-react";
import { useMetrics } from "@/data/MetricsContext";
import {
  formatBytes,
  formatCpuRate,
  formatLatency,
  formatNumber,
  formatUptime,
  formatTimeAgo,
} from "@/lib/metricsFormat";

interface MetricCardProps {
  readonly title: string;
  readonly value: string;
  readonly icon: React.ReactNode;
  readonly tooltip: string;
  readonly loading?: boolean;
  readonly disabled?: boolean;
  readonly variant?: "default" | "warning" | "success";
}

function MetricCard({
  title,
  value,
  icon,
  tooltip,
  loading,
  disabled,
  variant = "default",
}: MetricCardProps) {
  const iconColorClass = disabled
    ? "text-muted-foreground/30"
    : variant === "warning"
    ? "text-amber-500"
    : variant === "success"
    ? "text-emerald-500"
    : "text-muted-foreground";

  return (
    <Card className={`relative overflow-hidden ${disabled ? "opacity-50" : ""}`}>
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
                  {disabled ? "No permission to view this metric" : tooltip}
                </TooltipContent>
              </Tooltip>
            </div>
            {loading ? (
              <Skeleton className="h-8 w-20" />
            ) : disabled ? (
              <div className="flex items-center gap-1 text-muted-foreground">
                <Lock className="h-4 w-4" />
                <span className="text-sm">Restricted</span>
              </div>
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

interface MetricsKpiCardsProps {
  readonly loading?: boolean;
}

export function MetricsKpiCards({ loading: externalLoading }: MetricsKpiCardsProps) {
  const {
    latestMetrics,
    latestLoading,
    permissionLevel,
    workflowsStatus,
    workflowsLoading,
    timeseries,
    timeseriesLoading,
  } = useMetrics();

  const loading = externalLoading || latestLoading;
  const hasFullPermission = permissionLevel === "full";

  // Compute CPU rate from latest timeseries point
  const latestCpuRate = timeseries.length > 0 ? timeseries[timeseries.length - 1].cpuRate : null;

  return (
    <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-5" data-testid="metrics-kpi-cards">
      {/* n8n Version - always visible with any metrics permission */}
      <MetricCard
        title="n8n Version"
        value={latestMetrics?.n8n_version || "—"}
        icon={<Server className="h-5 w-5" />}
        tooltip="Currently running n8n version"
        loading={loading}
      />

      {/* Active Workflows */}
      <MetricCard
        title="Active Workflows"
        value={formatNumber(workflowsStatus?.active)}
        icon={<Activity className="h-5 w-5" />}
        tooltip="Number of active workflows on this instance"
        loading={workflowsLoading}
        variant={workflowsStatus && workflowsStatus.active > 0 ? "success" : "default"}
      />

      {/* RAM (RSS) - requires full permission */}
      <MetricCard
        title="RAM (RSS)"
        value={formatBytes(latestMetrics?.memory_rss_bytes)}
        icon={<MemoryStick className="h-5 w-5" />}
        tooltip="Resident Set Size - total memory allocated to the process"
        loading={loading}
        disabled={!hasFullPermission}
        variant={
          latestMetrics?.memory_rss_bytes && latestMetrics.memory_rss_bytes > 1024 * 1024 * 1024
            ? "warning"
            : "default"
        }
      />

      {/* CPU Rate - requires full permission */}
      <MetricCard
        title="CPU Rate"
        value={formatCpuRate(latestCpuRate)}
        icon={<Cpu className="h-5 w-5" />}
        tooltip="Current CPU utilization rate (computed from counter delta)"
        loading={timeseriesLoading}
        disabled={!hasFullPermission}
        variant={latestCpuRate && latestCpuRate > 0.8 ? "warning" : "default"}
      />

      {/* Event Loop Lag - requires full permission */}
      <MetricCard
        title="Event Loop Lag"
        value={formatLatency(latestMetrics?.eventloop_lag_p99_s)}
        icon={<Timer className="h-5 w-5" />}
        tooltip="Event loop lag p99 - high values indicate processing delays"
        loading={loading}
        disabled={!hasFullPermission}
        variant={
          latestMetrics?.eventloop_lag_p99_s && latestMetrics.eventloop_lag_p99_s > 0.1
            ? "warning"
            : "default"
        }
      />

      {/* Open File Descriptors - requires full permission */}
      <MetricCard
        title="Open FDs"
        value={formatNumber(latestMetrics?.open_fds)}
        icon={<FileStack className="h-5 w-5" />}
        tooltip="Number of open file descriptors"
        loading={loading}
        disabled={!hasFullPermission}
        variant={
          latestMetrics?.open_fds && latestMetrics.open_fds > 1000 ? "warning" : "default"
        }
      />

      {/* Uptime */}
      <MetricCard
        title="Uptime"
        value={formatUptime(latestMetrics?.process_start_time_seconds)}
        icon={<Timer className="h-5 w-5" />}
        tooltip="Time since the n8n process started"
        loading={loading}
        disabled={!hasFullPermission}
      />

      {/* Last Updated */}
      <MetricCard
        title="Last Updated"
        value={formatTimeAgo(latestMetrics?.ts)}
        icon={<Activity className="h-5 w-5" />}
        tooltip="When the last metrics snapshot was recorded"
        loading={loading}
      />
    </div>
  );
}
