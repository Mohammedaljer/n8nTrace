/**
 * CSV export utilities with formula injection protection.
 * All CSV generation must use these functions.
 */

/**
 * Characters that could trigger formula injection in Excel/Sheets.
 * If a cell starts with these, prefix with a single quote.
 */
const FORMULA_CHARS = ["=", "+", "-", "@", "\t", "\r"];

/**
 * Sanitize a cell value to prevent CSV formula injection.
 * Prefixes dangerous characters with a single quote.
 */
export function sanitizeCsvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  const str = String(value);

  // Check if value starts with formula-triggering characters
  if (str.length > 0 && FORMULA_CHARS.some((char) => str.startsWith(char))) {
    return `'${str}`;
  }

  return str;
}

/**
 * Escape a value for CSV format (handle quotes and commas).
 */
function escapeCsvValue(value: string): string {
  // If value contains comma, newline, or quote, wrap in quotes
  if (value.includes(",") || value.includes("\n") || value.includes('"')) {
    // Escape internal quotes by doubling them
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Convert a single value to a safe, escaped CSV cell.
 */
export function toCsvCell(value: unknown): string {
  const sanitized = sanitizeCsvCell(value);
  return escapeCsvValue(sanitized);
}

/**
 * Convert an array of values to a CSV row string.
 */
export function toCsvRow(values: unknown[]): string {
  return values.map(toCsvCell).join(",");
}

/**
 * Generate a complete CSV string from headers and rows.
 */
export function generateCsv(
  headers: readonly string[],
  rows: readonly (readonly unknown[])[]
): string {
  const headerRow = toCsvRow([...headers]);
  const dataRows = rows.map((row) => toCsvRow([...row]));
  return [headerRow, ...dataRows].join("\n");
}

/**
 * Format a Date for CSV export in ISO format.
 */
export function formatDateForCsv(date: Date | null | undefined): string {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
    return "";
  }
  return date.toISOString();
}

/**
 * Trigger a file download in the browser.
 */
export function downloadBlob(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";

  document.body.appendChild(link);
  link.click();

  // Cleanup
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Download content as a CSV file.
 */
export function downloadCsv(content: string, filename: string): void {
  downloadBlob(content, filename, "text/csv;charset=utf-8;");
}

/**
 * Download content as a JSON file.
 */
export function downloadJson(content: string, filename: string): void {
  downloadBlob(content, filename, "application/json;charset=utf-8;");
}
