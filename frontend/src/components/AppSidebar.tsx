import { useState } from "react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  GitBranch,
  List,
  HelpCircle,
  PanelLeftClose,
  PanelLeft,
  Users,
  UsersRound,
  Shield,
  ScrollText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataStatusBar } from "@/components/DataStatusBar";
import { cn } from "@/lib/utils";
import { useAuth } from "@/security/AuthContext";

const mainNavItems = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Workflows", url: "/workflows", icon: GitBranch },
  { title: "Executions", url: "/executions", icon: List },
  { title: "Help", url: "/help", icon: HelpCircle },
] as const;

const adminNavItems = [
  { title: "Users", url: "/admin/users", icon: Users },
  { title: "Groups", url: "/admin/groups", icon: UsersRound },
  { title: "Roles", url: "/admin/roles", icon: Shield },
  { title: "Audit Log", url: "/admin/audit-log", icon: ScrollText },
] as const;

export function AppSidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();
  const { state } = useAuth();

  const showAdminSection =
    state.status === "authenticated" &&
    (state.permissions.includes("admin:users") || state.permissions.includes("admin:roles"));

  return (
    <aside
      className={cn(
        "flex flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-all duration-200",
        collapsed ? "w-16" : "w-60"
      )}
      role="navigation"
      aria-label="Main navigation"
    >
      <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-4">
        <img src="/n8n_Pulse.svg" alt="n8n Pulse" className="h-5 w-5 shrink-0" aria-hidden="true" />
        {!collapsed && <span className="text-sm font-semibold tracking-tight">n8n Pulse</span>}
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto h-7 w-7 text-sidebar-muted hover:text-sidebar-foreground hover:bg-sidebar-accent"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
        >
          {collapsed ? (
            <PanelLeft className="h-4 w-4" aria-hidden="true" />
          ) : (
            <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
          )}
        </Button>
      </div>

      <nav className="flex-1 space-y-1 px-2 py-3 overflow-y-auto" aria-label="Primary navigation">
        {mainNavItems.map((item) => {
          const active = location.pathname.startsWith(item.url);
          return (
            <NavLink
              key={item.url}
              to={item.url}
              end={item.url === "/dashboard"}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                active ? "bg-sidebar-accent text-sidebar-primary" : "text-sidebar-muted"
              )}
              activeClassName=""
            >
              <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              {!collapsed && <span>{item.title}</span>}
            </NavLink>
          );
        })}

        {showAdminSection && (
          <>
            <div className={cn("mt-6 mb-2 px-3")}>
              {!collapsed ? (
                <span className="text-xs font-semibold uppercase tracking-wider text-sidebar-muted">
                  Admin
                </span>
              ) : (
                <div className="h-px bg-sidebar-border" />
              )}
            </div>

            {adminNavItems.map((item) => {
              const active = location.pathname.startsWith(item.url);
              return (
                <NavLink
                  key={item.url}
                  to={item.url}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    active ? "bg-sidebar-accent text-sidebar-primary" : "text-sidebar-muted"
                  )}
                  activeClassName=""
                >
                  <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {!collapsed && <span>{item.title}</span>}
                </NavLink>
              );
            })}
          </>
        )}
      </nav>

      {!collapsed && (
        <div className="border-t border-sidebar-border px-4 py-3">
          <DataStatusBar />
        </div>
      )}
    </aside>
  );
}
