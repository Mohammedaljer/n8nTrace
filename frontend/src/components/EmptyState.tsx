import { Link } from "react-router-dom";
import { FileQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";

interface EmptyStateProps {
  readonly icon?: React.ReactNode;
  readonly title: string;
  readonly description: string;
  /** Label for the primary CTA button */
  readonly actionLabel?: string;
  /** Internal route or click handler for the CTA */
  readonly actionHref?: string;
  readonly onAction?: () => void;
}

/**
 * Reusable empty-state placeholder with optional call-to-action.
 * Used on all pages to guide new users when no data is present.
 */
export function EmptyState({ icon, title, description, actionLabel, actionHref, onAction }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center px-4">
      <div className="mb-4 text-muted-foreground">
        {icon ?? <FileQuestion className="h-10 w-10" />}
      </div>
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
      {actionLabel && (actionHref || onAction) && (
        <div className="mt-5">
          {actionHref ? (
            <Button asChild variant="outline" size="sm">
              <Link to={actionHref}>{actionLabel}</Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={onAction}>
              {actionLabel}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
