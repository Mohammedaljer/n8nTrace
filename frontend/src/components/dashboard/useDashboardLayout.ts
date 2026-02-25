import { useState, useCallback, useEffect } from "react";
import type { DashboardLayout, WidgetLayoutItem, WidgetSize, WidgetDefinition } from "./widgetRegistry";
import { loadLayout, saveLayout, resetLayout, getDefaultLayout, SIZE_GRID_COLS } from "./widgetRegistry";

interface UseDashboardLayoutReturn {
  layout: DashboardLayout;
  isCustomizing: boolean;
  setIsCustomizing: (value: boolean) => void;
  toggleWidgetVisibility: (widgetId: string) => void;
  setWidgetSize: (widgetId: string, size: WidgetSize) => void;
  reorderWidgets: (fromIndex: number, toIndex: number) => void;
  autoArrange: () => void;
  resetToDefault: () => void;
  getVisibleWidgets: () => WidgetLayoutItem[];
}

/**
 * Auto-arrange algorithm: Deterministic 2D bin-packing with gap removal
 * 
 * Strategy:
 * 1. Process widgets in their current order (by `order` field)
 * 2. Place each widget in the first available position (top-to-bottom, left-to-right)
 * 3. Output widgets sorted by their packed (row, col) position
 * 
 * This ensures:
 * - Same input always produces same output (deterministic)
 * - Gaps are removed by packing widgets tightly
 * - Mixed sizes (Small=1, Medium=2, Large=3 cols) work correctly
 * - Clicking twice produces identical results
 */
function computeAutoArrangedOrder(widgets: WidgetLayoutItem[], _registry: readonly WidgetDefinition[]): WidgetLayoutItem[] {
  const visible = widgets.filter(w => w.visible).sort((a, b) => a.order - b.order);
  const hidden = widgets.filter(w => !w.visible);
  
  if (visible.length === 0) return widgets;

  const GRID_COLS = 3;
  const getColSpan = (size: WidgetSize): number => SIZE_GRID_COLS[size] || 3;
  
  // Grid occupancy tracker: grid[row][col] = true if occupied
  // We'll grow rows as needed
  const grid: boolean[][] = [];
  
  const ensureRow = (row: number) => {
    while (grid.length <= row) {
      grid.push(new Array(GRID_COLS).fill(false));
    }
  };
  
  // Find first available position for a widget of given width
  const findPosition = (width: number): { row: number; col: number } => {
    let row = 0;
    while (true) {
      ensureRow(row);
      for (let col = 0; col <= GRID_COLS - width; col++) {
        // Check if all cells for this widget are free
        let fits = true;
        for (let c = col; c < col + width; c++) {
          if (grid[row][c]) {
            fits = false;
            break;
          }
        }
        if (fits) {
          return { row, col };
        }
      }
      row++;
    }
  };
  
  // Mark cells as occupied
  const occupy = (row: number, col: number, width: number) => {
    ensureRow(row);
    for (let c = col; c < col + width; c++) {
      grid[row][c] = true;
    }
  };
  
  // Pack each widget and record its position
  const packed: Array<{ widget: WidgetLayoutItem; row: number; col: number }> = [];
  
  for (const widget of visible) {
    const width = getColSpan(widget.size);
    const pos = findPosition(width);
    occupy(pos.row, pos.col, width);
    packed.push({ widget, row: pos.row, col: pos.col });
  }
  
  // Sort by position: row first (top to bottom), then col (left to right)
  packed.sort((a, b) => {
    if (a.row !== b.row) return a.row - b.row;
    return a.col - b.col;
  });
  
  // Assign new order values based on packed position
  const arranged = packed.map((p, idx) => ({ ...p.widget, order: idx }));
  
  // Append hidden widgets at the end (preserve their relative order)
  const hiddenSorted = hidden.sort((a, b) => a.order - b.order);
  const hiddenReordered = hiddenSorted.map((w, idx) => ({ ...w, order: arranged.length + idx }));
  
  return [...arranged, ...hiddenReordered];
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

  const autoArrange = useCallback(() => {
    setLayout((prev) => {
      const arranged = computeAutoArrangedOrder(prev.widgets, registry);
      return { ...prev, widgets: arranged };
    });
  }, [registry]);

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
    autoArrange,
    resetToDefault,
    getVisibleWidgets,
  };
}
