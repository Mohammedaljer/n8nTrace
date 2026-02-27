import {
  startOfHour,
  startOfDay,
  startOfWeek,
  format,
  differenceInHours,
  differenceInDays,
} from "date-fns";
import type { Execution } from "@/types/execution";

/**
 * Time bucket granularity based on date range
 */
export type BucketGranularity = "hour" | "day" | "week";

/**
 * Single time bucket data point
 */
export interface TimeBucketData {
  readonly bucketKey: string;
  readonly bucketLabel: string;
  readonly bucketStart: Date;
  readonly success: number;
  readonly error: number;
  readonly total: number;
}

/**
 * Result of time series aggregation
 */
export interface TimeSeriesResult {
  readonly granularity: BucketGranularity;
  readonly buckets: readonly TimeBucketData[];
}

/**
 * Determine the appropriate bucket granularity based on date range
 * - <= 48 hours: hour buckets
 * - <= 31 days: day buckets
 * - else: week buckets
 */
export function determineBucketGranularity(
  dateFrom: Date,
  dateTo: Date
): BucketGranularity {
  const hoursDiff = differenceInHours(dateTo, dateFrom);
  
  if (hoursDiff <= 48) {
    return "hour";
  }
  
  const daysDiff = differenceInDays(dateTo, dateFrom);
  
  if (daysDiff <= 31) {
    return "day";
  }
  
  return "week";
}

/**
 * Get bucket key and start date for an execution based on granularity
 */
function getBucketInfo(
  date: Date,
  granularity: BucketGranularity
): { key: string; start: Date } {
  switch (granularity) {
    case "hour": {
      const start = startOfHour(date);
      return {
        key: format(start, "yyyy-MM-dd'T'HH:00"),
        start,
      };
    }
    case "day": {
      const start = startOfDay(date);
      return {
        key: format(start, "yyyy-MM-dd"),
        start,
      };
    }
    case "week": {
      const start = startOfWeek(date, { weekStartsOn: 1 }); // Monday
      return {
        key: format(start, "yyyy-'W'ww"),
        start,
      };
    }
  }
}

/**
 * Format bucket label for display
 */
function formatBucketLabel(start: Date, granularity: BucketGranularity): string {
  switch (granularity) {
    case "hour":
      return format(start, "MMM d, HH:mm");
    case "day":
      return format(start, "MMM d");
    case "week":
      return `Week of ${format(start, "MMM d")}`;
  }
}

/**
 * Aggregate executions into time buckets with adaptive granularity
 * 
 * @param executions - List of executions to aggregate
 * @param dateFrom - Start of date range (optional, auto-detected if not provided)
 * @param dateTo - End of date range (optional, auto-detected if not provided)
 * @returns Time series data with determined granularity
 */
export function aggregateExecutionsByTimeBucket(
  executions: readonly Execution[],
  dateFrom?: Date,
  dateTo?: Date
): TimeSeriesResult {
  // Filter executions with valid start times
  const validExecutions = executions.filter((e) => e.startedAt !== null);
  
  if (validExecutions.length === 0) {
    return {
      granularity: "day",
      buckets: [],
    };
  }

  // Determine date range from filters or data
  const timestamps = validExecutions.map((e) => (e.startedAt as Date).getTime());
  const minTimestamp = Math.min(...timestamps);
  const maxTimestamp = Math.max(...timestamps);
  
  const effectiveFrom = dateFrom ?? new Date(minTimestamp);
  const effectiveTo = dateTo ?? new Date(maxTimestamp);
  
  // Determine granularity
  const granularity = determineBucketGranularity(effectiveFrom, effectiveTo);
  
  // Aggregate into buckets
  const bucketMap = new Map<string, { start: Date; success: number; error: number }>();
  
  for (const exec of validExecutions) {
    const { key, start } = getBucketInfo(exec.startedAt as Date, granularity);
    
    const existing = bucketMap.get(key) ?? { start, success: 0, error: 0 };
    
    if (exec.status === "success") {
      existing.success++;
    } else if (exec.status === "error" || exec.status === "crashed") {
      existing.error++;
    }
    // Ignore "other" statuses for clarity in the chart
    
    bucketMap.set(key, existing);
  }
  
  // Convert to sorted array
  const buckets: TimeBucketData[] = [];
  
  for (const [bucketKey, data] of bucketMap) {
    buckets.push({
      bucketKey,
      bucketLabel: formatBucketLabel(data.start, granularity),
      bucketStart: data.start,
      success: data.success,
      error: data.error,
      total: data.success + data.error,
    });
  }
  
  // Sort by bucket start time
  buckets.sort((a, b) => a.bucketStart.getTime() - b.bucketStart.getTime());
  
  return {
    granularity,
    buckets,
  };
}

/**
 * Get a human-readable description of the granularity
 */
export function getGranularityLabel(granularity: BucketGranularity): string {
  switch (granularity) {
    case "hour":
      return "Hourly";
    case "day":
      return "Daily";
    case "week":
      return "Weekly";
  }
}
