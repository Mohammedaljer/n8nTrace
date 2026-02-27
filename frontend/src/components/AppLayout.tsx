import { Outlet } from "react-router-dom";
import { AppSidebar } from "@/components/AppSidebar";
import { AppHeader } from "@/components/AppHeader";
import { AppFooter } from "@/components/AppFooter";

export function AppLayout() {
  return (
    <div className="flex h-screen w-full overflow-hidden">
      <AppSidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <AppHeader />
        <main
          id="main-content"
          className="flex-1 overflow-y-auto"
          role="main"
          aria-label="Main content"
        >
          <div className="min-h-full flex flex-col">
            <div className="flex-1">
              <Outlet />
            </div>
            <AppFooter />
          </div>
        </main>
      </div>
    </div>
  );
}
