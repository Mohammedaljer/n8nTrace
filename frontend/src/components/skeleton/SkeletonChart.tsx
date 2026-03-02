import { Skeleton } from "@/components/ui/skeleton";

interface SkeletonChartProps {
  /** Height class for the chart area (default: "h-64") */
  readonly height?: string;
}

/**
 * Skeleton placeholder for chart areas.
 * Shows a card frame with a shimmering chart-like area.
 */
export function SkeletonChart({ height = "h-64" }: SkeletonChartProps) {
  return (
    <div className="rounded-lg border bg-card p-4 space-y-3" role="status" aria-label="Loading chart">
      <div className="flex items-center justify-between">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-4 w-20" />
      </div>
      <Skeleton className={`${height} w-full rounded-md`} />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
