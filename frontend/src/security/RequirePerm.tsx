import { Navigate } from "react-router-dom";
import { hasPerm, useAuth } from "@/security/AuthContext";

export function RequirePerm({ perm, children }: { perm: string; children: React.ReactNode }) {
  const { state } = useAuth();

  if (state.status === "loading") return null; // أو Spinner
  if (state.status === "anonymous") return <Navigate to="/login" replace />;
  if (!hasPerm(state, perm)) return <Navigate to="/dashboard" replace />;

  return <>{children}</>;
}
