import { PageShell } from "@/components/PageShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  FileText,
  RefreshCw,
  Filter,
  AlertTriangle,
  Download,
  Share2,
  User,
  Info,
} from "lucide-react";
import { useData } from "@/data/DataContext";
import { useAuth } from "@/security/AuthContext";

const guides = [
  {
    icon: <FileText className="h-5 w-5 text-primary" />,
    title: "1. Load your data",
    body: "Ensure the backend can access n8n data (API mode). Then refresh the UI to fetch workflows/executions.",
  },
  {
    icon: <RefreshCw className="h-5 w-5 text-primary" />,
    title: "2. Refresh the app",
    body: "If you changed credentials or data sources, refresh the browser and re-login if needed.",
  },
  {
    icon: <Filter className="h-5 w-5 text-primary" />,
    title: "3. Use filters",
    body: 'Use the filter bar at the top of each page to narrow down by date range, status, workflow, or search term.',
  },
] as const;

export default function HelpPage() {
  const { loadResult } = useData();
  const { state } = useAuth();

  const warnings = loadResult?.warnings ?? [];
  const skippedTotal = (loadResult?.skippedExecutions ?? 0) + (loadResult?.skippedNodes ?? 0);

  const userLabel =
    state.status === "authenticated" ? state.user.email : "Not authenticated";

  return (
    <PageShell title="Help" description="A quick guide to get started with the analytics dashboard.">
      <div className="grid gap-4 md:grid-cols-3">
        {guides.map((guide) => (
          <Card key={guide.title}>
            <CardHeader className="flex flex-row items-center gap-3 pb-2">
              {guide.icon}
              <CardTitle className="text-base">{guide.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{guide.body}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Alert variant="default">
        <User className="h-5 w-5" />
        <AlertTitle>Signed in</AlertTitle>
        <AlertDescription>
          Current user: <strong>{userLabel}</strong>
        </AlertDescription>
      </Alert>

      {skippedTotal > 0 && (
        <Card className="border-warning/50">
          <CardHeader className="flex flex-row items-center gap-3 pb-2">
            <AlertTriangle className="h-5 w-5 text-warning" />
            <CardTitle className="text-base">Parsing Warnings</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-sm text-muted-foreground">
              {skippedTotal} row(s) were skipped during parsing due to missing or invalid data.
            </p>
            {warnings.length > 0 && (
              <div className="max-h-48 overflow-y-auto rounded-md bg-muted p-3 font-mono text-xs">
                {warnings.slice(0, 20).map((w, i) => (
                  <div key={i} className="py-0.5">
                    {w}
                  </div>
                ))}
                {warnings.length > 20 && (
                  <div className="pt-2 text-muted-foreground">
                    ...and {warnings.length - 20} more warnings
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center gap-3 pb-2">
          <Download className="h-5 w-5 text-primary" />
          <CardTitle className="text-base">Export Formats</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div>
            <p className="font-medium flex items-center gap-2">
              <Share2 className="h-4 w-4" aria-hidden="true" />
              Executions CSV
            </p>
            <p className="text-muted-foreground mt-1">
              Exports filtered execution data (IDs, status, timestamps, duration, node counts).
            </p>
          </div>
          <div>
            <p className="font-medium flex items-center gap-2">
              <Share2 className="h-4 w-4" aria-hidden="true" />
              Node Runs CSV
            </p>
            <p className="text-muted-foreground mt-1">
              Exports filtered node execution data (node name/type, timing, items out).
            </p>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-center gap-3 pb-2">
          <Info className="h-5 w-5 text-primary" />
          <CardTitle className="text-base">About n8n Pulse</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-1">
          <p>
            <span className="text-muted-foreground">Version:</span>{" "}
            <span className="font-mono font-medium">v{__APP_VERSION__}</span>
          </p>
          <p className="text-muted-foreground">
            Self-hosted analytics dashboard for n8n workflows &amp; instance health.
          </p>
        </CardContent>
      </Card>
    </PageShell>
  );
}
