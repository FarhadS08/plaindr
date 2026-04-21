import { useState } from "react";
import { toast } from "sonner";
import {
  BookMarked,
  ExternalLink,
  Loader2,
  MoreHorizontal,
  Plus,
  Trash2,
} from "lucide-react";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { SubmitPolicyDialog } from "@/components/dashboard/SubmitPolicyDialog";
import { useActiveOrgId } from "@/_core/hooks/useActiveOrg";
import { trpc } from "@/lib/trpc";

/* ─────────────────────────────────────────────────────────────
 * /dashboard/library — user-submitted policies.
 *
 * Single route that flips scope based on the active org — mirrors the
 * watchlist and conversations patterns. Personal vs org is visible in
 * the header; the OrgSwitcher in the top bar is the control.
 * ───────────────────────────────────────────────────────────── */

export default function Library() {
  const organizationId = useActiveOrgId();
  const [submitOpen, setSubmitOpen] = useState(false);
  const [toDelete, setToDelete] = useState<{ id: string; url: string } | null>(
    null,
  );
  const utils = trpc.useUtils();

  const list = trpc.userPolicies.list.useQuery({
    organization_id: organizationId,
  });

  const del = trpc.userPolicies.delete.useMutation({
    onSuccess: async () => {
      toast.success("Policy removed");
      await utils.userPolicies.list.invalidate({
        organization_id: organizationId,
      });
      setToDelete(null);
    },
    onError: err => toast.error(err.message),
  });

  const rows = list.data ?? [];

  return (
    <DashboardShell
      crumbs={[{ label: "Library" }]}
      actions={
        <Button size="sm" onClick={() => setSubmitOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          Add policy
        </Button>
      }
    >
      <div className="max-w-5xl mx-auto py-8 space-y-6">
        <Header scope={organizationId ? "org" : "personal"} count={rows.length} />

        {list.isLoading ? (
          <SkeletonTable />
        ) : rows.length === 0 ? (
          <EmptyState
            scope={organizationId ? "org" : "personal"}
            onAdd={() => setSubmitOpen(true)}
          />
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead className="hidden md:table-cell">Source</TableHead>
                  <TableHead>Last scraped</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[60px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => (
                  <TableRow key={row.id}>
                    <TableCell className="max-w-[260px]">
                      <div className="font-medium truncate">
                        {row.title || hostOnly(row.url)}
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate font-mono">
                        {row.url}
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <a
                        href={row.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                      >
                        {hostOnly(row.url)}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.last_scraped_at
                        ? formatRelative(row.last_scraped_at)
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <StatusBadge
                        status={row.last_status}
                        isMirror={row.is_canonical_mirror}
                      />
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon" variant="ghost" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => window.open(row.url, "_blank")}
                          >
                            <ExternalLink className="h-4 w-4 mr-2" />
                            Open source
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() =>
                              setToDelete({ id: row.id, url: row.url })
                            }
                            className="text-destructive focus:text-destructive"
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Remove
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <SubmitPolicyDialog open={submitOpen} onOpenChange={setSubmitOpen} />

      <AlertDialog
        open={!!toDelete}
        onOpenChange={open => !open && setToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this policy?</AlertDialogTitle>
            <AlertDialogDescription>
              Plaindr will stop tracking{" "}
              <span className="font-mono">{toDelete && hostOnly(toDelete.url)}</span>.
              You can add it again anytime.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={del.isPending}
              onClick={() => toDelete && del.mutate({ id: toDelete.id })}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {del.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Remove"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardShell>
  );
}

/* ── header + empty + skeletons ───────────────────────────── */

function Header({
  scope,
  count,
}: {
  scope: "personal" | "org";
  count: number;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <div className="flex items-center gap-2">
          <BookMarked className="h-4 w-4 text-primary" />
          <h1 className="text-xl font-semibold">Library</h1>
          {count > 0 && (
            <Badge variant="outline" className="text-[10.5px] font-mono">
              {count}
            </Badge>
          )}
        </div>
        <p className="text-[12.5px] text-muted-foreground mt-1">
          {scope === "org"
            ? "Policies your organization has submitted for tracking."
            : "Policies you've submitted for personal tracking."}
        </p>
      </div>
    </div>
  );
}

function EmptyState({
  scope,
  onAdd,
}: {
  scope: "personal" | "org";
  onAdd: () => void;
}) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/20 py-16 text-center">
      <BookMarked className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
      <h2 className="text-sm font-semibold">
        {scope === "org"
          ? "No policies in this library yet"
          : "Your library is empty"}
      </h2>
      <p className="text-[12.5px] text-muted-foreground mt-1.5 mb-5 max-w-sm mx-auto">
        Paste any privacy policy, terms, or security page URL. We'll
        scrape it now and track changes going forward — so you never miss
        a quiet update.
      </p>
      <Button onClick={onAdd} size="sm" className="gap-2">
        <Plus className="h-4 w-4" />
        Add your first policy
      </Button>
    </div>
  );
}

function SkeletonTable() {
  return (
    <div className="rounded-lg border border-border divide-y divide-border">
      {[0, 1, 2].map(i => (
        <div key={i} className="p-3 flex items-center gap-4">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="h-4 w-24 ml-auto" />
        </div>
      ))}
    </div>
  );
}

function StatusBadge({
  status,
  isMirror,
}: {
  status: string;
  isMirror: boolean;
}) {
  if (isMirror) {
    return (
      <Badge variant="outline" className="text-[10.5px]">
        Tracked globally
      </Badge>
    );
  }
  if (status === "ok" || status === "updated" || status === "unchanged") {
    return (
      <Badge variant="outline" className="text-[10.5px] border-emerald-500/40 text-emerald-700 dark:text-emerald-400">
        {status === "updated" ? "Updated" : "OK"}
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge variant="outline" className="text-[10.5px] border-destructive/40 text-destructive">
        Failed
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-[10.5px] text-muted-foreground">
      Pending
    </Badge>
  );
}

/* ── helpers ──────────────────────────────────────────────── */

function hostOnly(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const days = Math.floor((now - d.getTime()) / (1000 * 60 * 60 * 24));
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
