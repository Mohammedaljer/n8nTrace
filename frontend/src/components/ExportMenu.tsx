import { useState, useRef, useMemo } from "react";
import {
  Download,
  Share2,
  Upload,
  FileSpreadsheet,
  FileJson,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { useFilters } from "@/hooks/useFilters";
import { useData } from "@/data/DataContext";
import { useTheme } from "@/hooks/useTheme";
import { loadLayout, saveLayout } from "@/components/dashboard/widgetRegistry";
import { WIDGET_REGISTRY } from "@/components/dashboard/WidgetComponents";
import { generateCsv, downloadCsv, downloadJson, formatDateForCsv } from "@/lib/export/csv";
import {
  createShareView,
  serializeShareView,
  importShareViewFromFile,
  extractViewSettings,
  type Theme,
} from "@/lib/export/shareView";
import {
  generateExecutionBundle,
  getBundleHeaders,
  bundleRowToArray,
} from "@/data/aggregations/shareBundle";
import { filterExecutions } from "@/data/selectors/executionSelectors";
import { useAuth } from "@/security/AuthContext";
import type { ExecutionNode } from "@/types/execution";

export function ExportMenu() {
  const { toast } = useToast();
  const { filters, setFilters, datePreset, setDatePreset } = useFilters();
  const { loadResult } = useData();
  const { theme, setTheme } = useTheme();
  const { state } = useAuth();

  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Permission check (real auth)
  const canExport =
    state.status === "authenticated" && state.permissions.includes("export:data");

  // Get filtered data
  const filteredExecutions = useMemo(
    () => filterExecutions(loadResult?.executions ?? [], loadResult?.workflows ?? [], loadResult?.nodeRuns ?? [], filters),
    [loadResult, filters]
  );

  const filteredNodeRuns = useMemo(() => {
    const executionIds = new Set(
      filteredExecutions.map((e) => `${e.instanceId}::${e.executionId}`)
    );

    return (loadResult?.nodeRuns ?? []).filter((node: ExecutionNode) =>
      executionIds.has(`${node.instanceId}::${node.executionId}`)
    );
  }, [filteredExecutions, loadResult]);

  // ===== Export Functions =====

  const handleExportExecutions = () => {
    if (filteredExecutions.length === 0) {
      toast({
        title: "No data to export",
        description: "Apply different filters to include executions.",
        variant: "destructive",
      });
      return;
    }

    const headers = [
      "instance_id",
      "execution_id",
      "workflow_id",
      "status",
      "mode",
      "started_at",
      "stopped_at",
      "duration_ms",
      "nodes_count",
      "last_node_executed",
      "finished",
    ];

    const rows = filteredExecutions.map((e) => [
      e.instanceId,
      e.executionId,
      e.workflowId,
      e.status ?? "",
      e.mode ?? "",
      formatDateForCsv(e.startedAt),
      formatDateForCsv(e.stoppedAt),
      e.durationMs,
      e.nodesCount,
      e.lastNodeExecuted ?? "",
      e.finished,
    ]);

    const csv = generateCsv(headers, rows);
    const timestamp = new Date().toISOString().split("T")[0];
    downloadCsv(csv, `executions_${timestamp}.csv`);

    toast({
      title: "Executions exported",
      description: `Exported ${filteredExecutions.length} executions to CSV.`,
    });
  };

  const handleExportNodes = () => {
    if (filteredNodeRuns.length === 0) {
      toast({
        title: "No data to export",
        description: "Apply different filters to include node runs.",
        variant: "destructive",
      });
      return;
    }

    const headers = [
      "instance_id",
      "execution_id",
      "workflow_id",
      "node_name",
      "node_type",
      "run_index",
      "execution_status",
      "execution_time_ms",
      "items_out_count",
      "start_time",
    ];

    const rows = filteredNodeRuns.map((n: ExecutionNode) => [
      n.instanceId,
      n.executionId,
      n.workflowId,
      n.nodeName,
      n.nodeType,
      n.runIndex,
      n.executionStatus,
      n.executionTimeMs,
      n.itemsOutCount,
      formatDateForCsv(n.startTime),
    ]);

    const csv = generateCsv(headers, rows);
    const timestamp = new Date().toISOString().split("T")[0];
    downloadCsv(csv, `execution_nodes_${timestamp}.csv`);

    toast({
      title: "Node runs exported",
      description: `Exported ${filteredNodeRuns.length} node runs to CSV.`,
    });
  };

  const handleExportBundle = () => {
    if (filteredExecutions.length === 0) {
      toast({
        title: "No data to export",
        description: "Apply different filters to include executions.",
        variant: "destructive",
      });
      return;
    }

    const bundleRows = generateExecutionBundle(filteredExecutions, filteredNodeRuns);
    const rows = bundleRows.map(bundleRowToArray);
    const csv = generateCsv(getBundleHeaders(), rows);
    const timestamp = new Date().toISOString().split("T")[0];
    downloadCsv(csv, `shared_execution_bundle_${timestamp}.csv`);

    toast({
      title: "Execution bundle exported",
      description: `Exported ${bundleRows.length} executions with node details.`,
    });
  };

  const handleExportView = () => {
    const layout = loadLayout(WIDGET_REGISTRY);
    const shareView = createShareView({
      filters,
      datePreset,
      theme: theme as Theme,
      dashboardLayout: layout,
    });

    const json = serializeShareView(shareView);
    const timestamp = new Date().toISOString().split("T")[0];
    downloadJson(json, `share_view_${timestamp}.json`);

    toast({
      title: "View configuration exported",
      description: "Filters, theme, and layout saved to JSON.",
    });
  };

  // ===== Import Functions =====

  const handleImportClick = () => {
    setImportError(null);
    setImportDialogOpen(true);
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const result = await importShareViewFromFile(file);

    if (!result.success) {
      setImportError(result.error ?? "Failed to import");
      return;
    }

    if (result.data) {
      const settings = extractViewSettings(result.data);

      setFilters(settings.filters);
      setDatePreset(settings.datePreset);
      setTheme(settings.theme);
      saveLayout(settings.dashboardLayout);

      setImportDialogOpen(false);
      toast({
        title: "View imported",
        description: "Filters, theme, and layout have been applied. Reload to see layout changes.",
      });
    }

    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const triggerFileInput = () => fileInputRef.current?.click();

  if (!canExport) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2" disabled>
            <ShieldAlert className="h-4 w-4" aria-hidden="true" />
            Export
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          You don’t have permission to export data.
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            <Download className="h-4 w-4" aria-hidden="true" />
            Export
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>Export Data</DropdownMenuLabel>

          <DropdownMenuItem onClick={handleExportExecutions} className="gap-2">
            <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
            Executions CSV
            <span className="ml-auto text-xs text-muted-foreground">
              {filteredExecutions.length}
            </span>
          </DropdownMenuItem>

          <DropdownMenuItem onClick={handleExportNodes} className="gap-2">
            <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
            Node Runs CSV
            <span className="ml-auto text-xs text-muted-foreground">
              {filteredNodeRuns.length}
            </span>
          </DropdownMenuItem>

          <DropdownMenuItem onClick={handleExportBundle} className="gap-2">
            <Share2 className="h-4 w-4" aria-hidden="true" />
            Share Dataset (Bundle)
            <span className="ml-auto text-xs text-muted-foreground">
              {filteredExecutions.length}
            </span>
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuLabel>Share View</DropdownMenuLabel>

          <DropdownMenuItem onClick={handleExportView} className="gap-2">
            <FileJson className="h-4 w-4" aria-hidden="true" />
            Export View Settings
          </DropdownMenuItem>

          <DropdownMenuItem onClick={handleImportClick} className="gap-2">
            <Upload className="h-4 w-4" aria-hidden="true" />
            Import View Settings
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={handleFileSelect}
        className="hidden"
        aria-label="Import view configuration file"
      />

      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import View Settings</DialogTitle>
            <DialogDescription>
              Select a share_view.json file to restore filters, theme, and dashboard layout.
            </DialogDescription>
          </DialogHeader>

          {importError && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {importError}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setImportDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={triggerFileInput} className="gap-2">
              <Upload className="h-4 w-4" aria-hidden="true" />
              Choose File
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
