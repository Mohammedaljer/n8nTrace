import { useMemo } from "react";
import type { WidgetSize } from "@/components/dashboard/widgetRegistry";
import type { NodePerformance } from "@/data/aggregations/kpiAggregations";
import type { Execution, Workflow } from "@/types/execution";

// Re-export original components with size-aware wrappers

export { KpiCards } from "./KpiCards";

// Re-export the new ExecutionsOverTime chart
export { ExecutionsOverTime } from "./ExecutionsOverTime";

// Size-aware wrapper for SlowNodesChart
import { SlowNodesChart as OriginalSlowNodesChart } from "./SlowNodesChart";

interface SlowNodesChartWrapperProps {
  data: readonly NodePerformance[] | null;
  loading?: boolean;
  size?: WidgetSize;
}

export function SlowNodesChart({ data, loading }: SlowNodesChartWrapperProps) {
  return <OriginalSlowNodesChart data={data} loading={loading} />;
}

// Size-aware wrapper for FailedExecutionsTable
import { FailedExecutionsTable as OriginalFailedExecutionsTable } from "./FailedExecutionsTable";

interface FailedExecutionsTableWrapperProps {
  executions: readonly Execution[] | null;
  workflows: readonly Workflow[];
  loading?: boolean;
  size?: WidgetSize;
}

export function FailedExecutionsTable({ executions, workflows, loading, size }: FailedExecutionsTableWrapperProps) {
  // Limit rows based on size
  const limitedExecutions = useMemo(() => {
    if (!executions) return null;
    const limit = size === "small" ? 5 : size === "large" ? 15 : 10;
    return executions.slice(0, limit);
  }, [executions, size]);

  return <OriginalFailedExecutionsTable executions={limitedExecutions} workflows={workflows} loading={loading} />;
}

// Metrics widgets
export { MetricsSection } from "./MetricsSection";
export { MetricsKpiCards } from "./MetricsKpiCards";
export { MetricsChartsGrid } from "./MetricsCharts";
export { MetricsInstanceSelect } from "./MetricsInstanceSelect";
