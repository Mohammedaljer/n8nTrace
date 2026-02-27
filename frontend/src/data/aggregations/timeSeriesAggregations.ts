import type { Execution } from "@/types/execution";

export interface DailyExecutionData {
  readonly date: string;
  readonly success: number;
  readonly error: number;
  readonly other: number;
  readonly total: number;
}

/**
 * Group executions by date for time series visualization
 * Returns data sorted by date ascending
 */
export function groupExecutionsByDay(
  executions: readonly Execution[]
): readonly DailyExecutionData[] {
  const byDate = new Map<string, { success: number; error: number; other: number }>();

  for (const exec of executions) {
    if (!exec.startedAt) continue;

    const dateKey = exec.startedAt.toISOString().split("T")[0];
    const entry = byDate.get(dateKey) ?? { success: 0, error: 0, other: 0 };

    if (exec.status === "success") {
      entry.success++;
    } else if (exec.status === "error" || exec.status === "crashed") {
      entry.error++;
    } else {
      entry.other++;
    }

    byDate.set(dateKey, entry);
  }

  // Convert to array and sort by date
  const result: DailyExecutionData[] = [];

  for (const [date, counts] of byDate) {
    result.push({
      date,
      success: counts.success,
      error: counts.error,
      other: counts.other,
      total: counts.success + counts.error + counts.other,
    });
  }

  return result.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Get the date range from executions
 */
export function getDateRange(
  executions: readonly Execution[]
): { minDate: Date | null; maxDate: Date | null } {
  const dates = executions
    .filter((e) => e.startedAt !== null)
    .map((e) => e.startedAt as Date);

  if (dates.length === 0) {
    return { minDate: null, maxDate: null };
  }

  const timestamps = dates.map((d) => d.getTime());
  return {
    minDate: new Date(Math.min(...timestamps)),
    maxDate: new Date(Math.max(...timestamps)),
  };
}

/**
 * Get failed executions sorted by most recent first
 */
export function getFailedExecutions(
  executions: readonly Execution[],
  limit: number = 10
): readonly Execution[] {
  return executions
    .filter((e) => e.status === "error" || e.status === "crashed")
    .sort((a, b) => {
      const aTime = a.startedAt?.getTime() ?? 0;
      const bTime = b.startedAt?.getTime() ?? 0;
      return bTime - aTime;
    })
    .slice(0, limit);
}
