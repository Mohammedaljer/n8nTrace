import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { BarChart3, HelpCircle, LineChart } from "lucide-react";
import {
  BarChart,
  Bar,
  LineChart as RechartsLineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
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
  DEFAULT_CHART_HEIGHT,
  DEFAULT_CHART_MARGIN,
  DEFAULT_AXIS_PROPS,
  DEFAULT_GRID_PROPS,
} from "@/components/charts/chartDefaults";
import type { Execution } from "@/types/execution";
import {
  aggregateExecutionsByTimeBucket,
  getGranularityLabel,
  type TimeBucketData,
  type BucketGranularity,
} from "@/data/aggregations/timeSeries";

type ChartMode = "bar" | "line";

interface ExecutionsOverTimeProps {
  readonly executions: readonly Execution[];
  readonly dateFrom?: string;
  readonly dateTo?: string;
  readonly loading?: boolean;
}

interface ChartDataPoint extends TimeBucketData {
  readonly displayLabel: string;
}

/**
 * Chart configuration for shadcn chart primitives
 */
const chartConfig = {
  success: {
    label: "Success",
    color: "hsl(var(--success))",
  },
  error: {
    label: "Errors",
    color: "hsl(var(--destructive))",
  },
} satisfies ChartConfig;

/**
 * Shorten labels for cramped displays
 */
function shortenLabel(label: string, granularity: BucketGranularity, dataLength: number): string {
  // For many data points, shorten labels
  if (granularity === "hour" && dataLength > 12) {
    // Show just time for hourly
    const match = label.match(/(\d{2}:\d{2})$/);
    return match ? match[1] : label;
  }
  if (granularity === "day" && dataLength > 14) {
    // Abbreviate further for many days
    return label.replace(/^([A-Z][a-z]{2}) (\d+).*/, "$1 $2");
  }
  return label;
}

export function ExecutionsOverTime({
  executions,
  dateFrom,
  dateTo,
  loading,
}: ExecutionsOverTimeProps) {
  const [chartMode, setChartMode] = useState<ChartMode>("bar");

  // Aggregate data with adaptive bucketing
  const { chartData, granularity } = useMemo(() => {
    if (!executions.length) {
      return { chartData: [], granularity: "day" as BucketGranularity };
    }

    const fromDate = dateFrom ? new Date(dateFrom) : undefined;
    const toDate = dateTo ? new Date(dateTo) : undefined;

    const result = aggregateExecutionsByTimeBucket(executions, fromDate, toDate);

    const data: ChartDataPoint[] = result.buckets.map((bucket) => ({
      ...bucket,
      displayLabel: shortenLabel(bucket.bucketLabel, result.granularity, result.buckets.length),
    }));

    return {
      chartData: data,
      granularity: result.granularity,
    };
  }, [executions, dateFrom, dateTo]);

  const isEmpty = !loading && chartData.length === 0;
  const granularityLabel = getGranularityLabel(granularity);

  return (
    <Card className="col-span-full lg:col-span-2">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base font-medium">
              Executions Over Time
            </CardTitle>
            <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {granularityLabel}
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <HelpCircle className="h-4 w-4 cursor-help text-muted-foreground/50" />
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[240px] text-xs">
                {granularityLabel} breakdown of workflow runs. Auto-adjusts
                granularity based on selected date range.
              </TooltipContent>
            </Tooltip>
          </div>

          {/* Chart mode toggle */}
          <div
            className="flex items-center rounded-md border"
            role="group"
            aria-label="Chart type"
          >
            <Button
              variant={chartMode === "bar" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 rounded-r-none px-2"
              onClick={() => setChartMode("bar")}
              aria-pressed={chartMode === "bar"}
              aria-label="Stacked bar chart"
            >
              <BarChart3 className="h-4 w-4" />
            </Button>
            <Button
              variant={chartMode === "line" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 rounded-l-none px-2"
              onClick={() => setChartMode("line")}
              aria-pressed={chartMode === "line"}
              aria-label="Line chart"
            >
              <LineChart className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[280px] w-full" />
        ) : isEmpty ? (
          <div className="flex h-[280px] flex-col items-center justify-center gap-2 text-center">
            <BarChart3 className="h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">
              No executions in selected time range
            </p>
          </div>
        ) : chartMode === "bar" ? (
          <ChartContainer config={chartConfig} className="h-[280px] w-full">
            <BarChart
              data={chartData}
              margin={DEFAULT_CHART_MARGIN}
              accessibilityLayer
            >
              <CartesianGrid {...DEFAULT_GRID_PROPS} />
              <XAxis
                dataKey="displayLabel"
                {...DEFAULT_AXIS_PROPS}
                className="fill-muted-foreground"
                interval="preserveStartEnd"
              />
              <YAxis
                {...DEFAULT_AXIS_PROPS}
                className="fill-muted-foreground"
                allowDecimals={false}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(value) => value}
                    formatter={(value, name) => (
                      <div className="flex items-center justify-between gap-8">
                        <span className="text-muted-foreground">{chartConfig[name as keyof typeof chartConfig]?.label ?? name}</span>
                        <span className="font-mono font-medium tabular-nums">{value as number}</span>
                      </div>
                    )}
                  />
                }
              />
              <ChartLegend content={<ChartLegendContent />} />
              <Bar
                dataKey="success"
                stackId="executions"
                fill="var(--color-success)"
                radius={[0, 0, 0, 0]}
              />
              <Bar
                dataKey="error"
                stackId="executions"
                fill="var(--color-error)"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ChartContainer>
        ) : (
          <ChartContainer config={chartConfig} className="h-[280px] w-full">
            <RechartsLineChart
              data={chartData}
              margin={DEFAULT_CHART_MARGIN}
              accessibilityLayer
            >
              <CartesianGrid {...DEFAULT_GRID_PROPS} />
              <XAxis
                dataKey="displayLabel"
                {...DEFAULT_AXIS_PROPS}
                className="fill-muted-foreground"
                interval="preserveStartEnd"
              />
              <YAxis
                {...DEFAULT_AXIS_PROPS}
                className="fill-muted-foreground"
                allowDecimals={false}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(value) => value}
                    formatter={(value, name) => (
                      <div className="flex items-center justify-between gap-8">
                        <span className="text-muted-foreground">{chartConfig[name as keyof typeof chartConfig]?.label ?? name}</span>
                        <span className="font-mono font-medium tabular-nums">{value as number}</span>
                      </div>
                    )}
                  />
                }
              />
              <ChartLegend content={<ChartLegendContent />} />
              <Line
                type="monotone"
                dataKey="success"
                stroke="var(--color-success)"
                strokeWidth={2}
                dot={{ fill: "var(--color-success)", strokeWidth: 0, r: 3 }}
                activeDot={{ r: 5, strokeWidth: 0 }}
              />
              <Line
                type="monotone"
                dataKey="error"
                stroke="var(--color-error)"
                strokeWidth={2}
                dot={{ fill: "var(--color-error)", strokeWidth: 0, r: 3 }}
                activeDot={{ r: 5, strokeWidth: 0 }}
              />
            </RechartsLineChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
