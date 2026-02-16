import { createContext, useContext, useCallback, useMemo, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { ExecutionFilters, FilterKey } from "@/types/execution";
import { detectDatePreset, getPresetById, type DatePresetId } from "@/lib/datePresets";

const STORAGE_KEY = "n8n-filters";

interface FilterContextValue {
  filters: ExecutionFilters;
  setFilter: <K extends FilterKey>(key: K, value: ExecutionFilters[K]) => void;
  setFilters: (filters: ExecutionFilters) => void;
  clearFilter: (key: FilterKey) => void;
  clearAllFilters: () => void;
  hasActiveFilters: boolean;
  activeFilterCount: number;
  temporarilyIgnoreFilters: boolean;
  setTemporarilyIgnoreFilters: (ignore: boolean) => void;
  availableInstances: string[];
  setAvailableInstances: (instances: string[]) => void;
  datePreset: DatePresetId;
  setDatePreset: (preset: DatePresetId) => void;
}

export const FilterContext = createContext<FilterContextValue | null>(null);

// URL param names match filter keys
const PARAM_KEYS: FilterKey[] = [
  "instanceId",
  "dateFrom",
  "dateTo",
  "status",
  "workflowId",
  "search",
  "mode",
  "finished",
  "durationMsMin",
  "durationMsMax",
  "nodeNameContains",
  "nodeTypeContains",
  "itemsOutMin",
  "itemsOutMax",
  "executionTimeMsMin",
  "executionTimeMsMax",
];

// Keys that should NOT be persisted to localStorage (transient filters)
const NON_PERSISTENT_KEYS: FilterKey[] = ["search"];

/**
 * Load saved filters from localStorage
 */
function loadFromStorage(): Partial<ExecutionFilters> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return {};
    return JSON.parse(stored) as Partial<ExecutionFilters>;
  } catch {
    return {};
  }
}

/**
 * Save filters to localStorage (excluding transient keys)
 */
