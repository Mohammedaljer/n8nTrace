/**
 * Text sanitization utilities to prevent XSS and ensure safe rendering.
 * All user-visible text should pass through these utilities.
 */

/**
 * Sanitizes a string for safe display by removing control characters
 * and ensuring it's a valid string. Does NOT escape HTML entities -
 * React handles that automatically for text content.
 */
export function sanitizeText(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  const str = String(value);

  // Remove control characters except newlines and tabs
  // eslint-disable-next-line no-control-regex
  return str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

/**
 * Truncates text to a maximum length with ellipsis.
 * Safe for display - does not break mid-character.
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1).trimEnd() + "…";
}

/**
 * Formats a number for display with locale-appropriate formatting.
 */
export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString();
}

/**
 * Safely formats a date for display.
 * Returns a safe fallback for null/invalid dates.
 */
export function formatSafeDate(
  date: Date | null | undefined,
  options?: Intl.DateTimeFormatOptions
): string {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
    return "—";
  }

  try {
    return date.toLocaleString(undefined, options);
  } catch {
    return "—";
  }
}

/**
 * Validates that a string is a safe ID (alphanumeric, hyphens, underscores).
 */
export function isValidId(id: unknown): id is string {
  if (typeof id !== "string") return false;
  return /^[\w-]+$/.test(id) && id.length > 0 && id.length < 256;
}
