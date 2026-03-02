import { useMemo, useEffect, useState } from "react";
import { PageShell } from "@/components/PageShell";
import { GlobalFilterBar } from "@/components/GlobalFilterBar";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/state";
import { Button } from "@/components/ui/button";
import { SkeletonCard, SkeletonChart } from "@/components/skeleton";
import { Settings2, BarChart3, RotateCcw, RefreshCw } from "lucide-react";
import { useData } from "@/data/DataContext";
import { useFilters } from "@/hooks/useFilters";
import { filterExecutions } from "@/data/selectors/executionSelectors";
import { computeKpis, computeSlowNodes, getFailedExecutions } from "@/data/aggregations";
import { useDashboardLayout } from "@/components/dashboard/useDashboardLayout";
import { CustomizePanel } from "@/components/dashboard/CustomizePanel";
import { WIDGET_REGISTRY, WidgetDataProvider } from "@/components/dashboard/WidgetComponents";
import { SIZE_COLS } from "@/components/dashboard/widgetRegistry";
import { useAuth } from "@/security/AuthContext";
import { MetricsProvider } from "@/data/MetricsContext";
import * as metricsApi from "@/data/metricsApi";

export default function DashboardPage() {
  const { loadResult, isLoading, error, reload } = useData();
  const { filters } = useFilters();
  const { state } = useAuth();

  // Metrics config state
  const [metricsConfig, setMetricsConfig] = useState<metricsApi.MetricsConfig | null>(null);
  const [metricsConfigLoading, setMetricsConfigLoading] = useState(true);

  // Load metrics config to determine widget visibility
  useEffect(() => {
    async function loadMetricsConfig() {
      try {
        const config = await metricsApi.getMetricsConfig();
        setMetricsConfig(config);
      } catch {
        setMetricsConfig(null);
      } finally {
        setMetricsConfigLoading(false);
      }
    }
    loadMetricsConfig();
  }, []);

  // canCustomizeDashboard is now granted to ALL authenticated users (from metrics config)
  // This allows personal UI customization without requiring admin permissions
  const canCustomize = metricsConfig?.canCustomizeDashboard ?? false;
  
  // Only admins can access instance-level metrics (CPU/RAM/etc.)
  const canAdmin =
    state.status === "authenticated" && state.permissions.includes("admin:users");

  const {
    layout,
    isCustomizing,
    setIsCustomizing,
    toggleWidgetVisibility,
    setWidgetSize,
    reorderWidgets,
    autoArrange,
    resetToDefault,
    getVisibleWidgets,
  } = useDashboardLayout(WIDGET_REGISTRY);

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

  const filteredExecutions = globalFiltered;

  // Filter node runs to only include those from filtered executions
  const filteredNodeRuns = useMemo(() => {
    if (!loadResult) return [];
    const executionIds = new Set(filteredExecutions.map((e) => e.executionId));
    return loadResult.nodeRuns.filter((n) => executionIds.has(n.executionId));
  }, [loadResult, filteredExecutions]);

  // Compute all aggregations
  const kpis = useMemo(() => computeKpis(filteredExecutions), [filteredExecutions]);

  const slowNodes = useMemo(
    () => computeSlowNodes(filteredNodeRuns, 10),
    [filteredNodeRuns]
  );

  const failedExecutions = useMemo(
    () => getFailedExecutions(filteredExecutions, 500), // Get up to 500 for pagination
    [filteredExecutions]
  );

  const hasData = !isLoading && !!loadResult && loadResult.executions.length > 0;
  
  // Get visible widgets, filtering out metrics widgets that shouldn't be shown
  const visibleWidgets = useMemo(() => {
    const widgets = getVisibleWidgets();
    return widgets.filter((widget) => {
      const definition = WIDGET_REGISTRY.find((w) => w.id === widget.id);
      if (!definition) return false;

      // For non-metrics widgets, always include
      if (!definition.requiresMetricsEnabled) return true;

      // For metrics widgets, check config
      if (!metricsConfig?.enabled) return false;

      // Check permission
      if (definition.requiresPermission === "metrics.read.full") {
        return metricsConfig.hasFullPermission;
      }
      if (definition.requiresPermission === "metrics.read.version") {
        return metricsConfig.hasVersionPermission || metricsConfig.hasFullPermission;
      }

      return true;
    });
  }, [getVisibleWidgets, metricsConfig]);

  // Widget registry map for quick lookup
  const registryMap = useMemo(
    () => new Map(WIDGET_REGISTRY.map((w) => [w.id, w] as const)),
    []
  );

  // Check if there are any metrics widgets visible
  const hasMetricsWidgets = visibleWidgets.some(w => 
    registryMap.get(w.id)?.category === "metrics"
  );

  const headerActions = (
    <>
      {!isLoading && !isCustomizing && (
        <Button
          variant="ghost"
          size="sm"
          onClick={reload}
          className="text-muted-foreground"
          aria-label="Refresh dashboard data"
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      )}

      {isCustomizing && (
        <Button
          variant="ghost"
          size="sm"
          onClick={resetToDefault}
          className="text-muted-foreground"
        >
          <RotateCcw className="mr-2 h-4 w-4" />
          Reset
        </Button>
      )}

      {canCustomize && (
        <Button
          variant={isCustomizing ? "default" : "outline"}
          size="sm"
          onClick={() => setIsCustomizing(!isCustomizing)}
        >
          <Settings2 className="mr-2 h-4 w-4" />
          {isCustomizing ? "Done" : "Customize"}
        </Button>
      )}
    </>
  );

  // Render widget content, wrapping metrics widgets in MetricsProvider
  const renderWidgetContent = () => {
    if (visibleWidgets.length === 0) {
      return (
        <EmptyState
          icon={<Settings2 className="h-10 w-10" />}
          title="No widgets visible"
          description="Click 'Customize' to show some widgets on your dashboard."
        />
      );
    }

    const metricsWidgets = visibleWidgets.filter(w => registryMap.get(w.id)?.category === "metrics");
    const analyticsWidgets = visibleWidgets.filter(w => registryMap.get(w.id)?.category === "analytics");

    return (
      <div className="space-y-8">
        {/* Metrics Widgets - wrapped in MetricsProvider */}
        {metricsWidgets.length > 0 && (
          <MetricsProvider>
            <div className="grid gap-6 grid-cols-1 lg:grid-cols-3">
              {metricsWidgets.map((widget) => {
                const definition = registryMap.get(widget.id);
                if (!definition) return null;

                const WidgetComponent = definition.component;
                const colSpan = SIZE_COLS[widget.size];

                return (
                  <div key={widget.id} className={`col-span-1 ${colSpan}`}>
                    <WidgetComponent size={widget.size} />
                  </div>
                );
              })}
            </div>
          </MetricsProvider>
        )}

        {/* Analytics Widgets */}
        {analyticsWidgets.length > 0 && (
          <div className="grid gap-6 grid-cols-1 lg:grid-cols-3">
            {analyticsWidgets.map((widget) => {
              const definition = registryMap.get(widget.id);
              if (!definition) return null;

              const WidgetComponent = definition.component;
              const colSpan = SIZE_COLS[widget.size];

              return (
                <div key={widget.id} className={`col-span-1 ${colSpan}`}>
                  <WidgetComponent size={widget.size} />
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <PageShell
      title="Dashboard"
      description="Overview of your n8n execution performance."
      headerActions={headerActions}
    >
      <GlobalFilterBar />

      {isCustomizing && (
        <CustomizePanel
          registry={WIDGET_REGISTRY}
          layout={layout}
          onToggleVisibility={toggleWidgetVisibility}
          onSetSize={setWidgetSize}
          onReorder={reorderWidgets}
          onAutoArrange={autoArrange}
          onReset={resetToDefault}
          onClose={() => setIsCustomizing(false)}
          metricsConfig={metricsConfig}
        />
      )}

      {isLoading || metricsConfigLoading ? (
        <div className="space-y-6" data-testid="dashboard-loading">
          <SkeletonCard count={4} />
          <div className="grid gap-6 grid-cols-1 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <SkeletonChart height="h-64" />
            </div>
            <div className="lg:col-span-1">
              <SkeletonChart height="h-64" />
            </div>
          </div>
        </div>
      ) : error ? (
        <ErrorState
          message="Failed to load dashboard data"
          details={error}
          onRetry={reload}
        />
      ) : !hasData && !hasMetricsWidgets ? (
        <EmptyState
          icon={<BarChart3 className="h-10 w-10" />}
          title="No data yet"
          description="Execution data will appear here once n8n workflows run and data is ingested. Check the Getting Started guide for setup instructions."
          actionLabel="Getting Started"
          actionHref="/help"
        />
      ) : (
        <WidgetDataProvider
          value={{
            kpis,
            filteredExecutions,
            slowNodes,
            failedExecutions,
            workflows: loadResult?.workflows ?? [],
            instanceId: filters.instanceId,
            dateFrom: filters.dateFrom,
            dateTo: filters.dateTo,
            isLoading,
          }}
        >
          {renderWidgetContent()}
        </WidgetDataProvider>
      )}
    </PageShell>
  );
}
