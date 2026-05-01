import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { listIncidents, type AlertIncident } from "@/data/alertsApi";

function severityClass(severity: string) {
  if (severity === "critical") return "bg-red-100 text-red-800 border-red-200";
  if (severity === "warning") return "bg-amber-100 text-amber-800 border-amber-200";
  return "bg-slate-100 text-slate-800 border-slate-200";
}

export function RecentAlertIncidents(_props: { size: "small" | "medium" | "large" }) {
  const [rows, setRows] = useState<AlertIncident[]>([]);

  useEffect(() => {
    let mounted = true;
    listIncidents({ limit: 5 })
      .then((incidents) => {
        if (!mounted) return;
        setRows(incidents);
      })
      .catch(() => {
        if (!mounted) return;
        setRows([]);
      });

    return () => {
      mounted = false;
    };
  }, []);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Recent Incidents</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">No incidents</p>
        ) : rows.map((row) => (
          <div key={row.id} className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium truncate">{row.title}</p>
              <p className="text-[11px] text-muted-foreground">{row.status}</p>
            </div>
            <Badge variant="outline" className={severityClass(row.severity)}>{row.severity}</Badge>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
