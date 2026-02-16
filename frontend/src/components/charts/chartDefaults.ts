/**
 * Shared chart defaults and utilities for consistent chart styling
 * Follows best practices to reduce chartjunk (Nielsen Norman Group guidelines)
 */

/**
 * Standard chart height in pixels
 */
export const DEFAULT_CHART_HEIGHT = 280;

/**
 * Standard margins for charts (compact design, minimal chartjunk)
 */
export const DEFAULT_CHART_MARGIN = {
  top: 12,
  right: 12,
  left: 0,
  bottom: 0,
} as const;

/**
 * Margins for horizontal bar charts (need more left space for labels)
 */
export const HORIZONTAL_CHART_MARGIN = {
  top: 8,
  right: 24,
  left: 0,
  bottom: 8,
} as const;

/**
 * Shared axis props for minimal visual clutter
 */
export const DEFAULT_AXIS_PROPS = {
  tick: { fontSize: 11 },
  tickLine: false,
  axisLine: false,
} as const;

/**
 * Shared grid props for subtle background reference lines
 */
export const DEFAULT_GRID_PROPS = {
  strokeDasharray: "3 3",
  className: "stroke-border/50",
  vertical: false,
} as const;

/**
 * Value formatters for common data types
 */
export const formatters = {
  /**
   * Format milliseconds to human-readable duration
   */
  duration: (ms: number): string => {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  },

  /**
   * Format seconds to human-readable duration
   */
  seconds: (sec: number): string => {
    const ms = sec * 1000;
    return formatters.duration(ms);
  },

  /**
   * Format bytes to human-readable size
   */
  bytes: (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  },

  /**
   * Format bytes to short form for Y-axis labels
   */
  bytesShort: (bytes: number): string => {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}K`;
    if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))}M`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}G`;
  },

  /**
   * Format percentage (0-1 range to display)
   */
  percent: (value: number): string => {
    return `${(value * 100).toFixed(0)}%`;
  },

  /**
   * Format percentage for axis (compact)
   */
  percentAxis: (value: number): string => {
    return `${(value * 100).toFixed(0)}%`;
  },

  /**
   * Format latency in seconds to ms display
   */
  latency: (seconds: number): string => {
    return `${(seconds * 1000).toFixed(0)}ms`;
  },

  /**
   * Format count numbers with locale separators
   */
  count: (value: number): string => {
    return value.toLocaleString();
  },
} as const;

/**
 * Common chart color definitions using CSS variables
 * These map to both light and dark theme values
 */
export const chartColors = {
  success: "hsl(var(--success))",
  error: "hsl(var(--destructive))",
  warning: "hsl(var(--warning))",
  primary: "hsl(var(--primary))",
  muted: "hsl(var(--muted-foreground))",
} as const;

/**
 * Type-safe chart config builder helper
 */
export type ChartColorKey = keyof typeof chartColors;