function saveToStorage(filters: ExecutionFilters): void {
  try {
    const toSave: Partial<ExecutionFilters> = {};
    for (const key of PARAM_KEYS) {
      if (NON_PERSISTENT_KEYS.includes(key)) continue;
      const value = filters[key];
      if (value !== undefined && value !== null && value !== "") {
        (toSave as Record<string, unknown>)[key] = value;
      }
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  } catch {
    // Ignore storage errors
  }
}

function parseFiltersFromParams(params: URLSearchParams): ExecutionFilters {
  const filters: Record<string, unknown> = {};

  for (const key of PARAM_KEYS) {
    const value = params.get(key);
    // Skip null/undefined/empty - treat as "no filter"
    if (value === null || value === undefined || value === "") continue;

    switch (key) {
      case "finished":
        filters[key] = value === "true";
        break;
      case "durationMsMin":
      case "durationMsMax":
      case "itemsOutMin":
      case "itemsOutMax":
      case "executionTimeMsMin":
      case "executionTimeMsMax": {
        const num = parseInt(value, 10);
        if (!isNaN(num)) filters[key] = num;
        break;
      }
      case "status":
        // Don't store "all" as a filter value
        if (value !== "all") filters[key] = value;
        break;
      case "instanceId":
        // Don't store "all" or empty as a filter value
        if (value && value !== "all") filters[key] = value;
        break;
      default:
        if (value) filters[key] = value;
    }
  }

  return filters as ExecutionFilters;
}

function filtersToParams(filters: ExecutionFilters): URLSearchParams {
  const params = new URLSearchParams();

  for (const key of PARAM_KEYS) {
    const value = filters[key];
    // Only set params for defined, non-null, non-empty values
    if (value === undefined || value === null || value === "") continue;
    // Skip "all" values - they represent "no filter"
    if (value === "all") continue;
    params.set(key, String(value));
  }

  return params;
}


/**
 * Hook that manages filter state with URL params and localStorage persistence.
 * Priority: URL params > localStorage > defaults
 */
export function useFilterState(): {
  filters: ExecutionFilters;
  setFilter: <K extends FilterKey>(key: K, value: ExecutionFilters[K]) => void;
  setFilters: (filters: ExecutionFilters) => void;
  clearFilter: (key: FilterKey) => void;
  clearAllFilters: () => void;
  hasActiveFilters: boolean;
  activeFilterCount: number;
  availableInstances: string[];
  setAvailableInstances: (instances: string[]) => void;
  datePreset: DatePresetId;
  setDatePreset: (preset: DatePresetId) => void;
} {
  const [searchParams, setSearchParams] = useSearchParams();
  const [availableInstances, setAvailableInstancesInternal] = useState<string[]>([]);
  const initializedRef = useRef(false);

  // Compute effective filters (URL params are the single source of truth)
  const filters = useMemo(() => {
    return parseFiltersFromParams(searchParams);
  }, [searchParams]);

  // Initialize from localStorage on first load if URL has no params
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const urlFilters = parseFiltersFromParams(searchParams);
    const storedFilters = loadFromStorage();

    // No defaults applied - only restore from storage if URL is empty
    if (Object.keys(storedFilters).length > 0 && Object.keys(urlFilters).length === 0) {
      setSearchParams(filtersToParams(storedFilters as ExecutionFilters), { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Persist to localStorage whenever filters change
  useEffect(() => {
    saveToStorage(filters);
  }, [filters]);

  // Set available instances - no default applied (user must explicitly select)
  const setAvailableInstances = useCallback(
    (instances: string[]) => {
      setAvailableInstancesInternal(instances);
    },
    []
  );

  // Compute date preset from current range
  const datePreset = useMemo(
    () => detectDatePreset(filters.dateFrom, filters.dateTo),
    [filters.dateFrom, filters.dateTo]
  );

  const setDatePreset = useCallback(
    (presetId: DatePresetId) => {
      const preset = getPresetById(presetId);
      if (!preset) return;

      const range = preset.getRange();
      const newFilters = {
        ...filters,
        dateFrom: range.from,
        dateTo: range.to,
      };
      setSearchParams(filtersToParams(newFilters), { replace: true });
    },
    [filters, setSearchParams]
  );

  const setFilter = useCallback(
    <K extends FilterKey>(key: K, value: ExecutionFilters[K]) => {
      const newFilters = { ...filters };
      // Treat undefined, null, empty string, or "all" as "clear this filter"
      const shouldClear = 
        value === undefined || 
        value === null || 
        value === "" || 
        value === "all";
      
      if (shouldClear) {
        delete (newFilters as Record<string, unknown>)[key];
      } else {
        (newFilters as Record<string, unknown>)[key] = value;
      }
      setSearchParams(filtersToParams(newFilters), { replace: true });
    },
    [filters, setSearchParams]
  );

  const setFilters = useCallback(
    (newFilters: ExecutionFilters) => {
      setSearchParams(filtersToParams(newFilters), { replace: true });
    },
    [setSearchParams]
  );

  const clearFilter = useCallback(
    (key: FilterKey) => {
      const newFilters = { ...filters };
      delete (newFilters as Record<string, unknown>)[key];
      setSearchParams(filtersToParams(newFilters), { replace: true });
    },
    [filters, setSearchParams]
  );

  const clearAllFilters = useCallback(() => {
    // Clear all filters - no defaults applied
    setSearchParams(new URLSearchParams(), { replace: true });
    localStorage.removeItem(STORAGE_KEY);
  }, [setSearchParams]);

  const activeFilterCount = useMemo(() => {
    // Don't count date filters as "active" since they're always set
    return Object.keys(filters).filter(
      (k) => {
        const key = k as FilterKey;
        if (key === "dateFrom" || key === "dateTo") return false;
        return filters[key] !== undefined && filters[key] !== "";
      }
    ).length;
  }, [filters]);

  const hasActiveFilters = activeFilterCount > 0;

  return {
    filters,
    setFilter,
    setFilters,
    clearFilter,
    clearAllFilters,
    hasActiveFilters,
    activeFilterCount,
    availableInstances,
    setAvailableInstances,
    datePreset,
    setDatePreset,
  };
}

export function useFilters(): FilterContextValue {
  const context = useContext(FilterContext);
  if (!context) {
    throw new Error("useFilters must be used within a FilterProvider");
  }
  return context;
}
