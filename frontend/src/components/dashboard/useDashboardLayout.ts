import { useState, useCallback, useEffect } from "react";
import type { DashboardLayout, WidgetLayoutItem, WidgetSize, WidgetDefinition } from "./widgetRegistry";
import { loadLayout, saveLayout, resetLayout, getDefaultLayout } from "./widgetRegistry";

interface UseDashboardLayoutReturn {
  layout: DashboardLayout;
  isCustomizing: boolean;
  setIsCustomizing: (value: boolean) => void;
  toggleWidgetVisibility: (widgetId: string) => void;
  setWidgetSize: (widgetId: string, size: WidgetSize) => void;
  reorderWidgets: (fromIndex: number, toIndex: number) => void;
  resetToDefault: () => void;
  getVisibleWidgets: () => WidgetLayoutItem[];
}

export function useDashboardLayout(registry: readonly WidgetDefinition[]): UseDashboardLayoutReturn {
  const [layout, setLayout] = useState<DashboardLayout>(() => loadLayout(registry));
  const [isCustomizing, setIsCustomizing] = useState(false);

  // Save to localStorage whenever layout changes
  useEffect(() => {
    saveLayout(layout);
  }, [layout]);

  const toggleWidgetVisibility = useCallback((widgetId: string) => {
    setLayout((prev) => ({
      ...prev,
      widgets: prev.widgets.map((w) =>
        w.id === widgetId ? { ...w, visible: !w.visible } : w
      ),
    }));
  }, []);

  const setWidgetSize = useCallback((widgetId: string, size: WidgetSize) => {
    setLayout((prev) => ({
      ...prev,
      widgets: prev.widgets.map((w) =>
        w.id === widgetId ? { ...w, size } : w
      ),
    }));
  }, []);

  const reorderWidgets = useCallback((fromIndex: number, toIndex: number) => {
    setLayout((prev) => {
      const widgets = [...prev.widgets];
      const [moved] = widgets.splice(fromIndex, 1);
      widgets.splice(toIndex, 0, moved);
      
      // Update order values
      const reordered = widgets.map((w, idx) => ({ ...w, order: idx }));
      
      return { ...prev, widgets: reordered };
    });
  }, []);

  const resetToDefault = useCallback(() => {
    resetLayout();
    setLayout(getDefaultLayout(registry));
  }, [registry]);

  const getVisibleWidgets = useCallback(() => {
    return layout.widgets
      .filter((w) => w.visible)
      .sort((a, b) => a.order - b.order);
  }, [layout.widgets]);

  return {
    layout,
    isCustomizing,
    setIsCustomizing,
    toggleWidgetVisibility,
    setWidgetSize,
    reorderWidgets,
    resetToDefault,
    getVisibleWidgets,
  };
}
