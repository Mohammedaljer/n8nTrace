import { Alert, AlertDescription } from "@/components/ui/alert";
import { Shield } from "lucide-react";

export function DemoBanner() {
  return (
    <Alert className="mb-6 border-warning/50 bg-warning/10">
      <Shield className="h-4 w-4 text-warning" />
      <AlertDescription className="text-warning-foreground">
        <strong>Demo Mode:</strong> This is demo data stored in your browser's
        localStorage. Real RBAC will be backend-enforced in production.
      </AlertDescription>
    </Alert>
  );
}
