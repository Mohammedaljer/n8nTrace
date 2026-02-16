/**
 * Admin route guard using REAL auth context.
 * Notes:
 * - UI checks are only UX; backend must enforce 401/403.
 * - This component prevents demo `useUser` crashes (needs UserProvider). [file:171]
 */

import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ShieldAlert } from "lucide-react";
import { useAuth } from "@/security/AuthContext";

interface AdminGuardProps {
  children: ReactNode;
}

export function AdminGuard({ children }: AdminGuardProps) {
  const { state } = useAuth();
  const location = useLocation();

  if (state.status !== "authenticated") {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  // Change these permission names if your backend uses different ones.
  const canAdmin =
    state.permissions.includes("admin:users") ||
    state.permissions.includes("admin:roles") ||
    state.permissions.includes("admin:groups");

  if (!canAdmin) {
    return (
      <div className="flex items-center justify-center min-h-[50vh] p-8">
        <Alert variant="destructive" className="max-w-md">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Access Denied</AlertTitle>
          <AlertDescription>
            You don&apos;t have permission to access admin features.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return <>{children}</>;
}
