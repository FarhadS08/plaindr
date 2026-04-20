import type { ReactNode } from "react";
import { Link } from "wouter";
import { Building2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DashboardShell, type Crumb } from "@/components/dashboard/DashboardShell";

/* ─────────────────────────────────────────────────────────────
 * RequireOrg — wraps every /org/* page.
 *
 * Pulls the active organization once so each child page gets
 * consistent loading / empty / ready states without each one
 * rolling its own. If the user is in personal mode we nudge them
 * toward switching rather than silently 404ing.
 * ───────────────────────────────────────────────────────────── */

export type ActiveOrg = {
  id: string;
  name: string;
  slug: string;
  role: "owner" | "admin" | "member";
};

export function RequireOrg({
  crumbs = [],
  children,
}: {
  crumbs?: Crumb[];
  children: (org: ActiveOrg) => ReactNode;
}) {
  const active = trpc.organizations.getActive.useQuery();

  if (active.isLoading) {
    return (
      <DashboardShell crumbs={[{ label: "Organization" }, ...crumbs]}>
        <div className="max-w-4xl mx-auto py-8 space-y-4">
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
        { label: active.data.name, href: "/org" },
        ...crumbs,
      ]}
    >
      {children(active.data)}
    </DashboardShell>
  );
}
