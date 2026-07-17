import { useState, useEffect, type ReactNode } from "react";
import { FilterContext, useFilterState } from "@/hooks/useFilters";
import { useData } from "@/data/DataContext";
import { isApiMode } from "@/data/config";

interface FilterProviderProps {
  children: ReactNode;
}

export function FilterProvider({ children }: FilterProviderProps) {
  const filterState = useFilterState();
  const [temporarilyIgnoreFilters, setTemporarilyIgnoreFilters] = useState(false);
  const { loadResult } = useData();

  // Secure mode: available instances are derived from loaded data + metrics API.
  // Any real scoping MUST be enforced server-side (not in browser).
  useEffect(() => {
    const instanceSet = new Set<string>();
    
    // Add instances from execution data
    if (loadResult) {
      for (const exec of loadResult.executions) {
        if (exec.instanceId) instanceSet.add(exec.instanceId);
      }
    }
    
    // Also fetch instances from metrics API (for cases with metrics but no executions)
    if (isApiMode()) {
      fetch('/api/metrics/instances', { credentials: 'include' })
        .then(res => res.ok ? res.json() : { instances: [] })
        .then(data => {
          if (Array.isArray(data.instances)) {
            for (const inst of data.instances) {
              instanceSet.add(inst);
            }
          }
          filterState.setAvailableInstances(Array.from(instanceSet));
        })
        .catch(() => {
          // Fallback: just use execution instances
          filterState.setAvailableInstances(Array.from(instanceSet));
        });
    } else {
      const instanceArray = Array.from(instanceSet);
      filterState.setAvailableInstances(instanceArray);
    }
  }, [loadResult]); // eslint-disable-line react-hooks/exhaustive-deps -- intentionally not depending on filterState methods

  useEffect(() => {
    if (filterState.availableInstances.length !== 1) return;

    const [singleInstance] = filterState.availableInstances;
    if (filterState.filters.instanceId === singleInstance) return;

    filterState.setFilter('instanceId', singleInstance);
  }, [filterState.availableInstances, filterState.filters.instanceId, filterState.setFilter]);

  return (
    <FilterContext.Provider
      value={{
        ...filterState,
        temporarilyIgnoreFilters,
        setTemporarilyIgnoreFilters,
      }}
    >
      {children}
    </FilterContext.Provider>
  );
}
