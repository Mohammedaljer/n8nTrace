import { useEffect, useMemo, useState } from "react";
import { PageShell } from "@/components/PageShell";
import { AdminGuard } from "@/admin/components/AdminGuard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Pencil, Trash2, Search } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { getDataConfig } from "@/data/config";

type RoleRow = { id: string; key: string; name: string };

// From GET /api/admin/groups after adding group_scopes + description
type ScopeRow = {
  instance_id: string | null;
  workflow_id: string | null;
  tag: string | null;
};

type GroupRow = {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  roles: RoleRow[];
  scopes: ScopeRow[];
};

const config = getDataConfig();
const API_BASE = config.apiBaseUrl;

function parseCommaSeparated(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function scopeToForm(scopes: ScopeRow[]) {
  const instanceIds = uniqueSorted(
    scopes.map((s) => s.instance_id).filter(Boolean) as string[]
  );
  const workflowIds = uniqueSorted(
    scopes.map((s) => s.workflow_id).filter(Boolean) as string[]
  );
  const tags = uniqueSorted(scopes.map((s) => s.tag).filter(Boolean) as string[]);
  return {
    instanceIdsText: instanceIds.join(", "),
    workflowIdsText: workflowIds.join(", "),
    tagsText: tags.join(", "),
  };
}

function renderScopeBadges(scopes: ScopeRow[]): string[] {
  const inst = uniqueSorted(scopes.map((s) => s.instance_id).filter(Boolean) as string[]);
  const wfs = uniqueSorted(scopes.map((s) => s.workflow_id).filter(Boolean) as string[]);
  const tags = uniqueSorted(scopes.map((s) => s.tag).filter(Boolean) as string[]);

  const items: string[] = [];
  if (inst.length) items.push(`Instances: ${inst.join(", ")}`);
  if (wfs.length) items.push(`Workflows: ${wfs.length} selected`);
  if (tags.length) items.push(`Tags: ${tags.join(", ")}`);
  return items.length ? items : ["All (no restrictions)"];
}

export default function AdminGroupsPage() {
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const [editing, setEditing] = useState<GroupRow | null>(null);
  const [toDelete, setToDelete] = useState<GroupRow | null>(null);

  // form fields
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);
  const [formInstanceIds, setFormInstanceIds] = useState("");
  const [formWorkflowIds, setFormWorkflowIds] = useState("");
  const [formTags, setFormTags] = useState("");

  const loadAll = async () => {
    setLoading(true);
    try {
      const [gRes, rRes] = await Promise.all([
        fetch(`${API_BASE}/api/admin/groups`, { credentials: "include" }),
        fetch(`${API_BASE}/api/admin/roles`, { credentials: "include" }),
      ]);

      if (!gRes.ok) throw new Error(`Groups HTTP ${gRes.status}`);
      if (!rRes.ok) throw new Error(`Roles HTTP ${rRes.status}`);

      setGroups((await gRes.json()) as GroupRow[]);
      setRoles((await rRes.json()) as RoleRow[]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter(
      (g) =>
        g.name.toLowerCase().includes(q) ||
        (g.description || "").toLowerCase().includes(q)
    );
  }, [groups, search]);

  const openAddDialog = () => {
    setEditing(null);
    setFormName("");
    setFormDescription("");
    setSelectedRoleIds([]);
    setFormInstanceIds("");
    setFormWorkflowIds("");
    setFormTags("");
    setDialogOpen(true);
  };

  const openEditDialog = (g: GroupRow) => {
    setEditing(g);
    setFormName(g.name);
    setFormDescription(g.description ?? "");
    setSelectedRoleIds(g.roles.map((r) => r.id));
    const s = scopeToForm(g.scopes || []);
    setFormInstanceIds(s.instanceIdsText);
    setFormWorkflowIds(s.workflowIdsText);
    setFormTags(s.tagsText);
    setDialogOpen(true);
  };

  const toggleRole = (roleId: string) => {
    setSelectedRoleIds((prev) =>
      prev.includes(roleId) ? prev.filter((id) => id !== roleId) : [...prev, roleId]
    );
  };

  const handleSave = async () => {
    if (!formName.trim()) {
      toast({
        title: "Validation Error",
        description: "Group name is required.",
        variant: "destructive",
      });
      return;
    }

    const payload = {
      name: formName.trim(),
      description: formDescription.trim() ? formDescription.trim() : null,
      roleIds: selectedRoleIds,
      scope: {
        instanceIds: parseCommaSeparated(formInstanceIds),
        workflowIds: parseCommaSeparated(formWorkflowIds),
        tags: parseCommaSeparated(formTags),
      },
    };

    if (editing) {
      const r = await fetch(`${API_BASE}/api/admin/groups/${editing.id}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });

      if (!r.ok) {
        toast({
          title: "Failed",
          description: `Update group failed (HTTP ${r.status}).`,
          variant: "destructive",
        });
        return;
      }

      toast({ title: "Group updated", description: `Updated ${payload.name}` });
    } else {
      const r = await fetch(`${API_BASE}/api/admin/groups`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });

      if (!r.ok) {
        toast({
          title: "Failed",
          description: `Create group failed (HTTP ${r.status}).`,
          variant: "destructive",
        });
        return;
      }

      toast({ title: "Group added", description: `Added ${payload.name}` });
    }

    setDialogOpen(false);
    setEditing(null);
    await loadAll();
  };

  const openDelete = (g: GroupRow) => {
    setToDelete(g);
    setDeleteOpen(true);
  };

  const submitDelete = async () => {
    if (!toDelete) return;

    const r = await fetch(`${API_BASE}/api/admin/groups/${toDelete.id}`, {
      method: "DELETE",
      credentials: "include",
      headers: { Accept: "application/json" },
    });

    if (!r.ok) {
      toast({ title: "Failed", description: `Delete failed (HTTP ${r.status}).`, variant: "destructive" });
      return;
    }

    toast({ title: "Deleted", description: `Deleted ${toDelete.name}` });
    setDeleteOpen(false);
    setToDelete(null);
    await loadAll();
  };

  return (
    <AdminGuard>
      <PageShell title="Manage Groups" description="Add, edit, or remove groups and scopes (PostgreSQL).">
        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search groups..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
          <div className="flex gap-2">
            <Button onClick={openAddDialog}>
              <Plus className="h-4 w-4 mr-2" />
              Add Group
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Roles</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead className="w-[110px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                      No groups found.
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((g) => (
                    <TableRow key={g.id}>
                      <TableCell className="font-medium">{g.name}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {g.description || "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {g.roles?.length ? (
                            g.roles.map((r) => (
                              <Badge key={r.id} variant="secondary" className="text-xs">
                                {r.name} ({r.key})
                              </Badge>
                            ))
                          ) : (
                            <span className="text-sm text-muted-foreground">—</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {renderScopeBadges(g.scopes || []).map((item, i) => (
                            <Badge key={i} variant="outline" className="text-xs font-normal">
                              {item}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEditDialog(g)}
                            aria-label={`Edit ${g.name}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openDelete(g)}
                            aria-label={`Delete ${g.name}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Add/Edit Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{editing ? "Edit Group" : "Add Group"}</DialogTitle>
              <DialogDescription>
                {editing ? "Update group details, roles, and scope restrictions." : "Create a new group with roles and scope."}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g., Production Team"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="Optional description..."
                  rows={2}
                />
              </div>

              <div className="space-y-2">
                <Label>Roles</Label>
                <div className="border rounded-md p-3 space-y-2 max-h-44 overflow-y-auto">
                  {roles.map((r) => (
                    <div key={r.id} className="flex items-center gap-2">
                      <Checkbox
                        id={`role-${r.id}`}
                        checked={selectedRoleIds.includes(r.id)}
                        onCheckedChange={() => toggleRole(r.id)}
                      />
                      <Label htmlFor={`role-${r.id}`} className="cursor-pointer text-sm font-normal">
                        {r.name} <span className="text-muted-foreground">({r.key})</span>
                      </Label>
                    </div>
                  ))}
                  {roles.length === 0 && (
                    <div className="text-sm text-muted-foreground">No roles found.</div>
                  )}
                </div>
              </div>

              <div className="border-t pt-4">
                <h4 className="text-sm font-medium mb-3">Scope Restrictions</h4>
                <p className="text-xs text-muted-foreground mb-3">
                  Leave empty for unrestricted access. Enter comma-separated values.
                </p>

                <div className="space-y-3">
                  <div className="space-y-1">
                    <Label htmlFor="instanceIds" className="text-xs">
                      Instance IDs
                    </Label>
                    <Input
                      id="instanceIds"
                      value={formInstanceIds}
                      onChange={(e) => setFormInstanceIds(e.target.value)}
                      placeholder="e.g., prod, staging"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="workflowIds" className="text-xs">
                      Workflow IDs
                    </Label>
                    <Input
                      id="workflowIds"
                      value={formWorkflowIds}
                      onChange={(e) => setFormWorkflowIds(e.target.value)}
                      placeholder="e.g., wf-001, wf-002"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="tags" className="text-xs">
                      Tags
                    </Label>
                    <Input
                      id="tags"
                      value={formTags}
                      onChange={(e) => setFormTags(e.target.value)}
                      placeholder="e.g., critical, sales"
                    />
                  </div>
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleSave}>
                {editing ? "Save Changes" : "Add Group"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation */}
        <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Group</AlertDialogTitle>
              <AlertDialogDescription>
                Delete “{toDelete?.name}”? This will also remove roles, scopes, and user memberships via cascade.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={submitDelete}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </PageShell>
    </AdminGuard>
  );
}
