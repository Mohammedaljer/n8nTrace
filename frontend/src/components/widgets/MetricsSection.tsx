/**
 * Metrics Section - Complete metrics dashboard section
 * Only rendered when METRICS_ENABLED=true and user has permission
 * Uses global instance filter from FiltersContext
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, Activity, Lock, Server, Info } from "lucide-react";
import { MetricsProvider, useMetrics } from "@/data/MetricsContext";
import { MetricsKpiCards } from "./MetricsKpiCards";
import { MetricsChartsGrid } from "./MetricsCharts";

function MetricsSectionContent() {
  const {
    config,
    configLoading,
    configError,
    selectedInstanceId,
    latestError,
  } = useMetrics();

  // Loading config
  if (configLoading) {
    return (
      <div className="space-y-6" data-testid="metrics-section-loading">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      </div>
    );
  }

  // Config error
  if (configError) {
    return (
      <Card className="border-destructive/50">
        <CardContent className="pt-6">
          <div className="flex items-center gap-3 text-destructive">
            <AlertCircle className="h-5 w-5" />
            <p>Failed to load metrics configuration: {configError}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Metrics feature disabled
  if (!config?.enabled) {
    return null; // Don't show anything if metrics is disabled
  }

  // No permissions
  if (!config.hasVersionPermission && !config.hasFullPermission) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-5 w-5" />
            Instance Metrics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
            <Lock className="h-10 w-10 text-muted-foreground/30" />
            <div>
              <p className="text-sm font-medium">No metrics permission</p>
              <p className="text-sm text-muted-foreground">
                Contact an administrator to request access
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // "All instances" selected - show info state
  if (selectedInstanceId === 'all') {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-5 w-5" />
            Instance Metrics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
            <Info className="h-10 w-10 text-muted-foreground/30" />
            <div>
              <p className="text-sm font-medium">Select an instance to view metrics</p>
              <p className="text-sm text-muted-foreground">
                Use the Instance dropdown above to select a specific instance
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // No instance selected
  if (!selectedInstanceId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-5 w-5" />
            Instance Metrics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
            <Server className="h-10 w-10 text-muted-foreground/30" />
            <div>
              <p className="text-sm font-medium">Select an instance</p>
              <p className="text-sm text-muted-foreground">
                Use the Instance dropdown above to select an instance
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Error loading metrics
  if (latestError) {
    return (
      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-5 w-5" />
            Instance Metrics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 text-destructive">
            <AlertCircle className="h-5 w-5" />
            <p>{latestError}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Full metrics view
  return (
    <div className="space-y-6" data-testid="metrics-section">
      {/* KPI Cards */}
      <MetricsKpiCards />

      {/* Charts (only for full permission) */}
      {config.hasFullPermission && <MetricsChartsGrid />}
    </div>
  );
}

export function MetricsSection() {
  return (
    <MetricsProvider>
      <MetricsSectionContent />
    </MetricsProvider>
  );
}
