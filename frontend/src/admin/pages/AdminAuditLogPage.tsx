import { useEffect, useState } from "react";
import { PageShell } from "@/components/PageShell";
import { AdminGuard } from "@/admin/components/AdminGuard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ChevronLeft, ChevronRight, Search, RefreshCw } from "lucide-react";
import { getDataConfig } from "@/data/config";

type AuditLogEntry = {
  id: string;
  created_at: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  target_email: string | null;
  ip: string | null;
  actor_email: string | null;
};

const config = getDataConfig();
const API_BASE = config.apiBaseUrl;

const ACTION_COLORS: Record<string, string> = {
  login_success: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  login_failed: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  user_created: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  user_deleted: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  password_reset_requested: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  password_reset_completed: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  password_set: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  retention_cleanup: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
};

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString();
}

function formatAction(action: string): string {
  return action.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
}

export default function AdminAuditLogPage() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [actions, setActions] = useState<string[]>([]);
  
  // Filters
  const [selectedAction, setSelectedAction] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  
  // Pagination
  const [page, setPage] = useState(0);
  const limit = 50;

  const loadActions = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/audit-log-actions`, { credentials: "include" });
      if (res.ok) setActions(await res.json());
    } catch {}
  };

  const loadLogs = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("limit", String(limit));
      params.set("offset", String(page * limit));
      if (selectedAction && selectedAction !== "all") params.set("action", selectedAction);
      if (dateFrom) params.set("date_from", new Date(dateFrom).toISOString());
      if (dateTo) params.set("date_to", new Date(dateTo + "T23:59:59").toISOString());

      const res = await fetch(`${API_BASE}/api/admin/audit-logs?${params}`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs);
        setTotal(data.total);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadActions();
  }, []);

  useEffect(() => {
    loadLogs();
  }, [page, selectedAction, dateFrom, dateTo]);

  const totalPages = Math.ceil(total / limit);

  const handleSearch = () => {
    setPage(0);
    loadLogs();
  };

  return (
    <AdminGuard>
      <PageShell title="Audit Log" description="Security and admin activity log.">
        {/* Filters */}
        <div className="flex flex-wrap gap-4 mb-6" data-testid="audit-log-filters">
          <div className="w-48">
            <Label className="text-xs text-muted-foreground mb-1 block">Action</Label>
            <Select value={selectedAction} onValueChange={(v) => { setSelectedAction(v); setPage(0); }}>
              <SelectTrigger data-testid="audit-log-action-filter">
                <SelectValue placeholder="All actions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All actions</SelectItem>
                {actions.map(a => (
                  <SelectItem key={a} value={a}>{formatAction(a)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="w-40">
            <Label className="text-xs text-muted-foreground mb-1 block">From</Label>
            <Input 
              type="date" 
              className="dark:[color-scheme:dark]"
              value={dateFrom} 
              onChange={(e) => { setDateFrom(e.target.value); setPage(0); }}
              data-testid="audit-log-date-from"
            />
          </div>

          <div className="w-40">
            <Label className="text-xs text-muted-foreground mb-1 block">To</Label>
            <Input 
              type="date" 
              className="dark:[color-scheme:dark]"
              value={dateTo} 
              onChange={(e) => { setDateTo(e.target.value); setPage(0); }}
              data-testid="audit-log-date-to"
            />
          </div>

          <div className="flex items-end">
            <Button variant="outline" size="sm" onClick={handleSearch} data-testid="audit-log-refresh-btn">
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : (
          <>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[180px]">Time</TableHead>
                    <TableHead className="w-[180px]">Action</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Target</TableHead>
                    <TableHead className="w-[120px]">IP</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                        No audit logs found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    logs.map((log) => (
                      <TableRow key={log.id}>
                        <TableCell className="text-sm">
                          {formatDate(log.created_at)}
                        </TableCell>
                        <TableCell>
                          <Badge 
                            variant="secondary" 
                            className={ACTION_COLORS[log.action] || ""}
                          >
                            {formatAction(log.action)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">
                          {log.actor_email || <span className="text-muted-foreground">System</span>}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {log.target_type && log.target_id ? (
                            <span>
                              {log.target_email || log.target_id.substring(0, 8) + "..."}
                              <span className="text-xs ml-1">({log.target_type})</span>
                            </span>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground font-mono">
                          {log.ip || "—"}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between mt-4">
              <p className="text-sm text-muted-foreground">
                Showing {page * limit + 1}–{Math.min((page + 1) * limit, total)} of {total}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => p + 1)}
                  disabled={page >= totalPages - 1}
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </PageShell>
    </AdminGuard>
  );
}
