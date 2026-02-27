import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { HelpCircle } from "lucide-react";
import {
  BarChart,
  Bar,
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
import type { DailyExecutionData } from "@/data/aggregations/timeSeriesAggregations";

interface ExecutionsTimeSeriesChartProps {
  readonly data: readonly DailyExecutionData[] | null;
  readonly loading?: boolean;
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

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function ExecutionsTimeSeriesChart({ data, loading }: ExecutionsTimeSeriesChartProps) {
  const chartData = useMemo(() => {
    if (!data) return [];
    return data.map((d) => ({
      ...d,
      dateLabel: formatDate(d.date),
    }));
  }, [data]);

  const isEmpty = !loading && chartData.length === 0;

  return (
    <Card className="col-span-full lg:col-span-2">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <CardTitle className="text-base font-medium">Executions Over Time</CardTitle>
          <Tooltip>
            <TooltipTrigger asChild>
              <HelpCircle className="h-4 w-4 text-muted-foreground/50 cursor-help" />
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[220px] text-xs">
              Daily breakdown of workflow runs. Green bars show successful runs, red bars show failures.
            </TooltipContent>
          </Tooltip>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[280px] w-full" />
        ) : isEmpty ? (
          <div className="flex h-[280px] items-center justify-center text-sm text-muted-foreground">
            No executions in this time range
          </div>
        ) : (
          <ChartContainer config={chartConfig} className="h-[280px] w-full">
            <BarChart
              data={chartData}
              margin={DEFAULT_CHART_MARGIN}
              accessibilityLayer
            >
              <CartesianGrid {...DEFAULT_GRID_PROPS} />
              <XAxis
                dataKey="dateLabel"
                {...DEFAULT_AXIS_PROPS}
                className="fill-muted-foreground"
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
                stackId="a"
                fill="var(--color-success)"
                radius={[0, 0, 0, 0]}
              />
              <Bar
                dataKey="error"
                stackId="a"
                fill="var(--color-error)"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
