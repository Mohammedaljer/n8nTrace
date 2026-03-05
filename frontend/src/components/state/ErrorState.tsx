import { useState } from "react";
import { AlertTriangle, RefreshCw, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ErrorStateProps {
  /** User-friendly error message */
  readonly message?: string;
  /** Additional detail (safe/sanitized only — not raw server errors) */
  readonly details?: string;
  /** Retry callback — if provided, shows a Retry button */
  readonly onRetry?: () => void;
}

/**
 * Reusable error state component with safe messaging and retry support.
 * Never renders raw HTML — all strings are treated as plain text.
 */
export function ErrorState({
  message = "Something went wrong",
  details,
  onRetry,
}: ErrorStateProps) {
  const [showDetails, setShowDetails] = useState(false);

  return (
    <div
      className="flex flex-col items-center justify-center rounded-lg border border-dashed border-destructive/30 bg-destructive/5 py-12 px-4 text-center"
      role="alert"
    >
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
        <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden="true" />
      </div>

      <h3 className="text-lg font-semibold">{message}</h3>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        Please try again. If the problem persists, check the server logs or contact your administrator.
      </p>

      {details && (
        <div className="mt-3 w-full max-w-md">
          <button
            type="button"
            onClick={() => setShowDetails((s) => !s)}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
            aria-expanded={showDetails}
          >
            {showDetails ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {showDetails ? "Hide details" : "Show details"}
          </button>
          {showDetails && (
            <p className="mt-2 rounded-md bg-muted p-3 text-xs text-muted-foreground text-left break-words">
              {details}
            </p>
          )}
        </div>
      )}

      {onRetry && (
        <Button variant="outline" size="sm" className="mt-5" onClick={onRetry}>
          <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
          Retry
        </Button>
      )}
    </div>
  );
}
