import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAlertsOverview } from "@/data/alertsApi";
import { BellRing } from "lucide-react";

export function AlertsActiveCount(_props: { size: "small" | "medium" | "large" }) {
  const [value, setValue] = useState<number | null>(null);

  useEffect(() => {
    let mounted = true;
    getAlertsOverview()
      .then((overview) => {
        if (!mounted) return;
        setValue(overview.active.active_count);
      })
      .catch(() => {
        if (!mounted) return;
        setValue(null);
      });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <BellRing className="h-4 w-4" />
          Active Alerts
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-semibold">{value ?? "-"}</p>
      </CardContent>
    </Card>
  );
}
