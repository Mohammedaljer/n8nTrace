import { ChevronDown, Shield, User as UserIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/security/AuthContext";
import { logout } from "@/data/authApi";

export function UserSelector() {
  const { state, refresh } = useAuth();

  if (state.status !== "authenticated") return null;

  const isAdmin =
    state.permissions.includes("admin:users") ||
    state.permissions.includes("admin:roles") ||
    state.permissions.includes("admin:groups");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2">
          <UserIcon className="h-4 w-4" />
          <span className="hidden sm:inline max-w-[160px] truncate">
            {state.user.email}
          </span>
          <Badge variant="outline" className="hidden md:inline-flex text-xs">
            {isAdmin ? "Admin" : "User"}
          </Badge>
          <ChevronDown className="h-3 w-3 opacity-50" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64 z-50 bg-popover">
        <DropdownMenuLabel className="flex items-center gap-2">
          <Shield className="h-4 w-4" />
          <div>
            <div className="text-xs font-normal text-muted-foreground">
              Signed in
            </div>
            <div className="text-sm truncate">{state.user.email}</div>
          </div>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onClick={async () => {
            await logout();
            await refresh();
          }}
        >
          Logout
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
