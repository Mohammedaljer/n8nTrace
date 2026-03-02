import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/security/AuthContext";
import { Loader2 } from "lucide-react";

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { state } = useAuth();
  const location = useLocation();

  if (state.status === "loading") {
    return (
      <div className="flex h-[50vh] items-center justify-center" role="status" aria-label="Loading">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">Loading…</span>
      </div>
    );
  }

  if (state.status === "anonymous") {
    // Preserve the intended destination so Login can redirect back after auth
    const returnTo = location.pathname + location.search;
    return <Navigate to={`/login?returnTo=${encodeURIComponent(returnTo)}`} replace />;
  }

  return <>{children}</>;
}
