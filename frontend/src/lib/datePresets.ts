import { startOfDay, endOfDay, subDays, format } from "date-fns";

export type DatePresetId = "today" | "yesterday" | "last7days" | "last30days" | "custom";

export interface DatePreset {
  id: DatePresetId;
  label: string;
  getRange: () => { from: string; to: string };
}

/**
 * Format date as ISO string for filters (YYYY-MM-DDTHH:mm)
 */
export function formatDateTimeForFilter(date: Date): string {
  return format(date, "yyyy-MM-dd'T'HH:mm");
}

/**
 * Get the start and end of today in local time
 * 'from' is start of today (00:00), 'to' is current time (now)
 */
function getTodayRange(): { from: string; to: string } {
  const now = new Date();
  return {
    from: formatDateTimeForFilter(startOfDay(now)),
    to: formatDateTimeForFilter(now),  // Current time, not end of day
  };
}

/**
 * Get the start and end of yesterday in local time
 */
function getYesterdayRange(): { from: string; to: string } {
  const yesterday = subDays(new Date(), 1);
  return {
    from: formatDateTimeForFilter(startOfDay(yesterday)),
    to: formatDateTimeForFilter(endOfDay(yesterday)),
  };
}

/**
 * Get range for last N days (including today)
 * 'from' is start of N days ago, 'to' is current time (now)
 */
function getLastNDaysRange(n: number): { from: string; to: string } {
  const now = new Date();
  const start = subDays(now, n - 1);
  return {
    from: formatDateTimeForFilter(startOfDay(start)),
    to: formatDateTimeForFilter(now),  // Current time, not end of day
  };
}

export const DATE_PRESETS: DatePreset[] = [
  {
    id: "today",
    label: "Today",
    getRange: getTodayRange,
  },
  {
    id: "yesterday",
    label: "Yesterday",
    getRange: getYesterdayRange,
  },
  {
    id: "last7days",
    label: "Last 7 days",
    getRange: () => getLastNDaysRange(7),
  },
  {
    id: "last30days",
    label: "Last 30 days",
    getRange: () => getLastNDaysRange(30),
  },
];

/**
 * Detect which preset matches the current date range (if any)
 */
export function detectDatePreset(dateFrom?: string, dateTo?: string): DatePresetId {
  if (!dateFrom || !dateTo) return "custom";

  for (const preset of DATE_PRESETS) {
    const range = preset.getRange();
    // Compare just the date parts for simpler matching
    const fromDate = dateFrom.split("T")[0];
    const toDate = dateTo.split("T")[0];
    const presetFromDate = range.from.split("T")[0];
    const presetToDate = range.to.split("T")[0];

    if (fromDate === presetFromDate && toDate === presetToDate) {
      return preset.id;
    }
  }

  return "custom";
}

/**
 * Get preset by ID
 */
export function getPresetById(id: DatePresetId): DatePreset | undefined {
  return DATE_PRESETS.find((p) => p.id === id);
}
