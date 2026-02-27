import { createContext, useContext, useState, useEffect, useMemo, useCallback, type ReactNode } from "react";
import type { DataSource } from "./DataSource";
import type { DataLoadResult } from "@/types/execution";
import { createDataSource } from "./createDataSource";
import { useAuth } from "@/security/AuthContext";

interface DataContextValue {
  dataSource: DataSource;
  loadResult: DataLoadResult | null;
  isLoading: boolean;
  error: string | null;
  reload: () => void;
}

const defaultLoadResult: DataLoadResult = {
  executions: [],
  nodeRuns: [],
  workflows: [],
  warnings: [],
  skippedExecutions: 0,
  skippedNodes: 0,
};

const DataContext = createContext<DataContextValue | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const { state: authState } = useAuth();
  const dataSource = useMemo(() => createDataSource(), []);
  const [loadResult, setLoadResult] = useState<DataLoadResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  const load = useCallback(async (forceReload = false) => {
    // Skip loading if auth is still loading
    if (authState.status === "loading") {
      return;
    }
    
    // Skip loading if not authenticated (data requires auth)
    if (authState.status === "anonymous") {
      setLoadResult(defaultLoadResult);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      // Force create a new data source if reloading to clear cache
      const source = forceReload ? createDataSource() : dataSource;
      const result = await source.loadAll();
      setLoadResult(result);
    } catch (err) {
      setError(String(err));
      setLoadResult(defaultLoadResult);
    } finally {
      setIsLoading(false);
    }
  }, [authState.status, dataSource]);

  // Load data when auth becomes authenticated or reload is triggered
  useEffect(() => {
    if (authState.status === "authenticated") {
      load(loadAttempt > 0); // Force reload if this is a retry
    } else if (authState.status === "anonymous") {
      setLoadResult(defaultLoadResult);
      setIsLoading(false);
    }
    // Still loading auth - keep isLoading true
  }, [authState.status, loadAttempt]);

  const reload = useCallback(() => {
    setLoadAttempt((prev) => prev + 1);
  }, []);

  return (
    <DataContext.Provider value={{ dataSource, loadResult, isLoading, error, reload }}>
      {children}
    </DataContext.Provider>
  );
}

export function useData(): DataContextValue {
  const context = useContext(DataContext);
  if (!context) {
    throw new Error("useData must be used within a DataProvider");
  }
  return context;
}

export function useDataSource(): DataSource {
  return useData().dataSource;
}
