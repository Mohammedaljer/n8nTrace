import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DATE_PRESETS, type DatePresetId } from "@/lib/datePresets";

interface DateRangePresetsProps {
  activePreset: DatePresetId;
  onPresetChange: (presetId: DatePresetId) => void;
}

/**
 * Quick-select buttons for common date ranges.
 */
export function DateRangePresets({ activePreset, onPresetChange }: DateRangePresetsProps) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Date range presets">
      {DATE_PRESETS.map((preset) => (
        <Button
          key={preset.id}
          variant={activePreset === preset.id ? "secondary" : "ghost"}
          size="sm"
          onClick={() => onPresetChange(preset.id)}
          className={cn(
            "h-7 px-2 text-xs",
            activePreset === preset.id && "font-medium"
          )}
          aria-pressed={activePreset === preset.id}
        >
          {preset.label}
        </Button>
      ))}
    </div>
  );
}
