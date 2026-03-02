import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Search, ChevronDown, ChevronUp, Calendar, SlidersHorizontal } from "lucide-react";
import { useFilters } from "@/hooks/useFilters";
import { WorkflowSelect } from "@/components/WorkflowSelect";
import { FilterChips } from "@/components/FilterChips";
import { InstanceSelect } from "@/components/InstanceSelect";
import { DateRangePresets } from "@/components/DateRangePresets";
import { ExportMenu } from "@/components/ExportMenu";
import { Badge } from "@/components/ui/badge";
import type { ExecutionStatus } from "@/types/execution";

const statusOptions: { value: ExecutionStatus | "all"; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "success", label: "Success" },
  { value: "error", label: "Error" },
  { value: "running", label: "Running" },
  { value: "waiting", label: "Waiting" },
];

const modeOptions = [
  { value: "all", label: "All modes" },
  { value: "manual", label: "Manual" },
  { value: "trigger", label: "Trigger" },
  { value: "webhook", label: "Webhook" },
  { value: "retry", label: "Retry" },
];

const finishedOptions = [
  { value: "all", label: "All" },
  { value: "true", label: "Finished" },
  { value: "false", label: "Not finished" },
];

export function GlobalFilterBar() {
  const {
    filters,
    setFilter,
    availableInstances,
    hasActiveFilters,
    activeFilterCount,
    datePreset,
    setDatePreset,
  } = useFilters();
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Count advanced-only filters (those hidden in the collapsible section)
  const advancedFilterCount = [
    filters.mode, filters.finished,
    filters.durationMsMin, filters.durationMsMax,
    filters.nodeNameContains, filters.nodeTypeContains,
    filters.itemsOutMin, filters.itemsOutMax,
    filters.executionTimeMsMin, filters.executionTimeMsMax,
  ].filter((v) => v !== undefined && v !== null && v !== "").length;

  return (
    <div className="space-y-3">
      <div className="rounded-xl border bg-card p-4 shadow-sm">
        {/* Primary filters - responsive grid layout */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-center">
          {/* Instance */}
          <div className="sm:col-span-1">
            <InstanceSelect
              value={filters.instanceId}
              instances={availableInstances}
              onValueChange={(v) => setFilter("instanceId", v)}
            />
          </div>

          {/* Search */}
          <div className="relative sm:col-span-1 lg:flex-1 lg:min-w-[200px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              placeholder="Search executions, nodes, types…"
              className="pl-9"
              value={filters.search ?? ""}
              onChange={(e) => setFilter("search", e.target.value || undefined)}
              aria-label="Search executions"
            />
          </div>

          {/* Date range presets - scrollable on mobile */}
          <div className="sm:col-span-2 lg:col-span-1 overflow-x-auto">
            <DateRangePresets
              activePreset={datePreset}
              onPresetChange={setDatePreset}
            />
          </div>

          {/* Status */}
          <div className="sm:col-span-1">
            <Select
              value={filters.status ?? "all"}
              onValueChange={(v) =>
                setFilter("status", v === "all" ? undefined : (v as ExecutionStatus))
              }
            >
              <SelectTrigger className="w-full lg:w-[140px]" aria-label="Filter by status">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent className="z-50 bg-popover">
                {statusOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Workflow */}
          <div className="sm:col-span-1">
            <WorkflowSelect
              value={filters.workflowId}
              onValueChange={(v) => setFilter("workflowId", v)}
            />
          </div>

          {/* Advanced toggle + Export */}
          <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-1">
            <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
              <CollapsibleTrigger asChild>
                <Button
                  variant={showAdvanced ? "secondary" : "ghost"}
                  size="sm"
                  className="text-muted-foreground"
                  aria-expanded={showAdvanced}
                >
                  <SlidersHorizontal className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                  Advanced
                  {!showAdvanced && advancedFilterCount > 0 && (
                    <Badge variant="secondary" className="ml-1.5 h-5 min-w-[20px] px-1.5 text-xs font-semibold">
                      {advancedFilterCount}
                    </Badge>
                  )}
                  {showAdvanced ? (
                    <ChevronUp className="ml-1 h-3 w-3" aria-hidden="true" />
                  ) : (
                    <ChevronDown className="ml-1 h-3 w-3" aria-hidden="true" />
                  )}
                </Button>
              </CollapsibleTrigger>
            </Collapsible>

            {/* Export menu */}
            <ExportMenu />
          </div>
        </div>

        {/* Advanced filters - collapsible with FIXED layout */}
        <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
          <CollapsibleContent className="overflow-visible">
            <div className="mt-4 pt-4 border-t border-border/50">
              {/* Advanced filters grid - properly spaced and non-overlapping */}
              <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
                {/* Date range (custom) */}
                <div className="space-y-2">
                  <Label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                    <Calendar className="h-3 w-3" aria-hidden="true" />
                    Custom Date Range
                  </Label>
                  <div className="space-y-2">
                    <Input
                      type="datetime-local"
                      className="w-full dark:[color-scheme:dark]"
                      value={filters.dateFrom ?? ""}
                      onChange={(e) => setFilter("dateFrom", e.target.value || undefined)}
                      aria-label="From date and time"
                      placeholder="From"
                    />
                    <Input
                      type="datetime-local"
                      className="w-full dark:[color-scheme:dark]"
                      value={filters.dateTo ?? ""}
                      onChange={(e) => setFilter("dateTo", e.target.value || undefined)}
                      aria-label="To date and time"
                      placeholder="To"
                    />
                  </div>
                </div>

                {/* Mode */}
                <div className="space-y-2">
                  <Label className="text-xs font-medium text-muted-foreground">Execution Mode</Label>
                  <Select
                    value={filters.mode ?? "all"}
                    onValueChange={(v) =>
                      setFilter("mode", v === "all" ? undefined : v)
                    }
                  >
                    <SelectTrigger className="w-full" aria-label="Filter by mode">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="z-50 bg-popover">
                      {modeOptions.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Finished */}
                <div className="space-y-2">
                  <Label className="text-xs font-medium text-muted-foreground">Completion Status</Label>
                  <Select
                    value={
                      filters.finished === undefined
                        ? "all"
                        : filters.finished
                        ? "true"
                        : "false"
                    }
                    onValueChange={(v) =>
                      setFilter(
                        "finished",
                        v === "all" ? undefined : v === "true"
                      )
                    }
                  >
                    <SelectTrigger className="w-full" aria-label="Filter by finished status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="z-50 bg-popover">
                      {finishedOptions.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Duration range */}
                <div className="space-y-2">
                  <Label className="text-xs font-medium text-muted-foreground">
                    Duration (ms)
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      placeholder="Min"
                      className="w-full"
                      value={filters.durationMsMin ?? ""}
                      onChange={(e) =>
                        setFilter(
                          "durationMsMin",
                          e.target.value ? parseInt(e.target.value, 10) : undefined
                        )
                      }
                      aria-label="Minimum duration"
                    />
                    <span className="text-muted-foreground text-sm shrink-0">–</span>
                    <Input
                      type="number"
                      placeholder="Max"
                      className="w-full"
                      value={filters.durationMsMax ?? ""}
                      onChange={(e) =>
                        setFilter(
                          "durationMsMax",
                          e.target.value ? parseInt(e.target.value, 10) : undefined
                        )
                      }
                      aria-label="Maximum duration"
                    />
                  </div>
                </div>

                {/* Node name contains */}
                <div className="space-y-2">
                  <Label className="text-xs font-medium text-muted-foreground">
                    Node Name Contains
                  </Label>
                  <Input
                    placeholder="e.g. HTTP Request"
                    value={filters.nodeNameContains ?? ""}
                    onChange={(e) =>
                      setFilter("nodeNameContains", e.target.value || undefined)
                    }
                    aria-label="Node name filter"
                  />
                </div>

                {/* Node type contains */}
                <div className="space-y-2">
                  <Label className="text-xs font-medium text-muted-foreground">
                    Node Type Contains
                  </Label>
                  <Input
                    placeholder="e.g. n8n-nodes-base"
                    value={filters.nodeTypeContains ?? ""}
                    onChange={(e) =>
                      setFilter("nodeTypeContains", e.target.value || undefined)
                    }
                    aria-label="Node type filter"
                  />
                </div>

                {/* Items out range */}
                <div className="space-y-2">
                  <Label className="text-xs font-medium text-muted-foreground">
                    Items Out Count
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      placeholder="Min"
                      className="w-full"
                      value={filters.itemsOutMin ?? ""}
                      onChange={(e) =>
                        setFilter(
                          "itemsOutMin",
                          e.target.value ? parseInt(e.target.value, 10) : undefined
                        )
                      }
                      aria-label="Minimum items out"
                    />
                    <span className="text-muted-foreground text-sm shrink-0">–</span>
                    <Input
                      type="number"
                      placeholder="Max"
                      className="w-full"
                      value={filters.itemsOutMax ?? ""}
                      onChange={(e) =>
                        setFilter(
                          "itemsOutMax",
                          e.target.value ? parseInt(e.target.value, 10) : undefined
                        )
                      }
                      aria-label="Maximum items out"
                    />
                  </div>
                </div>

                {/* Execution time range */}
                <div className="space-y-2">
                  <Label className="text-xs font-medium text-muted-foreground">
                    Node Exec Time (ms)
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      placeholder="Min"
                      className="w-full"
                      value={filters.executionTimeMsMin ?? ""}
                      onChange={(e) =>
                        setFilter(
                          "executionTimeMsMin",
                          e.target.value ? parseInt(e.target.value, 10) : undefined
                        )
                      }
                      aria-label="Minimum execution time"
                    />
                    <span className="text-muted-foreground text-sm shrink-0">–</span>
                    <Input
                      type="number"
                      placeholder="Max"
                      className="w-full"
                      value={filters.executionTimeMsMax ?? ""}
                      onChange={(e) =>
                        setFilter(
                          "executionTimeMsMax",
                          e.target.value ? parseInt(e.target.value, 10) : undefined
                        )
                      }
                      aria-label="Maximum execution time"
                    />
                  </div>
                </div>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>

      {/* Filter chips */}
      <FilterChips />
    </div>
  );
}
