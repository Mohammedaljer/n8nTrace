import { Skeleton } from "@/components/ui/skeleton";

interface SkeletonCardProps {
  /** Number of cards to render */
  readonly count?: number;
  /** Height class for each card (default: "h-28") */
  readonly height?: string;
  /** Grid columns class (default: responsive auto-fit) */
  readonly className?: string;
}

/**
 * Skeleton placeholder for dashboard/KPI card grids.
 * Shows animated shimmer placeholders to reduce layout shift during data loading.
 */
export function SkeletonCard({ count = 4, height = "h-28", className }: SkeletonCardProps) {
  return (
    <div className={className ?? "grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4"} role="status" aria-label="Loading cards">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-lg border bg-card p-4 space-y-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className={`${height} w-full`} />
          <Skeleton className="h-3 w-16" />
        </div>
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}
