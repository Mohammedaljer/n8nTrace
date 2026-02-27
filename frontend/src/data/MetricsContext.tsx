/**
 * Metrics context for managing n8n instance health data
 * Uses global instanceId from FiltersContext (unified dropdown)
 */
import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react";
import * as metricsApi from "@/data/metricsApi";
import { useFilters } from "@/hooks/useFilters";
import type {
  MetricsConfig,
  MetricsSnapshot,
  MetricsTimeseriesDatapoint,
  WorkflowsStatusResponse,
} from "@/data/metricsApi";

interface MetricsContextValue {
  // Config
  config: MetricsConfig | null;
  configLoading: boolean;
  configError: string | null;
  
  // Instance ID (from global filters - read-only here)
  selectedInstanceId: string | null;
  
  // Latest metrics
  latestMetrics: MetricsSnapshot | null;
  latestLoading: boolean;
  latestError: string | null;
  permissionLevel: "full" | "version" | null;
  
  // Timeseries
  timeseries: MetricsTimeseriesDatapoint[];
  timeseriesLoading: boolean;
  timeseriesError: string | null;
  
  // Workflows status
  workflowsStatus: WorkflowsStatusResponse | null;
  workflowsLoading: boolean;
  
  // Refresh functions
  refreshLatest: () => Promise<void>;
  refreshTimeseries: (from?: string, to?: string) => Promise<void>;
  refreshWorkflowsStatus: () => Promise<void>;
}

const MetricsContext = createContext<MetricsContextValue | null>(null);

export function MetricsProvider({ children }: { children: React.ReactNode }) {
  // Get global filters (includes instanceId)
  const { filters } = useFilters();
  const selectedInstanceId = filters.instanceId || null;
  
  // Config state
  const [config, setConfig] = useState<MetricsConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);
  
  // Latest metrics state
  const [latestMetrics, setLatestMetrics] = useState<MetricsSnapshot | null>(null);
  const [latestLoading, setLatestLoading] = useState(false);
  const [latestError, setLatestError] = useState<string | null>(null);
  const [permissionLevel, setPermissionLevel] = useState<"full" | "version" | null>(null);
  
  // Timeseries state
  const [timeseries, setTimeseries] = useState<MetricsTimeseriesDatapoint[]>([]);
  const [timeseriesLoading, setTimeseriesLoading] = useState(false);
  const [timeseriesError, setTimeseriesError] = useState<string | null>(null);
  
  // Workflows status state
  const [workflowsStatus, setWorkflowsStatus] = useState<WorkflowsStatusResponse | null>(null);
  const [workflowsLoading, setWorkflowsLoading] = useState(false);
  
  // Load config on mount
  useEffect(() => {
    async function loadConfig() {
      try {
        const cfg = await metricsApi.getMetricsConfig();
        setConfig(cfg);
        setConfigError(null);
      } catch (err) {
        setConfigError(err instanceof Error ? err.message : "Failed to load metrics config");
      } finally {
        setConfigLoading(false);
      }
    }
    loadConfig();
  }, []);
  
  // Refresh latest metrics
  const refreshLatest = useCallback(async () => {
    // Skip if no instance, disabled, or "all" selected (metrics widgets don't support "all")
    if (!selectedInstanceId || !config?.enabled || selectedInstanceId === 'all') return;
    
    setLatestLoading(true);
    setLatestError(null);
    try {
      const response = await metricsApi.getMetricsLatest(selectedInstanceId);
      setLatestMetrics(response.data);
      setPermissionLevel(response.permissionLevel || null);
    } catch (err) {
      setLatestError(err instanceof Error ? err.message : "Failed to load metrics");
      setLatestMetrics(null);
    } finally {
      setLatestLoading(false);
    }
  }, [selectedInstanceId, config?.enabled]);
  
  // Refresh timeseries
  const refreshTimeseries = useCallback(async (from?: string, to?: string) => {
    if (!selectedInstanceId || !config?.enabled || !config?.hasFullPermission || selectedInstanceId === 'all') return;
    
    setTimeseriesLoading(true);
    setTimeseriesError(null);
    try {
      const response = await metricsApi.getMetricsTimeseries(selectedInstanceId, from, to);
      setTimeseries(response.data || []);
    } catch (err) {
      setTimeseriesError(err instanceof Error ? err.message : "Failed to load timeseries");
      setTimeseries([]);
    } finally {
      setTimeseriesLoading(false);
    }
  }, [selectedInstanceId, config?.enabled, config?.hasFullPermission]);
  
  // Refresh workflows status
  const refreshWorkflowsStatus = useCallback(async () => {
    if (!selectedInstanceId || selectedInstanceId === 'all') return;
    
    setWorkflowsLoading(true);
    try {
      const response = await metricsApi.getWorkflowsStatus(selectedInstanceId);
      setWorkflowsStatus(response);
    } catch {
      setWorkflowsStatus(null);
    } finally {
      setWorkflowsLoading(false);
    }
  }, [selectedInstanceId]);
  
  // Auto-refresh when instance changes
  useEffect(() => {
    if (selectedInstanceId && config?.enabled) {
      refreshLatest();
      if (config.hasFullPermission) {
        refreshTimeseries();
      }
      refreshWorkflowsStatus();
    } else {
      setLatestMetrics(null);
      setTimeseries([]);
      setWorkflowsStatus(null);
    }
  }, [selectedInstanceId, config?.enabled, config?.hasFullPermission]);
  
  const value = useMemo(() => ({
    config,
    configLoading,
    configError,
    selectedInstanceId,
    latestMetrics,
    latestLoading,
    latestError,
    permissionLevel,
    timeseries,
    timeseriesLoading,
    timeseriesError,
    workflowsStatus,
    workflowsLoading,
    refreshLatest,
    refreshTimeseries,
    refreshWorkflowsStatus,
  }), [
    config,
    configLoading,
    configError,
    selectedInstanceId,
    latestMetrics,
    latestLoading,
    latestError,
    permissionLevel,
    timeseries,
    timeseriesLoading,
    timeseriesError,
    workflowsStatus,
    workflowsLoading,
    refreshLatest,
    refreshTimeseries,
    refreshWorkflowsStatus,
  ]);
  
  return (
    <MetricsContext.Provider value={value}>
      {children}
    </MetricsContext.Provider>
  );
}

export function useMetrics(): MetricsContextValue {
  const context = useContext(MetricsContext);
  if (!context) {
    throw new Error("useMetrics must be used within a MetricsProvider");
  }
  return context;
}
