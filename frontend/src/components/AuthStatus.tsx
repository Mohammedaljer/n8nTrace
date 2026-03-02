import { useState } from "react";
import { useAuth } from "@/security/AuthContext";
import { logout, revokeAllSessions } from "@/data/authApi";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LogOut, MonitorSmartphone, ChevronDown } from "lucide-react";

export function AuthStatus() {
  const { state, refresh } = useAuth();
  const [revoking, setRevoking] = useState(false);

  if (state.status !== "authenticated") return null;

  const handleLogout = async () => {
    await logout();
    await refresh();
  };

  const handleRevokeAll = async () => {
    setRevoking(true);
    try {
      await revokeAllSessions();
      await refresh();
    } finally {
      setRevoking(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
        aria-label={`Account menu for ${state.user.email}`}
      >
        {state.user.email}
        <ChevronDown className="h-3 w-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onClick={handleLogout}>
          <LogOut className="mr-2 h-4 w-4" />
          Log out
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleRevokeAll} disabled={revoking}>
          <MonitorSmartphone className="mr-2 h-4 w-4" />
          {revoking ? "Revoking…" : "Log out all devices"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
