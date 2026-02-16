/**
 * Metrics Time Series Charts - Display metrics over time
 * Uses shadcn chart primitives for consistent styling
 */
import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { HelpCircle, Lock, RefreshCw } from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Area,
  AreaChart,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  DEFAULT_CHART_MARGIN,
  DEFAULT_AXIS_PROPS,
  DEFAULT_GRID_PROPS,
  formatters,
} from "@/components/charts/chartDefaults";
import { useMetrics } from "@/data/MetricsContext";
import { formatBytes, formatCpuRate, formatLatency } from "@/lib/metricsFormat";
import type { MetricsTimeseriesDatapoint } from "@/data/metricsApi";

type ChartType = "memory" | "cpu" | "eventloop" | "fds";

interface ChartConfigDef {
  title: string;
  description: string;
  dataKeys: string[];
  yAxisFormatter?: (value: number) => string;
  domain?: [number | string, number | string];
  chartConfig: ChartConfig;
}

const CHART_CONFIGS: Record<ChartType, ChartConfigDef> = {
  memory: {
    title: "Memory Usage",
    description: "RSS, Heap, and External memory over time",
    dataKeys: ["memoryRssBytes", "heapUsedBytes", "externalMemoryBytes"],
    yAxisFormatter: formatters.bytesShort,
    chartConfig: {
      memoryRssBytes: {
        label: "RSS",
        color: "hsl(var(--primary))",
      },
      heapUsedBytes: {
        label: "Heap",
        color: "hsl(var(--success))",
      },
      externalMemoryBytes: {
        label: "External",
        color: "hsl(var(--muted-foreground))",
      },
    },
  },
  cpu: {
    title: "CPU Rate",
    description: "CPU utilization rate (computed from counter delta)",
    dataKeys: ["cpuRate"],
    yAxisFormatter: (v) => `${(v * 100).toFixed(0)}%`,
    domain: [0, "auto"],
    chartConfig: {
      cpuRate: {
        label: "CPU",
        color: "hsl(var(--success))",
      },
    },
  },
  eventloop: {
    title: "Event Loop Lag (p99)",
    description: "Event loop lag in milliseconds - high values indicate delays",
    dataKeys: ["eventloopLagP99S"],
    yAxisFormatter: (v) => `${(v * 1000).toFixed(0)}ms`,
    domain: [0, "auto"],
    chartConfig: {
      eventloopLagP99S: {
        label: "Lag (p99)",
        color: "hsl(var(--warning))",
      },
    },
  },
  fds: {
    title: "Open File Descriptors",
    description: "Number of open file handles",
    dataKeys: ["openFds"],
    yAxisFormatter: (v) => v.toLocaleString(),
    domain: [0, "auto"],
    chartConfig: {
      openFds: {
        label: "File Descriptors",
        color: "hsl(var(--destructive))",
      },
    },
  },
};

function formatTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

interface MetricsChartProps {
  readonly chartType: ChartType;
  readonly loading?: boolean;
  readonly disabled?: boolean;
}

