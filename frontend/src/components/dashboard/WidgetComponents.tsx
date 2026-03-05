import { useMemo, createContext, useContext, type ReactNode } from "react";
import type { WidgetDefinition, WidgetSize } from "./widgetRegistry";
import type { DashboardKpiData, NodePerformance } from "@/data/aggregations/kpiAggregations";
import type { Execution, Workflow } from "@/types/execution";

// Context to pass data to widgets without prop drilling
interface WidgetDataContextValue {
  kpis: DashboardKpiData | null;
  filteredExecutions: readonly Execution[];
  slowNodes: readonly NodePerformance[];
  failedExecutions: readonly Execution[];
  workflows: readonly Workflow[];
  instanceId?: string;
  dateFrom?: string;
  dateTo?: string;
  isLoading: boolean;
}

const WidgetDataContext = createContext<WidgetDataContextValue | null>(null);

export function WidgetDataProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: WidgetDataContextValue;
}) {
  return (
    <WidgetDataContext.Provider value={value}>
      {children}
    </WidgetDataContext.Provider>
  );
}

export function useWidgetData(): WidgetDataContextValue {
  const context = useContext(WidgetDataContext);
  if (!context) {
    throw new Error("useWidgetData must be used within a WidgetDataProvider");
  }
  return context;
}

// Import the actual widget components
import { KpiCards } from "@/components/widgets/KpiCards";
import { ExecutionsOverTime } from "@/components/widgets/ExecutionsOverTime";
import { SlowNodesChart } from "@/components/widgets/SlowNodesChart";
import { FailedExecutionsTable } from "@/components/widgets/FailedExecutionsTable";
import { MetricsKpiCards } from "@/components/widgets/MetricsKpiCards";
import { MetricsChartsGrid } from "@/components/widgets/MetricsCharts";
import { MetricsExplorer } from "@/components/widgets/MetricsExplorer";
import { useMetrics } from "@/data/MetricsContext";
import { Activity, Info } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

/** Shared placeholder shown when no single instance is selected */
function SelectInstancePrompt({ title }: { title: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
          <Info className="h-10 w-10 text-muted-foreground/30" />
          <div>
            <p className="text-sm font-medium">Select a single instance to view {title.toLowerCase()}</p>
            <p className="text-sm text-muted-foreground">
              Use the Instance dropdown above to choose an instance
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Widget wrapper components that consume context
function KpiCardsWidget(_props: { size: WidgetSize }) {
  const { kpis, isLoading } = useWidgetData();
  return <KpiCards data={kpis} loading={isLoading} />;
}

function TimeSeriesWidget(_props: { size: WidgetSize }) {
  const { filteredExecutions, dateFrom, dateTo, isLoading } = useWidgetData();
  return (
    <ExecutionsOverTime
      executions={filteredExecutions}
      dateFrom={dateFrom}
      dateTo={dateTo}
      loading={isLoading}
    />
  );
}

function SlowNodesWidget(_props: { size: WidgetSize }) {
  const { slowNodes, instanceId, dateFrom, dateTo, isLoading } = useWidgetData();
  return (
    <SlowNodesChart
      data={slowNodes}
      loading={isLoading}
      instanceId={instanceId}
      dateFrom={dateFrom}
      dateTo={dateTo}
    />
  );
}

function FailedExecutionsWidget({ size }: { size: WidgetSize }) {
  const { failedExecutions, workflows, isLoading } = useWidgetData();
  
  // Page size based on widget size
  const pageSize = size === "small" ? 10 : size === "large" ? 20 : 15;
  
  return (
    <FailedExecutionsTable
      executions={failedExecutions}
      workflows={workflows}
      loading={isLoading}
      pageSize={pageSize}
    />
  );
}

// Metrics widget wrappers - these use the MetricsProvider from MetricsSection
function InstanceMetricsWidget(_props: { size: WidgetSize }) {
  const { selectedInstanceId } = useMetrics();

  // No specific instance selected — prompt instead of showing "Restricted"
  if (!selectedInstanceId || selectedInstanceId === 'all') {
    return <SelectInstancePrompt title="metrics" />;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Activity className="h-5 w-5" />
          Instance Metrics
          <span className="text-sm font-normal text-muted-foreground">
            ({selectedInstanceId})
          </span>
        </h3>
      </div>
      <MetricsKpiCards loading={false} />
    </div>
  );
}

function InstanceMetricsChartsWidget(_props: { size: WidgetSize }) {
  const { selectedInstanceId } = useMetrics();

  if (!selectedInstanceId || selectedInstanceId === 'all') {
    return <SelectInstancePrompt title="instance metrics over time" />;
  }

  return <MetricsChartsGrid loading={false} />;
}

function MetricsExplorerWidget(_props: { size: WidgetSize }) {
  const { selectedInstanceId } = useMetrics();
  return <MetricsExplorer instanceId={selectedInstanceId} />;
}

// Widget Registry - includes both analytics and metrics widgets
export const WIDGET_REGISTRY: readonly WidgetDefinition[] = [
  // Metrics widgets (shown first)
  {
    id: "instance-metrics-kpi",
    title: "Instance Metrics",
    description: "KPI cards: n8n version, memory, CPU, workers",
    component: InstanceMetricsWidget,
    defaultOrder: 0,
    defaultSize: "large",
    defaultVisible: true,
    allowedSizes: ["medium", "large"],
    category: "metrics",
    requiresPermission: "metrics.read.version",
    requiresMetricsEnabled: true,
  },
  {
    id: "instance-metrics-charts",
    title: "Instance Metrics Over Time",
    description: "Time series: memory, CPU, event loop lag",
    component: InstanceMetricsChartsWidget,
    defaultOrder: 1,
    defaultSize: "large",
    defaultVisible: true,
    allowedSizes: ["medium", "large"],
    category: "metrics",
    requiresPermission: "metrics.read.full",
    requiresMetricsEnabled: true,
  },
  {
    id: "metrics-explorer",
    title: "Metrics Explorer",
    description: "Query Prometheus-style metrics with labels and aggregations",
    component: MetricsExplorerWidget,
    defaultOrder: 2,
    defaultSize: "large",
    defaultVisible: false, // Hidden by default
    allowedSizes: ["medium", "large"],
    category: "metrics",
    requiresPermission: "metrics.read.full",
    requiresMetricsEnabled: true,
  },
  // Analytics widgets
  {
    id: "kpi-cards",
    title: "KPI Cards",
    description: "Key performance metrics: runs, failures, durations",
    component: KpiCardsWidget,
    defaultOrder: 3,
    defaultSize: "large",
    defaultVisible: true,
    allowedSizes: ["medium", "large"],
    category: "analytics",
  },
  {
    id: "time-series",
    title: "Executions Over Time",
    description: "Adaptive time buckets: hourly, daily, or weekly",
    component: TimeSeriesWidget,
    defaultOrder: 4,
    defaultSize: "medium",
    defaultVisible: true,
    allowedSizes: ["small", "medium", "large"],
    category: "analytics",
  },
  {
    id: "slow-nodes",
    title: "Slowest Nodes",
    description: "Top 10 nodes by P95 execution time",
    component: SlowNodesWidget,
    defaultOrder: 5,
    defaultSize: "small",
    defaultVisible: true,
    allowedSizes: ["small", "medium"],
    category: "analytics",
  },
  {
    id: "failed-executions",
    title: "Recent Failures",
    description: "Most recent workflow errors",
    component: FailedExecutionsWidget,
    defaultOrder: 6,
    defaultSize: "large",
    defaultVisible: true,
    allowedSizes: ["small", "medium", "large"],
    category: "analytics",
  },
];
