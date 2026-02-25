import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { GripVertical, RotateCcw, Check, Lock, Activity, BarChart3, Sparkles } from "lucide-react";
import type { WidgetDefinition, WidgetLayoutItem, WidgetSize, DashboardLayout } from "./widgetRegistry";
import { SIZE_LABELS } from "./widgetRegistry";
import type { MetricsConfig } from "@/data/metricsApi";

interface CustomizePanelProps {
  registry: readonly WidgetDefinition[];
  layout: DashboardLayout;
  onToggleVisibility: (widgetId: string) => void;
  onSetSize: (widgetId: string, size: WidgetSize) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onAutoArrange: () => void;
  onReset: () => void;
  onClose: () => void;
  metricsConfig?: MetricsConfig | null;
}

interface DraggableItemProps {
  widget: WidgetLayoutItem;
  definition: WidgetDefinition;
  index: number;
  onToggleVisibility: (widgetId: string) => void;
  onSetSize: (widgetId: string, size: WidgetSize) => void;
  onDragStart: (index: number) => void;
  onDragOver: (index: number) => void;
  onDragEnd: () => void;
  isDragging: boolean;
  dragOverIndex: number | null;
  isDisabled: boolean;
  disabledReason?: string;
}

function DraggableItem({
  widget,
  definition,
  index,
  onToggleVisibility,
  onSetSize,
  onDragStart,
  onDragOver,
  onDragEnd,
  isDragging,
  dragOverIndex,
  isDisabled,
  disabledReason,
}: DraggableItemProps) {
  const isDropTarget = dragOverIndex === index;
  const isMetrics = definition.category === "metrics";

  const content = (
    <div
      draggable={!isDisabled}
      onDragStart={() => !isDisabled && onDragStart(index)}
      onDragOver={(e) => {
        e.preventDefault();
        if (!isDisabled) onDragOver(index);
      }}
      onDragEnd={onDragEnd}
      className={`
        flex items-center gap-3 p-3 rounded-lg border bg-card transition-all
        ${isDragging ? "opacity-50" : ""}
        ${isDropTarget ? "border-primary border-2" : "border-border"}
        ${!widget.visible || isDisabled ? "opacity-60" : ""}
        ${isDisabled ? "cursor-not-allowed" : ""}
      `}
    >
      {/* Drag handle */}
      <div className={`${isDisabled ? "text-muted-foreground/30" : "cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"}`}>
        {isDisabled ? <Lock className="h-5 w-5" /> : <GripVertical className="h-5 w-5" />}
      </div>

      {/* Widget info */}
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm flex items-center gap-2">
          {definition.title}
          {isMetrics && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal">
              Metrics
            </Badge>
          )}
        </div>
        <div className="text-xs text-muted-foreground truncate">
          {definition.description}
        </div>
      </div>

      {/* Size selector */}
      <Select
        value={widget.size}
        onValueChange={(size: WidgetSize) => onSetSize(widget.id, size)}
        disabled={!widget.visible || isDisabled}
      >
        <SelectTrigger className="w-[100px] h-8">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {definition.allowedSizes.map((size) => (
            <SelectItem key={size} value={size}>
              {SIZE_LABELS[size]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Visibility toggle */}
      <Switch
        checked={widget.visible && !isDisabled}
        onCheckedChange={() => !isDisabled && onToggleVisibility(widget.id)}
        disabled={isDisabled}
        aria-label={`Toggle ${definition.title} visibility`}
      />
    </div>
  );

  // Wrap with tooltip if disabled
  if (isDisabled && disabledReason) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          {content}
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[200px] text-xs">
          {disabledReason}
        </TooltipContent>
      </Tooltip>
    );
  }

  return content;
}

