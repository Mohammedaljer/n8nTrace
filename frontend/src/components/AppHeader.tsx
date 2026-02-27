import { ThemeToggle } from "@/components/ThemeToggle";
import { DataStatusBar } from "@/components/DataStatusBar";
import { AuthStatus } from "@/components/AuthStatus";

export function AppHeader() {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b bg-card px-4">
      <div className="flex items-center gap-2">
        <DataStatusBar />
      </div>
      <div className="flex items-center gap-2">
        <AuthStatus />
        <ThemeToggle />
      </div>
    </header>
  );
}
