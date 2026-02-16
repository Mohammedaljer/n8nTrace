import { useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { HelpCircle, ExternalLink, Zap } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Cell,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  DEFAULT_AXIS_PROPS,
  HORIZONTAL_CHART_MARGIN,
  formatters,
} from "@/components/charts/chartDefaults";
import type { NodePerformance } from "@/data/aggregations/kpiAggregations";

interface SlowNodesChartProps {
  readonly data: readonly NodePerformance[] | null;
  readonly loading?: boolean;
  readonly instanceId?: string;
  readonly dateFrom?: string;
  readonly dateTo?: string;
}

function truncateName(name: string, maxLen: number = 18): string {
  if (name.length <= maxLen) return name;
  return name.slice(0, maxLen - 1) + "…";
}

/**
 * Build URL search params for navigating to executions page
 */
function buildExecutionsUrl(
  node: NodePerformance,
  instanceId?: string,
  dateFrom?: string,
  dateTo?: string
): string {
  const params = new URLSearchParams();
  
  if (instanceId) params.set("instanceId", instanceId);
  if (dateFrom) params.set("dateFrom", dateFrom);
  if (dateTo) params.set("dateTo", dateTo);
  
  // Filter by node name
  params.set("nodeNameContains", node.nodeName);
  
  return `/executions?${params.toString()}`;
}

interface ChartDataPoint extends NodePerformance {
  displayName: string;
  p95Seconds: number;
}

/**
 * Chart configuration for shadcn chart primitives
 */
const chartConfig = {
  p95Seconds: {
    label: "P95 Duration",
    color: "hsl(var(--warning))",
  },
} satisfies ChartConfig;

