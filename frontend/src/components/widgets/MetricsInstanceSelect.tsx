/**
 * Metrics Instance Selector - Select which n8n instance to view metrics for
 */
import { Check, ChevronsUpDown, Server, Search, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useMemo, useState } from "react";
import { useMetrics } from "@/data/MetricsContext";

export function MetricsInstanceSelect() {
  const {
    availableInstances,
    instancesLoading,
    selectedInstanceId,
    setSelectedInstanceId,
    config,
  } = useMetrics();

  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const sortedInstances = useMemo(() => {
    return [...availableInstances].sort((a, b) => a.localeCompare(b));
  }, [availableInstances]);

  const filteredInstances = useMemo(() => {
    if (!searchQuery.trim()) return sortedInstances;
    const query = searchQuery.toLowerCase();
    return sortedInstances.filter((instance) =>
      instance.toLowerCase().includes(query)
    );
  }, [sortedInstances, searchQuery]);

  // Loading state
  if (instancesLoading) {
    return <Skeleton className="h-10 w-[180px]" />;
  }

  // No instances available
  if (availableInstances.length === 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
        <AlertCircle className="h-4 w-4" aria-hidden="true" />
        <span>No instances available</span>
      </div>
    );
  }

  // Single instance - just show it
  if (availableInstances.length === 1) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-sm font-medium">
        <Server className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <span>{availableInstances[0]}</span>
      </div>
    );
  }

  const displayValue = selectedInstanceId ?? "Select instance";
  const showSearch = availableInstances.length > 5;

  return (
    <Popover
      open={open}
      onOpenChange={(isOpen) => {
        setOpen(isOpen);
        if (!isOpen) setSearchQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label="Select metrics instance"
          className="w-[200px] justify-between font-normal"
          data-testid="metrics-instance-select"
        >
          <Server className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="truncate flex-1 text-left">{displayValue}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[220px] p-0 z-50 bg-popover" align="start">
        {showSearch && (
          <div className="p-2 border-b">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search instances..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 h-8"
                autoFocus
              />
            </div>
          </div>
        )}
        <ScrollArea className="h-[200px]">
          <div className="p-1">
            {filteredInstances.map((instance) => (
              <button
                key={instance}
                type="button"
                onClick={() => {
                  setSelectedInstanceId(instance);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  selectedInstanceId === instance && "bg-accent"
                )}
              >
                <Check
                  className={cn(
                    "mr-2 h-4 w-4 shrink-0",
                    selectedInstanceId === instance ? "opacity-100" : "opacity-0"
                  )}
                  aria-hidden="true"
                />
                <span className="truncate">{instance}</span>
              </button>
            ))}
            {filteredInstances.length === 0 && searchQuery && (
              <div className="py-4 text-center text-sm text-muted-foreground">
                No instances found
              </div>
            )}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
