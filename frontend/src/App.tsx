import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useSearchParams, Outlet } from "react-router-dom";
import { DataProvider } from "@/data/DataContext";
import { getSetupStatus } from "@/data/setupApi";
import { FilterProvider } from "@/components/FilterProvider";
import { ThemeProvider } from "@/hooks/useTheme";
import { AppLayout } from "@/components/AppLayout";
import { RouteErrorBoundary } from "@/components/ErrorBoundary";
import { lazy, Suspense, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { AuthProvider } from "@/security/AuthContext";
import { RequirePerm } from "@/security/RequirePerm";
import { RequireAuth } from "@/security/RequireAuth";

// Lazy load pages
const DashboardPage = lazy(() => import("@/pages/DashboardPage"));
const WorkflowsPage = lazy(() => import("@/pages/WorkflowsPage"));
const ExecutionsPage = lazy(() => import("@/pages/ExecutionsPage"));
const ExecutionDetailPage = lazy(() => import("@/pages/ExecutionDetailPage"));
const HelpPage = lazy(() => import("@/pages/HelpPage"));
const LoginPage = lazy(() => import("@/pages/Login"));
const SetupPage = lazy(() => import("@/pages/Setup"));
const ForgotPasswordPage = lazy(() => import("@/pages/ForgotPassword"));
const SetPasswordPage = lazy(() => import("@/pages/SetPassword"));
const ResetPasswordPage = lazy(() => import("@/pages/ResetPassword"));
const NotFound = lazy(() => import("@/pages/NotFound"));

// Admin pages
const AdminUsersPage = lazy(() => import("@/admin/pages/AdminUsersPage"));
const AdminGroupsPage = lazy(() => import("@/admin/pages/AdminGroupsPage"));
const AdminRolesPage = lazy(() => import("@/admin/pages/AdminRolesPage"));
const AdminAuditLogPage = lazy(() => import("@/admin/pages/AdminAuditLogPage"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
    },
  },
});

function PageLoader() {
  return (
    <div className="flex h-[50vh] items-center justify-center" role="status" aria-label="Loading page">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden="true" />
      <span className="sr-only">Loading page…</span>
    </div>
  );
}

/** When setupRequired: redirect any route except /setup to /setup. When not required: redirect /setup to /login. Caches status; re-checks after setup success. */
function SetupRedirectGuard() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const pathname = location.pathname;
  const [setupRequired, setSetupRequired] = useState<boolean | "loading">("loading");
  const hasSetupSuccess = searchParams.get("setup") === "success";

  useEffect(() => {
    let cancelled = false;
    getSetupStatus()
      .then((data) => {
        if (!cancelled) setSetupRequired(data.setupRequired);
      })
      .catch(() => {
        if (!cancelled) setSetupRequired(false);
      });
    return () => { cancelled = true; };
  }, [hasSetupSuccess]);

  if (setupRequired === "loading") {
    return <PageLoader />;
  }
  if (setupRequired === true && pathname !== "/setup") {
    return <Navigate to="/setup" replace />;
  }
  if (setupRequired === false && pathname === "/setup") {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}

function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <AuthProvider>
            <DataProvider>
              <Toaster />
              <Sonner />

              <BrowserRouter>
                <FilterProvider>
                  <a href="#main-content" className="skip-link">
                    Skip to main content
                  </a>

                  <Routes>
                    <Route element={<SetupRedirectGuard />}>
                    {/* Auth routes (no layout) */}
                    <Route
                      path="/setup"
                      element={
                        <Suspense fallback={<PageLoader />}>
                          <SetupPage />
                        </Suspense>
                      }
                    />
                    <Route
                      path="/login"
                      element={
                        <Suspense fallback={<PageLoader />}>
                          <LoginPage />
                        </Suspense>
                      }
                    />
                    <Route
                      path="/forgot-password"
                      element={
                        <Suspense fallback={<PageLoader />}>
                          <ForgotPasswordPage />
                        </Suspense>
                      }
                    />
                    <Route
                      path="/set-password"
                      element={
                        <Suspense fallback={<PageLoader />}>
                          <SetPasswordPage />
                        </Suspense>
                      }
                    />
                    <Route
                      path="/reset-password"
                      element={
                        <Suspense fallback={<PageLoader />}>
                          <ResetPasswordPage />
                        </Suspense>
                      }
                    />

                    {/* Main app routes (protected, with layout) */}
                    <Route
                      element={
                        <RequireAuth>
                          <AppLayout />
                        </RequireAuth>
                      }
                    >
                      <Route path="/" element={<Navigate to="/dashboard" replace />} />

                      <Route
                        path="/dashboard"
                        element={
                          <RouteErrorBoundary>
                            <Suspense fallback={<PageLoader />}>
                              <DashboardPage />
                            </Suspense>
                          </RouteErrorBoundary>
                        }
                      />

                      <Route
                        path="/workflows"
                        element={
                          <RouteErrorBoundary>
                            <Suspense fallback={<PageLoader />}>
                              <WorkflowsPage />
                            </Suspense>
                          </RouteErrorBoundary>
                        }
                      />

                      <Route
                        path="/executions"
                        element={
                          <RouteErrorBoundary>
                            <Suspense fallback={<PageLoader />}>
                              <ExecutionsPage />
                            </Suspense>
                          </RouteErrorBoundary>
                        }
                      />

                      <Route
                        path="/executions/:executionId"
                        element={
                          <RouteErrorBoundary>
                            <Suspense fallback={<PageLoader />}>
                              <ExecutionDetailPage />
                            </Suspense>
                          </RouteErrorBoundary>
                        }
                      />

                      <Route
                        path="/help"
                        element={
                          <RouteErrorBoundary>
                            <Suspense fallback={<PageLoader />}>
                              <HelpPage />
                            </Suspense>
                          </RouteErrorBoundary>
                        }
                      />

                      {/* Admin routes (protected by permission) */}
                      <Route
                        path="/admin/users"
                        element={
                          <RouteErrorBoundary>
                            <Suspense fallback={<PageLoader />}>
                              <RequirePerm perm="admin:users">
                                <AdminUsersPage />
                              </RequirePerm>
                            </Suspense>
                          </RouteErrorBoundary>
                        }
                      />

                      <Route
                        path="/admin/groups"
                        element={
                          <RouteErrorBoundary>
                            <Suspense fallback={<PageLoader />}>
                              <RequirePerm perm="admin:roles">
                                <AdminGroupsPage />
                              </RequirePerm>
                            </Suspense>
                          </RouteErrorBoundary>
                        }
                      />

                      <Route
                        path="/admin/roles"
                        element={
                          <RouteErrorBoundary>
                            <Suspense fallback={<PageLoader />}>
                              <RequirePerm perm="admin:roles">
                                <AdminRolesPage />
                              </RequirePerm>
                            </Suspense>
                          </RouteErrorBoundary>
                        }
                      />

                      <Route
                        path="/admin/audit-log"
                        element={
                          <RouteErrorBoundary>
                            <Suspense fallback={<PageLoader />}>
                              <RequirePerm perm="admin:users">
                                <AdminAuditLogPage />
                              </RequirePerm>
                            </Suspense>
                          </RouteErrorBoundary>
                        }
                      />
                    </Route>

                    {/* Not found */}
                    <Route
                      path="*"
                      element={
                        <Suspense fallback={<PageLoader />}>
                          <NotFound />
                        </Suspense>
                      }
                    />
                    </Route>
                  </Routes>
                </FilterProvider>
              </BrowserRouter>
            </DataProvider>
          </AuthProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
