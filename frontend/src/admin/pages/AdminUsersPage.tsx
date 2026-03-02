import { useEffect, useMemo, useState } from "react";
import { PageShell } from "@/components/PageShell";
import { AdminGuard } from "@/admin/components/AdminGuard";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { SkeletonTable } from "@/components/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  Plus, Pencil, Search, UserX, UserCheck, Trash2, Copy, Check, 
  KeyRound, Link as LinkIcon, RefreshCw, LockOpen 
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { getDataConfig } from "@/data/config";

type GroupRow = { id: string; name: string };
type UserRow = {
  id: string;
  email: string;
  is_active: boolean;
  created_at: string;
  password_set_at: string | null;
  failed_login_attempts: number | null;
  locked_until: string | null;
  groups: GroupRow[];
};

const config = getDataConfig();
const API_BASE = config.apiBaseUrl;

async function readApiError(r: Response) {
  try {
    const j = (await r.json()) as { error?: string; message?: string };
    return j?.error || j?.message || null;
  } catch {
    return null;
  }
}

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Button variant="outline" size="sm" onClick={handleCopy} className="gap-2">
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      {label || (copied ? "Copied!" : "Copy")}
    </Button>
  );
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // Add dialog
  const [addOpen, setAddOpen] = useState(false);
  const [addEmail, setAddEmail] = useState("");
  const [addGroupIds, setAddGroupIds] = useState<string[]>([]);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteLinkExpiry, setInviteLinkExpiry] = useState<string | null>(null);

  // Edit groups dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRow | null>(null);
  const [editGroupIds, setEditGroupIds] = useState<string[]>([]);

  // Reset password link dialog
  const [resetLinkOpen, setResetLinkOpen] = useState(false);
  const [resetLinkUser, setResetLinkUser] = useState<UserRow | null>(null);
  const [resetLink, setResetLink] = useState<string | null>(null);
  const [resetLinkExpiry, setResetLinkExpiry] = useState<string | null>(null);
  const [resetLinkLoading, setResetLinkLoading] = useState(false);

  // Regenerate invite dialog
  const [regenInviteOpen, setRegenInviteOpen] = useState(false);
  const [regenInviteUser, setRegenInviteUser] = useState<UserRow | null>(null);
  const [regenInviteLink, setRegenInviteLink] = useState<string | null>(null);
  const [regenInviteLinkLoading, setRegenInviteLinkLoading] = useState(false);

  // Deactivate dialog
  const [deactOpen, setDeactOpen] = useState(false);
  const [userToDeact, setUserToDeact] = useState<UserRow | null>(null);

  // Delete dialog
  const [delOpen, setDelOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<UserRow | null>(null);

  const loadAll = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [uRes, gRes] = await Promise.all([
        fetch(`${API_BASE}/api/admin/users`, { credentials: "include" }),
        fetch(`${API_BASE}/api/admin/groups`, { credentials: "include" }),
      ]);

      if (!uRes.ok) throw new Error(`Users HTTP ${uRes.status}`);
      if (!gRes.ok) throw new Error(`Groups HTTP ${gRes.status}`);

      setUsers((await uRes.json()) as UserRow[]);
      const gData = (await gRes.json()) as Array<{ id: string; name: string }>;
      setGroups(gData.map((x) => ({ id: x.id, name: x.name })));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => u.email.toLowerCase().includes(q));
  }, [users, search]);

  const toggle = (arr: string[], id: string) =>
    arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id];

  const openAdd = () => {
    setAddEmail("");
    setAddGroupIds([]);
    setInviteLink(null);
    setInviteLinkExpiry(null);
    setAddOpen(true);
  };

  const submitAdd = async () => {
    const email = addEmail.trim().toLowerCase();
    if (!email) {
      toast({ title: "Validation error", description: "Email is required.", variant: "destructive" });
      return;
    }

    const r = await fetch(`${API_BASE}/api/admin/users`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ email, groupIds: addGroupIds }),
    });

    if (!r.ok) {
      const serverMsg = await readApiError(r);
      const msg =
        serverMsg ||
        (r.status === 409 ? "Email already exists." : `Create failed (HTTP ${r.status}).`);
      toast({ title: "Failed", description: msg, variant: "destructive" });
      return;
    }

    const data = await r.json();
    setInviteLink(data.inviteLink);
    setInviteLinkExpiry(data.inviteLinkExpiresAt);
    toast({ title: "User created", description: `Invite link generated for ${email}` });
    await loadAll();
  };

  const closeAddDialog = () => {
    setAddOpen(false);
    setInviteLink(null);
    setInviteLinkExpiry(null);
  };

  const openEdit = (u: UserRow) => {
    setEditingUser(u);
    setEditGroupIds(u.groups.map((g) => g.id));
    setEditOpen(true);
  };

  const submitEditGroups = async () => {
    if (!editingUser) return;

    const r = await fetch(`${API_BASE}/api/admin/users/${editingUser.id}/groups`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ groupIds: editGroupIds }),
    });

    if (!r.ok) {
      const serverMsg = await readApiError(r);
      toast({ title: "Failed", description: serverMsg || `Save failed (HTTP ${r.status}).`, variant: "destructive" });
      return;
    }

    toast({ title: "Saved", description: `Updated groups for ${editingUser.email}` });
    setEditOpen(false);
    setEditingUser(null);
    await loadAll();
  };

  // Reset password link
  const openResetLink = (u: UserRow) => {
    setResetLinkUser(u);
    setResetLink(null);
    setResetLinkExpiry(null);
    setResetLinkOpen(true);
  };

  const generateResetLink = async () => {
    if (!resetLinkUser) return;
    setResetLinkLoading(true);

    try {
      const r = await fetch(`${API_BASE}/api/admin/users/${resetLinkUser.id}/reset-password-link`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
      });

      if (!r.ok) {
        const serverMsg = await readApiError(r);
        toast({ title: "Failed", description: serverMsg || `Failed to generate reset link.`, variant: "destructive" });
        return;
      }

      const data = await r.json();
      setResetLink(data.resetLink);
      setResetLinkExpiry(data.resetLinkExpiresAt);
      toast({ title: "Reset link generated", description: "Copy the link and share it securely with the user." });
    } finally {
      setResetLinkLoading(false);
    }
  };

  // Regenerate invite link
  const openRegenInvite = (u: UserRow) => {
    setRegenInviteUser(u);
    setRegenInviteLink(null);
    setRegenInviteOpen(true);
  };

  const generateRegenInvite = async () => {
    if (!regenInviteUser) return;
    setRegenInviteLinkLoading(true);

    try {
      const r = await fetch(`${API_BASE}/api/admin/users/${regenInviteUser.id}/regenerate-invite`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
      });

      if (!r.ok) {
        const serverMsg = await readApiError(r);
        toast({ title: "Failed", description: serverMsg || `Failed to regenerate invite link.`, variant: "destructive" });
        return;
      }

      const data = await r.json();
      setRegenInviteLink(data.inviteLink);
      toast({ title: "Invite link regenerated", description: "Copy the link and share it securely with the user." });
    } finally {
      setRegenInviteLinkLoading(false);
    }
  };

  const openDeactivate = (u: UserRow) => {
    setUserToDeact(u);
    setDeactOpen(true);
  };

  const submitDeactivate = async () => {
    if (!userToDeact) return;

    const r = await fetch(`${API_BASE}/api/admin/users/${userToDeact.id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ is_active: false }),
    });

    if (!r.ok) {
      const serverMsg = await readApiError(r);
      toast({
        title: "Failed",
        description: serverMsg || `Deactivate failed (HTTP ${r.status}).`,
        variant: "destructive",
      });
      return;
    }

    toast({ title: "User deactivated", description: userToDeact.email });
    setDeactOpen(false);
    setUserToDeact(null);
    await loadAll();
  };

  const submitActivate = async (u: UserRow) => {
    const r = await fetch(`${API_BASE}/api/admin/users/${u.id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ is_active: true }),
    });

    if (!r.ok) {
      const serverMsg = await readApiError(r);
      toast({
        title: "Failed",
        description: serverMsg || `Activate failed (HTTP ${r.status}).`,
        variant: "destructive",
      });
      return;
    }

    toast({ title: "User activated", description: u.email });
    await loadAll();
  };

  const openDelete = (u: UserRow) => {
    setUserToDelete(u);
    setDelOpen(true);
  };

  const submitDelete = async () => {
    if (!userToDelete) return;

    const r = await fetch(`${API_BASE}/api/admin/users/${userToDelete.id}`, {
      method: "DELETE",
      credentials: "include",
      headers: { Accept: "application/json" },
    });

    if (!r.ok) {
      const serverMsg = await readApiError(r);
      toast({
        title: "Failed",
        description: serverMsg || `Delete failed (HTTP ${r.status}).`,
        variant: "destructive",
      });
      return;
    }

    toast({ title: "User deleted", description: userToDelete.email });
    setDelOpen(false);
    setUserToDelete(null);
    await loadAll();
  };

  const isUserLocked = (u: UserRow) =>
    !!u.locked_until && new Date(u.locked_until) > new Date();

  const submitUnlock = async (u: UserRow) => {
    const r = await fetch(`${API_BASE}/api/admin/users/${u.id}/unlock`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
    });

    if (!r.ok) {
      const serverMsg = await readApiError(r);
      toast({
        title: "Failed",
        description: serverMsg || `Unlock failed (HTTP ${r.status}).`,
        variant: "destructive",
      });
      return;
    }

    toast({ title: "Account unlocked", description: u.email });
    await loadAll();
  };

  const formatExpiry = (dateStr: string | null) => {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    return date.toLocaleString();
  };

  return (
    <AdminGuard>
      <PageShell title="Manage Users" description="Create users with invite links and manage group membership.">
        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search users..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
              aria-label="Search users"
              data-testid="users-search-input"
            />
          </div>
          <div className="flex gap-2">
            <Button onClick={openAdd} data-testid="add-user-button">
              <Plus className="h-4 w-4 mr-2" />
              Add User
            </Button>
          </div>
        </div>

        {loading ? (
          <SkeletonTable rows={6} columns={4} />
        ) : loadError ? (
          <ErrorState message="Failed to load users" details={loadError} onRetry={loadAll} />
        ) : (
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Groups</TableHead>
                  <TableHead className="w-[100px]">Status</TableHead>
                  <TableHead className="w-[180px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="p-0">
                      <EmptyState
                        icon={<Search className="h-10 w-10" />}
                        title="No users found"
                        description={search ? "Try a different search term." : "Add a user to get started."}
                        actionLabel={!search ? "Add User" : undefined}
                        onAction={!search ? openAdd : undefined}
                      />
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((u) => (
                    <TableRow key={u.id} data-testid={`user-row-${u.email}`}>
                      <TableCell className="font-medium">
                        <div className="flex flex-col">
                          <span>{u.email}</span>
                          {!u.password_set_at && (
                            <span className="text-xs text-amber-600 dark:text-amber-400">
                              Pending invite
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {u.groups.length ? (
                            u.groups.map((g) => (
                              <Badge key={g.id} variant="secondary" className="text-xs">
                                {g.name}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-muted-foreground text-sm">None</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <Badge variant={u.is_active ? "secondary" : "outline"}>
                            {u.is_active ? "Active" : "Inactive"}
                          </Badge>
                          {isUserLocked(u) && (
                            <Badge variant="destructive" className="text-xs">
                              Locked
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEdit(u)}
                            aria-label={`Edit groups for ${u.email}`}
                            title="Edit groups"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>

                          {u.password_set_at ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openResetLink(u)}
                              aria-label={`Reset password for ${u.email}`}
                              title="Reset password link"
                            >
                              <KeyRound className="h-4 w-4" />
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openRegenInvite(u)}
                              aria-label={`Regenerate invite for ${u.email}`}
                              title="Regenerate invite link"
                            >
                              <RefreshCw className="h-4 w-4" />
                            </Button>
                          )}

                          {u.is_active ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openDeactivate(u)}
                              aria-label={`Deactivate ${u.email}`}
                              title="Deactivate"
                            >
                              <UserX className="h-4 w-4" />
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => void submitActivate(u)}
                              aria-label={`Activate ${u.email}`}
                              title="Activate"
                            >
                              <UserCheck className="h-4 w-4" />
                            </Button>
                          )}

                          {isUserLocked(u) && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => void submitUnlock(u)}
                              aria-label={`Unlock ${u.email}`}
                              title="Unlock account"
                              className="text-amber-600 hover:text-amber-700 dark:text-amber-400"
                            >
                              <LockOpen className="h-4 w-4" />
                            </Button>
                          )}

                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openDelete(u)}
                            aria-label={`Delete ${u.email}`}
                            title="Delete"
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

        {/* Add User Dialog */}
        <Dialog open={addOpen} onOpenChange={closeAddDialog}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Add User</DialogTitle>
              <DialogDescription>
                Create a new user. They will receive an invite link to set their password.
              </DialogDescription>
            </DialogHeader>

            {inviteLink ? (
              <div className="space-y-4 py-2">
                <Alert className="border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950">
                  <LinkIcon className="h-4 w-4 text-green-600 dark:text-green-400" />
                  <AlertDescription className="text-green-800 dark:text-green-200">
                    User created successfully! Share the invite link below:
                  </AlertDescription>
                </Alert>
                
                <div className="space-y-2">
                  <Label>Invite Link</Label>
                  <div className="flex gap-2">
                    <Input value={inviteLink} readOnly className="font-mono text-xs" />
                    <CopyButton text={inviteLink} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Expires: {formatExpiry(inviteLinkExpiry)}
                  </p>
                </div>

                <Alert>
                  <AlertDescription className="text-sm">
                    <strong>Important:</strong> This link is shown only once. Copy it now and share it securely with the user.
                  </AlertDescription>
                </Alert>
              </div>
            ) : (
              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label htmlFor="add-email">Email</Label>
                  <Input 
                    id="add-email" 
                    type="email"
                    value={addEmail} 
                    onChange={(e) => setAddEmail(e.target.value)} 
                    placeholder="user@example.com"
                    data-testid="add-user-email-input"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Groups (optional)</Label>
                  <div className="border rounded-md p-3 space-y-2 max-h-56 overflow-y-auto">
                    {groups.map((g) => (
                      <div key={g.id} className="flex items-center gap-2">
                        <Checkbox
                          id={`add-group-${g.id}`}
                          checked={addGroupIds.includes(g.id)}
                          onCheckedChange={() => setAddGroupIds((prev) => toggle(prev, g.id))}
                        />
                        <Label htmlFor={`add-group-${g.id}`} className="text-sm font-normal cursor-pointer">
                          {g.name}
                        </Label>
                      </div>
                    ))}
                    {groups.length === 0 && (
                      <div className="text-sm text-muted-foreground">No groups found.</div>
                    )}
                  </div>
                </div>
              </div>
            )}

            <DialogFooter>
              {inviteLink ? (
                <Button onClick={closeAddDialog}>Done</Button>
              ) : (
                <>
                  <Button variant="outline" onClick={closeAddDialog}>Cancel</Button>
                  <Button onClick={submitAdd} data-testid="add-user-submit-button">Create User</Button>
                </>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit Groups Dialog */}
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Edit User Groups</DialogTitle>
              <DialogDescription>
                Update group membership for <span className="font-medium">{editingUser?.email}</span>.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2 py-2">
              <Label>Groups</Label>
              <div className="border rounded-md p-3 space-y-2 max-h-56 overflow-y-auto">
                {groups.map((g) => (
                  <div key={g.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`edit-group-${g.id}`}
                      checked={editGroupIds.includes(g.id)}
                      onCheckedChange={() => setEditGroupIds((prev) => toggle(prev, g.id))}
                    />
                    <Label htmlFor={`edit-group-${g.id}`} className="text-sm font-normal cursor-pointer">
                      {g.name}
                    </Label>
                  </div>
                ))}
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
              <Button onClick={submitEditGroups}>Save Changes</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Reset Password Link Dialog */}
        <Dialog open={resetLinkOpen} onOpenChange={setResetLinkOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Generate Password Reset Link</DialogTitle>
              <DialogDescription>
                Generate a one-time password reset link for <span className="font-medium">{resetLinkUser?.email}</span>.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              {resetLink ? (
                <>
                  <Alert className="border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950">
                    <LinkIcon className="h-4 w-4 text-green-600 dark:text-green-400" />
                    <AlertDescription className="text-green-800 dark:text-green-200">
                      Reset link generated successfully!
                    </AlertDescription>
                  </Alert>
                  
                  <div className="space-y-2">
                    <Label>Reset Link</Label>
                    <div className="flex gap-2">
                      <Input value={resetLink} readOnly className="font-mono text-xs" />
                      <CopyButton text={resetLink} />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Expires: {formatExpiry(resetLinkExpiry)}
                    </p>
                  </div>

                  <Alert>
                    <AlertDescription className="text-sm">
                      <strong>Important:</strong> This link is shown only once. Copy it now and share it securely with the user.
                    </AlertDescription>
                  </Alert>
                </>
              ) : (
                <Alert>
                  <AlertDescription>
                    Click the button below to generate a secure one-time reset link. 
                    The link will expire in 60 minutes.
                  </AlertDescription>
                </Alert>
              )}
            </div>

            <DialogFooter>
              {resetLink ? (
                <Button onClick={() => setResetLinkOpen(false)}>Done</Button>
              ) : (
                <>
                  <Button variant="outline" onClick={() => setResetLinkOpen(false)}>Cancel</Button>
                  <Button onClick={generateResetLink} disabled={resetLinkLoading}>
                    {resetLinkLoading ? "Generating..." : "Generate Reset Link"}
                  </Button>
                </>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Regenerate Invite Link Dialog */}
        <Dialog open={regenInviteOpen} onOpenChange={setRegenInviteOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Regenerate Invite Link</DialogTitle>
              <DialogDescription>
                Generate a new invite link for <span className="font-medium">{regenInviteUser?.email}</span> who hasn't set their password yet.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              {regenInviteLink ? (
                <>
                  <Alert className="border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950">
                    <LinkIcon className="h-4 w-4 text-green-600 dark:text-green-400" />
                    <AlertDescription className="text-green-800 dark:text-green-200">
                      New invite link generated successfully!
                    </AlertDescription>
                  </Alert>
                  
                  <div className="space-y-2">
                    <Label>Invite Link</Label>
                    <div className="flex gap-2">
                      <Input value={regenInviteLink} readOnly className="font-mono text-xs" />
                      <CopyButton text={regenInviteLink} />
                    </div>
                  </div>

                  <Alert>
                    <AlertDescription className="text-sm">
                      <strong>Important:</strong> This link is shown only once. Copy it now and share it securely with the user.
                    </AlertDescription>
                  </Alert>
                </>
              ) : (
                <Alert>
                  <AlertDescription>
                    The previous invite link will be invalidated. Click the button below to generate a new invite link.
                  </AlertDescription>
                </Alert>
              )}
            </div>

            <DialogFooter>
              {regenInviteLink ? (
                <Button onClick={() => setRegenInviteOpen(false)}>Done</Button>
              ) : (
                <>
                  <Button variant="outline" onClick={() => setRegenInviteOpen(false)}>Cancel</Button>
                  <Button onClick={generateRegenInvite} disabled={regenInviteLinkLoading}>
                    {regenInviteLinkLoading ? "Generating..." : "Generate New Invite"}
                  </Button>
                </>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Deactivate Dialog */}
        <AlertDialog open={deactOpen} onOpenChange={setDeactOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Deactivate user</AlertDialogTitle>
              <AlertDialogDescription>
                Deactivate "{userToDeact?.email}"? They will no longer be able to log in.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={submitDeactivate}>Deactivate</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Delete Dialog */}
        <AlertDialog open={delOpen} onOpenChange={setDelOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete user</AlertDialogTitle>
              <AlertDialogDescription>
                Delete "{userToDelete?.email}"? This will permanently remove the user from the database.
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
