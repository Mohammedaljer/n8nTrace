import { FileQuestion } from "lucide-react";

interface EmptyStateProps {
  readonly icon?: React.ReactNode;
  readonly title: string;
  readonly description: string;
}

export function EmptyState({ icon, title, description }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
      <div className="mb-4 text-muted-foreground">
        {icon ?? <FileQuestion className="h-10 w-10" />}
      </div>
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
