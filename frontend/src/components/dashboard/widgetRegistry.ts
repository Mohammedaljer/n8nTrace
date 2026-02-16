import type { ComponentType } from "react";

export type WidgetSize = "small" | "medium" | "large";

// Widget category for grouping in customize panel
export type WidgetCategory = "metrics" | "analytics";

export interface WidgetDefinition {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly component: ComponentType<{ size: WidgetSize }>;
  readonly defaultOrder: number;
  readonly defaultSize: WidgetSize;
  readonly defaultVisible: boolean;
  readonly allowedSizes: readonly WidgetSize[];
  readonly category: WidgetCategory;
  // For metrics widgets: permission required
  readonly requiresPermission?: "metrics.read.version" | "metrics.read.full";
  // For metrics widgets: requires metrics feature to be enabled
  readonly requiresMetricsEnabled?: boolean;
}

export interface WidgetLayoutItem {
  id: string;
  visible: boolean;
  size: WidgetSize;
  order: number;
}

export interface DashboardLayout {
  widgets: WidgetLayoutItem[];
  version: number;
}

// Grid column spans for each size
export const SIZE_COLS: Record<WidgetSize, string> = {
  small: "lg:col-span-1",
  medium: "lg:col-span-2",
  large: "lg:col-span-3",
};

export const SIZE_LABELS: Record<WidgetSize, string> = {
  small: "Small",
  medium: "Medium",
  large: "Large",
};

// Bump version when adding new widgets to force layout refresh
const LAYOUT_VERSION = 2;
const STORAGE_KEY = "n8n-dashboard-layout";

export function getDefaultLayout(registry: readonly WidgetDefinition[]): DashboardLayout {
  return {
    version: LAYOUT_VERSION,
    widgets: registry.map((w) => ({
      id: w.id,
      visible: w.defaultVisible,
      size: w.defaultSize,
      order: w.defaultOrder,
    })),
  };
}

export function loadLayout(registry: readonly WidgetDefinition[]): DashboardLayout {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return getDefaultLayout(registry);

    const parsed = JSON.parse(stored) as DashboardLayout;
    
    // Version check - reset if outdated
    if (parsed.version !== LAYOUT_VERSION) {
      return getDefaultLayout(registry);
    }

    // Merge with registry to handle new/removed widgets
    const existingIds = new Set(parsed.widgets.map((w) => w.id));
    const registryIds = new Set(registry.map((w) => w.id));

    // Keep existing valid widgets
    const validWidgets = parsed.widgets.filter((w) => registryIds.has(w.id));

    // Add any new widgets from registry
    const newWidgets = registry
      .filter((w) => !existingIds.has(w.id))
      .map((w) => ({
        id: w.id,
        visible: w.defaultVisible,
        size: w.defaultSize,
        order: w.defaultOrder,
      }));

    return {
      version: LAYOUT_VERSION,
      widgets: [...validWidgets, ...newWidgets].sort((a, b) => a.order - b.order),
    };
  } catch {
    return getDefaultLayout(registry);
  }
}

export function saveLayout(layout: DashboardLayout): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    console.warn("Failed to save dashboard layout to localStorage");
  }
}

export function resetLayout(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    console.warn("Failed to reset dashboard layout");
  }
}