function MetricsChart({ chartType, loading, disabled }: MetricsChartProps) {
  const { timeseries } = useMetrics();
  const config = CHART_CONFIGS[chartType];

  // Transform data for the chart
  const chartData = useMemo(() => {
    return timeseries.map((point) => ({
      ...point,
      displayTime: formatTime(point.ts),
    }));
  }, [timeseries]);

  if (disabled) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base font-medium">{config.title}</CardTitle>
            <Tooltip>
              <TooltipTrigger asChild>
                <HelpCircle className="h-4 w-4 cursor-help text-muted-foreground/50" />
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[240px] text-xs">
                Full metrics permission required to view this chart
              </TooltipContent>
            </Tooltip>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex h-[200px] flex-col items-center justify-center gap-2 text-center">
            <Lock className="h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">
              Permission required
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">{config.title}</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[200px] w-full" />
        </CardContent>
      </Card>
    );
  }

  const isEmpty = chartData.length === 0;
  const isMultiSeries = config.dataKeys.length > 1;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <CardTitle className="text-base font-medium">{config.title}</CardTitle>
          <Tooltip>
            <TooltipTrigger asChild>
              <HelpCircle className="h-4 w-4 cursor-help text-muted-foreground/50" />
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[240px] text-xs">
              {config.description}
            </TooltipContent>
          </Tooltip>
        </div>
      </CardHeader>
      <CardContent>
        {isEmpty ? (
          <div className="flex h-[200px] flex-col items-center justify-center gap-2 text-center">
            <p className="text-sm text-muted-foreground">
              No data available for selected time range
            </p>
          </div>
        ) : isMultiSeries ? (
          // Multi-series chart (memory) - Area chart
          <ChartContainer config={config.chartConfig} className="h-[200px] w-full">
            <AreaChart
              data={chartData}
              margin={{ ...DEFAULT_CHART_MARGIN, left: 8 }}
              accessibilityLayer
            >
              <CartesianGrid {...DEFAULT_GRID_PROPS} />
              <XAxis
                dataKey="displayTime"
                {...DEFAULT_AXIS_PROPS}
                className="fill-muted-foreground"
                interval="preserveStartEnd"
              />
              <YAxis
                {...DEFAULT_AXIS_PROPS}
                className="fill-muted-foreground"
                tickFormatter={config.yAxisFormatter}
                width={52}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(value) => value}
                    formatter={(value, name) => (
                      <div className="flex items-center justify-between gap-8">
                        <span className="text-muted-foreground">
                          {config.chartConfig[name as string]?.label ?? name}
                        </span>
                        <span className="font-mono font-medium tabular-nums">
                          {formatBytes(value as number)}
                        </span>
                      </div>
                    )}
                  />
                }
              />
              <ChartLegend content={<ChartLegendContent />} />
              <Area
                type="monotone"
                dataKey="memoryRssBytes"
                stroke="var(--color-memoryRssBytes)"
                fill="var(--color-memoryRssBytes)"
                fillOpacity={0.2}
                strokeWidth={2}
              />
              <Area
                type="monotone"
                dataKey="heapUsedBytes"
                stroke="var(--color-heapUsedBytes)"
                fill="var(--color-heapUsedBytes)"
                fillOpacity={0.2}
                strokeWidth={2}
              />
              <Area
                type="monotone"
                dataKey="externalMemoryBytes"
                stroke="var(--color-externalMemoryBytes)"
                fill="var(--color-externalMemoryBytes)"
                fillOpacity={0.2}
                strokeWidth={2}
              />
            </AreaChart>
          </ChartContainer>
        ) : (
          // Single-series chart - Line chart
          <ChartContainer config={config.chartConfig} className="h-[200px] w-full">
            <LineChart
              data={chartData}
              margin={{ ...DEFAULT_CHART_MARGIN, left: 8 }}
              accessibilityLayer
            >
              <CartesianGrid {...DEFAULT_GRID_PROPS} />
              <XAxis
                dataKey="displayTime"
                {...DEFAULT_AXIS_PROPS}
                className="fill-muted-foreground"
                interval="preserveStartEnd"
              />
              <YAxis
                {...DEFAULT_AXIS_PROPS}
                className="fill-muted-foreground"
                tickFormatter={config.yAxisFormatter}
                domain={config.domain}
                width={42}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(value) => value}
                    formatter={(value, name) => {
                      // Format based on chart type
                      let formattedValue: string;
                      if (chartType === "cpu") {
                        formattedValue = formatCpuRate(value as number);
                      } else if (chartType === "eventloop") {
                        formattedValue = formatLatency(value as number);
                      } else {
                        formattedValue = (value as number).toLocaleString();
                      }
                      return (
                        <div className="flex items-center justify-between gap-8">
                          <span className="text-muted-foreground">
                            {config.chartConfig[name as string]?.label ?? name}
                          </span>
                          <span className="font-mono font-medium tabular-nums">
                            {formattedValue}
                          </span>
                        </div>
                      );
                    }}
                  />
                }
              />
              <Line
                type="monotone"
                dataKey={config.dataKeys[0]}
                stroke={`var(--color-${config.dataKeys[0]})`}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 0 }}
              />
            </LineChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

interface MetricsChartsGridProps {
  readonly loading?: boolean;
}

export function MetricsChartsGrid({ loading: externalLoading }: MetricsChartsGridProps) {
  const { timeseriesLoading, permissionLevel, refreshTimeseries } = useMetrics();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const loading = externalLoading || timeseriesLoading;
  const hasFullPermission = permissionLevel === "full";

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refreshTimeseries();
    setIsRefreshing(false);
  };

  return (
    <div className="space-y-4" data-testid="metrics-charts-grid">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">Instance Metrics Over Time</h3>
        {hasFullPermission && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing || loading}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        )}
      </div>
      <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
        <MetricsChart chartType="memory" loading={loading} disabled={!hasFullPermission} />
        <MetricsChart chartType="cpu" loading={loading} disabled={!hasFullPermission} />
        <MetricsChart chartType="eventloop" loading={loading} disabled={!hasFullPermission} />
        <MetricsChart chartType="fds" loading={loading} disabled={!hasFullPermission} />
      </div>
    </div>
  );
}
