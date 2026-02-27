import { useEffect, useState } from "react";
import { PageShell } from "@/components/PageShell";
import { AdminGuard } from "@/admin/components/AdminGuard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info, Shield } from "lucide-react";
import { Link } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import { getDataConfig } from "@/data/config";

type PermissionRow = { id: string; key: string; description: string | null };
type RoleRow = {
  id: string;
  key: string;
  name: string;
  created_at: string;
  permissions: PermissionRow[];
};

const config = getDataConfig();
const API_BASE = config.apiBaseUrl;

export default function AdminRolesPage() {
  const [rows, setRows] = useState<RoleRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        setLoading(true);
        const r = await fetch(`${API_BASE}/api/admin/roles-with-permissions`, {
          credentials: "include",
          headers: { Accept: "application/json" },
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = (await r.json()) as RoleRow[];
        if (alive) setRows(data);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  return (
    <AdminGuard>
      <PageShell title="System Roles" description="Roles and permissions from PostgreSQL.">
        <Alert className="mb-6">
          <Info className="h-4 w-4" />
          <AlertDescription>
            These roles are stored in the database.{" "}
            <Link to="/help" className="underline hover:no-underline">
              Learn more
            </Link>
          </AlertDescription>
        </Alert>

        {loading ? (
          <div className="grid gap-6 md:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i}>
                <CardHeader>
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="h-4 w-56" />
                </CardHeader>
                <CardContent className="space-y-2">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-4 w-44" />
                  <Skeleton className="h-4 w-52" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-3">
            {rows.map((role) => (
              <Card key={role.id} className="relative">
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <Shield className="h-5 w-5 text-primary" />
                    <CardTitle className="text-lg">{role.name}</CardTitle>
                  </div>
                  <CardDescription>Key: {role.key}</CardDescription>
                </CardHeader>

                <CardContent>
                  <h4 className="text-sm font-medium mb-3">Permissions</h4>
                  <div className="flex flex-wrap gap-1">
                    {role.permissions.length ? (
                      role.permissions.map((p) => (
                        <Badge key={p.id} variant="secondary" className="text-xs">
                          {p.key}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </div>

                  <div className="mt-4 pt-4 border-t">
                    <Badge variant="outline">
                      {role.permissions.length} permission{role.permissions.length !== 1 ? "s" : ""}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </PageShell>
    </AdminGuard>
  );
}
