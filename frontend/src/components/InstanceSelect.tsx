import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Server, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";

interface InstanceSelectProps {
  value?: string;
  instances: string[];
  onValueChange: (value: string | undefined) => void;
}

/**
 * Select dropdown for n8n instance filtering.
 * Defaults to "All instances" (undefined value).
 */
export function InstanceSelect({ value, instances, onValueChange }: InstanceSelectProps) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const sortedInstances = useMemo(() => {
    return [...instances].sort((a, b) => a.localeCompare(b));
  }, [instances]);

  const filteredInstances = useMemo(() => {
    if (!searchQuery.trim()) return sortedInstances;
    const query = searchQuery.toLowerCase();
    return sortedInstances.filter((instance) =>
      instance.toLowerCase().includes(query)
    );
  }, [sortedInstances, searchQuery]);

  const displayValue = value ?? "All instances";

  if (instances.length === 0) {
    return null;
  }

  // Only show if there are multiple instances
  if (instances.length === 1) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
        <Server className="h-4 w-4" aria-hidden="true" />
        <span>{instances[0]}</span>
      </div>
    );
  }

  const showSearch = instances.length > 5;

  return (
    <Popover open={open} onOpenChange={(isOpen) => {
      setOpen(isOpen);
      if (!isOpen) setSearchQuery("");
    }}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label="Select instance"
          className="w-[180px] justify-between font-normal"
        >
          <Server className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="truncate flex-1 text-left">{displayValue}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[200px] p-0 z-50 bg-popover" align="start">
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
            <button
              type="button"
              onClick={() => {
                onValueChange(undefined);
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                !value && "bg-accent"
              )}
            >
              <Check
                className={cn(
                  "mr-2 h-4 w-4",
                  !value ? "opacity-100" : "opacity-0"
                )}
                aria-hidden="true"
              />
              All instances
            </button>
            {filteredInstances.map((instance) => (
              <button
                key={instance}
                type="button"
                onClick={() => {
                  onValueChange(instance);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  value === instance && "bg-accent"
                )}
              >
                <Check
                  className={cn(
                    "mr-2 h-4 w-4 shrink-0",
                    value === instance ? "opacity-100" : "opacity-0"
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
