import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useFilters } from "@/hooks/useFilters";
import { useData } from "@/data/DataContext";
import type { FilterKey } from "@/types/execution";

const FILTER_LABELS: Record<FilterKey, string> = {
  instanceId: "Instance",
  dateFrom: "From",
  dateTo: "To",
  status: "Status",
  workflowId: "Workflow",
  search: "Search",
  mode: "Mode",
  finished: "Finished",
  durationMsMin: "Min duration",
  durationMsMax: "Max duration",
  nodeNameContains: "Node name",
  nodeTypeContains: "Node type",
  itemsOutMin: "Min items out",
  itemsOutMax: "Max items out",
  executionTimeMsMin: "Min exec time",
  executionTimeMsMax: "Max exec time",
};

/**
 * Check if a filter value represents an "active" (set) state.
 * Returns false for undefined, null, empty string, and "all" values.
 */
function isFilterSet(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string" && (value.trim() === "" || value === "all")) return false;
  return true;
}

function formatFilterValue(key: FilterKey, value: unknown, workflowName?: string): string {
  if (!isFilterSet(value)) return "";

  switch (key) {
    case "finished":
      return value ? "Yes" : "No";
    case "durationMsMin":
    case "durationMsMax":
    case "executionTimeMsMin":
    case "executionTimeMsMax":
      return `${value}ms`;
    case "workflowId":
      return workflowName ?? String(value);
    default:
      return String(value);
  }
}

export function FilterChips() {
  const { filters, clearFilter, clearAllFilters, hasActiveFilters } = useFilters();
  const { loadResult } = useData();

  const workflowMap = new Map(
    loadResult?.workflows.map((w) => [w.workflowId, w.name]) ?? []
  );

  if (!hasActiveFilters) return null;

  const activeFilters = (Object.keys(filters) as FilterKey[]).filter(
    (key) => isFilterSet(filters[key])
  );

  const handleRemoveFilter = (key: FilterKey) => {
    // Call clearFilter which sets the value to undefined and updates URL
    clearFilter(key);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 px-1">
      <span className="text-xs text-muted-foreground">Active filters:</span>
      {activeFilters.map((key) => {
        const value = filters[key];
        const label = FILTER_LABELS[key];
        const displayValue = formatFilterValue(
          key,
          value,
          key === "workflowId" ? workflowMap.get(value as string) : undefined
        );

        return (
          <Badge
            key={key}
            variant="secondary"
            className="gap-1 pr-1 font-normal"
          >
            <span className="text-muted-foreground">{label}:</span>
            <span className="max-w-[120px] truncate">{displayValue}</span>
            <button
              type="button"
              onClick={() => handleRemoveFilter(key)}
              className="ml-1 rounded-full p-0.5 hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring"
              aria-label={`Remove ${label} filter`}
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        );
      })}
      <Button
        variant="ghost"
        size="sm"
        onClick={clearAllFilters}
        className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
      >
        Clear all
      </Button>
    </div>
  );
}
