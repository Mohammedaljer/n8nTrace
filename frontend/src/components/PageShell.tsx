import { type ReactNode, useEffect } from "react";
import { Skeleton } from "@/components/ui/skeleton";

interface PageShellProps {
  readonly title: React.ReactNode;
  readonly description?: string;
  readonly headerActions?: ReactNode;
  readonly children: React.ReactNode;
}

export function PageShell({ title, description, headerActions, children }: PageShellProps) {
  useEffect(() => {
    const text = typeof title === "string" ? title : "";
    if (text) document.title = `n8n-trace - ${text}`;
    return () => { document.title = "n8n-trace"; };
  }, [title]);
  return (
    <div className="flex flex-col gap-6 p-6 lg:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {description && (
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {headerActions && (
          <div className="flex shrink-0 items-center gap-2">
            {headerActions}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

export function PageShellSkeleton() {
  return (
    <div className="flex flex-col gap-6 p-6 lg:p-8">
      <div>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-2 h-4 w-72" />
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-lg" />
        ))}
      </div>
    </div>
  );
}
