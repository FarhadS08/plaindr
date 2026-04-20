import { useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import {
  Copy,
  Link2,
  Loader2,
  Lock,
  Mail,
  Send,
  Trash2,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RequireOrg } from "./_RequireOrg";
import { RoleBadge, formatDate, type Role } from "./_helpers";

export default function OrgInvites() {
  return (
    <RequireOrg crumbs={[{ label: "Invites" }]}>
      {org => {
        if (org.role !== "owner" && org.role !== "admin") {
          return (
            <div className="max-w-2xl mx-auto py-16 text-center">
              <Lock className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
              <h1 className="text-xl font-semibold mb-2">Admins only</h1>
              <p className="text-sm text-muted-foreground mb-6">
                Only org admins can send or manage invites.
              </p>
              <Button asChild>
                <Link href="/org">Back to overview</Link>
              </Button>
            </div>
          );
        }
        return (
          <div className="max-w-3xl mx-auto py-8 space-y-6">
            <InvitesCard orgId={org.id} />
          </div>
        );
      }}
    </RequireOrg>
  );
}

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
          <Select
            value={role}
            onValueChange={v => setRole(v as "admin" | "member")}
          >
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
              <div
                key={i.id}
                className="flex items-center justify-between py-3 gap-3"
              >
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
                    <RoleBadge role={i.role as Role} />
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
