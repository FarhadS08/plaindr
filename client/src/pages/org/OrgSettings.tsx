import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Building2, Loader2, Trash2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RequireOrg } from "./_RequireOrg";
import type { Role } from "./_helpers";

export default function OrgSettings() {
  return (
    <RequireOrg crumbs={[{ label: "Settings" }]}>
      {org => (
        <div className="max-w-3xl mx-auto py-8 space-y-6">
          <OrgHeaderCard
            orgId={org.id}
            name={org.name}
            slug={org.slug}
            role={org.role}
          />
          <DangerZoneCard
            orgId={org.id}
            name={org.name}
            role={org.role}
          />
        </div>
      )}
    </RequireOrg>
  );
}

function OrgHeaderCard({
  orgId,
  name,
  slug,
  role,
}: {
  orgId: string;
  name: string;
  slug: string;
  role: Role;
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

function DangerZoneCard({
  orgId,
  name,
  role,
}: {
  orgId: string;
  name: string;
  role: Role;
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
                Removes the org and every member. This cannot be undone. Type{" "}
                <span className="font-mono">{name}</span> below to confirm.
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
