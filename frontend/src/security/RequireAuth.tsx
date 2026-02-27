import { Navigate } from "react-router-dom";
import { useAuth } from "@/security/AuthContext";

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { state } = useAuth();
  if (state.status === "loading") return null;
  if (state.status === "anonymous") return <Navigate to="/login" replace />;
  return <>{children}</>;
}
