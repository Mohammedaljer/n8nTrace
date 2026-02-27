import type { ExecutionStatus, NodeStatus } from "@/types/execution";
import { cn } from "@/lib/utils";
import { CheckCircle, XCircle, Loader2, Clock, HelpCircle } from "lucide-react";

interface StatusBadgeProps {
  readonly status: ExecutionStatus | NodeStatus | null;
  readonly size?: "sm" | "md";
}

const statusConfig: Record<
  string,
  { icon: typeof CheckCircle; className: string; label: string }
> = {
  success: {
    icon: CheckCircle,
    className: "bg-success/10 text-success border-success/20",
    label: "Success",
  },
  error: {
    icon: XCircle,
    className: "bg-destructive/10 text-destructive border-destructive/20",
    label: "Error",
  },
  running: {
    icon: Loader2,
    className: "bg-primary/10 text-primary border-primary/20",
    label: "Running",
  },
  waiting: {
    icon: Clock,
    className: "bg-warning/10 text-warning border-warning/20",
    label: "Waiting",
  },
  crashed: {
    icon: XCircle,
    className: "bg-destructive/10 text-destructive border-destructive/20",
    label: "Crashed",
  },
  unknown: {
    icon: HelpCircle,
    className: "bg-muted text-muted-foreground border-border",
    label: "Unknown",
  },
};

export function StatusBadge({ status, size = "sm" }: StatusBadgeProps) {
  const config = statusConfig[status ?? "unknown"] ?? statusConfig.unknown;
  const Icon = config.icon;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border font-medium",
        config.className,
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-sm"
      )}
    >
      <Icon
        className={cn(
          "shrink-0",
          size === "sm" ? "h-3 w-3" : "h-4 w-4",
          status === "running" && "animate-spin"
        )}
      />
      {config.label}
    </span>
  );
}
