import { Link } from "wouter";
import {
  ArrowRight,
  Bookmark,
  Building2,
  MessageSquare,
  Send,
  ShieldCheck,
  Users,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { RequireOrg } from "./_RequireOrg";
import { RoleBadge, formatDate } from "./_helpers";

/* ─────────────────────────────────────────────────────────────
 * /org — the org home.
 *
 * Three tiles at the top (members, pending invites, shared
 * watchlist count) give the health-at-a-glance. Below, two quick
 * glances: a compressed member list and a compressed recent
 * shared-conversation list. Both link out to the dedicated pages
 * for detail — this is a dashboard, not a workspace.
 * ───────────────────────────────────────────────────────────── */

export default function OrgOverview() {
  return (
    <RequireOrg>
      {org => (
        <div className="max-w-5xl mx-auto py-8 space-y-6">
          <Header orgName={org.name} orgRole={org.role} />
          <StatsRow orgId={org.id} role={org.role} />
          <CompliancePreview orgId={org.id} role={org.role} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <MembersPreview orgId={org.id} />
            <ActivityPreview orgId={org.id} />
          </div>
        </div>
      )}
    </RequireOrg>
  );
}

function Header({
  orgName,
  orgRole,
}: {
  orgName: string;
  orgRole: "owner" | "admin" | "member";
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <div className="h-10 w-10 rounded-xl bg-violet-500/10 flex items-center justify-center shrink-0">
          <Building2 className="h-5 w-5 text-violet-600 dark:text-violet-300" />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-semibold truncate">{orgName}</h1>
          <div className="text-[11px] text-muted-foreground">
            You're {orgRole === "owner" || orgRole === "admin" ? "an" : "a"}{" "}
            <RoleBadge role={orgRole} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── tiles ────────────────────────────────────────────────── */

function StatsRow({
  orgId,
  role,
}: {
  orgId: string;
  role: "owner" | "admin" | "member";
}) {
  const members = trpc.organizations.members.useQuery({
    organization_id: orgId,
  });
  const invites =
    role === "owner" || role === "admin"
      ? trpc.invites.list.useQuery({ organization_id: orgId })
      : null;
  const watchlist = trpc.watchlist.list.useQuery({
    organization_id: orgId,
  });

  const pendingInvites =
    invites?.data?.filter(i => !i.accepted_at).length ?? null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <StatTile
        icon={Users}
        label="Members"
        value={members.data?.length ?? null}
        href="/org/members"
      />
      <StatTile
        icon={Send}
        label="Pending invites"
        value={pendingInvites}
        href="/org/invites"
        muted={invites === null}
      />
      <StatTile
        icon={Bookmark}
        label="Shared watchlist"
        value={watchlist.data?.length ?? null}
        href="/dashboard"
      />
    </div>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
  href,
  muted,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number | null;
  href: string;
  muted?: boolean;
}) {
  const display = value === null ? <Skeleton className="h-6 w-8" /> : value;
  const content = (
    <Card
      className={cn(
        "transition-colors",
        muted ? "opacity-60" : "hover:border-primary/40",
      )}
    >
      <CardContent className="p-4 flex items-center gap-3">
        <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10.5px] uppercase tracking-[0.14em] font-mono text-muted-foreground">
            {label}
          </div>
          <div className="text-lg font-semibold mt-0.5">{display}</div>
        </div>
        {!muted && (
          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        )}
      </CardContent>
    </Card>
  );
  return muted ? content : <Link href={href}>{content}</Link>;
}

/* ── compliance preview ──────────────────────────────────── */

function CompliancePreview({
  orgId,
  role,
}: {
  orgId: string;
  role: "owner" | "admin" | "member";
}) {
  const profile = trpc.organizations.getProfile.useQuery({
    organization_id: orgId,
  });
  const reqs =
    (profile.data?.compliance_requirements as string[] | null) ?? [];
  const residency = profile.data?.data_residency as string | null;
  const hasAny = reqs.length > 0 || !!residency;
  const isOwner = role === "owner";

  if (!hasAny) {
    // Empty profile prompt — nudges the owner; quietly informs others.
    return (
      <Card className="border-dashed">
        <CardContent className="py-4 flex items-center gap-3">
          <ShieldCheck className="h-4 w-4 text-muted-foreground shrink-0" />
          <p className="text-sm flex-1">
            <span className="font-medium">No compliance profile yet.</span>{" "}
            <span className="text-muted-foreground">
              {isOwner
                ? "Add your frameworks so Plaindr flags tools that don't meet them."
                : "Ask the owner to add the org's compliance frameworks."}
            </span>
          </p>
          {isOwner && (
            <Button asChild size="sm" variant="outline" className="gap-1.5">
              <Link href="/org/profile">
                Set profile
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="py-4 flex items-center gap-3">
        <ShieldCheck className="h-4 w-4 text-primary shrink-0" />
        <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
          {reqs.map(r => (
            <span
              key={r}
              className="inline-flex items-center rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 text-[11px] font-medium"
            >
              {r}
            </span>
          ))}
          {residency && (
            <span className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[11px] font-mono text-muted-foreground">
              {residency}
            </span>
          )}
        </div>
        {isOwner && (
          <Button asChild size="sm" variant="ghost" className="h-7 text-xs">
            <Link href="/org/profile">
              Edit
              <ArrowRight className="h-3 w-3 ml-1" />
            </Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

/* ── member preview ───────────────────────────────────────── */

function MembersPreview({ orgId }: { orgId: string }) {
  const members = trpc.organizations.members.useQuery({
    organization_id: orgId,
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          Members
        </CardTitle>
        <Button asChild size="sm" variant="ghost" className="h-7 text-xs">
          <Link href="/org/members">
            Manage
            <ArrowRight className="h-3 w-3 ml-1" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        {members.isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map(i => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {members.data?.slice(0, 5).map(m => (
              <div
                key={m.user_id}
                className="flex items-center justify-between py-2.5"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">
                    {m.is_self ? "You" : `${m.user_id.slice(0, 8)}…`}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    joined {formatDate(m.joined_at)}
                  </div>
                </div>
                <RoleBadge role={m.role} />
              </div>
            ))}
            {(members.data?.length ?? 0) > 5 && (
              <div className="pt-2 text-[11px] text-muted-foreground text-center">
                +{(members.data?.length ?? 0) - 5} more
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ── activity preview (recent shared conversations) ──────── */

function ActivityPreview({ orgId }: { orgId: string }) {
  const convos = trpc.conversations.list.useQuery({
    organization_id: orgId,
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-primary" />
          Recent shared chats
        </CardTitle>
        <Button asChild size="sm" variant="ghost" className="h-7 text-xs">
          <Link href="/dashboard/chat">
            Open
            <ArrowRight className="h-3 w-3 ml-1" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        {convos.isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map(i => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : (convos.data?.length ?? 0) === 0 ? (
          <div className="py-8 text-center text-[12px] text-muted-foreground">
            No shared conversations yet.
            <br />
            Anything you ask while in this org context will show up here.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {convos.data?.slice(0, 5).map(c => (
              <Link
                key={c.id}
                href={`/dashboard/chat?id=${c.id}`}
                className="flex items-center justify-between py-2.5 hover:bg-muted/40 -mx-2 px-2 rounded-md transition-colors"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">
                    {c.title ?? "Untitled"}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {formatDate(c.updated_at ?? c.created_at)}
                  </div>
                </div>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
