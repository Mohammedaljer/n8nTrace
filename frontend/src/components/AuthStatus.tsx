import { useAuth } from "@/security/AuthContext";
import { logout } from "@/data/authApi";

export function AuthStatus() {
  const { state, refresh } = useAuth();

  if (state.status !== "authenticated") return null;

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">{state.user.email}</span>
      <button
        className="text-sm underline"
        onClick={async () => {
          await logout();
          await refresh();
        }}
      >
        Logout
      </button>
    </div>
  );
}
