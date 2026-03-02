import { useState, useMemo } from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useData } from "@/data/DataContext";

interface WorkflowSelectProps {
  value?: string;
  onValueChange: (value: string | undefined) => void;
}

export function WorkflowSelect({ value, onValueChange }: WorkflowSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const { loadResult } = useData();

  const workflows = useMemo(() => {
    const list = loadResult?.workflows ?? [];
    if (!search) return list;
    const searchLower = search.toLowerCase();
    return list.filter(
      (w) =>
        w.name.toLowerCase().includes(searchLower) ||
        w.workflowId.toLowerCase().includes(searchLower)
    );
  }, [loadResult?.workflows, search]);

  const selectedWorkflow = useMemo(
    () => loadResult?.workflows.find((w) => w.workflowId === value),
    [loadResult?.workflows, value]
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-[200px] justify-between font-normal"
        >
          <span className="truncate">
            {selectedWorkflow?.name ?? (value ? value : "All workflows")}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-0" align="start">
        <div className="flex items-center border-b px-3 py-2">
          <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
          <Input
            placeholder="Search workflows..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 border-0 p-0 focus-visible:ring-0"
            aria-label="Search workflows"
          />
        </div>
        <ScrollArea className="h-[200px]">
          <div className="p-1">
            <button
              onClick={() => {
                onValueChange(undefined);
                setOpen(false);
                setSearch("");
              }}
              className={cn(
                "flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent",
                !value && "bg-accent"
              )}
            >
              <Check
                className={cn(
                  "mr-2 h-4 w-4",
                  !value ? "opacity-100" : "opacity-0"
                )}
              />
              All workflows
            </button>
            {workflows.map((workflow) => (
              <button
                key={workflow.workflowId}
                onClick={() => {
                  onValueChange(workflow.workflowId);
                  setOpen(false);
                  setSearch("");
                }}
                className={cn(
                  "flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent",
                  value === workflow.workflowId && "bg-accent"
                )}
              >
                <Check
                  className={cn(
                    "mr-2 h-4 w-4 shrink-0",
                    value === workflow.workflowId ? "opacity-100" : "opacity-0"
                  )}
                />
                <span className="truncate">{workflow.name}</span>
              </button>
            ))}
            {workflows.length === 0 && (
              <div className="px-2 py-4 text-center text-sm text-muted-foreground">
                No workflows found
              </div>
            )}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
