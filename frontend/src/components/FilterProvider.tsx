import { useState, useEffect, type ReactNode } from "react";
import { FilterContext, useFilterState } from "@/hooks/useFilters";
import { useData } from "@/data/DataContext";

interface FilterProviderProps {
  children: ReactNode;
}

export function FilterProvider({ children }: FilterProviderProps) {
  const filterState = useFilterState();
  const [temporarilyIgnoreFilters, setTemporarilyIgnoreFilters] = useState(false);
  const { loadResult } = useData();

  // Secure mode: available instances are derived from loaded data.
  // Any real scoping MUST be enforced server-side (not in browser).
  useEffect(() => {
    if (!loadResult) return;

    const instanceSet = new Set<string>();
    for (const exec of loadResult.executions) {
      if (exec.instanceId) instanceSet.add(exec.instanceId);
    }
    filterState.setAvailableInstances(Array.from(instanceSet));
  }, [loadResult]); // intentionally not depending on filterState methods

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