export function CustomizePanel({
  registry,
  layout,
  onToggleVisibility,
  onSetSize,
  onReorder,
  onAutoArrange,
  onReset,
  onClose,
  metricsConfig,
}: CustomizePanelProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const registryMap = new Map(registry.map((w) => [w.id, w]));

  const handleDragStart = (index: number) => {
    setDragIndex(index);
  };

  const handleDragOver = (index: number) => {
    if (dragIndex !== null && dragIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDragEnd = () => {
    if (dragIndex !== null && dragOverIndex !== null && dragIndex !== dragOverIndex) {
      onReorder(dragIndex, dragOverIndex);
    }
    setDragIndex(null);
    setDragOverIndex(null);
  };

  // Check if a widget is disabled based on metrics config
  const getWidgetDisabledState = (definition: WidgetDefinition): { isDisabled: boolean; reason?: string } => {
    if (!definition.requiresMetricsEnabled) {
      return { isDisabled: false };
    }

    // Metrics feature disabled
    if (!metricsConfig?.enabled) {
      return { isDisabled: true, reason: "Metrics feature is disabled (METRICS_ENABLED=false)" };
    }

    // Check permission
    if (definition.requiresPermission === "metrics.read.full" && !metricsConfig.hasFullPermission) {
      return { isDisabled: true, reason: "Requires full metrics permission" };
    }

    if (definition.requiresPermission === "metrics.read.version" && 
        !metricsConfig.hasVersionPermission && !metricsConfig.hasFullPermission) {
      return { isDisabled: true, reason: "Requires metrics permission" };
    }

    return { isDisabled: false };
  };

  // Separate widgets by category
  const metricsWidgets = layout.widgets.filter(w => registryMap.get(w.id)?.category === "metrics");
  const analyticsWidgets = layout.widgets.filter(w => registryMap.get(w.id)?.category === "analytics");

  const visibleCount = layout.widgets.filter((w) => {
    const def = registryMap.get(w.id);
    if (!def) return false;
    const { isDisabled } = getWidgetDisabledState(def);
    return w.visible && !isDisabled;
  }).length;

  return (
    <Card className="mb-6 shadow-lg border-primary/10">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CardTitle className="text-base">Customize Dashboard</CardTitle>
            <Badge variant="secondary">
              {visibleCount} of {layout.widgets.length} visible
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" onClick={onAutoArrange}>
                  <Sparkles className="h-4 w-4 mr-1" />
                  Auto arrange
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p className="text-xs">Compact layout to remove gaps</p>
              </TooltipContent>
            </Tooltip>
            <Button variant="ghost" size="sm" onClick={onReset}>
              <RotateCcw className="h-4 w-4 mr-1" />
              Reset
            </Button>
            <Button variant="default" size="sm" onClick={onClose}>
              <Check className="h-4 w-4 mr-1" />
              Done
            </Button>
          </div>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Drag to reorder, toggle visibility, and choose widget sizes.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Metrics Widgets Section */}
        {metricsWidgets.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Instance Metrics Widgets
            </h4>
            <div className="space-y-2">
              {metricsWidgets.map((widget) => {
                const definition = registryMap.get(widget.id);
                if (!definition) return null;
                
                const globalIndex = layout.widgets.findIndex(w => w.id === widget.id);
                const { isDisabled, reason } = getWidgetDisabledState(definition);

                return (
                  <DraggableItem
                    key={widget.id}
                    widget={widget}
                    definition={definition}
                    index={globalIndex}
                    onToggleVisibility={onToggleVisibility}
                    onSetSize={onSetSize}
                    onDragStart={handleDragStart}
                    onDragOver={handleDragOver}
                    onDragEnd={handleDragEnd}
                    isDragging={dragIndex === globalIndex}
                    dragOverIndex={dragOverIndex}
                    isDisabled={isDisabled}
                    disabledReason={reason}
                  />
                );
              })}
            </div>
          </div>
        )}

        {/* Execution Analytics Widgets Section */}
        {analyticsWidgets.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Execution Analytics Widgets
            </h4>
            <div className="space-y-2">
              {analyticsWidgets.map((widget) => {
                const definition = registryMap.get(widget.id);
                if (!definition) return null;

                const globalIndex = layout.widgets.findIndex(w => w.id === widget.id);

                return (
                  <DraggableItem
                    key={widget.id}
                    widget={widget}
                    definition={definition}
                    index={globalIndex}
                    onToggleVisibility={onToggleVisibility}
                    onSetSize={onSetSize}
                    onDragStart={handleDragStart}
                    onDragOver={handleDragOver}
                    onDragEnd={handleDragEnd}
                    isDragging={dragIndex === globalIndex}
                    dragOverIndex={dragOverIndex}
                    isDisabled={false}
                  />
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
