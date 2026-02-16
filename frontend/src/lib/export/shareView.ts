/**
 * Share view JSON schema and import/export utilities.
 * Allows users to export and import their dashboard configuration.
 */

import { z } from "zod";
import type { ExecutionFilters, DatePreset } from "@/types/execution";
import type { DashboardLayout } from "@/components/dashboard/widgetRegistry";

// ===== Schema Definitions =====

const widgetSizeSchema = z.enum(["small", "medium", "large"]);

const widgetLayoutItemSchema = z.object({
  id: z.string().min(1).max(100),
  visible: z.boolean(),
  size: widgetSizeSchema,
  order: z.number().int().min(0).max(100),
});

const dashboardLayoutSchema = z.object({
  widgets: z.array(widgetLayoutItemSchema).max(50),
  version: z.number().int().min(1).max(100),
});

const themeSchema = z.enum(["light", "dark", "system"]);

const datePresetSchema = z.enum(["today", "yesterday", "last7days", "last30days", "custom"]);

const filtersSchema = z.object({
  instanceId: z.string().max(100).optional(),
  dateFrom: z.string().max(50).optional(),
  dateTo: z.string().max(50).optional(),
  status: z.enum(["success", "error", "running", "waiting", "crashed", "unknown"]).optional(),
  workflowId: z.string().max(100).optional(),
  search: z.string().max(500).optional(),
  mode: z.string().max(50).optional(),
  finished: z.boolean().optional(),
  durationMsMin: z.number().int().min(0).optional(),
  durationMsMax: z.number().int().min(0).optional(),
  nodeNameContains: z.string().max(200).optional(),
  nodeTypeContains: z.string().max(200).optional(),
  itemsOutMin: z.number().int().min(0).optional(),
  itemsOutMax: z.number().int().min(0).optional(),
  executionTimeMsMin: z.number().int().min(0).optional(),
  executionTimeMsMax: z.number().int().min(0).optional(),
}).strict();

const shareViewSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string(),
  filters: filtersSchema,
  datePreset: datePresetSchema,
  theme: themeSchema,
  dashboardLayout: dashboardLayoutSchema,
}).strict();

export type ShareViewData = z.infer<typeof shareViewSchema>;
export type Theme = z.infer<typeof themeSchema>;

// ===== Export Functions =====

export interface ExportViewParams {
  filters: ExecutionFilters;
  datePreset: DatePreset;
  theme: Theme;
  dashboardLayout: DashboardLayout;
}

/**
 * Create a shareable view JSON object.
 */
export function createShareView(params: ExportViewParams): ShareViewData {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    filters: params.filters,
    datePreset: params.datePreset,
    theme: params.theme,
    dashboardLayout: params.dashboardLayout,
  };
}

/**
 * Serialize share view to JSON string.
 */
export function serializeShareView(data: ShareViewData): string {
  return JSON.stringify(data, null, 2);
}

// ===== Import Functions =====

export interface ImportResult {
  success: boolean;
  data?: ShareViewData;
  error?: string;
}

/**
 * Parse and validate a share view JSON string.
 */
export function parseShareView(jsonString: string): ImportResult {
  try {
    const parsed = JSON.parse(jsonString);
    const validated = shareViewSchema.parse(parsed);
    return { success: true, data: validated };
  } catch (err) {
    if (err instanceof z.ZodError) {
      const issues = err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      return { success: false, error: `Invalid format: ${issues}` };
    }
    if (err instanceof SyntaxError) {
      return { success: false, error: "Invalid JSON format" };
    }
    return { success: false, error: "Failed to parse view configuration" };
  }
}

/**
 * Read a File object and parse it as share view.
 */
export async function importShareViewFromFile(file: File): Promise<ImportResult> {
  try {
    // Validate file type
    if (!file.name.endsWith(".json")) {
      return { success: false, error: "File must be a .json file" };
    }

    // Validate file size (max 100KB)
    if (file.size > 100 * 1024) {
      return { success: false, error: "File is too large (max 100KB)" };
    }

    const content = await file.text();
    return parseShareView(content);
  } catch {
    return { success: false, error: "Failed to read file" };
  }
}

// ===== Apply Functions =====

export interface ApplyViewResult {
  filters: ExecutionFilters;
  datePreset: DatePreset;
  theme: Theme;
  dashboardLayout: DashboardLayout;
}

/**
 * Extract applicable settings from validated share view.
 */
export function extractViewSettings(data: ShareViewData): ApplyViewResult {
  return {
    filters: data.filters as ExecutionFilters,
    datePreset: data.datePreset,
    theme: data.theme,
    dashboardLayout: data.dashboardLayout as DashboardLayout,
  };
}
