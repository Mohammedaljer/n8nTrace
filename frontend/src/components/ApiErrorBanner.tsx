import { AlertTriangle, FileText, Settings } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { isApiMode } from "@/data/config";

interface ApiErrorBannerProps {
  error: string;
}

export function ApiErrorBanner({ error }: ApiErrorBannerProps) {
  // Only show API-specific guidance if in API mode
  if (!isApiMode()) {
    return (
      <Alert variant="destructive" className="mx-auto max-w-2xl">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Data Loading Error</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert variant="destructive" className="mx-auto max-w-2xl">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>API Connection Failed</AlertTitle>
      <AlertDescription className="mt-2 space-y-4">
        <p>{error}</p>
        
        <div className="rounded-md bg-destructive/10 p-4 text-sm">
          <p className="font-medium mb-2">To fix this issue:</p>
          <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
            <li>
              <strong>Switch to CSV mode:</strong> Set{" "}
              <code className="rounded bg-muted px-1 py-0.5">VITE_DATA_MODE=csv</code>{" "}
              in your environment
            </li>
            <li>
              <strong>Or start the backend:</strong> Ensure your API server is running at the configured URL
            </li>
            <li>
              <strong>Check the URL:</strong> Verify{" "}
              <code className="rounded bg-muted px-1 py-0.5">VITE_API_BASE_URL</code>{" "}
              points to your backend
            </li>
          </ol>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" size="sm" asChild>
            <a href="/help">
              <FileText className="mr-2 h-4 w-4" />
              View Help Guide
            </a>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a 
              href="https://github.com/your-repo/SECURITY.md" 
              target="_blank" 
              rel="noopener noreferrer"
            >
              <Settings className="mr-2 h-4 w-4" />
              Configuration Docs
            </a>
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
