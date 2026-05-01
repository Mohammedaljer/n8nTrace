import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getAlertsOverview } from "@/data/alertsApi";

type SeverityState = {
  info: number;
  warning: number;
  critical: number;
};

export function AlertsBySeverity(_props: { size: "small" | "medium" | "large" }) {
  const [state, setState] = useState<SeverityState | null>(null);

  useEffect(() => {
    let mounted = true;
    getAlertsOverview()
      .then((overview) => {
        if (!mounted) return;
        setState({
          info: overview.active.info_count,
          warning: overview.active.warning_count,
          critical: overview.active.critical_count,
        });
      })
      .catch(() => {
        if (!mounted) return;
        setState(null);
      });

    return () => {
      mounted = false;
    };
  }, []);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Alerts by Severity</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Critical</span>
          <Badge variant="outline" className="bg-red-100 text-red-800 border-red-200">{state?.critical ?? "-"}</Badge>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Warning</span>
          <Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-200">{state?.warning ?? "-"}</Badge>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Info</span>
          <Badge variant="outline" className="bg-slate-100 text-slate-800 border-slate-200">{state?.info ?? "-"}</Badge>
        </div>
      </CardContent>
    </Card>
  );
}