export function SlowNodesChart({
  data,
  loading,
  instanceId,
  dateFrom,
  dateTo,
}: SlowNodesChartProps) {
  const navigate = useNavigate();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const chartData = useMemo((): ChartDataPoint[] => {
    if (!data) return [];
    return data.map((d) => ({
      ...d,
      displayName: truncateName(d.nodeName),
      p95Seconds: d.p95TimeMs / 1000,
    }));
  }, [data]);

  const isEmpty = !loading && chartData.length === 0;

  // Color gradient from warning to destructive based on position
  const getBarColor = useCallback(
    (index: number, isHovered: boolean): string => {
      const ratio = index / Math.max(chartData.length - 1, 1);
      const baseColor = ratio < 0.3 ? "hsl(var(--destructive))" : "hsl(var(--warning))";
      if (isHovered) {
        return ratio < 0.3 ? "hsl(var(--destructive) / 0.8)" : "hsl(var(--warning) / 0.8)";
      }
      return baseColor;
    },
    [chartData.length]
  );

  const handleBarClick = useCallback(
    (node: NodePerformance) => {
      const url = buildExecutionsUrl(node, instanceId, dateFrom, dateTo);
      navigate(url);
    },
    [navigate, instanceId, dateFrom, dateTo]
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <CardTitle className="text-base font-medium">Slowest Nodes (P95)</CardTitle>
          <Tooltip>
            <TooltipTrigger asChild>
              <HelpCircle className="h-4 w-4 cursor-help text-muted-foreground/50" />
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[240px] text-xs">
              Top 10 slowest nodes ranked by 95th percentile execution time. 
              Click a bar to see executions containing that node.
            </TooltipContent>
          </Tooltip>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[280px] w-full" />
        ) : isEmpty ? (
          <div className="flex h-[280px] flex-col items-center justify-center gap-2 text-center">
            <Zap className="h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">
              No node performance data available
            </p>
          </div>
        ) : (
          <ChartContainer config={chartConfig} className="h-[280px] w-full">
            <BarChart
              data={chartData}
              layout="vertical"
              margin={HORIZONTAL_CHART_MARGIN}
              onMouseLeave={() => setActiveIndex(null)}
              accessibilityLayer
            >
              <CartesianGrid 
                strokeDasharray="3 3" 
                className="stroke-border/50" 
                horizontal={false} 
              />
              <XAxis
                type="number"
                {...DEFAULT_AXIS_PROPS}
                tickFormatter={(v: number) => formatters.seconds(v)}
                className="fill-muted-foreground"
              />
              <YAxis
                type="category"
                dataKey="displayName"
                {...DEFAULT_AXIS_PROPS}
                width={100}
                className="fill-muted-foreground"
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    hideLabel
                    formatter={(value, _name, item) => {
                      const dataPoint = item.payload as ChartDataPoint;
                      return (
                        <div className="space-y-1.5">
                          <div className="font-medium">{dataPoint.nodeName}</div>
                          <div className="text-xs text-muted-foreground">{dataPoint.nodeType}</div>
                          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs pt-1 border-t">
                            <div>
                              <span className="text-muted-foreground">P95:</span>{" "}
                              <span className="font-mono font-medium">{formatters.duration(dataPoint.p95TimeMs)}</span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Median:</span>{" "}
                              <span className="font-mono font-medium">{formatters.duration(dataPoint.medianTimeMs)}</span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Avg:</span>{" "}
                              <span className="font-mono font-medium">{formatters.duration(dataPoint.avgTimeMs)}</span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Runs:</span>{" "}
                              <span className="font-mono font-medium">{dataPoint.executionCount.toLocaleString()}</span>
                            </div>
                          </div>
                        </div>
                      );
                    }}
                  />
                }
              />
              <Bar
                dataKey="p95Seconds"
                radius={[0, 4, 4, 0]}
                cursor="pointer"
                onClick={(data: ChartDataPoint) => handleBarClick(data)}
                onMouseEnter={(_, index) => setActiveIndex(index)}
              >
                {chartData.map((entry, index) => (
                  <Cell
                    key={`cell-${entry.nodeName}`}
                    fill={getBarColor(index, activeIndex === index)}
                  />
                ))}
              </Bar>
            </BarChart>
          </ChartContainer>
        )}

        {/* Interactive list below chart for detailed tooltips */}
        {!loading && !isEmpty && (
          <div className="mt-4 space-y-1 border-t pt-4">
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              Click a node to view related executions
            </p>
            <div className="max-h-[200px] space-y-1 overflow-y-auto">
              {chartData.slice(0, 5).map((node, index) => (
                <NodeRow
                  key={`${node.nodeName}-${node.nodeType}`}
                  node={node}
                  index={index}
                  instanceId={instanceId}
                  dateFrom={dateFrom}
                  dateTo={dateTo}
                  onNavigate={handleBarClick}
                />
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface NodeRowProps {
  node: ChartDataPoint;
  index: number;
  instanceId?: string;
  dateFrom?: string;
  dateTo?: string;
  onNavigate: (node: NodePerformance) => void;
}

function NodeRow({ node, index, instanceId, dateFrom, dateTo, onNavigate }: NodeRowProps) {
  const execUrl = buildExecutionsUrl(node, instanceId, dateFrom, dateTo);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={() => onNavigate(node)}
          className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="flex items-center gap-2 overflow-hidden">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
              {index + 1}
            </span>
            <span className="truncate font-medium">{node.nodeName}</span>
          </div>
          <span className="shrink-0 text-xs text-muted-foreground">
            {formatters.duration(node.p95TimeMs)}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-[280px]">
        <div className="space-y-2">
          <div>
            <p className="font-semibold">{node.nodeName}</p>
            <p className="text-xs text-muted-foreground">{node.nodeType}</p>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <div>
              <span className="text-muted-foreground">P95:</span>{" "}
              <span className="font-medium">{formatters.duration(node.p95TimeMs)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Median:</span>{" "}
              <span className="font-medium">{formatters.duration(node.medianTimeMs)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Average:</span>{" "}
              <span className="font-medium">{formatters.duration(node.avgTimeMs)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Runs:</span>{" "}
              <span className="font-medium">{node.executionCount.toLocaleString()}</span>
            </div>
          </div>
          <a
            href={execUrl}
            onClick={(e) => {
              e.stopPropagation();
              onNavigate(node);
            }}
            className="flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <ExternalLink className="h-3 w-3" />
            View example executions
          </a>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
