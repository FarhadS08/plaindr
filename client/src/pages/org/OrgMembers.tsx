import { toast } from "sonner";
import { MoreHorizontal, UserMinus, Users } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
import { RequireOrg } from "./_RequireOrg";
import { RoleBadge, formatDate, type Role } from "./_helpers";

export default function OrgMembers() {
  return (
    <RequireOrg crumbs={[{ label: "Members" }]}>
      {org => (
        <div className="max-w-3xl mx-auto py-8 space-y-6">
          <MembersCard orgId={org.id} role={org.role} />
        </div>
      )}
    </RequireOrg>
  );
}

function MembersCard({ orgId, role }: { orgId: string; role: Role }) {
  const utils = trpc.useUtils();
  const members = trpc.organizations.members.useQuery({
    organization_id: orgId,
  });

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
        <CardTitle className="text-base flex items-center gap-2">
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
                          role: v as Role,
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
