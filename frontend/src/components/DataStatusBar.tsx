import { useData } from "@/data/DataContext";
import { Loader2, Database, Cloud, AlertTriangle } from "lucide-react";
import { isApiMode } from "@/data/config";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function DataStatusBar() {
  const { loadResult, isLoading, error } = useData();

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span>Loading data…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 text-xs text-destructive">
        <Database className="h-3 w-3" />
        <span>Error loading data</span>
      </div>
    );
  }

  if (!loadResult) return null;

  const { executions, nodeRuns, skippedExecutions, skippedNodes, warnings } = loadResult;
  const hasSkipped = (skippedExecutions ?? 0) > 0 || (skippedNodes ?? 0) > 0;
  const totalSkipped = (skippedExecutions ?? 0) + (skippedNodes ?? 0);
  const apiMode = isApiMode();

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      {apiMode ? (
        <Cloud className="h-3 w-3" />
      ) : (
        <Database className="h-3 w-3" />
      )}
      <span>
        {apiMode ? "API" : "CSV"}: {executions?.length ?? 0} executions, {nodeRuns?.length ?? 0} nodes
      </span>
      {hasSkipped && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400 cursor-help">
              <AlertTriangle className="h-3 w-3" />
              {totalSkipped} rows skipped
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            <p className="font-medium mb-1">Skipped due to invalid format:</p>
            <ul className="text-xs space-y-0.5">
              {(skippedExecutions ?? 0) > 0 && <li>• {skippedExecutions} executions</li>}
              {(skippedNodes ?? 0) > 0 && <li>• {skippedNodes} node runs</li>}
            </ul>
            {warnings && warnings.length > 0 && (
              <p className="text-xs mt-2 text-muted-foreground">
                Check console for details
              </p>
            )}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
