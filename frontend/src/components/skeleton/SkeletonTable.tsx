import { Skeleton } from "@/components/ui/skeleton";

interface SkeletonTableProps {
  /** Number of rows to render (default: 6) */
  readonly rows?: number;
  /** Number of columns to render (default: 5) */
  readonly columns?: number;
  /** Whether to show a header row (default: true) */
  readonly showHeader?: boolean;
}

/**
 * Skeleton placeholder for data tables.
 * Renders a realistic table shimmer including optional header row.
 */
export function SkeletonTable({ rows = 6, columns = 5, showHeader = true }: SkeletonTableProps) {
  // Vary column widths for visual realism
  const colWidths = ["w-24", "w-32", "w-40", "w-20", "w-28", "w-36", "w-16"];

  return (
    <div className="rounded-lg border bg-card overflow-hidden" role="status" aria-label="Loading table">
      {showHeader && (
        <div className="flex gap-4 border-b bg-muted/30 px-4 py-3">
          {Array.from({ length: columns }).map((_, i) => (
            <Skeleton key={i} className={`h-4 ${colWidths[i % colWidths.length]}`} />
          ))}
        </div>
      )}
      {Array.from({ length: rows }).map((_, rowIdx) => (
        <div key={rowIdx} className="flex items-center gap-4 border-b last:border-b-0 px-4 py-3">
          {Array.from({ length: columns }).map((_, colIdx) => (
            <Skeleton
              key={colIdx}
              className={`h-4 ${colWidths[(colIdx + rowIdx) % colWidths.length]}`}
            />
          ))}
        </div>
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}
