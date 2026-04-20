import { useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Building2,
  Copy,
  Crown,
  Link2,
  Loader2,
  Mail,
  MoreHorizontal,
  Send,
  Shield,
  Trash2,
  UserMinus,
  Users,
} from "lucide-react";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

/* ─────────────────────────────────────────────────────────────
 * /settings/org — member management + danger zone.
 *
 * Requires an active organization. If the user is in personal mode
 * we just tell them, rather than guessing which org they meant.
 * Role-gated actions hide themselves instead of showing disabled
 * buttons: less visual noise, same security (server still enforces).
 * ───────────────────────────────────────────────────────────── */

export default function OrgSettings() {
  const active = trpc.organizations.getActive.useQuery();

  if (active.isLoading) {
    return (
      <DashboardShell crumbs={[{ label: "Organization" }]}>
        <div className="max-w-3xl mx-auto py-8 space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-64 w-full" />
        </div>
      </DashboardShell>
    );
  }

  if (!active.data) {
    return (
      <DashboardShell crumbs={[{ label: "Organization" }]}>
        <div className="max-w-3xl mx-auto py-16 text-center">
          <Building2 className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
          <h1 className="text-xl font-semibold mb-2">No organization selected</h1>
          <p className="text-sm text-muted-foreground mb-6">
            Switch to an organization from the top-left menu, or create one.
          </p>
          <Button asChild>
            <Link href="/dashboard">Back to dashboard</Link>
          </Button>
        </div>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell
      crumbs={[
        { label: "Settings" },
        { label: active.data.name },
      ]}
    >
      <div className="max-w-3xl mx-auto py-8 space-y-6">
        <OrgHeaderCard
          orgId={active.data.id}
          name={active.data.name}
          slug={active.data.slug}
          role={active.data.role}
        />
        <MembersCard orgId={active.data.id} role={active.data.role} />
        {(active.data.role === "owner" || active.data.role === "admin") && (
          <InvitesCard orgId={active.data.id} />
        )}
        <DangerZoneCard
          orgId={active.data.id}
          name={active.data.name}
          role={active.data.role}
        />
      </div>
    </DashboardShell>
  );
}

/* ── name + slug header ───────────────────────────────────── */

function OrgHeaderCard({
  orgId,
  name,
  slug,
  role,
}: {
  orgId: string;
  name: string;
  slug: string;
  role: "owner" | "admin" | "member";
}) {
  const utils = trpc.useUtils();
  const [draft, setDraft] = useState(name);
  const canEdit = role === "owner" || role === "admin";

  const rename = trpc.organizations.rename.useMutation({
    onSuccess: async () => {
      toast.success("Name updated");
      await utils.organizations.getActive.invalidate();
      await utils.organizations.list.invalidate();
    },
    onError: err => toast.error(err.message),
  });

  const dirty = draft.trim() !== name && draft.trim().length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Building2 className="h-4 w-4 text-primary" />
          Organization
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label htmlFor="org-name">Name</Label>
          <Input
            id="org-name"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            disabled={!canEdit}
            maxLength={100}
            className="mt-1.5"
          />
        </div>
        <div>
          <Label>Slug</Label>
          <div className="mt-1.5 h-10 px-3 flex items-center rounded-md border border-border bg-muted/40 text-sm font-mono text-muted-foreground">
            {slug}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            Slug is permanent so invite links keep working.
          </p>
        </div>
        {canEdit && (
          <div className="flex justify-end">
            <Button
              size="sm"
              disabled={!dirty || rename.isPending}
              onClick={() =>
                rename.mutate({ organization_id: orgId, name: draft.trim() })
              }
            >
              {rename.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ── member list + role actions ───────────────────────────── */

function MembersCard({
  orgId,
  role,
}: {
  orgId: string;
  role: "owner" | "admin" | "member";
}) {
  const utils = trpc.useUtils();
  const members = trpc.organizations.members.useQuery({ organization_id: orgId });

  const updateRole = trpc.organizations.updateMemberRole.useMutation({
    onSuccess: async () => {
      toast.success("Role updated");
      await utils.organizations.members.invalidate({ organization_id: orgId });
    },
    onError: err => toast.error(err.message),
  });

  const removeMember = trpc.organizations.removeMember.useMutation({
    onSuccess: async () => {
      toast.success("Member removed");
      await utils.organizations.members.invalidate({ organization_id: orgId });
    },
    onError: err => toast.error(err.message),
  });

  const canManage = role === "owner" || role === "admin";

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="h-4 w-4 text-primary" />
          Members
        </CardTitle>
        <span className="text-xs text-muted-foreground">
          {members.data?.length ?? "—"} total
        </span>
      </CardHeader>
      <CardContent>
        {members.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : (
          <div className="divide-y divide-border">
            {members.data?.map(m => (
              <div
                key={m.user_id}
                className="flex items-center justify-between py-3"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">
                    {m.is_self ? "You" : `${m.user_id.slice(0, 8)}…`}
                  </div>
                  <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                    <RoleBadge role={m.role} />
                    <span>joined {formatDate(m.joined_at)}</span>
                  </div>
                </div>
                {canManage && !m.is_self && (
                  <div className="flex items-center gap-2">
                    <Select
                      value={m.role}
                      onValueChange={v =>
                        updateRole.mutate({
                          organization_id: orgId,
                          user_id: m.user_id,
                          role: v as "owner" | "admin" | "member",
                        })
                      }
                    >
                      <SelectTrigger className="h-8 w-[120px] text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="member">Member</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                        {role === "owner" && (
                          <SelectItem value="owner">Owner</SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="icon" variant="ghost" className="h-8 w-8">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() =>
                            removeMember.mutate({
                              organization_id: orgId,
                              user_id: m.user_id,
                            })
                          }
                          className="text-destructive focus:text-destructive"
                        >
                          <UserMinus className="h-4 w-4 mr-2" />
                          Remove
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RoleBadge({ role }: { role: "owner" | "admin" | "member" }) {
  const Icon = role === "owner" ? Crown : role === "admin" ? Shield : Users;
  const tint =
    role === "owner"
      ? "text-amber-600 dark:text-amber-400"
      : role === "admin"
        ? "text-violet-600 dark:text-violet-400"
        : "text-muted-foreground";
  return (
    <span className={cn("inline-flex items-center gap-1 uppercase tracking-wider font-mono text-[10px]", tint)}>
      <Icon className="h-3 w-3" />
      {role}
    </span>
  );
}

/* ── leave / delete ───────────────────────────────────────── */

function DangerZoneCard({
  orgId,
  name,
  role,
}: {
  orgId: string;
  name: string;
  role: "owner" | "admin" | "member";
}) {
  const qc = useQueryClient();
  const utils = trpc.useUtils();
  const [confirm, setConfirm] = useState("");

  const leave = trpc.organizations.leave.useMutation({
    onSuccess: async () => {
      toast.success("Left organization");
      await utils.organizations.list.invalidate();
      await utils.organizations.getActive.invalidate();
      await qc.invalidateQueries();
      window.location.href = "/dashboard";
    },
    onError: err => toast.error(err.message),
  });

  const del = trpc.organizations.delete.useMutation({
    onSuccess: async () => {
      toast.success("Organization deleted");
      await utils.organizations.list.invalidate();
      await utils.organizations.getActive.invalidate();
      await qc.invalidateQueries();
      window.location.href = "/dashboard";
    },
    onError: err => toast.error(err.message),
  });

  return (
    <Card className="border-destructive/30">
      <CardHeader>
        <CardTitle className="text-base text-destructive">Danger zone</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium">Leave organization</div>
            <p className="text-[12px] text-muted-foreground">
              You'll lose access to shared watchlists and conversations.
            </p>
          </div>
          <Button
            variant="outline"
            disabled={leave.isPending}
            onClick={() => leave.mutate({ organization_id: orgId })}
          >
            {leave.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Leave"
            )}
          </Button>
        </div>

        {role === "owner" && (
          <div className="pt-4 border-t border-border space-y-3">
            <div>
              <div className="text-sm font-medium">Delete organization</div>
              <p className="text-[12px] text-muted-foreground">
                Removes the org and every member. This cannot be undone.
                Type <span className="font-mono">{name}</span> below to confirm.
              </p>
            </div>
            <Input
              placeholder={name}
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
            />
            <div className="flex justify-end">
              <Button
                variant="destructive"
                disabled={confirm !== name || del.isPending}
                onClick={() => del.mutate({ organization_id: orgId })}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                {del.isPending ? "Deleting…" : "Delete"}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ── invites ──────────────────────────────────────────────── */

function InvitesCard({ orgId }: { orgId: string }) {
  const utils = trpc.useUtils();
  const invites = trpc.invites.list.useQuery({ organization_id: orgId });
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");

  const create = trpc.invites.create.useMutation({
    onSuccess: async inv => {
      toast.success(
        inv.email ? `Invite sent to ${inv.email}` : "Invite link created",
      );
      setEmail("");
      await utils.invites.list.invalidate({ organization_id: orgId });
    },
    onError: err => toast.error(err.message),
  });

  const revoke = trpc.invites.revoke.useMutation({
    onSuccess: async () => {
      toast.success("Invite revoked");
      await utils.invites.list.invalidate({ organization_id: orgId });
    },
    onError: err => toast.error(err.message),
  });

  function inviteUrl(code: string): string {
    return `${window.location.origin}/invite/${code}`;
  }

  const pending = (invites.data ?? []).filter(i => !i.accepted_at);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Mail className="h-4 w-4 text-primary" />
          Invites
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <form
          onSubmit={e => {
            e.preventDefault();
            create.mutate({
              organization_id: orgId,
              email: email.trim() || null,
              role,
            });
          }}
          className="flex flex-col sm:flex-row gap-2"
        >
          <Input
            type="email"
            placeholder="teammate@work.com (optional — leave blank for a link)"
            value={email}
            onChange={e => setEmail(e.target.value)}
            className="flex-1"
          />
          <Select value={role} onValueChange={v => setRole(v as "admin" | "member")}>
            <SelectTrigger className="sm:w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="member">Member</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
            </SelectContent>
          </Select>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Send className="h-4 w-4 mr-2" />
                Invite
              </>
            )}
          </Button>
        </form>

        {pending.length === 0 ? (
          <p className="text-[12px] text-muted-foreground text-center py-4">
            No pending invites.
          </p>
        ) : (
          <div className="divide-y divide-border">
            {pending.map(i => (
              <div key={i.id} className="flex items-center justify-between py-3 gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate flex items-center gap-2">
                    {i.email ? (
                      <>
                        <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                        {i.email}
                      </>
                    ) : (
                      <>
                        <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
                        Shareable link
                      </>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                    <RoleBadge role={i.role as "admin" | "member"} />
                    <span>expires {formatDate(i.expires_at)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      navigator.clipboard.writeText(inviteUrl(i.code));
                      toast.success("Link copied");
                    }}
                  >
                    <Copy className="h-3.5 w-3.5 mr-1.5" />
                    Copy
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    onClick={() => revoke.mutate({ invite_id: i.id })}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
